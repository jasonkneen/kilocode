#!/usr/bin/env node
import "../../../src/utils/path"
import fs from "node:fs"
import path from "node:path"
import readline from "node:readline"
import http from "node:http"
import { URL } from "node:url"
import { exec as execCb } from "node:child_process"
import { promisify } from "node:util"

import type { Anthropic } from "@anthropic-ai/sdk"

// Reuse repo modules via relative imports and an alias provided in build
import { buildCliApiHandler, type ApiHandler } from "./api.js"
// Compute defaultModeSlug from DEFAULT_MODES to avoid pulling VS Code dependent helpers

import type { ProviderSettings } from "../../../packages/types/src/provider-settings.js"
import { parseToolUses, executeTool } from "./tool-runner.js"
import { Collapser } from "./collapser.js"
import { AssistantMessageParser } from "../../../src/core/assistant-message/AssistantMessageParser.js"
import { ToolArgs } from "../../../src/core/prompts/tools/types.js"
import { getExecuteCommandDescription } from "../../../src/core/prompts/tools/execute-command.js"
import { getReadFileDescription } from "../../../src/core/prompts/tools/read-file.js"
import { getWriteToFileDescription } from "../../../src/core/prompts/tools/write-to-file.js"
import { getInsertContentDescription } from "../../../src/core/prompts/tools/insert-content.js"
import { getListFilesDescription } from "../../../src/core/prompts/tools/list-files.js"
import { getSearchFilesDescription } from "../../../src/core/prompts/tools/search-files.js"
import { getSearchAndReplaceDescription } from "../../../src/core/prompts/tools/search-and-replace.js"
import { getUseMcpToolDescription } from "../../../src/core/prompts/tools/use-mcp-tool.js"
// Removed: getAccessMcpResourceDescription
import { getAskFollowupQuestionDescription } from "../../../src/core/prompts/tools/ask-followup-question.js"
import { getAttemptCompletionDescription } from "../../../src/core/prompts/tools/attempt-completion.js"
import { getNewTaskDescription } from "../../../src/core/prompts/tools/new-task.js"
import { getSwitchModeDescription } from "../../../src/core/prompts/tools/switch-mode.js"
import { getListCodeDefinitionNamesDescription } from "../../../src/core/prompts/tools/list-code-definition-names.js"
import { getCodebaseSearchDescription } from "../../../src/core/prompts/tools/codebase-search.js"
import { getUpdateTodoListDescription } from "../../../src/core/prompts/tools/update-todo-list.js"
// Add: apply_diff description via diff strategy (no direct import available)
import { MultiSearchReplaceDiffStrategy } from "../../../src/core/diff/strategies/multi-search-replace.js"
import {
	createCliExtensionContext,
	env as vscodeEnv,
	FileBackedStorage,
	detectVsCodeGlobalStorageDir,
} from "./shims/vscode.js"
import { ContextProxy } from "../../../src/core/config/ContextProxy.js"
import { getModels } from "../../../src/api/providers/fetchers/modelCache.js"
import { ensureSettingsDirectoryExists } from "../../../src/utils/globalContext.js"
import { GlobalFileNames } from "../../../src/shared/globalFileNames.js"
import { loadMcpSettings, resolveProjectMcpPath, callMcpTool, saveProjectMcp, type McpSettings } from "./mcp.js"
import { parseKiloSlashCommands } from "../../../src/core/slash-commands/kilo.js"
import { CliThinkingAnimation } from "./thinking-animation.js"

type MessageParam = Anthropic.Messages.MessageParam

type CliOptions = {
	cwd: string
	provider: string | undefined
	model: string | undefined
}

function parseArgs(argv: string[]): CliOptions {
	const opts: CliOptions = { cwd: process.cwd(), provider: process.env.KILO_PROVIDER, model: process.env.KILO_MODEL }
	for (let i = 2; i < argv.length; i++) {
		const a = argv[i]
		if (a === "--cwd" && argv[i + 1]) opts.cwd = path.resolve(argv[++i])
		else if ((a === "--provider" || a === "-p") && argv[i + 1]) opts.provider = argv[++i]
		else if ((a === "--model" || a === "-m") && argv[i + 1]) opts.model = argv[++i]
	}
	return opts
}

function toProviderSettings(opts: CliOptions): ProviderSettings {
	const provider = (opts.provider || "kilocode") as ProviderSettings["apiProvider"]
	const settings: ProviderSettings = { apiProvider: provider }

	// Provider-specific envs
	if (provider === "openrouter") {
		settings.openRouterApiKey = process.env.OPENROUTER_API_KEY
		settings.openRouterModelId = opts.model || process.env.OPENROUTER_MODEL_ID
	} else if (provider === "openai") {
		settings.openAiApiKey = process.env.OPENAI_API_KEY
		settings.openAiModelId = opts.model || process.env.OPENAI_MODEL_ID
	} else if (provider === "anthropic") {
		settings.apiModelId = opts.model || process.env.ANTHROPIC_MODEL_ID
		settings.apiKey = process.env.ANTHROPIC_API_KEY as any
	} else if (provider === "kilocode") {
		settings.kilocodeToken = process.env.KILOCODE_TOKEN
		settings.kilocodeModel = opts.model || process.env.KILOCODE_MODEL || "openai/gpt-5"
	} else if (provider === "groq") {
		settings.groqApiKey = process.env.GROQ_API_KEY
		settings.apiModelId = opts.model || process.env.GROQ_MODEL_ID
	} else if (provider === "gemini") {
		settings.geminiApiKey = process.env.GEMINI_API_KEY
		settings.apiModelId = opts.model || process.env.GEMINI_MODEL_ID
	} else if (provider === "ollama") {
		settings.ollamaBaseUrl = process.env.OLLAMA_BASE_URL || "http://localhost:11434"
		settings.apiModelId = opts.model || process.env.OLLAMA_MODEL_ID
	} else if (provider === "lmstudio") {
		settings.lmStudioBaseUrl = process.env.LMSTUDIO_BASE_URL || "http://localhost:1234"
		// Use LM Studio-specific model id field
		;(settings as any).lmStudioModelId = opts.model || process.env.LMSTUDIO_MODEL_ID
		// Ensure reasonable context length for LM Studio
		settings.modelMaxTokens = Math.min(settings.modelMaxTokens ?? 4096, 32768)
	} else if (provider === "vertex") {
		settings.vertexProjectId = process.env.VERTEX_PROJECT_ID
		settings.vertexRegion = process.env.VERTEX_REGION
		settings.apiModelId = opts.model || process.env.VERTEX_MODEL_ID
	} else if (provider === "bedrock") {
		// Align with ProviderSettings schema field names
		;(settings as any).awsAccessKey = process.env.AWS_ACCESS_KEY_ID
		;(settings as any).awsSecretKey = process.env.AWS_SECRET_ACCESS_KEY
		settings.awsSessionToken = process.env.AWS_SESSION_TOKEN
		settings.awsRegion = process.env.AWS_REGION || "us-east-1"
		settings.apiModelId = opts.model || process.env.BEDROCK_MODEL_ID
	} else if (provider === "fireworks") {
		settings.fireworksApiKey = process.env.FIREWORKS_API_KEY
		settings.apiModelId = opts.model || process.env.FIREWORKS_MODEL_ID
	} else if (provider === "featherless") {
		settings.featherlessApiKey = process.env.FEATHERLESS_API_KEY
		settings.apiModelId = opts.model || process.env.FEATHERLESS_MODEL_ID
	}

	// Defaults
	settings.includeMaxTokens = true
	settings.diffEnabled = false
	settings.todoListEnabled = false
	settings.fuzzyMatchThreshold = 1.0
	settings.modelTemperature = 0.2

	return settings
}

