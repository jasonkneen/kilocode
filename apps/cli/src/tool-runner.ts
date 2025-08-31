import fs from "node:fs/promises"
import fssync from "node:fs"
import path from "node:path"
import { exec as execCb } from "node:child_process"
import { promisify } from "node:util"

import { AssistantMessageParser } from "../../../src/core/assistant-message/AssistantMessageParser.js"
import type {
	ToolUse,
	ExecuteCommandToolUse,
	ReadFileToolUse,
	WriteToFileToolUse,
	InsertCodeBlockToolUse,
	SearchFilesToolUse,
	ListFilesToolUse,
	SearchAndReplaceToolUse,
	AskFollowupQuestionToolUse,
	AttemptCompletionToolUse,
	NewTaskToolUse,
	SwitchModeToolUse,
	ListCodeDefinitionNamesToolUse,
	CodebaseSearchToolUse,
	SimpleReadFileToolUse,
	EditFileToolUse,
	FetchInstructionsToolUse,
	AccessMcpResourceToolUse,
} from "../../../src/shared/tools.js"
import { MultiSearchReplaceDiffStrategy } from "../../../src/core/diff/strategies/multi-search-replace.js"
import type { ToolUse as GenericToolUse } from "../../../src/shared/tools.js"

// MCP + CLI state helpers
import { createCliExtensionContext } from "./shims/vscode.js"
import { ensureSettingsDirectoryExists } from "../../../src/utils/globalContext.js"
import { GlobalFileNames } from "../../../src/shared/globalFileNames.js"
import { loadMcpSettings, resolveProjectMcpPath, callMcpTool } from "./mcp.js"

const exec = promisify(execCb)

// Basic ignore functionality (simplified version of RooIgnoreController)
let ignoreInstance: any = null
let lastIgnoreCheck = 0
const IGNORE_CACHE_TTL = 5000 // 5 seconds

function getIgnoreInstance(cwd: string) {
	const now = Date.now()
	if (ignoreInstance && now - lastIgnoreCheck < IGNORE_CACHE_TTL) {
		return ignoreInstance
	}

	try {
		// Try to load .rooignore file
		const rooignorePath = path.join(cwd, ".rooignore")
		if (fssync.existsSync(rooignorePath)) {
			const ignore = require("ignore")
			const ignoreContent = fssync.readFileSync(rooignorePath, "utf8")
			ignoreInstance = ignore().add(ignoreContent)
		} else {
			// Fallback to default patterns
			const ignore = require("ignore")
			const defaultPatterns = [
				"node_modules/**",
				".git/**",
				"dist/**",
				"out/**",
				"build/**",
				"bundle/**",
				"vendor/**",
				"tmp/**",
				"temp/**",
				"__pycache__/**",
				"env/**",
				"venv/**",
				"Pods/**",
				"target/**",
				"deps/**",
				"pkg/**",
				".*/**", // Hidden directories
			]
			ignoreInstance = ignore().add(defaultPatterns)
		}
		lastIgnoreCheck = now
	} catch (e) {
		// If ignore fails, create a basic ignore instance
		const ignore = require("ignore")
		ignoreInstance = ignore().add(["node_modules/**", ".git/**"])
	}

	return ignoreInstance
}

function isPathIgnored(fp: string, cwd: string = process.cwd()): boolean {
	try {
		const relativePath = path.relative(cwd, fp)
		if (relativePath.startsWith("..")) return false // Outside of cwd

		const ignore = getIgnoreInstance(cwd)
		return ignore.ignores(relativePath)
	} catch (e) {
		// Fallback to basic checks
		const parts = fp.split(path.sep)
		const commonIgnores = ["node_modules", ".git", "dist", "build"]
		return parts.some((part) => commonIgnores.includes(part) || part.startsWith("."))
	}
}

export type ToolExecution = {
	name: string
	params: Record<string, string | undefined>
	output: string
}

export function parseToolUses(text: string): ToolUse[] {
	const parser = new AssistantMessageParser()
	parser.processChunk(text)
	const blocks = parser.getContentBlocks()
	return blocks.filter((b): b is ToolUse => b.type === "tool_use")
}

export async function executeTool(cwd: string, tool: ToolUse): Promise<ToolExecution> {
	switch (tool.name) {
		case "execute_command":
			return runExecuteCommand(cwd, tool as ExecuteCommandToolUse)
		case "read_file":
			return runReadFile(cwd, tool as ReadFileToolUse)
		case "write_to_file":
			return runWriteToFile(cwd, tool as WriteToFileToolUse)
		case "insert_content":
			return runInsertContent(cwd, tool as InsertCodeBlockToolUse)
		case "list_files":
			return runListFiles(cwd, tool as ListFilesToolUse)
		case "search_files":
			return runSearchFiles(cwd, tool as SearchFilesToolUse)
		case "search_and_replace":
			return runSearchAndReplace(cwd, tool as SearchAndReplaceToolUse)
		case "apply_diff":
			return runApplyDiff(cwd, tool as GenericToolUse)
		case "ask_followup_question":
			return runAskFollowupQuestion(cwd, tool as AskFollowupQuestionToolUse)
		case "attempt_completion":
			return runAttemptCompletion(cwd, tool as AttemptCompletionToolUse)
		case "new_task":
			return runNewTask(cwd, tool as NewTaskToolUse)
		case "switch_mode":
			return runSwitchMode(cwd, tool as SwitchModeToolUse)
		case "list_code_definition_names":
			return runListCodeDefinitionNames(cwd, tool as ListCodeDefinitionNamesToolUse)
		case "codebase_search":
			return runCodebaseSearch(cwd, tool as CodebaseSearchToolUse)
		case "update_todo_list":
			return runUpdateTodoList(cwd, tool as GenericToolUse)
		case "use_mcp_tool":
			return runUseMcpTool(cwd, tool as GenericToolUse)
		// Missing tools from extension
		case "simple_read_file":
			return runSimpleReadFile(cwd, tool as SimpleReadFileToolUse)
		case "edit_file":
			return runEditFile(cwd, tool as EditFileToolUse)
		case "fetch_instructions":
			return runFetchInstructions(cwd, tool as FetchInstructionsToolUse)
		case "access_mcp_resource":
			return runAccessMcpResource(cwd, tool as AccessMcpResourceToolUse)
		default:
			return { name: tool.name, params: tool.params, output: `Unsupported tool: ${tool.name}` }
	}
}

async function runExecuteCommand(defaultCwd: string, tool: ExecuteCommandToolUse): Promise<ToolExecution> {
	const cmd = (tool.params.command || "").trim()
	const cwd = tool.params.cwd ? path.resolve(defaultCwd, tool.params.cwd) : defaultCwd
	if (!cmd) return { name: tool.name, params: tool.params, output: "Missing command" }
	try {
		const { stdout, stderr } = await exec(cmd, { cwd, maxBuffer: 10 * 1024 * 1024, env: process.env })
		const out =
			[stderr ? `[stderr]\n${stderr.trim()}` : "", stdout ? `[stdout]\n${stdout.trim()}` : ""]
				.filter(Boolean)
				.join("\n\n") || "(no output)"
		return { name: tool.name, params: tool.params, output: out }
	} catch (e: any) {
		return {
			name: tool.name,
			params: tool.params,
			output: `Command failed (exit=${e?.code ?? "unknown"}):\n${e?.stderr || e?.message || String(e)}`,
		}
	}
}

async function runReadFile(defaultCwd: string, tool: ReadFileToolUse): Promise<ToolExecution> {
	const p = (tool.params.path || "").trim()
	if (!p) return { name: tool.name, params: tool.params, output: "Missing path" }
	const fp = path.resolve(defaultCwd, p)
	if (isPathIgnored(fp, defaultCwd)) {
		return { name: tool.name, params: tool.params, output: `Access to ${fp} is blocked by ignore rules.` }
	}
	try {
		const data = await fs.readFile(fp, "utf8")
		const start = tool.params.start_line ? parseInt(tool.params.start_line, 10) : undefined
		const end = tool.params.end_line ? parseInt(tool.params.end_line, 10) : undefined
		const lines = data.split("\n")
		const slice = lines.slice(start ? Math.max(0, start - 1) : 0, end ? Math.max(0, end) : undefined)
		return { name: tool.name, params: tool.params, output: slice.join("\n") }
	} catch (e: any) {
		return { name: tool.name, params: tool.params, output: `Failed to read ${fp}: ${e?.message || String(e)}` }
	}
}