async function main() {
	const opts = parseArgs(process.argv)
	const cwd = opts.cwd
	const context = createCliExtensionContext()
	// Initialize VS Code-ish context proxy so model cache works
	await ContextProxy.getInstance(context as any)
	// Load saved secrets as defaults if envs not provided
	const savedKilocodeToken = await context.secrets.get("kilocodeToken")
	const savedKilocodeOrgId = await context.secrets.get("kilocodeOrganizationId")
	const providerSettings = toProviderSettings({
		...opts,
		// If provider is kilocode and no env token, use saved secret
	})

	// Inject saved Kilo token if provider is kilocode and none specified
	if (providerSettings.apiProvider === "kilocode") {
		if (!providerSettings.kilocodeToken && savedKilocodeToken) providerSettings.kilocodeToken = savedKilocodeToken
		if (!(providerSettings as any).kilocodeOrganizationId && savedKilocodeOrgId)
			(providerSettings as any).kilocodeOrganizationId = savedKilocodeOrgId
	}

	let api: ApiHandler = buildCliApiHandler(providerSettings)
	// CLI parity: suppress provider fallback warnings that the extension does not surface
	const originalWarn = console.warn
	console.warn = (...args: any[]) => {
		try {
			const first = args?.[0]
			if (typeof first === "string" && first.includes("no longer exists, falling back")) {
				return // swallow fallback noise in CLI
			}
		} catch {}
		return (originalWarn as any).apply(console, args as any)
	}

	// Lazy import modes when needed to avoid heavy graph
	const modeModule: typeof import("../../../packages/types/src/mode.js") = await import(
		"../../../packages/types/src/mode.js"
	)
	let currentMode = modeModule.DEFAULT_MODES[0]?.slug || "code"
	let messages: MessageParam[] = []
	let customModes: any[] | undefined
	let sessionId = String(Date.now())
	const stateDir = (context as any).globalStorageUri.fsPath as string
	const sessionsDir = path.join(stateDir, "sessions")
	await fs.promises.mkdir(sessionsDir, { recursive: true }).catch(() => {})
	const todosFile = path.join(stateDir, "todos.json")
	const uiFile = path.join(stateDir, "ui.json")
	const loadTodos = (): string[] => {
		try {
			return JSON.parse(fs.readFileSync(todosFile, "utf8"))
		} catch {
			return []
		}
	}
	const saveTodos = (list: string[]) => fs.writeFileSync(todosFile, JSON.stringify(list, null, 2), "utf8")
	const saveSession = async () => {
		const meta = {
			provider: providerSettings.apiProvider,
			model: api.getModel().id,
			mode: currentMode,
			cwd, // include working directory for richer /resume listing
			updatedAt: new Date().toISOString(),
		}
		await fs.promises.writeFile(
			path.join(sessionsDir, `${sessionId}.json`),
			JSON.stringify({ meta, messages }, null, 2),
			"utf8",
		)
	}
	const listSessions = async () => {
		try {
			const files = (await fs.promises.readdir(sessionsDir)).filter((f) => f.endsWith(".json"))
			const stats = await Promise.all(
				files.map(async (f) => ({
					id: f.replace(/\.json$/, ""),
					mtime: (await fs.promises.stat(path.join(sessionsDir, f))).mtimeMs,
				})),
			)
			return stats.sort((a, b) => b.mtime - a.mtime)
		} catch {
			return []
		}
	}
	const loadSession = async (id: string) => {
		const p = path.join(sessionsDir, `${id}.json`)
		const raw = fs.readFileSync(p, "utf8")
		const parsed = JSON.parse(raw)
		messages = parsed.messages || []
		sessionId = id
	}

	// Load project custom modes from .kilocodemodes if present
	try {
		const modesPath = path.join(cwd, ".kilocodemodes")
		if (fs.existsSync(modesPath)) {
			const raw = fs.readFileSync(modesPath, "utf8")
			const parsed = JSON.parse(raw)
			if (Array.isArray(parsed?.customModes)) customModes = parsed.customModes
		}
	} catch {}

	const banner = () => {
		process.stdout.write("\u001b[2J\u001b[0;0H") // clear screen
		// Funky ASCII big-text banner in WHITE
		const RESET = "\u001b[0m"
		const WHITE = "\u001b[97m"
		const bannerLines = [
			"██╗  ██╗  ██╗  ██╗      █████╗       ██████╗  █████╗   ██████╗   ███████╗  ",
			"██║ ██╔╝  ██║  ██║     ██╔══██╗     ██╔════╝ ██╔══██╗  ██╔══██╗  ██╔════╝  ",
			"█████╔╝   ██║  ██║     ██║  ██║     ██║      ██║  ██║  ██║  ██║  █████╗    ",
			"██╔═██╗   ██║  ██║     ██║  ██║     ██║      ██║  ██║  ██║  ██║  ██╔══╝    ",
			"██║  ██╗  ██║  ██████╗ ╚█████╔╝     ╚██████╗ ╚█████╔╝  ██████╔╝  ███████╗  ",
			"╚═╝  ╚═╝  ╚═╝  ╚═════╝  ╚════╝       ╚═════╝  ╚════╝   ╚═════╝   ╚══════╝  ",
		]
		for (let i = 0; i < bannerLines.length; i++) {
			console.log(WHITE + bannerLines[i] + RESET)
		}
		console.log(`\n${WHITE}KILO CODE — CLI Agent${RESET}`)
		console.log(`cwd: ${cwd}`)
		console.log(`provider: ${providerSettings.apiProvider}`)
		// Match extension: show the selected/requested model when available
		const selectedModel = ((): string => {
			try {
				const id =
					(providerSettings.apiProvider === "openrouter" && (providerSettings as any).openRouterModelId) ||
					(providerSettings.apiProvider === "openai" && (providerSettings as any).openAiModelId) ||
					(providerSettings.apiProvider === "kilocode" && (providerSettings as any).kilocodeModel) ||
					(providerSettings as any).apiModelId
				return id || opts.model || "default"
			} catch {
				return opts.model || "default"
			}
		})()
		console.log(`model: ${selectedModel}`)
		console.log(`mode: ${currentMode}`)
		console.log('Type "/modes", "/model <id>", "/provider <name>", "/clear"')
		console.log("—")
	}

	banner()

	// Collapser to manage folded sections (tool outputs, long logs)
	const collapser = new Collapser(process.stdout)
	// Helper: check if readline interface is still usable
	const isRlUsable = (r: any): boolean => {
		try {
			return !!r && !(r as any).closed && !(r as any).destroyed
		} catch {
			return false
		}
	}
	// Wire Ctrl+R to expand last collapsed block
	readline.emitKeypressEvents(process.stdin)
	try {
		if (process.stdin.isTTY) process.stdin.setRawMode(true)
	} catch {}
	let isPrompting = false
	const renderColoredInput = () => {
		if (!isPrompting) return
		const line = (rl as any).line || ""
		let colored = line
		if (line.startsWith("!")) colored = `${color.red}${line}${color.reset}`
		else if (line.startsWith("/")) colored = `${color.cyan}${line}${color.reset}`
		// Repaint current input line with colored variant
		readline.clearLine(process.stdout, 0)
		readline.cursorTo(process.stdout, 0)
		process.stdout.write("> " + colored)
	}

	process.stdin.on("keypress", (_str, key: any) => {
		if (key && key.ctrl && key.name === "r") {
			clearStatusLine()
			collapser.expandLast()
			// Repaint prompt if active
			if (isRlUsable(rl)) rl.prompt(true)
		}
		// Ctrl+1..9 expands the Nth collapsed block
		if (key && key.ctrl && /^[1-9]$/.test(key.name)) {
			const n = Number(key.name)
			clearStatusLine()
			collapser.expandByIndex(n)
			if (isRlUsable(rl)) rl.prompt(true)
		}
		// Recolor input live
		renderColoredInput()
	})

	// Simple readline completer for slash commands and @file paths
	const slashCommands = [
		"/help",
		"/modes",
		"/mode",
		"/provider",
		"/model",
		"/models",
		"/status",
		"/usage",
		"/login",
		"/logout",
		"/config",
		"/mcp",
		"/clear",
		"/resume",
		"/todos",
		"/todo",
		"/blocks",
		"/expand",
		"/fold",
		"/theme",
		"/autocontinue",
		"/autorun",
		"/autorunmax",
		"/stats",
		"/test",
		"/setup",
		"/env",
	]
	let modelIdsCache: string[] = []
	const completer = (line: string) => {
		if (line.startsWith("/")) {
			const [cmd, ...rest] = line.split(/\s+/)
			if (rest.length === 0) {
				const hits = slashCommands.filter((c) => c.startsWith(cmd))
				return [hits.length ? hits : slashCommands, line]
			}
			if (cmd === "/model" && modelIdsCache.length) {
				const prefix = rest.join(" ")
				const hits = modelIdsCache.filter((m) => m.startsWith(prefix))
				return [hits.length ? hits : modelIdsCache, line]
			}
			// Autocomplete for /expand and /blocks
			if ("/expand".startsWith(cmd)) return [["/expand "], line]
			if ("/blocks".startsWith(cmd)) return [["/blocks"], line]
			// Autocomplete for /fold and /theme
			if ("/fold".startsWith(cmd)) return [["/fold on", "/fold off", "/fold toggle"], line]
			if ("/theme".startsWith(cmd)) return [["/theme default", "/theme mono"], line]
			if ("/autorun".startsWith(cmd)) return [["/autorun on", "/autorun off", "/autorun toggle"], line]
			if ("/autorunmax".startsWith(cmd))
				return [["/autorunmax 1", "/autorunmax 2", "/autorunmax 3", "/autorunmax 5"], line]
			if ("/autocontinue".startsWith(cmd))
				return [["/autocontinue on", "/autocontinue off", "/autocontinue toggle"], line]
			if ("/stats".startsWith(cmd)) return [["/stats verbose", "/stats quiet"], line]
			return [[], line]
		}
		const atIdx = line.lastIndexOf("@")
		if (atIdx >= 0) {
			const partial = line.slice(atIdx + 1)
			try {
				const ents = fs.readdirSync(cwd, { withFileTypes: true })
				const choices = ents.map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
				const hits = choices.filter((n) => n.startsWith(partial))
				return [hits.length ? hits : choices, line]
			} catch {}
		}
		return [[], line]
	}
	const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true, completer })

	// Session usage tracking & theming
	type ThemeName = "default" | "mono"
	const getColorMap = (theme: ThemeName) => {
		if (theme === "mono") {
			const none = ""
			return {
				dim: none,
				resetDim: none,
				reset: none,
				bright: none,
				gray: none,
				red: none,
				green: none,
				yellow: none,
				blue: none,
				magenta: none,
				cyan: none,
			}
		}
		return {
			dim: "\x1b[2m",
			resetDim: "\x1b[22m",
			reset: "\x1b[0m",
			bright: "\x1b[1m",
			gray: "\x1b[90m",
			red: "\x1b[31m",
			green: "\x1b[32m",
			yellow: "\x1b[33m",
			blue: "\x1b[34m",
			magenta: "\x1b[35m",
			cyan: "\x1b[36m",
		}
	}
	// Load persisted UI state
	const loadUi = (): {
		foldEnabled: boolean
		theme: ThemeName
		lastModel?: string
		lastMode?: string
		autoContinue?: boolean
		autoRun?: boolean
		autoRunMaxSteps?: number
		showSubStats?: boolean
	} => {
		try {
			const raw = fs.readFileSync(uiFile, "utf8")
			const parsed = JSON.parse(raw)
			const theme: ThemeName = parsed?.theme === "mono" ? "mono" : "default"
			const foldEnabled = typeof parsed?.foldEnabled === "boolean" ? parsed.foldEnabled : true
			const lastModel = typeof parsed?.lastModel === "string" ? parsed.lastModel : undefined
			const lastMode = typeof parsed?.lastMode === "string" ? parsed.lastMode : undefined
			const autoContinue = typeof parsed?.autoContinue === "boolean" ? parsed.autoContinue : false
			const autoRun = typeof parsed?.autoRun === "boolean" ? parsed.autoRun : false
			const autoRunMaxSteps = Number.isInteger(parsed?.autoRunMaxSteps)
				? Math.max(1, Math.min(10, parsed.autoRunMaxSteps))
				: 2
			const showSubStats = typeof parsed?.showSubStats === "boolean" ? parsed.showSubStats : false
			return { foldEnabled, theme, lastModel, lastMode, autoContinue, autoRun, autoRunMaxSteps, showSubStats }
		} catch {
			return { foldEnabled: true, theme: "default" }
		}
	}
	const saveUi = (uiState: {
		foldEnabled: boolean
		theme: ThemeName
		lastModel?: string
		lastMode?: string
		autoContinue?: boolean
		autoRun?: boolean
		autoRunMaxSteps?: number
		showSubStats?: boolean
	}) => {
		try {
			fs.writeFileSync(uiFile, JSON.stringify(uiState, null, 2), "utf8")
		} catch {}
	}
	let ui = loadUi()
	// Allow env var to override theme on launch
	const envTheme = (process.env.KILO_CLI_THEME as ThemeName) || undefined
	if (envTheme === "mono" || envTheme === "default") ui.theme = envTheme
	let color = getColorMap(ui.theme)

	// Persistent status line rendering directly under the input prompt
	const renderStatusLine = () => {
		try {
			if (!isPrompting || !isRlUsable(rl) || !process.stdout.isTTY) return
			const prov = providerSettings.apiProvider
			const modelId = ui.lastModel || opts.model || api.getModel()?.id || "model"
			const used = usageTotals.in + usageTotals.out
			const ctx = (api.getModel().info as any)?.contextWindow
			const left = ctx ? Math.max(0, ctx - used) : undefined
			const status =
				`${color.dim}${prov}${color.reset} · ${color.dim}${modelId}${color.reset} · ${color.dim}${currentMode}${color.reset}` +
				`  ${color.cyan}in:${usageTotals.in}${color.reset} ${color.cyan}out:${usageTotals.out}${color.reset}` +
				(left !== undefined ? ` ${color.yellow}ctx:${left}${color.reset}` : "") +
				(ui.autoRun ? ` ${color.green}autorun:on${color.reset}` : ` ${color.gray}autorun:off${color.reset}`) +
				(ui.autoContinue
					? ` ${color.green}autocont:on${color.reset}`
					: ` ${color.gray}autocont:off${color.reset}`) +
				(ui.foldEnabled ? ` ${color.green}fold:on${color.reset}` : ` ${color.gray}fold:off${color.reset}`)

			// Move down one line below the prompt, draw status, and move back
			readline.moveCursor(process.stdout, 0, 1)
			readline.clearLine(process.stdout, 0)
			process.stdout.write(status)
			readline.moveCursor(process.stdout, 0, -1)
		} catch {}
	}

	const clearStatusLine = () => {
		try {
			if (!isRlUsable(rl) || !process.stdout.isTTY) return
			// Clear the line below the prompt (where we draw status)
			readline.moveCursor(process.stdout, 0, 1)
			readline.clearLine(process.stdout, 0)
			readline.moveCursor(process.stdout, 0, -1)
		} catch {}
	}

	// Restore last mode if saved
	if (ui.lastMode) currentMode = ui.lastMode

	// Helper to apply a model id to provider settings
	function applyModelToProvider(p: typeof providerSettings, modelId: string) {
		if (!modelId) return
		const prov = p.apiProvider
		if (prov === "openrouter") (p as any).openRouterModelId = modelId
		else if (prov === "openai") (p as any).openAiModelId = modelId
		else if (prov === "kilocode") (p as any).kilocodeModel = modelId
		else (p as any).apiModelId = modelId
	}
	// Strict model helpers: no fallback allowed — require explicit model and exact match
	function getExplicitModelId(p: typeof providerSettings): string | undefined {
		const prov = p.apiProvider
		if (prov === "openrouter") return (p as any).openRouterModelId
		if (prov === "openai") return (p as any).openAiModelId
		if (prov === "kilocode") return (p as any).kilocodeModel
		return (p as any).apiModelId
	}
	function getProviderModelEnvName(prov: string | undefined): string {
		switch (prov) {
			case "openrouter":
				return "OPENROUTER_MODEL_ID"
			case "openai":
				return "OPENAI_MODEL_ID"
			case "anthropic":
				return "ANTHROPIC_MODEL_ID"
			case "kilocode":
				return "KILOCODE_MODEL"
			case "groq":
				return "GROQ_MODEL_ID"
			case "gemini":
				return "GEMINI_MODEL_ID"
			case "vertex":
				return "VERTEX_MODEL_ID"
			case "bedrock":
				return "BEDROCK_MODEL_ID"
			case "fireworks":
				return "FIREWORKS_MODEL_ID"
			case "featherless":
				return "FEATHERLESS_MODEL_ID"
			case "ollama":
				return "OLLAMA_MODEL_ID"
			case "lmstudio":
				return "LMSTUDIO_MODEL_ID"
			default:
				return "MODEL_ID"
		}
	}
	function enforceNoFallback(contextLabel = "init"): boolean {
		try {
			const prov = providerSettings.apiProvider
			const requested = getExplicitModelId(providerSettings)
			if (!requested || String(requested).trim().length === 0) {
				console.error(
					`${color.red}Strict model required${color.reset}: no model configured for provider "${prov}". Fallbacks are disabled. Set a model with ${color.cyan}/model <id>${color.reset} or env ${color.cyan}${getProviderModelEnvName(
						prov,
					)}${color.reset}.`,
				)
				return false
			}
			const resolved = api.getModel()?.id
			if (!resolved || String(resolved).trim().length === 0) {
				console.error(
					`${color.red}Strict model required${color.reset}: provider resolved no model in "${contextLabel}". Fallbacks are disabled.`,
				)
				return false
			}
			if (resolved !== requested) {
				console.error(
					`${color.red}Strict model required${color.reset}: provider resolved to "${resolved}" in "${contextLabel}" but requested "${requested}". Fallbacks are disabled — fix the model ID or provider configuration.`,
				)
				return false
			}
			return true
		} catch (e: any) {
			console.error(`${color.red}Strict model check failed${color.reset}: ${e?.message || String(e)}`)
			return false
		}
	}
	// Restore last model if saved
	if (ui.lastModel) {
		applyModelToProvider(providerSettings, ui.lastModel)
		api = buildCliApiHandler(providerSettings)
		enforceNoFallback("restore-last-model")
	}
	const usageTotals = { in: 0, out: 0, cost: 0 }
	// Simple per-turn stats line
	function printStats(ctxWindow?: number) {
		const used = usageTotals.in + usageTotals.out
		const left = ctxWindow ? Math.max(0, ctxWindow - used) : undefined
		const stats =
			`${color.dim}tokens:${color.reset} ${color.cyan}in:${usageTotals.in}${color.reset} ${color.cyan}out:${usageTotals.out}${color.reset}` +
			(left !== undefined ? ` ${color.yellow}ctx:${left}${color.reset}` : "") +
			(usageTotals.cost ? ` ${color.green}~$${usageTotals.cost.toFixed(6)}${color.reset}` : "")
		console.log(stats)
	}
	function printStatsMaybe(location: "final" | "sub") {
		const ctx = (api.getModel().info as any)?.contextWindow
		if (location === "final" || ui.showSubStats) printStats(ctx)
	}
	// Color helpers and help output
	const colorCmd = (cmd: string) => `${color.cyan}${cmd}${color.reset}`
	const colorHdr = (hdr: string) => `${color.yellow}${hdr}${color.reset}`
	const colorMeta = (txt: string) => `${color.gray}${txt}${color.reset}`
	const showHelp = () => {
		console.log(colorHdr("Commands"))
		console.log(
			[
				`${colorCmd("/help")}        ${colorMeta("Show this help")}`,
				`${colorCmd("/setup")}       ${colorMeta("Setup wizard and configuration checks")}`,
				`${colorCmd("/env")}         ${colorMeta("Show environment variables status")}`,
				`${colorCmd("/status")}      ${colorMeta("Show provider, model, and token stats")}`,
				`${colorCmd("/provider")}    ${colorMeta("Switch provider: /provider <name>")}`,
				`${colorCmd("/model")}       ${colorMeta("Switch model: /model <id>")}`,
				`${colorCmd("/models")}      ${colorMeta("List available models")}`,
				`${colorCmd("/mode")}        ${colorMeta("Switch mode: /mode <slug>")}`,
				`${colorCmd("/modes")}       ${colorMeta("List available modes")}`,
				`${colorCmd("/login")}       ${colorMeta("Login to Kilocode: /login kilocode [token]")}`,
				`${colorCmd("/logout")}      ${colorMeta("Logout from Kilocode: /logout kilocode")}`,
				`${colorCmd("/config")}      ${colorMeta("Import/Export: /config import|export <path>")}`,
				`${colorCmd("/mcp")}         ${colorMeta("MCP: /mcp list | /mcp call <server> <tool> [args-json]")}`,
				`${colorCmd("/clear")}       ${colorMeta("Clear the conversation")}`,
				`${colorCmd("/resume")}      ${colorMeta("List or load a session: /resume [<id>]")}`,
				`${colorCmd("/todos")}       ${colorMeta("List todos")}`,
				`${colorCmd("/todo")}        ${colorMeta("Manage todo: /todo add <text> | /todo done <num>")}`,
				`${colorCmd("/blocks")}      ${colorMeta("List collapsible output blocks")}`,
				`${colorCmd("/expand")}      ${colorMeta("Expand block: /expand <n>")}`,
				`${colorCmd("/fold")}        ${colorMeta("Toggle folding: /fold on|off|toggle")}`,
				`${colorCmd("/theme")}       ${colorMeta("Theme: /theme default|mono")}`,
				`${colorCmd("/autocontinue")} ${colorMeta("Auto-continue: /autocontinue on|off|toggle")}`,
				`${colorCmd("/autorun")}     ${colorMeta("Auto-run: /autorun on|off|toggle")}`,
				`${colorCmd("/autorunmax")}  ${colorMeta("Auto-run steps: /autorunmax <1-10>")}`,
				`${colorCmd("/stats")}       ${colorMeta("Stats verbosity: /stats verbose|quiet")}`,
				`${colorCmd("/usage")}       ${colorMeta("Show token usage graph for current session")}`,
				`${colorCmd("/test")}        ${colorMeta("Test provider: /test connection")}`,
				`${colorMeta("Execute shell:")} ${colorCmd("!<command>")}`,
			].join("\n"),
		)
	}

	async function handleSlash(cmd: string): Promise<boolean> {
		if (cmd === "/usage") {
			const ctx = (api.getModel().info as any)?.contextWindow
			renderUsageGraphCLI(usageTotals, ctx, color)
			return true
		}
		if (cmd === "/clear") {
			messages = []
			banner()
			return true
		}
		if (cmd === "/help") {
			showHelp()
			return true
		}
		// Default usage/help when no options provided
		if (cmd === "/provider") {
			console.log(`${colorHdr("Usage")} ${colorCmd("/provider <name>")}`)
			console.log(`${colorMeta("Current")}: ${providerSettings.apiProvider}`)
			return true
		}
		if (cmd === "/model") {
			console.log(`${colorHdr("Usage")} ${colorCmd("/model <model-id>")}`)
			console.log(`${colorMeta("Current")}: ${ui.lastModel || opts.model || "default"}`)
			console.log(`${colorMeta("Tip")}: ${colorCmd("/models")} to list available models`)
			return true
		}
		if (cmd === "/mode") {
			console.log(`${colorHdr("Usage")} ${colorCmd("/mode <slug>")}`)
			console.log(`${colorMeta("Current")}: ${currentMode}`)
			console.log(`${colorMeta("Tip")}: ${colorCmd("/modes")} to list all modes`)
			return true
		}
		if (cmd === "/theme") {
			console.log(`${colorHdr("Usage")} ${colorCmd("/theme default|mono")}`)
			console.log(`${colorMeta("Current")}: ${ui.theme}`)
			return true
		}
		if (cmd === "/fold") {
			console.log(`${colorHdr("Usage")} ${colorCmd("/fold on|off|toggle")}`)
			console.log(`${colorMeta("Current")}: ${ui.foldEnabled ? "on" : "off"}`)
			console.log(`${colorMeta("Hint")}: Ctrl+R expands last block; Ctrl+1..9 expands specific block`)
			return true
		}
		if (cmd === "/autocontinue") {
			console.log(`${colorHdr("Usage")} ${colorCmd("/autocontinue on|off|toggle")}`)
			console.log(`${colorMeta("Current")}: ${ui.autoContinue ? "on" : "off"}`)
			return true
		}
		if (cmd === "/autorun") {
			console.log(`${colorHdr("Usage")} ${colorCmd("/autorun on|off|toggle")}`)
			console.log(`${colorMeta("Current")}: ${ui.autoRun ? "on" : "off"}`)
			console.log(`${colorMeta("Max steps")}: ${ui.autoRunMaxSteps || 2} (see ${colorCmd("/autorunmax")})`)
			return true
		}
		if (cmd === "/autorunmax") {
			console.log(`${colorHdr("Usage")} ${colorCmd("/autorunmax <1-10>")}`)
			console.log(`${colorMeta("Current")}: ${ui.autoRunMaxSteps || 2}`)
			return true
		}
		if (cmd === "/stats") {
			console.log(`${colorHdr("Usage")} ${colorCmd("/stats verbose|quiet")}`)
			console.log(`${colorMeta("Current")}: ${ui.showSubStats ? "verbose" : "quiet"}`)
			return true
		}
		if (cmd === "/mcp") {
			console.log(
				`${colorHdr("Usage")} ${colorCmd("/mcp list")} | ${colorCmd("/mcp call <server> <tool> [args-json]")}`,
			)
			return true
		}
		if (cmd === "/todo") {
			console.log(`${colorHdr("Usage")} ${colorCmd("/todo add <text>")} | ${colorCmd("/todo done <num>")}`)
			return true
		}
		if (cmd === "/expand") {
			console.log(`${colorHdr("Usage")} ${colorCmd("/expand <n>")}`)
			return true
		}
		if (cmd === "/login") {
			console.log(`${colorHdr("Usage")} ${colorCmd("/login kilocode [token]")}`)
			return true
		}
		if (cmd === "/logout") {
			console.log(`${colorHdr("Usage")} ${colorCmd("/logout kilocode")}`)
			return true
		}
		if (cmd === "/config") {
			console.log(
				`${colorHdr("Usage")} ${colorCmd("/config import <path>")} | ${colorCmd("/config export <path>")}`,
			)
			return true
		}
		if (cmd.startsWith("/models")) {
			try {
				if (providerSettings.apiProvider === "kilocode") {
					const rec = await getModels({
						provider: "kilocode-openrouter",
						kilocodeToken: (providerSettings as any).kilocodeToken,
						kilocodeOrganizationId: (providerSettings as any).kilocodeOrganizationId,
					})
					modelIdsCache = Object.keys(rec)
				} else if (providerSettings.apiProvider === "openrouter") {
					const rec = await getModels({
						provider: "openrouter",
						apiKey: (providerSettings as any).openRouterApiKey,
						baseUrl: (providerSettings as any).openRouterBaseUrl,
					})
					modelIdsCache = Object.keys(rec)
				} else {
					console.log("Model listing not implemented for this provider yet.")
					return true
				}
				for (const id of modelIdsCache) console.log(`- ${id}`)
			} catch (e: any) {
				console.error("Failed to fetch models:", e.message || String(e))
			}
			return true
		}
		if (cmd.startsWith("/status")) {
			console.log(`provider: ${providerSettings.apiProvider}`)
			console.log(`model: ${ui.lastModel || opts.model || "default"}`)
			// Keep parity with extension: do not surface internal fallback here
			console.log(`session tokens in:${usageTotals.in} out:${usageTotals.out}`)
			if (usageTotals.cost) console.log(`session cost ~$${usageTotals.cost.toFixed(6)}`)
			return true
		}
		if (cmd.startsWith("/resume")) {
			const parts = cmd.split(/\s+/)
			const targetId = parts[1]
			const entries = await listSessions()
			if (!entries.length) {
				console.log("No sessions found.")
				return true
			}
			if (!targetId) {
				console.log(colorHdr("Sessions (latest first)"))
				for (let i = 0; i < entries.length; i++) {
					const e = entries[i]
					try {
						const sp = path.join(sessionsDir, `${e.id}.json`)
						const raw = fs.readFileSync(sp, "utf8")
						const parsed = JSON.parse(raw)
						const meta = parsed?.meta || {}
						const dt = meta.updatedAt ? new Date(meta.updatedAt) : new Date(e.mtime)
						const when = dt.toLocaleString()
						const folder = meta.cwd || cwd
						// Find last textual message line
						let lastLine = ""
						const msgs: any[] = Array.isArray(parsed?.messages) ? parsed.messages : []
						for (let j = msgs.length - 1; j >= 0; j--) {
							const m = msgs[j]
							if (typeof m?.content === "string") {
								lastLine = (m.content as string).split("\n")[0].trim()
								break
							}
							if (Array.isArray(m?.content)) {
								const tb = (m.content as any[]).find((b) => b?.type === "text")
								if (tb?.text) {
									lastLine = String(tb.text).split("\n")[0].trim()
									break
								}
							}
						}
						const idColored = `${color.bright}${e.id}${color.reset}`
						const metaLine = `${colorMeta(when)}  ${colorMeta(folder)}`
						const lastPreview = lastLine ? `  ${colorMeta("•")} ${lastLine}` : ""
						console.log(`${i + 1}. ${idColored}  ${metaLine}${lastPreview}`)
					} catch {
						console.log(`${i + 1}. ${e.id}`)
					}
				}
				console.log(`Use ${colorCmd("/resume <id>")} to load.`)
				return true
			}
			const found = entries.find((e) => e.id === targetId) || entries[Number(targetId) - 1]
			if (!found) {
				console.log("Session not found.")
				return true
			}
			await loadSession(found.id)
			console.log(`Resumed session ${found.id}.`)
			return true
		}
		if (cmd === "/blocks") {
			console.log(collapser.list())
			return true
		}
		if (cmd.startsWith("/expand ")) {
			const n = Number(cmd.split(/\s+/)[1])
			if (!n || n < 1) {
				console.log("Usage: /expand <n>")
				return true
			}
			collapser.expandByIndex(n)
			return true
		}
		if (cmd.startsWith("/fold")) {
			const arg = cmd.split(/\s+/)[1]
			if (!arg || arg === "toggle") ui.foldEnabled = !ui.foldEnabled
			else if (arg === "on") ui.foldEnabled = true
			else if (arg === "off") ui.foldEnabled = false
			else {
				console.log("Usage: /foldon|off|toggle")
				return true
			}
			console.log(`Folding ${ui.foldEnabled ? "enabled" : "disabled"}.`)
			saveUi(ui)
			return true
		}
		if (cmd.startsWith("/theme")) {
			const arg = (cmd.split(/\s+/)[1] as ThemeName) || "default"
			if (arg !== "default" && arg !== "mono") {
				console.log("Usage: /theme default|mono")
				return true
			}
			ui.theme = arg
			color = getColorMap(ui.theme)
			console.log(`Theme set -> ${ui.theme}`)
			saveUi(ui)
			return true
		}
		if (cmd.startsWith("/autorunmax ")) {
			const n = Number(cmd.split(/\s+/)[1])
			if (!Number.isInteger(n) || n < 1 || n > 10) {
				console.log("Usage: /autorunmax <1-10>")
				return true
			}
			ui.autoRunMaxSteps = n
			saveUi(ui)
			console.log(`Auto-run max steps set -> ${n}`)
			return true
		}
		if (cmd.startsWith("/autorun")) {
			const arg = cmd.split(/\s+/)[1]
			if (!arg || arg === "toggle") ui.autoRun = !ui.autoRun
			else if (arg === "on") ui.autoRun = true
			else if (arg === "off") ui.autoRun = false
			else {
				console.log("Usage: /autorun on|off|toggle")
				return true
			}
			console.log(`Auto-run ${ui.autoRun ? "enabled" : "disabled"}.`)
			saveUi(ui)
			return true
		}
		if (cmd.startsWith("/stats")) {
			const arg = cmd.split(/\s+/)[1]
			if (arg === "verbose") ui.showSubStats = true
			else if (arg === "quiet" || !arg) ui.showSubStats = false
			else {
				console.log("Usage: /stats verbose|quiet")
				return true
			}
			saveUi(ui)
			console.log(`Stats mode -> ${ui.showSubStats ? "verbose" : "quiet"}`)
			return true
		}
		if (cmd.startsWith("/autocontinue")) {
			const arg = cmd.split(/\s+/)[1]
			if (!arg || arg === "toggle") ui.autoContinue = !ui.autoContinue
			else if (arg === "on") ui.autoContinue = true
			else if (arg === "off") ui.autoContinue = false
			else {
				console.log("Usage: /autocontinue on|off|toggle")
				return true
			}
			console.log(`Auto-continue ${ui.autoContinue ? "enabled" : "disabled"}.`)
			saveUi(ui)
			return true
		}
		if (cmd.startsWith("/todos")) {
			const list = loadTodos()
			if (!list.length) console.log("No todos.")
			else list.forEach((t, i) => console.log(`${i + 1}. ${t}`))
			return true
		}
		if (cmd.startsWith("/todo ")) {
			const sub = cmd.split(/\s+/)[1]
			const rest = cmd.split(/\s+/).slice(2).join(" ")
			let list = loadTodos()
			if (sub === "add") {
				if (!rest) {
					console.log("Usage: /todo add <text>")
					return true
				}
				list.push(rest)
				saveTodos(list)
				console.log("Added.")
				return true
			}
			if (sub === "done") {
				const n = Number(rest)
				if (!n) {
					console.log("Usage: /todo done <num>")
					return true
				}
				list.splice(n - 1, 1)
				saveTodos(list)
				console.log("Done.")
				return true
			}
			console.log("Usage: /todos | /todo add <text> | /todo done <num>")
			return true
		}
		if (cmd.startsWith("/mode ")) {
			currentMode = cmd.split(/\s+/)[1] || currentMode
			ui.lastMode = currentMode
			saveUi(ui)
			console.log(`Switched mode -> ${currentMode}`)
			return true
		}
		if (cmd === "/modes") {
			// Lazy-load DEFAULT_MODES to avoid pulling extra dependency at startup
			const { DEFAULT_MODES } = await import("../../../packages/types/src/mode.js")
			console.log("Available modes:")
			for (const m of DEFAULT_MODES) console.log(`- ${m.slug}: ${m.description}`)
			return true
		}
		if (cmd.startsWith("/provider ")) {
			const p = cmd.split(/\s+/)[1]
			providerSettings.apiProvider = p as any
			api = buildCliApiHandler(providerSettings)
			console.log(`Provider set -> ${p}`)
			enforceNoFallback("provider-switch")
			return true
		}
		if (cmd.startsWith("/login ")) {
			const parts = cmd.split(/\s+/)
			const target = parts[1]
			if (target !== "kilocode") {
				console.log("Usage: /login kilocode [token]")
				return true
			}
			let token = parts[2]
			if (!token) {
				// OAuth-style browser flow: start local callback server, open browser, capture token
				try {
					const { token: tkn, organizationId } = await startKilocodeBrowserLogin()
					token = tkn
					if (organizationId) (providerSettings as any).kilocodeOrganizationId = organizationId
					console.log("Received token from browser callback.")
				} catch (e: any) {
					// Fallback to prompt if browser flow fails
					console.log("Browser login failed or timed out. You can paste the token manually.")
					await new Promise<void>((resolve) => {
						rl.question("Paste Kilo Code API token: ", (ans) => {
							token = ans.trim()
							resolve()
						})
					})
				}
			}
			if (!token) {
				console.log("No token provided.")
				return true
			}
			// Persist and apply
			await context.secrets.store("kilocodeToken", token!)
			if ((providerSettings as any).kilocodeOrganizationId) {
				await context.secrets.store("kilocodeOrganizationId", (providerSettings as any).kilocodeOrganizationId)
			}
			providerSettings.apiProvider = "kilocode" as any
			;(providerSettings as any).kilocodeToken = token
			api = buildCliApiHandler(providerSettings)
			console.log("Kilo Code login saved and provider set to kilocode.")
			enforceNoFallback("login")
			return true
		}
		if (cmd.startsWith("/logout ")) {
			const parts = cmd.split(/\s+/)
			const target = parts[1]
			if (target !== "kilocode") {
				console.log("Usage: /logout kilocode")
				return true
			}
			await context.secrets.delete("kilocodeToken")
			await context.secrets.delete("kilocodeOrganizationId")
			if (providerSettings.apiProvider === "kilocode") {
				// Keep provider but clear token; user can switch or login again
				;(providerSettings as any).kilocodeToken = undefined
				;(providerSettings as any).kilocodeOrganizationId = undefined
			}
			console.log("Kilo Code token cleared.")
			return true
		}
		if (cmd.startsWith("/config ")) {
			const parts = cmd.split(/\s+/)
			const sub = parts[1]
			const file = parts[2]
			if (!sub) {
				console.log("Usage: /config import <path> | export <path>")
				return true
			}
			if (sub === "export") {
				if (!file) {
					console.log("Usage: /config export <path>")
					return true
				}
				try {
					const settingsDir = await ensureSettingsDirectoryExists(context as any)
					const globalMcpPath = path.join(settingsDir, GlobalFileNames.mcpSettings)
					const mcp = await loadMcpSettings(globalMcpPath, resolveProjectMcpPath(cwd))
					const payload = { providerProfiles: {}, globalSettings: { customModes: customModes || [] }, mcp }
					await fs.promises.writeFile(file, JSON.stringify(payload, null, 2), "utf8")
					console.log(`Exported config to ${file}`)
				} catch (e: any) {
					console.error("Export failed:", e.message || String(e))
				}
				return true
			}
			if (sub === "import") {
				if (!file) {
					console.log("Usage: /config import <path>")
					return true
				}
				try {
					const raw = fs.readFileSync(file, "utf8")
					const parsed = JSON.parse(raw)
					// Only customModes + mcp for now; providerProfiles are extension-managed
					if (Array.isArray(parsed?.globalSettings?.customModes)) {
						const importedCustomModes = parsed.globalSettings.customModes as any[]
						customModes = importedCustomModes
						const modesPath = path.join(cwd, ".kilocodemodes")
						fs.writeFileSync(modesPath, JSON.stringify({ customModes }, null, 2), "utf8")
						console.log(`Imported ${importedCustomModes.length} custom modes -> ${modesPath}`)
					}
					if (parsed?.mcp?.mcpServers) {
						const projFile = await saveProjectMcp(cwd, parsed.mcp)
						console.log(`Imported MCP servers -> ${projFile}`)
					}
				} catch (e: any) {
					console.error("Import failed:", e.message || String(e))
				}
				return true
			}
			console.log("Unknown /config subcommand")
			return true
		}
		if (cmd.startsWith("/test")) {
			const parts = cmd.split(/\s+/)
			const target = parts[1] || "connection"

			if (target === "connection" || target === "provider") {
				console.log(`Testing ${providerSettings.apiProvider} connection...`)
				try {
					// Create a simple test message
					const testSys = 'You are a helpful assistant. Respond with exactly: "Connection test successful"'
					const testMsgs: MessageParam[] = [{ role: "user", content: [{ type: "text", text: "test" }] }]

					const stream = api.createMessage(testSys, testMsgs)
					let response = ""
					let hasResponse = false

					const timeout = setTimeout(() => {
						if (!hasResponse) {
							console.error(`❌ Connection test timed out after 30s`)
							console.error(`Check that ${providerSettings.apiProvider} is running and accessible`)
							if (providerSettings.apiProvider === "lmstudio") {
								console.error(`LM Studio tips:`)
								console.error(
									`- Make sure LM Studio server is running on ${(providerSettings as any).lmStudioBaseUrl || "http://localhost:1234"}`,
								)
								console.error(
									`- Load a model with sufficient context length (>= 8k tokens recommended)`,
								)
								console.error(`- Check LM Studio logs for detailed error information`)
							}
						}
					}, 30000)

					for await (const chunk of stream) {
						hasResponse = true
						clearTimeout(timeout)
						if (chunk.type === "text") {
							response += chunk.text
						}
					}

					if (response.toLowerCase().includes("connection test successful") || response.trim().length > 0) {
						console.log(`✅ ${providerSettings.apiProvider} connection successful`)
						console.log(`Response: ${response.trim()}`)
					} else {
						console.log(`⚠️  Connection established but unexpected response: ${response}`)
					}
				} catch (e: any) {
					console.error(`❌ Connection test failed:`)
					console.error(`Error: ${e?.message || String(e)}`)

					if (providerSettings.apiProvider === "lmstudio") {
						console.error(`\nLM Studio troubleshooting:`)
						console.error(`1. Ensure LM Studio server is running`)
						console.error(`2. Load a model with adequate context length`)
						console.error(
							`3. Check server URL: ${(providerSettings as any).lmStudioBaseUrl || "http://localhost:1234"}`,
						)
						console.error(`4. Verify model supports the prompt format`)
					} else if (providerSettings.apiProvider === "ollama") {
						console.error(`\nOllama troubleshooting:`)
						console.error(`1. Ensure Ollama is running: ollama serve`)
						console.error(
							`2. Check server URL: ${(providerSettings as any).ollamaBaseUrl || "http://localhost:11434"}`,
						)
						console.error(`3. Verify model is available: ollama list`)
					}
				}
				return true
			}

			console.log("Usage: /test connection")
			return true
		}
		if (cmd.startsWith("/mcp ")) {
			const parts = cmd.split(/\s+/)
			const sub = parts[1]
			const settingsDir = await ensureSettingsDirectoryExists(context as any)
			const globalMcpPath = path.join(settingsDir, GlobalFileNames.mcpSettings)
			const mcp = await loadMcpSettings(globalMcpPath, resolveProjectMcpPath(cwd))
			if (sub === "list") {
				const names = Object.keys(mcp.mcpServers)
				if (!names.length) console.log("No MCP servers configured")
				else names.forEach((n) => console.log(`- ${n}`))
				return true
			}
			if (sub === "call") {
				const name = parts[2]
				const tool = parts[3]
				const json = parts.slice(4).join(" ") || "{}"
				if (!name || !tool) {
					console.log("Usage: /mcp call <server> <tool> [args-json]")
					return true
				}
				const cfg = mcp.mcpServers[name]
				if (!cfg) {
					console.log(`No such MCP server: ${name}`)
					return true
				}
				try {
					const args = JSON.parse(json)
					const res = await callMcpTool(name, cfg, tool, args)
					console.log(JSON.stringify(res, null, 2))
				} catch (e: any) {
					console.error("MCP call failed:", e.message || String(e))
				}
				return true
			}
			console.log("Usage: /mcp list | /mcp call <server> <tool> [args-json]")
			return true
		}
		if (cmd.startsWith("/model ")) {
			const requested = cmd.split(/\s+/)[1]
			if (!requested) {
				console.log("Usage: /model <model-id>")
				return true
			}
			applyModelToProvider(providerSettings, requested)
			api = buildCliApiHandler(providerSettings)
			ui.lastModel = requested
			saveUi(ui)
			console.log(`Model set -> ${requested}`)
			enforceNoFallback("model-change")
			return true
		}
		if (cmd.startsWith("/setup")) {
			console.log("🚀 Kilocode CLI Setup Wizard")
			console.log("—————————————————————————————")

			// Check for VS Code settings
			const vscodeStorageDir = detectVsCodeGlobalStorageDir()
			if (vscodeStorageDir) {
				console.log(`✅ Found VS Code settings directory: ${vscodeStorageDir}`)
				try {
					const globalState = new FileBackedStorage(vscodeStorageDir, "global_state.json")
					const providerProfiles = globalState.get("providerProfiles") || {}
					if (Object.keys(providerProfiles).length > 0) {
						console.log(
							`📋 Available VS Code provider profiles: ${Object.keys(providerProfiles).join(", ")}`,
						)
						console.log(`💡 you can use /config import to sync these settings`)
					}
				} catch (e) {
					console.log(`⚠️  Could not read VS Code settings: ${e}`)
				}
			} else {
				console.log(`⚠️  VS Code settings not found - using CLI-only configuration`)
			}

			// Check environment variables
			console.log("\n🔑 Environment Variables Detected:")
			const envVars = [
				{ name: "OPENAI_API_KEY", provider: "openai", present: !!process.env.OPENAI_API_KEY },
				{ name: "ANTHROPIC_API_KEY", provider: "anthropic", present: !!process.env.ANTHROPIC_API_KEY },
				{ name: "GROQ_API_KEY", provider: "groq", present: !!process.env.GROQ_API_KEY },
				{ name: "GEMINI_API_KEY", provider: "gemini", present: !!process.env.GEMINI_API_KEY },
				{ name: "KILOCODE_TOKEN", provider: "kilocode", present: !!process.env.KILOCODE_TOKEN },
				{ name: "OPENROUTER_API_KEY", provider: "openrouter", present: !!process.env.OPENROUTER_API_KEY },
				{ name: "FIREWORKS_API_KEY", provider: "fireworks", present: !!process.env.FIREWORKS_API_KEY },
				{ name: "OLLAMA_BASE_URL", provider: "ollama", present: !!process.env.OLLAMA_BASE_URL },
				{ name: "LMSTUDIO_BASE_URL", provider: "lmstudio", present: !!process.env.LMSTUDIO_BASE_URL },
			]

			envVars.forEach((v) => {
				const status = v.present ? "✅" : "❌"
				console.log(`${status} ${v.name} (${v.provider})`)
			})

			const availableProviders = envVars.filter((v) => v.present).map((v) => v.provider)
			if (availableProviders.length > 0) {
				console.log(`\n🎯 Ready to use providers: ${availableProviders.join(", ")}`)
				console.log(`💡 Switch with: /provider <name>`)
			} else {
				console.log(`\n⚠️  No API keys found in environment variables`)
				console.log(`💡 Set up your API keys or use: /login kilocode`)
			}

			// Check MCP configuration
			const settingsDir = await ensureSettingsDirectoryExists(context as any)
			const globalMcpPath = path.join(settingsDir, GlobalFileNames.mcpSettings)
			const projectMcpPath = resolveProjectMcpPath(cwd)
			const mcp = await loadMcpSettings(globalMcpPath, projectMcpPath)
			const mcpServerCount = Object.keys(mcp.mcpServers).length

			console.log(`\n🔌 MCP Configuration:`)
			console.log(`• Global MCP settings: ${globalMcpPath}`)
			console.log(`• Project MCP settings: ${projectMcpPath || "not configured"}`)
			console.log(`• MCP servers configured: ${mcpServerCount}`)
			if (mcpServerCount > 0) {
				console.log(`• Available servers: ${Object.keys(mcp.mcpServers).join(", ")}`)
				console.log(`💡 Use /mcp list for details`)
			}

			console.log(`\n✨ Setup complete! Use /help to see all commands.`)
			return true
		}
		if (cmd.startsWith("/env")) {
			console.log("🔑 Environment Variables Status:")
			console.log("—————————————————————————————")

			const envChecks = [
				{ name: "OPENAI_API_KEY", value: process.env.OPENAI_API_KEY, provider: "OpenAI" },
				{ name: "ANTHROPIC_API_KEY", value: process.env.ANTHROPIC_API_KEY, provider: "Anthropic" },
				{ name: "GROQ_API_KEY", value: process.env.GROQ_API_KEY, provider: "Groq" },
				{ name: "GEMINI_API_KEY", value: process.env.GEMINI_API_KEY, provider: "Google Gemini" },
				{ name: "KILOCODE_TOKEN", value: process.env.KILOCODE_TOKEN, provider: "Kilocode" },
				{ name: "OPENROUTER_API_KEY", value: process.env.OPENROUTER_API_KEY, provider: "OpenRouter" },
				{ name: "FIREWORKS_API_KEY", value: process.env.FIREWORKS_API_KEY, provider: "Fireworks" },
				{ name: "FEATHERLESS_API_KEY", value: process.env.FEATHERLESS_API_KEY, provider: "Featherless" },
				{ name: "OLLAMA_BASE_URL", value: process.env.OLLAMA_BASE_URL, provider: "Ollama" },
				{ name: "LMSTUDIO_BASE_URL", value: process.env.LMSTUDIO_BASE_URL, provider: "LM Studio" },
				{ name: "VERTEX_PROJECT_ID", value: process.env.VERTEX_PROJECT_ID, provider: "Google Vertex AI" },
				{ name: "AWS_ACCESS_KEY_ID", value: process.env.AWS_ACCESS_KEY_ID, provider: "AWS Bedrock" },
			]

			envChecks.forEach((check) => {
				const status = check.value ? "✅" : "❌"
				const maskedValue = check.value ? `${check.value.substring(0, 8)}...` : "not set"
				console.log(`${status} ${check.name}: ${maskedValue} (${check.provider})`)
			})

			const configured = envChecks.filter((c) => c.value).length
			console.log(`\n📊 Summary: ${configured}/${envChecks.length} providers configured`)

			if (configured === 0) {
				console.log(`\n💡 Getting started:`)
				console.log(`• For free tier: /login kilocode`)
				console.log(`• For OpenAI: export OPENAI_API_KEY="sk-..."`)
				console.log(`• For Anthropic: export ANTHROPIC_API_KEY="sk-ant-..."`)
				console.log(`• For local AI: Setup Ollama or LM Studio`)
			}
			return true
		}
		return false
	}

	async function startKilocodeBrowserLogin(): Promise<{ token: string; organizationId?: string | null }> {
		// Pick a port and start a local HTTP server to receive the callback: http://127.0.0.1:<port>/kilocode
		const server = http.createServer()
		const listen = (port: number) =>
			new Promise<void>((resolve, reject) => {
				server.once("error", reject)
				server.listen(port, "127.0.0.1", () => resolve())
			})
		// Try default port first, then random fallback
		let port = Number(process.env.KILOCODE_LOGIN_PORT) || 43110
		try {
			await listen(port)
		} catch {
			port = 0
			await listen(port)
			const addr = server.address()
			if (addr && typeof addr === "object") port = addr.port
		}

		const callbackUrl = `http://127.0.0.1:${port}/kilocode`
		const loginBase = process.env.KILOCODE_LOGIN_BASE || "https://app.kilocode.ai"
		// Open the hosted sign-in and request redirect back to the local callback
		const loginUrl = `${loginBase}/users/sign_in?redirect_uri=${encodeURIComponent(callbackUrl)}`

		const exec = promisify(execCb)
		const openBrowser = async (url: string) => {
			const platform = process.platform
			try {
				if (platform === "darwin") await exec(`open "${url}"`)
				else if (platform === "win32") await exec(`start "" "${url}"`, { shell: "cmd.exe" })
				else await exec(`xdg-open "${url}"`)
			} catch {
				console.log("Open this URL in your browser to continue login:")
				console.log(url)
			}
		}

		const tokenPromise = new Promise<{ token: string; organizationId?: string | null }>((resolve, reject) => {
			const timer = setTimeout(
				() => {
					try {
						server.close()
					} catch {}
					reject(new Error("Login timed out"))
				},
				2 * 60 * 1000,
			)

			server.on("request", (req, res) => {
				try {
					if (!req.url) return
					const url = new URL(req.url, `http://127.0.0.1:${port}`)
					if (url.pathname !== "/kilocode") return
					const token = url.searchParams.get("token") || ""
					const organizationId = url.searchParams.get("organizationId")
					res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
					if (token) {
						res.end("<html><body><h2>Login complete</h2><p>You can close this window.</p></body></html>")
						clearTimeout(timer)
						try {
							server.close()
						} catch {}
						resolve({ token, organizationId })
					} else {
						res.end(
							"<html><body><h2>Missing token</h2><p>Could not find token in callback.</p></body></html>",
						)
					}
				} catch (e) {
					// ignore
				}
			})
		})

		await openBrowser(loginUrl)
		return tokenPromise
	}

	function buildSystemPrompt(modeSlug: string): string {
		// Construct a lean system prompt using default modes
		const { DEFAULT_MODES } =
			require("../../../packages/types/src/mode.js") as typeof import("../../../packages/types/src/mode.js")
		const pool =
			customModes && customModes.length
				? [...DEFAULT_MODES.filter((m) => !customModes!.some((c) => c.slug === m.slug)), ...customModes]
				: DEFAULT_MODES
		const mode = pool.find((m) => m.slug === modeSlug) || pool[0]
		const role = mode.roleDefinition || ""
		const extra = mode.customInstructions ? `\n\n${mode.customInstructions}` : ""
		const cliPreamble = `You are running as a command-line TUI agent. You do not have a GUI. Respond concisely and stream results. Use markdown for code blocks.`

		const toolArgs: ToolArgs = { cwd, supportsComputerUse: false }
		// Build apply_diff tool description from diff strategy (matches extension behavior)
		const diffStrategy = new MultiSearchReplaceDiffStrategy()
		const applyDiffSection = diffStrategy.getToolDescription({ cwd })
		const toolSections = [
			getExecuteCommandDescription(toolArgs),
			getReadFileDescription(toolArgs),
			getWriteToFileDescription(toolArgs),
			getInsertContentDescription(toolArgs),
			getListFilesDescription(toolArgs),
			getSearchFilesDescription(toolArgs),
			getSearchAndReplaceDescription(toolArgs),
			// Add apply_diff to advertised tools (via diff strategy)
			applyDiffSection,
			getUseMcpToolDescription({} as any),
			// Removed: getAccessMcpResourceDescription({} as any),
			getAskFollowupQuestionDescription(),
			getAttemptCompletionDescription(),
			getNewTaskDescription(toolArgs),
			getSwitchModeDescription(),
			getListCodeDefinitionNamesDescription(toolArgs),
			getCodebaseSearchDescription(toolArgs),
			getUpdateTodoListDescription(toolArgs),
		]
			.filter(Boolean)
			.join("\n\n")

		const provider = providerSettings.apiProvider
		const selectedModelId = ui.lastModel || opts.model || ""

		const guidance = `You have access to the tools above. Use exactly one tool per assistant message using the XML format. After emitting a tool call, stop and wait for the tool result which will arrive in the user's next message.\n\nAvailable session commands: /modes, /mode <slug>, /provider <name>, /model <id>, /login kilocode [token], /logout kilocode, /mcp list|call ...`

		const environment =
			`Environment\n- Provider: ${provider}` +
			(selectedModelId ? `\n- Selected Model ID: ${selectedModelId}` : "")

		return `${role}\n\n${cliPreamble}\n\n${environment}\n\n${guidance}\n\n${toolSections}${extra}`
	}

	async function send(input: string) {
		// process Kilo slash commands where present
		const { processedText } = await parseKiloSlashCommands(input, {}, {})
		const sys = buildSystemPrompt(currentMode)
		// Enforce strict model immediately before sending
		if (!enforceNoFallback("send")) {
			// Do not mutate conversation; require the user to fix provider/model first
			return
		}
		// Helper: sanitize any raw XML tool tags accidentally echoed by models
		const sanitizeXml = (text: string): string => {
			try {
				const toolTags = [
					"list_files",
					"read_file",
					"execute_command",
					"search_files",
					"search_and_replace",
					"write_to_file",
					"insert_content",
					"apply_diff",
					"use_mcp_tool",
					"access_mcp_resource",
					"ask_followup_question",
					"update_todo_list",
					"new_task",
					"condense",
				]
				let out = text
				// Remove full tool blocks e.g. <read_file> ... </read_file>
				const toolsPattern = new RegExp(`<(${toolTags.join("|")})[\\s\\S]*?<\\/\\1>`, "g")
				out = out.replace(toolsPattern, "")
				// Remove common arg blocks if they appear standalone
				const argTags = [
					"args",
					"file",
					"path",
					"recursive",
					"command",
					"content",
					"line",
					"start_line",
					"end_line",
				]
				const argsPattern = new RegExp(`<(${argTags.join("|")})[\\s\\S]*?<\\/\\1>`, "g")
				out = out.replace(argsPattern, "")
				// Also drop lone opening/closing tags
				out = out.replace(/<\/?[a-z_]+>\s*$/gm, "")
				// Collapse excessive blank lines
				out = out.replace(/\n{3,}/g, "\n\n").trim()
				return out
			} catch {
				return text
			}
		}

		const userBlock: MessageParam = {
			role: "user",
			content: [{ type: "text", text: processedText }],
		}
		messages.push(userBlock)

		// Create stream
		const stream = api.createMessage(sys, messages)
		let assistantText = ""
		let reasoningText = ""
		let isFirstTextChunk = true
		let showedEarlyThinking = false
		const thinkingMain = new CliThinkingAnimation(color)
		// Used by autorun/auto-continue branches to accumulate reasoning
		let autoReason = ""

		// Hide streamed <thinking>/<reasoning> XML blocks in real time while preserving later collapsed view
		let inHiddenBlock: { tag: string | null } = { tag: null }
		const hideStreamTags = (text: string): string => {
			// Stream-safe filter that removes content inside specific XML-like tags across chunk boundaries.
			// Supports attributes in opening tags and nested blocks of different tag names.
			const hidden = new Set([
				"thinking",
				"reasoning",
				"list_files",
				"read_file",
				"execute_command",
				"search_files",
				"search_and_replace",
				"write_to_file",
				"insert_content",
				"apply_diff",
				"use_mcp_tool",
				"access_mcp_resource",
				"ask_followup_question",
				"update_todo_list",
				"new_task",
				"condense",
				"args",
				"question",
				"follow_up",
			])

			let out = ""
			let i = 0
			while (i < text.length) {
				if (inHiddenBlock.tag) {
					// Look for the closing tag of the active block
					const closeSeq = `</${inHiddenBlock.tag}>`
					const closeIdx = text.indexOf(closeSeq, i)
					if (closeIdx === -1) {
						// Entire remainder is hidden until next chunk arrives
						return out
					}
					// Skip hidden content including the closing tag
					i = closeIdx + closeSeq.length
					inHiddenBlock.tag = null
					continue
				}

				const ch = text[i]
				if (ch === "<") {
					// Parse a tag name (letters, digits, underscore, dash)
					const rest = text.slice(i + 1)
					const isClosing = rest.startsWith("/")
					const nameStart = i + 1 + (isClosing ? 1 : 0)
					let nameEnd = nameStart
					while (nameEnd < text.length) {
						const c = text[nameEnd]
						if (/[-_a-zA-Z0-9]/.test(c)) nameEnd++
						else break
					}
					const tagName = text.slice(nameStart, nameEnd)
					if (!isClosing && tagName && hidden.has(tagName)) {
						// Opening tag of a hidden block; advance to end of this tag '>' then enter hidden
						const gt = text.indexOf(">", nameEnd)
						if (gt === -1) {
							// Tag not closed yet; wait for next chunk
							inHiddenBlock.tag = tagName
							return out
						}
						inHiddenBlock.tag = tagName
						i = gt + 1
						continue
					}
				}

				// Normal visible character
				out += ch
				i++
			}
			return out
		}

		for await (const chunk of stream) {
			if (chunk.type === "text") {
				if (thinkingMain.isAnimating()) thinkingMain.stopAnimation()
				assistantText += chunk.text
				// Stream text chunks in real-time, filtering hidden XML tags
				if (isFirstTextChunk) {
					process.stdout.write("\n") // Start on new line
					isFirstTextChunk = false
				}
				const visible = hideStreamTags(chunk.text)
				if (visible.length > 0) process.stdout.write(visible)
			} else if (chunk.type === "reasoning") {
				// On first reasoning token, show the Thinking header before any answer text
				if (!showedEarlyThinking) {
					thinkingMain.startThinking()
					showedEarlyThinking = true
				}
				reasoningText += chunk.text
			} else if (chunk.type === "usage") {
				usageTotals.in += chunk.inputTokens || 0
				usageTotals.out += chunk.outputTokens || 0
				if (typeof chunk.totalCost === "number") usageTotals.cost = chunk.totalCost
			}
		}

		// Add newline after streaming completes
		if (!isFirstTextChunk) process.stdout.write("\n")
		if (thinkingMain.isAnimating()) thinkingMain.stopAnimation()

		// After stream completes, print collapsed previews for thinking and long answers
		const dim = "\u001b[2m",
			reset = "\u001b[22m"
		const previewFrom = (text: string, maxLines = 1): string => {
			const lines = (text || "").split("\n")
			let head = lines.slice(0, maxLines).join("\n")
			if (lines.length > maxLines) head += `\n… +${lines.length - maxLines} lines (ctrl+r or Ctrl+<n> to expand)`
			return head || "(empty)"
		}

		if (reasoningText.trim().length > 0) {
			if (ui.foldEnabled) {
				// Store reasoning as a collapsed block, dimmed and colored
				const full = `${color.dim}${color.magenta}${reasoningText}${color.reset}`
				collapser.add(`${color.magenta}💭 Thinking${color.reset}`, previewFrom(reasoningText, 1), full)
			} else {
				process.stdout.write(
					`\n${color.magenta}💭 Thinking${color.reset}\n${color.dim}${reasoningText}${color.reset}\n`,
				)
			}
		}

		if (assistantText.trim().length > 0) {
			// Strip tool_use XML and raw tool XML from the displayed assistant text; keep only textual content
			const parser = new AssistantMessageParser()
			parser.processChunk(assistantText)
			const contentBlocks = parser.getContentBlocks()
			const visibleText = contentBlocks
				.filter((b: any) => b.type === "text")
				.map((b: any) => b.text)
				.join("")
			const toolBlocks = contentBlocks.filter((b: any) => b.type === "tool_use")

			const cleanVisible = sanitizeXml(visibleText)

			// Don't display cleanVisible again since we already streamed it in real-time
			// Only use it for tool detection and auto-run logic

			// Auto-run: if no tool use in this turn and assistant didn't ask a question, send "continue" up to N steps
			const askedQuestion = /\?\s*$/.test(cleanVisible.trim())
			if (ui.autoRun && toolBlocks.length === 0 && !askedQuestion) {
				for (let step = 0; step < (ui.autoRunMaxSteps || 2); step++) {
					const autoUser: MessageParam = {
						role: "user",
						content: [{ type: "text", text: "continue" }],
					}
					messages.push(autoUser)
					const autoStream = api.createMessage(sys, messages)
					let autoAssistant = ""
					let isFirstChunk = true
					let showedEarlyThinkingAuto = false
					const thinkingAuto = new CliThinkingAnimation(color)
					for await (const chunk of autoStream) {
						if (chunk.type === "text") {
							if (thinkingAuto.isAnimating()) thinkingAuto.stopAnimation()
							autoAssistant += chunk.text
							// Stream auto-run responses in real-time too
							if (isFirstChunk) {
								process.stdout.write("\n") // Start on new line for auto-run
								isFirstChunk = false
							}
							process.stdout.write(hideStreamTags(chunk.text))
						} else if (chunk.type === "reasoning") {
							if (!showedEarlyThinkingAuto) {
								thinkingAuto.startThinking()
								showedEarlyThinkingAuto = true
							}
							autoReason += chunk.text
						} else if (chunk.type === "usage") {
							usageTotals.in += chunk.inputTokens || 0
							usageTotals.out += chunk.outputTokens || 0
							if (typeof chunk.totalCost === "number") usageTotals.cost = chunk.totalCost
						}
					}
					if (autoAssistant.trim().length === 0) break
					if (!isFirstChunk) process.stdout.write("\n") // End line after streaming
					if (thinkingAuto.isAnimating()) thinkingAuto.stopAnimation()
					messages.push({ role: "assistant", content: [{ type: "text", text: autoAssistant }] })

					// Stop autorun if assistant asked a question or produced a tool
					const tBlocks = parseToolUses(autoAssistant)
					const asked = /\?\s*$/.test(autoAssistant.trim())
					if (tBlocks.length > 0 || asked) break
				}
				await saveSession().catch(() => {})
				printStatsMaybe("sub")
			}
		}

		await saveSession().catch(() => {})
		printStatsMaybe("sub")

		const assistantMessage: MessageParam = {
			role: "assistant",
			content: [{ type: "text", text: assistantText }],
		}
		messages.push(assistantMessage)

		// If no assistant text and autocontinue is enabled, send a single automatic "continue"
		if (ui.autoContinue && assistantText.trim().length === 0) {
			const autoUser: MessageParam = {
				role: "user",
				content: [{ type: "text", text: "continue" }],
			}
			messages.push(autoUser)
			const autoStream = api.createMessage(sys, messages)
			let autoAssistant = ""
			let autoContinueReason = ""
			let isFirstAutoChunk = true
			let showedEarlyThinkingAutoCont = false
			const thinkingAutoCont = new CliThinkingAnimation(color)
			for await (const chunk of autoStream) {
				if (chunk.type === "text") {
					if (thinkingAutoCont.isAnimating()) thinkingAutoCont.stopAnimation()
					autoAssistant += chunk.text
					// Stream auto-continue responses in real-time
					if (isFirstAutoChunk) {
						process.stdout.write("\n") // Start on new line
						isFirstAutoChunk = false
					}
					process.stdout.write(hideStreamTags(chunk.text))
				} else if (chunk.type === "reasoning") {
					if (!showedEarlyThinkingAutoCont) {
						thinkingAutoCont.startThinking()
						showedEarlyThinkingAutoCont = true
					}
					autoContinueReason += chunk.text
				} else if (chunk.type === "usage") {
					usageTotals.in += chunk.inputTokens || 0
					usageTotals.out += chunk.outputTokens || 0
					if (typeof chunk.totalCost === "number") usageTotals.cost = chunk.totalCost
				}
			}
			if (!isFirstAutoChunk) process.stdout.write("\n") // End line after streaming
			if (thinkingAutoCont.isAnimating()) thinkingAutoCont.stopAnimation()
			if (autoContinueReason.trim().length > 0) {
				if (ui.foldEnabled)
					collapser.add(
						`${color.magenta}💭 Thinking${color.reset}`,
						previewFrom(autoContinueReason, 1),
						`${color.dim}${color.magenta}${autoContinueReason}${color.reset}`,
					)
				else
					process.stdout.write(
						`\n${color.magenta}💭 Thinking${color.reset}\n${color.dim}${autoContinueReason}${color.reset}\n`,
					)
			}
			// Auto-assistant text already streamed in real-time above
			messages.push({ role: "assistant", content: [{ type: "text", text: autoAssistant }] })
			await saveSession().catch(() => {})
			printStatsMaybe("sub")
		}

		// Tool loop: parse and execute tools until none remain or step limit reached
		let steps = 0
		while (steps++ < 8) {
			// Parse tool_uses from the latest assistant message (not the original streamed text)
			const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant") as any
			let latestAssistantText = ""
			if (lastAssistant) {
				if (Array.isArray(lastAssistant.content)) {
					latestAssistantText = lastAssistant.content
						.filter((b: any) => b.type === "text")
						.map((b: any) => b.text)
						.join("")
				} else if (typeof lastAssistant.content === "string") {
					latestAssistantText = lastAssistant.content
				}
			}
			const tools = parseToolUses(latestAssistantText)
			if (!tools.length) break

			// Execute exactly one tool per iteration
			const tool = tools[0]

			// Collapsed preamble summarizing planned tool action (single tool)
			const paramsInfoPlanned = Object.entries(tool.params || {})
				.filter(([_, v]) => (v ?? "").toString().length > 0)
				.map(([k, v]) => `${k}=${JSON.stringify(v)}`)
				.join(" ")
			const plannedTitle =
				tool.name === "execute_command"
					? `${color.cyan}L Bash(${(tool.params as any).command || ""})${color.reset}`
					: tool.name === "read_file"
						? `${color.blue}L Read(${(tool.params as any).path || ""})${color.reset}`
						: tool.name === "list_files"
							? `${color.green}L List(${(tool.params as any).path || "."}${(tool.params as any).recursive ? ", recursive" : ""})${color.reset}`
							: tool.name === "search_files"
								? `${color.green}L Search(${paramsInfoPlanned})${color.reset}`
								: `${color.magenta}L ${tool.name}${color.reset}`

			if (ui.foldEnabled) {
				collapser.add(`${color.yellow}⚙︎ Working${color.reset}`, plannedTitle, plannedTitle)
			} else {
				console.log(`${color.yellow}⚙︎ Working${color.reset}`)
				console.log(plannedTitle)
			}

			console.log(`\n${color.cyan}[tool]${color.reset} ${tool.name}`)
			const result = await executeTool(cwd, tool)

			// Collapse verbose tool outputs by default; show a one-line preview
			const previewFrom = (text: string, maxLines = 1): string => {
				const lines = (text || "").split("\n")
				let head = lines.slice(0, maxLines).join("\n")
				if (lines.length > maxLines) head += `\n… +${lines.length - maxLines} lines (ctrl+r to expand)`
				return head || "(no output)"
			}

			const paramsInfo = Object.entries(result.params || {})
				.filter(([_, v]) => (v ?? "").toString().length > 0)
				.map(([k, v]) => `${k}=${JSON.stringify(v)}`)
				.join(" ")

			const title = (() => {
				if (result.name === "execute_command")
					return `${color.cyan}⏺ Bash(${(result.params.command || "").trim()})${color.reset}`
				if (result.name === "read_file")
					return `${color.blue}⏺ Read(${result.params.path || ""})${color.reset}`
				if (result.name === "list_files")
					return `${color.green}⏺ List(${result.params.path || "."}${result.params.recursive ? ", recursive" : ""})${color.reset}`
				if (result.name === "search_files") return `${color.green}⏺ Search(${paramsInfo})${color.reset}`
				return `${color.magenta}⏺ ${result.name}${color.reset}`
			})()

			// Special handling for interactive tools
			if (result.name === "ask_followup_question") {
				// Display question prominently and wait for user response
				console.log(`${result.output}`)

				// Add the assistant message with the question to maintain conversation context
				const questionMessage: MessageParam = {
					role: "assistant",
					content: [{ type: "text", text: `${assistantText}\n\n${result.output}` }],
				}
				messages.push(questionMessage)

				// Break out of tool loop and return control to user
				await saveSession().catch(() => {})
				printStatsMaybe("final")
				return // Exit send() function completely - user will provide answer
			} else if (result.name === "attempt_completion") {
				// Display completion prominently
				console.log(`${result.output}`)
				const userToolResponse: MessageParam = {
					role: "user",
					content: [{ type: "text", text: `Task completion result: ${result.params.result || "completed"}` }],
				}
				messages.push(userToolResponse)
				break // End tool loop for completion
			} else {
				const needsCollapse = (result.output || "").split("\n").length > 5 || result.name === "execute_command"
				if (ui.foldEnabled && needsCollapse) {
					collapser.add(title, previewFrom(result.output, 1), result.output)
				} else {
					console.log(`${color.dim}${result.output}${color.reset}`)
				}

				const userToolResponse: MessageParam = {
					role: "user",
					content: [{ type: "text", text: `Tool result for ${result.name}:\n${result.output}` }],
				}
				messages.push(userToolResponse)
			}

			// Continue conversation with tool result
			const subStream = api.createMessage(sys, messages)
			let subAssistant = ""
			let subReason = ""
			let isFirstSubChunk = true
			let showedEarlyThinkingSub = false
			const thinkingSub = new CliThinkingAnimation(color)
			for await (const chunk of subStream) {
				if (chunk.type === "text") {
					if (thinkingSub.isAnimating()) thinkingSub.stopAnimation()
					subAssistant += chunk.text
					// Stream sub-responses in real-time
					if (isFirstSubChunk) {
						process.stdout.write("\n") // Start on new line
						isFirstSubChunk = false
					}
					process.stdout.write(hideStreamTags(chunk.text))
				} else if (chunk.type === "reasoning") {
					if (!showedEarlyThinkingSub) {
						thinkingSub.startThinking()
						showedEarlyThinkingSub = true
					}
					subReason += chunk.text
				} else if (chunk.type === "usage") {
					usageTotals.in += chunk.inputTokens || 0
					usageTotals.out += chunk.outputTokens || 0
					if (typeof chunk.totalCost === "number") usageTotals.cost = chunk.totalCost
				}
			}
			if (!isFirstSubChunk) process.stdout.write("\n") // End line after streaming
			if (thinkingSub.isAnimating()) thinkingSub.stopAnimation()

			if (subReason.trim().length > 0) {
				if (ui.foldEnabled)
					collapser.add(
						`${color.magenta}💭 Thinking${color.reset}`,
						previewFrom(subReason, 1),
						`${color.dim}${color.magenta}${subReason}${color.reset}`,
					)
				else
					process.stdout.write(
						`\n${color.magenta}💭 Thinking${color.reset}\n${color.dim}${subReason}${color.reset}\n`,
					)
			}
			// Sub-assistant text already streamed in real-time above
			messages.push({ role: "assistant", content: [{ type: "text", text: subAssistant }] })

			// Auto-continue once if the assistant produced no content after a tool (check subAssistant, not assistantText)
			if (ui.autoContinue && subAssistant.trim().length === 0) {
				const autoUser2: MessageParam = {
					role: "user",
					content: [{ type: "text", text: "continue" }],
				}
				messages.push(autoUser2)
				const autoStream2 = api.createMessage(sys, messages)
				let autoAssistant2 = ""
				let showedEarlyThinkingAuto2 = false
				const thinkingAuto2 = new CliThinkingAnimation(color)
				for await (const chunk of autoStream2) {
					if (chunk.type === "text") {
						if (thinkingAuto2.isAnimating()) thinkingAuto2.stopAnimation()
						autoAssistant2 += chunk.text
						process.stdout.write(hideStreamTags(chunk.text))
					} else if (chunk.type === "reasoning") {
						if (!showedEarlyThinkingAuto2) {
							thinkingAuto2.startThinking()
							showedEarlyThinkingAuto2 = true
						}
						autoReason += chunk.text
					} else if (chunk.type === "usage") {
						usageTotals.in += chunk.inputTokens || 0
						usageTotals.out += chunk.outputTokens || 0
						if (typeof chunk.totalCost === "number") usageTotals.cost = chunk.totalCost
					}
				}
				process.stdout.write("\n")
				if (thinkingAuto2.isAnimating()) thinkingAuto2.stopAnimation()
				messages.push({ role: "assistant", content: [{ type: "text", text: autoAssistant2 }] })
			}
		}
		// Print stats again after tool sub-streams
		printStats((api.getModel().info as any)?.contextWindow)
	}
	// Final per-turn stats
	printStatsMaybe("final")

	const prompt = () => {
		isPrompting = true
		// Initial paint handled by rl; avoid extra writes during typing
		rl.question("> ", async (line) => {
			isPrompting = false
			// Remove sticky footer once we leave prompt to avoid being scrolled by output
			clearStatusLine()
			const trimmed = line.trim()
			try {
				if (trimmed.startsWith("/")) {
					const handled = await handleSlash(trimmed)
					if (!handled) console.log("Unknown command")
				} else if (trimmed.startsWith("!")) {
					// Direct shell execution: !<cmd>
					const cmd = trimmed.slice(1).trim()
					if (!cmd) {
						console.log("Usage: !<command>")
						prompt()
						return
					}
					try {
						const exec = promisify(execCb)
						const { stdout, stderr } = await exec(cmd, {
							cwd,
							maxBuffer: 10 * 1024 * 1024,
							env: process.env,
						})
						if (stderr && stderr.trim())
							console.log(
								`${color.red}[stderr]${color.reset}\n${color.red}${stderr.trim()}${color.reset}`,
							)
						if (stdout && stdout.trim())
							console.log(
								`${color.red}[stdout]${color.reset}\n${color.red}${stdout.trim()}${color.reset}`,
							)
						if ((!stdout || !stdout.trim()) && (!stderr || !stderr.trim()))
							console.log(`${color.red}(no output)${color.reset}`)
					} catch (e: any) {
						const msg = e?.stderr || e?.message || String(e)
						console.log(
							`${color.red}Command failed:${color.reset}\n${color.red}${msg.trim()}${color.reset}`,
						)
					}
				} else if (trimmed.length > 0) {
					await send(trimmed)
				}
			} catch (err: any) {
				console.error("\n[Error]", err?.message || String(err))
			}
			prompt()
		})
	}

	prompt()
}