async function runWriteToFile(defaultCwd: string, tool: WriteToFileToolUse): Promise<ToolExecution> {
	const p = (tool.params.path || "").trim()
	const content = tool.params.content ?? ""
	if (!p) return { name: tool.name, params: tool.params, output: "Missing path" }
	const fp = path.resolve(defaultCwd, p)
	try {
		await fs.mkdir(path.dirname(fp), { recursive: true })
		await fs.writeFile(fp, content, "utf8")
		const lineCount = content.split("\n").length
		return { name: tool.name, params: tool.params, output: `Wrote ${lineCount} lines to ${fp}` }
	} catch (e: any) {
		return { name: tool.name, params: tool.params, output: `Failed to write ${fp}: ${e?.message || String(e)}` }
	}
}

async function runInsertContent(defaultCwd: string, tool: InsertCodeBlockToolUse): Promise<ToolExecution> {
	const p = (tool.params.path || "").trim()
	const content = tool.params.content ?? ""
	const line = tool.params.line ? parseInt(tool.params.line, 10) : undefined
	if (!p || !line) return { name: tool.name, params: tool.params, output: "Missing path or line" }
	const fp = path.resolve(defaultCwd, p)
	try {
		const data = await fs.readFile(fp, "utf8")
		const lines = data.split("\n")
		const idx = Math.max(0, Math.min(lines.length, line - 1))
		lines.splice(idx, 0, content)
		await fs.writeFile(fp, lines.join("\n"), "utf8")
		return { name: tool.name, params: tool.params, output: `Inserted content at line ${line} in ${fp}` }
	} catch (e: any) {
		return { name: tool.name, params: tool.params, output: `Failed to insert content: ${e?.message || String(e)}` }
	}
}

async function runListFiles(defaultCwd: string, tool: ListFilesToolUse): Promise<ToolExecution> {
	const base = path.resolve(defaultCwd, (tool.params.path || ".").trim() || ".")
	const recursive = (tool.params.recursive || "").toLowerCase() === "true"
	const out: string[] = []
	async function walk(dir: string) {
		const entries = await fs.readdir(dir, { withFileTypes: true })
		for (const e of entries) {
			const fp = path.join(dir, e.name)
			const relativePath = path.relative(base, fp) || "."

			// Skip ignored paths
			if (isPathIgnored(fp, base)) continue

			if (e.isDirectory()) {
				out.push(relativePath)
				if (recursive) await walk(fp)
			} else {
				out.push(relativePath)
			}
		}
	}
	try {
		await walk(base)
		return { name: tool.name, params: tool.params, output: out.sort().join("\n") }
	} catch (e: any) {
		return { name: tool.name, params: tool.params, output: `Failed to list files: ${e?.message || String(e)}` }
	}
}

async function runSearchFiles(defaultCwd: string, tool: SearchFilesToolUse): Promise<ToolExecution> {
	const base = path.resolve(defaultCwd, (tool.params.path || ".").trim() || ".")
	const pattern = tool.params.file_pattern?.trim()
	const regexStr = tool.params.regex?.trim()
	let regex: RegExp | null = null
	try {
		if (regexStr) regex = new RegExp(regexStr, "m")
	} catch (e) {
		return { name: tool.name, params: tool.params, output: `Invalid regex: ${regexStr}` }
	}
	const out: string[] = []
	async function walk(dir: string) {
		const entries = await fs.readdir(dir, { withFileTypes: true })
		for (const e of entries) {
			const fp = path.join(dir, e.name)
			if (e.isDirectory()) {
				if (isPathIgnored(fp, base)) continue
				await walk(fp)
				continue
			}
			if (pattern && !minimatch(e.name, pattern)) continue
			if (regex) {
				const data = await fs.readFile(fp, "utf8").catch(() => "")
				if (regex.test(data)) out.push(path.relative(base, fp))
			} else {
				out.push(path.relative(base, fp))
			}
		}
	}
	try {
		await walk(base)
		return { name: tool.name, params: tool.params, output: out.sort().join("\n") }
	} catch (e: any) {
		return { name: tool.name, params: tool.params, output: `Search failed: ${e?.message || String(e)}` }
	}
}

function minimatch(name: string, pattern: string): boolean {
	// Very small glob: supports *, ?
	const esc = (s: string) => s.replace(/[.+^${}()|\[\]\\]/g, "\\$&")
	const re = "^" + pattern.split("*").map(esc).join(".*").replace(/\?/g, ".") + "$"
	return new RegExp(re).test(name)
}

async function runSearchAndReplace(defaultCwd: string, tool: SearchAndReplaceToolUse): Promise<ToolExecution> {
	const p = (tool.params.path || "").trim()
	const search = tool.params.search || ""
	const replace = tool.params.replace || ""
	if (!p || !search) return { name: tool.name, params: tool.params, output: "Missing path or search" }
	const fp = path.resolve(defaultCwd, p)
	try {
		const data = await fs.readFile(fp, "utf8")
		let re: RegExp
		if ((tool.params.use_regex || "").toLowerCase() === "true") {
			const flags = (tool.params.ignore_case || "").toLowerCase() === "true" ? "gi" : "g"
			re = new RegExp(search, flags)
		} else {
			const esc = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
			const flags = (tool.params.ignore_case || "").toLowerCase() === "true" ? "gi" : "g"
			re = new RegExp(esc, flags)
		}
		const newData = data.replace(re, replace)
		await fs.writeFile(fp, newData, "utf8")
		return { name: tool.name, params: tool.params, output: `Replaced occurrences in ${fp}` }
	} catch (e: any) {
		return { name: tool.name, params: tool.params, output: `Search and replace failed: ${e?.message || String(e)}` }
	}
}

async function runApplyDiff(defaultCwd: string, tool: GenericToolUse): Promise<ToolExecution> {
	const p = (tool.params.path || "").trim()
	const diff = tool.params.diff || ""
	if (!p || !diff) return { name: tool.name, params: tool.params, output: "Missing path or diff" }
	const fp = path.resolve(defaultCwd, p)
	try {
		const original = await fs.readFile(fp, "utf8")
		const strategy = new MultiSearchReplaceDiffStrategy(1.0)
		const result = await strategy.applyDiff(original, diff)
		if (result.success) {
			await fs.writeFile(fp, result.content, "utf8")
			return { name: tool.name, params: tool.params, output: `Applied diff to ${fp}` }
		} else {
			return {
				name: tool.name,
				params: tool.params,
				output: `Failed to apply diff: ${result.error || "Unknown error"}`,
			}
		}
	} catch (e: any) {
		return { name: tool.name, params: tool.params, output: `apply_diff failed: ${e?.message || String(e)}` }
	}
}

async function runAskFollowupQuestion(defaultCwd: string, tool: AskFollowupQuestionToolUse): Promise<ToolExecution> {
	const question = tool.params.question || ""
	const followUp = tool.params.follow_up || ""
	if (!question) return { name: tool.name, params: tool.params, output: "Missing question" }

	// Parse follow-up suggestions from XML format
	const suggestions: string[] = []
	if (followUp) {
		const suggestRegex = /<suggest(?:\s+mode="([^"]*)")?[^>]*>(.*?)<\/suggest>/g
		let match
		while ((match = suggestRegex.exec(followUp)) !== null) {
			const mode = match[1] ? ` [${match[1]} mode]` : ""
			suggestions.push(`• ${match[2]}${mode}`)
		}
	}

	// Create interactive question format
	let output = `\n🤔 ${question}\n\n`
	if (suggestions.length > 0) {
		output += `💡 Suggested responses:\n${suggestions.join("\n")}\n\n`
	}
	output += `Please respond with your choice or provide additional details.`

	return {
		name: tool.name,
		params: tool.params,
		output,
	}
}

async function runAttemptCompletion(defaultCwd: string, tool: AttemptCompletionToolUse): Promise<ToolExecution> {
	const result = tool.params.result || ""
	if (!result) return { name: tool.name, params: tool.params, output: "Missing result" }

	return {
		name: tool.name,
		params: tool.params,
		output: `🎯 Task Completion Summary:\n\n${result}\n\n✅ The task has been completed. You can:\n• Type 'continue' if you want additional improvements\n• Ask for clarification on any part\n• Start a new task\n• Use /clear to start fresh`,
	}
}