main().catch((e) => {
	console.error(e)
	process.exit(1)
})
// ASCII usage graph helpers (CLI)
function makeBar(pct: number, width = 30): string {
	const clamped = Math.max(0, Math.min(1, pct || 0))
	const filled = Math.round(clamped * width)
	const empty = Math.max(0, width - filled)
	return `${"█".repeat(filled)}${"░".repeat(empty)}`
}
function renderUsageGraphCLI(
	usageTotals: { in: number; out: number; cost: number },
	ctxWindow: number | undefined,
	color: any,
) {
	const used = (usageTotals.in || 0) + (usageTotals.out || 0)
	const costStr = usageTotals.cost ? ` ${color.green}~$${usageTotals.cost.toFixed(6)}${color.reset}` : ""
	console.log(
		`${color.dim}tokens:${color.reset} ${color.cyan}in:${usageTotals.in}${color.reset} ${color.cyan}out:${usageTotals.out}${color.reset}` +
			(ctxWindow ? ` ${color.yellow}ctx:${used}/${ctxWindow}${color.reset}` : "") +
			costStr,
	)
	const inPct = ctxWindow ? (usageTotals.in || 0) / ctxWindow : used ? (usageTotals.in || 0) / used : 0
	const outPct = ctxWindow ? (usageTotals.out || 0) / ctxWindow : used ? (usageTotals.out || 0) / used : 0
	const usedPct = ctxWindow ? used / ctxWindow : 0
	console.log(`in  ${makeBar(inPct)} ${usageTotals.in}`)
	console.log(`out ${makeBar(outPct)} ${usageTotals.out}`)
	if (ctxWindow) {
		const left = Math.max(0, ctxWindow - used)
		console.log(`ctx ${makeBar(usedPct)} ${used}/${ctxWindow} (${left} left)`)
	}
}