async function runNewTask(defaultCwd: string, tool: NewTaskToolUse): Promise<ToolExecution> {
	const mode = tool.params.mode || "code"
	const message = tool.params.message || ""
	const todos = tool.params.todos || ""

	if (!message) return { name: tool.name, params: tool.params, output: "Missing task message" }

	return {
		name: tool.name,
		params: tool.params,
		output: `New task created in ${mode} mode:\n${message}\n${todos ? `\nTodos:\n${todos}` : ""}\n\nTask delegation successful.`,
	}
}

async function runSwitchMode(defaultCwd: string, tool: SwitchModeToolUse): Promise<ToolExecution> {
	const modeSlug = tool.params.mode_slug || ""
	const reason = tool.params.reason || ""

	if (!modeSlug) return { name: tool.name, params: tool.params, output: "Missing mode slug" }

	return {
		name: tool.name,
		params: tool.params,
		output: `Mode switch requested to: ${modeSlug}\nReason: ${reason}\n\nUse /mode ${modeSlug} to switch modes.`,
	}
}

// Execute MCP tool via configured servers
async function runUseMcpTool(defaultCwd: string, tool: GenericToolUse): Promise<ToolExecution> {
	try {
		const server =
			(tool.params as any).server || (tool.params as any).server_name || (tool.params as any).name || ""
		const toolName = (tool.params as any).tool || (tool.params as any).tool_name || ""
		let args: any = {}
		const rawArgs = (tool.params as any).args ?? (tool.params as any).arguments
		if (typeof rawArgs === "string" && rawArgs.trim()) {
			try {
				args = JSON.parse(rawArgs)
			} catch {
				// leave args as {}
			}
		} else if (rawArgs && typeof rawArgs === "object") {
			args = rawArgs
		}

		if (!server || !toolName) {
			return {
				name: tool.name,
				params: tool.params,
				output: `Missing server or tool name (got server="${server}", tool="${toolName}")`,
			}
		}

		// Resolve MCP settings: global + project
		const context = createCliExtensionContext()
		const settingsDir = await ensureSettingsDirectoryExists(context as any)
		const globalMcpPath = path.join(settingsDir, GlobalFileNames.mcpSettings)
		const projectMcpPath = resolveProjectMcpPath(defaultCwd)
		const mcp = await loadMcpSettings(globalMcpPath, projectMcpPath)

		const cfg = mcp.mcpServers[server]
		if (!cfg) {
			return {
				name: tool.name,
				params: tool.params,
				output: `No MCP server named "${server}" found. Use /mcp list to see available servers.`,
			}
		}

		const res = await callMcpTool(server, cfg, toolName, args)
		return {
			name: tool.name,
			params: tool.params,
			output: JSON.stringify(res, null, 2),
		}
	} catch (e: any) {
		return {
			name: tool.name,
			params: tool.params,
			output: `MCP call failed: ${e?.message || String(e)}`,
		}
	}
}

async function runListCodeDefinitionNames(
	defaultCwd: string,
	tool: ListCodeDefinitionNamesToolUse,
): Promise<ToolExecution> {
	const targetPath = path.resolve(defaultCwd, (tool.params.path || ".").trim())

	try {
		// Simple implementation that finds common code definition patterns
		const definitions: string[] = []

		async function scanFile(filePath: string) {
			try {
				const content = await fs.readFile(filePath, "utf8")
				const ext = path.extname(filePath).toLowerCase()

				// Basic patterns for different languages
				const patterns: RegExp[] = []

				if ([".js", ".ts", ".jsx", ".tsx"].includes(ext)) {
					patterns.push(
						/(?:function|const|let|var)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/g,
						/class\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/g,
						/interface\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/g,
						/type\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/g,
					)
				} else if ([".py"].includes(ext)) {
					patterns.push(/def\s+([a-zA-Z_][a-zA-Z0-9_]*)/g, /class\s+([a-zA-Z_][a-zA-Z0-9_]*)/g)
				} else if ([".java", ".c", ".cpp", ".h", ".hpp"].includes(ext)) {
					patterns.push(
						/(?:public|private|protected)?\s*(?:static)?\s*(?:\w+\s+)+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g,
						/class\s+([a-zA-Z_][a-zA-Z0-9_]*)/g,
					)
				}

				for (const pattern of patterns) {
					let match
					while ((match = pattern.exec(content)) !== null) {
						const name = match[1]
						if (name && !definitions.includes(name)) {
							definitions.push(name)
						}
					}
				}
			} catch {
				// Skip files that can't be read
			}
		}

		async function walkDirectory(dir: string) {
			const entries = await fs.readdir(dir, { withFileTypes: true } as any)
			for (const entry of entries as any[]) {
				const fullPath = path.join(dir, entry.name)
				// Skip ignored directories/files
				if (entry.isDirectory()) {
					if (isPathIgnored(fullPath, defaultCwd)) continue
					await walkDirectory(fullPath)
				} else if (entry.isFile()) {
					if (!isPathIgnored(fullPath, defaultCwd)) {
						await scanFile(fullPath)
					}
				}
			}
		}

		if (fssync.statSync(targetPath).isDirectory()) {
			await walkDirectory(targetPath)
		} else {
			await scanFile(targetPath)
		}

		return {
			name: tool.name,
			params: tool.params,
			output: definitions.length ? definitions.sort().join("\n") : "No code definitions found",
		}
	} catch (e: any) {
		return {
			name: tool.name,
			params: tool.params,
			output: `Failed to list definitions: ${e?.message || String(e)}`,
		}
	}
}

async function runCodebaseSearch(defaultCwd: string, tool: CodebaseSearchToolUse): Promise<ToolExecution> {
	const query = tool.params.query || ""
	const searchPath = path.resolve(defaultCwd, (tool.params.path || ".").trim())

	if (!query) return { name: tool.name, params: tool.params, output: "Missing search query" }

	try {
		// Simple semantic search using file content matching
		const results: string[] = []

		async function searchInFile(filePath: string) {
			try {
				const content = await fs.readFile(filePath, "utf8")
				const lines = content.split("\n")
				const matches: string[] = []

				// Case-insensitive search
				const queryLower = query.toLowerCase()

				lines.forEach((line, index) => {
					if (line.toLowerCase().includes(queryLower)) {
						const relativePath = path.relative(defaultCwd, filePath)
						matches.push(`${relativePath}:${index + 1}: ${line.trim()}`)
					}
				})

				if (matches.length > 0) {
					results.push(...matches.slice(0, 5)) // Limit matches per file
				}
			} catch (e) {
				// Skip files that can't be read
			}
		}

		async function walkDirectory(dir: string) {
			const entries = await fs.readdir(dir, { withFileTypes: true })
			for (const entry of entries) {
				const fullPath = path.join(dir, entry.name)

				if (entry.isDirectory() && !isPathIgnored(fullPath, defaultCwd)) {
					await walkDirectory(fullPath)
				} else if (entry.isFile()) {
					const ext = path.extname(entry.name).toLowerCase()
					// Only search in text files
					if (
						[
							".js",
							".ts",
							".jsx",
							".tsx",
							".py",
							".java",
							".c",
							".cpp",
							".h",
							".hpp",
							".md",
							".txt",
							".json",
							".yaml",
							".yml",
						].includes(ext)
					) {
						await searchInFile(fullPath)
					}
				}
			}
		}

		if (fssync.statSync(searchPath).isDirectory()) {
			await walkDirectory(searchPath)
		} else {
			await searchInFile(searchPath)
		}

		return {
			name: tool.name,
			params: tool.params,
			output: results.length ? results.slice(0, 20).join("\n") : `No matches found for "${query}"`,
		}
	} catch (e: any) {
		return { name: tool.name, params: tool.params, output: `Codebase search failed: ${e?.message || String(e)}` }
	}
}

async function runUpdateTodoList(defaultCwd: string, tool: GenericToolUse): Promise<ToolExecution> {
	const todos = tool.params.todos || ""
	if (!todos) return { name: tool.name, params: tool.params, output: "Missing todos list" }

	try {
		// Parse the todo list and store it
		const todoLines = todos.split("\n").filter((line) => line.trim())
		const parsedTodos = todoLines
			.map((line) => {
				const match = line.match(/^\s*- \[([ x-])\] (.+)$/)
				if (match) {
					const [, status, text] = match
					return {
						text: text.trim(),
						status: status === "x" ? "completed" : status === "-" ? "in_progress" : "pending",
					}
				}
				return null
			})
			.filter(Boolean) as { text: string; status: string }[]

		// Persist to the same CLI state file used by /todos
		const context = createCliExtensionContext()
		const stateDir = (context as any).globalStorageUri.fsPath as string
		const todosFile = path.join(stateDir, "todos.json")
		const textsOnly = parsedTodos.map((t) => t.text)
		await fs.mkdir(path.dirname(todosFile), { recursive: true })
		await fs.writeFile(todosFile, JSON.stringify(textsOnly, null, 2), "utf8")

		return {
			name: tool.name,
			params: tool.params,
			output: `Updated todo list with ${parsedTodos.length} items:\n${todos}\n\nTodo list has been persisted.`,
		}
	} catch (e: any) {
		return {
			name: tool.name,
			params: tool.params,
			output: `Failed to update todo list: ${e?.message || String(e)}`,
		}
	}
}

// Implementation of missing tools from extension

async function runSimpleReadFile(defaultCwd: string, tool: SimpleReadFileToolUse): Promise<ToolExecution> {
	const p = (tool.params.path || "").trim()
	if (!p) return { name: tool.name, params: tool.params, output: "Missing path" }
	const fp = path.resolve(defaultCwd, p)

	if (isPathIgnored(fp, defaultCwd)) {
		return { name: tool.name, params: tool.params, output: `Access to ${fp} is blocked by ignore rules.` }
	}

	try {
		const data = await fs.readFile(fp, "utf8")
		return { name: tool.name, params: tool.params, output: data }
	} catch (e: any) {
		return { name: tool.name, params: tool.params, output: `Failed to read ${fp}: ${e?.message || String(e)}` }
	}
}

async function runEditFile(defaultCwd: string, tool: EditFileToolUse): Promise<ToolExecution> {
	// CLI adaptation: Apply batch edits as diff patches rather than interactive editing
	const p = (tool.params.path || "").trim()
	const edits = tool.params.edits || ""

	if (!p) return { name: tool.name, params: tool.params, output: "Missing path" }
	if (!edits) return { name: tool.name, params: tool.params, output: "Missing edits" }

	const fp = path.resolve(defaultCwd, p)

	try {
		// Parse edits as JSON array or line-based format
		let editInstructions: Array<{ line?: number; action: string; content?: string }> = []

		try {
			// Try parsing as JSON first
			editInstructions = JSON.parse(edits)
		} catch {
			// Fallback: parse as simple line-based edits
			// Format: "insert:5:content" or "replace:3-7:content" or "delete:10"
			const lines = edits.split("\n").filter((l) => l.trim())
			for (const line of lines) {
				const parts = line.split(":")
				if (parts.length >= 2) {
					const action = parts[0]
					const lineSpec = parts[1]
					const content = parts.slice(2).join(":")

					if (action === "insert") {
						editInstructions.push({ action, line: parseInt(lineSpec), content })
					} else if (action === "replace" || action === "delete") {
						const lineNum = parseInt(lineSpec.split("-")[0])
						editInstructions.push({ action, line: lineNum, content })
					}
				}
			}
		}

		if (editInstructions.length === 0) {
			return { name: tool.name, params: tool.params, output: "No valid edit instructions found" }
		}

		const originalContent = await fs.readFile(fp, "utf8")
		const lines = originalContent.split("\n")

		// Apply edits in reverse order for line number stability
		const sortedEdits = editInstructions.sort((a, b) => (b.line || 0) - (a.line || 0))

		for (const edit of sortedEdits) {
			const lineIndex = (edit.line || 1) - 1 // Convert to 0-based

			if (edit.action === "insert") {
				lines.splice(lineIndex, 0, edit.content || "")
			} else if (edit.action === "replace") {
				lines[lineIndex] = edit.content || ""
			} else if (edit.action === "delete") {
				lines.splice(lineIndex, 1)
			}
		}

		const newContent = lines.join("\n")
		await fs.writeFile(fp, newContent, "utf8")

		return {
			name: tool.name,
			params: tool.params,
			output: `Applied ${editInstructions.length} edit(s) to ${fp}\n\nCLI Note: For complex edits, consider using 'apply_diff' or 'search_and_replace' tools.`,
		}
	} catch (e: any) {
		return { name: tool.name, params: tool.params, output: `Failed to edit file: ${e?.message || String(e)}` }
	}
}

async function runFetchInstructions(defaultCwd: string, tool: FetchInstructionsToolUse): Promise<ToolExecution> {
	const instructionType = tool.params.instruction_type || ""
	const context = tool.params.context || ""

	if (!instructionType) return { name: tool.name, params: tool.params, output: "Missing instruction_type" }

	try {
		// CLI implementation: Look for local instruction files and configurations
		const instructionSources = [
			path.join(defaultCwd, `.kilocode/instructions/${instructionType}.md`),
			path.join(defaultCwd, `.kilocode/instructions/${instructionType}.txt`),
			path.join(defaultCwd, `instructions/${instructionType}.md`),
			path.join(defaultCwd, `docs/instructions/${instructionType}.md`),
			path.join(defaultCwd, `README.md`), // Fallback to README
		]

		let instructions = ""
		let foundSource = ""

		for (const sourcePath of instructionSources) {
			try {
				if (fssync.existsSync(sourcePath)) {
					instructions = await fs.readFile(sourcePath, "utf8")
					foundSource = sourcePath
					break
				}
			} catch {
				// Continue to next source
			}
		}

		if (!instructions) {
			// Generate basic instructions based on type
			switch (instructionType) {
				case "coding":
					instructions =
						"Follow best practices for the detected programming language. Use consistent formatting and clear variable names. Add appropriate comments for complex logic."
					break
				case "testing":
					instructions =
						"Write comprehensive tests covering edge cases. Use descriptive test names. Ensure tests are isolated and deterministic."
					break
				case "documentation":
					instructions =
						"Write clear, concise documentation. Include examples where helpful. Keep documentation up-to-date with code changes."
					break
				default:
					instructions = `No specific instructions found for type: ${instructionType}. Please provide context-specific guidance.`
			}
			foundSource = "generated_default"
		}

		// Apply context if provided
		if (context) {
			instructions += `\n\nContext: ${context}`
		}

		return {
			name: tool.name,
			params: tool.params,
			output: `Instructions for ${instructionType} (source: ${foundSource}):\n\n${instructions}`,
		}
	} catch (e: any) {
		return {
			name: tool.name,
			params: tool.params,
			output: `Failed to fetch instructions: ${e?.message || String(e)}`,
		}
	}
}

async function runAccessMcpResource(defaultCwd: string, tool: AccessMcpResourceToolUse): Promise<ToolExecution> {
	try {
		const uri = tool.params.uri || ""
		const serverName =
			(tool.params as any).server || (tool.params as any).mcp_server || tool.params.server_name || ""

		if (!uri) return { name: tool.name, params: tool.params, output: "Missing resource URI" }
		if (!serverName) return { name: tool.name, params: tool.params, output: "Missing MCP server name" }

		// Resolve MCP settings: global + project
		const context = createCliExtensionContext()
		const settingsDir = await ensureSettingsDirectoryExists(context as any)
		const globalMcpPath = path.join(settingsDir, GlobalFileNames.mcpSettings)
		const projectMcpPath = resolveProjectMcpPath(defaultCwd)
		const mcp = await loadMcpSettings(globalMcpPath, projectMcpPath)

		const serverConfig = mcp.mcpServers[serverName]
		if (!serverConfig) {
			return {
				name: tool.name,
				params: tool.params,
				output: `No MCP server named "${serverName}" found. Available servers: ${Object.keys(mcp.mcpServers).join(", ")}`,
			}
		}

		// For CLI, we'll attempt to access the resource via MCP protocol
		// This is a simplified implementation - a full implementation would use the MCP client
		const resourceData = await callMcpTool(serverName, serverConfig, "read_resource", { uri })

		return {
			name: tool.name,
			params: tool.params,
			output: `Resource from ${serverName}:${uri}\n\n${JSON.stringify(resourceData, null, 2)}`,
		}
	} catch (e: any) {
		return {
			name: tool.name,
			params: tool.params,
			output: `Failed to access MCP resource: ${e?.message || String(e)}\n\nNote: Make sure the MCP server is running and the resource URI is valid.`,
		}
	}
}
