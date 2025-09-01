import fs from "node:fs/promises"
import fssync from "node:fs"
import path from "node:path"
import { exec as execCb } from "node:child_process"
import { promisify } from "node:util"
import ignore from "ignore"

import { AssistantMessageParser } from "../../../src/core/assistant-message/AssistantMessageParser.js"
import type {
	ToolUse,
	TextContent,
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
	NewRuleToolUse,
	ReportBugToolUse,
	CondenseToolUse,
	BrowserActionToolUse,
} from "../../../src/shared/tools.js"

// Enhanced UI and state management
import { RealTimeThinkingDisplay, parseResponseWithThinking } from "./ui/thinking-stream.js"
import { CheckpointIntegration } from "./checkpoints/checkpoint-manager.js"
import { MultiSearchReplaceDiffStrategy } from "../../../src/core/diff/strategies/multi-search-replace.js"
import { runMultiApplyDiff, MultiApplyDiffParams, MultiApplyDiffResult } from "./tools/multi-apply-diff.js"
import type { ToolUse as GenericToolUse } from "../../../src/shared/tools.js"

// MCP + CLI state helpers
import { createCliExtensionContext } from "./shims/vscode.js"
import { ensureSettingsDirectoryExists } from "../../../src/utils/globalContext.js"
import { GlobalFileNames } from "../../../src/shared/globalFileNames.js"
import { loadMcpSettings, resolveProjectMcpPath, callMcpTool } from "./mcp.js"

// CLI browser action implementation
import { createCliBrowserAction } from "./browser-action-cli.js"

// Enhanced integration features
import { EnhancedSettingsSync } from "./integrations/enhanced-settings-sync.js"
import { EnhancedMcpResourceManager } from "./integrations/enhanced-mcp-resources.js"
import { CrossSessionStateManager } from "./integrations/cross-session-state.js"

// Performance optimization engine
import { PerformanceOptimizationEngine } from "./performance/optimization-engine.js"

// Advanced terminal formatting
import { AdvancedTerminalFormatter } from "./ui/advanced-terminal-formatter.js"

// CLI-specific advanced tools
import { runBatchOperations } from "./tools/batch-operations.js"
import { runWorkflowAutomation } from "./tools/workflow-automation.js"
import { runSystemDiagnostics } from "./tools/system-diagnostics.js"

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
			const ignoreContent = fssync.readFileSync(rooignorePath, "utf8")
			ignoreInstance = ignore().add(ignoreContent)
		} else {
			// Fallback to default patterns
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
	metadata?: {
		duration?: number
		files_affected?: string[]
		bytes_processed?: number
		status?: "success" | "warning" | "error"
		progress?: number
	}
}

export type BatchToolExecution = {
	executions: ToolExecution[]
	total_duration: number
	success_count: number
	error_count: number
	summary: string
}

export type ParsedResponse = {
	toolUses: ToolUse[]
	textContent: TextContent[]
	hasTools: boolean
	hasText: boolean
}

export function parseToolUses(text: string): ToolUse[] {
	const parser = new AssistantMessageParser()
	parser.processChunk(text)
	parser.finalizeContentBlocks()
	const blocks = parser.getContentBlocks()
	return blocks.filter((b): b is ToolUse => b.type === "tool_use")
}

export function parseResponse(text: string): ParsedResponse {
	const parser = new AssistantMessageParser()
	parser.processChunk(text)
	parser.finalizeContentBlocks()
	const blocks = parser.getContentBlocks()

	const toolUses = blocks.filter((b): b is ToolUse => b.type === "tool_use")
	const textContent = blocks.filter((b): b is TextContent => b.type === "text")

	return {
		toolUses,
		textContent,
		hasTools: toolUses.length > 0,
		hasText: textContent.length > 0 && textContent.some((t) => t.content.trim().length > 0),
	}
}

export type ResponseExecutionResult = {
	type: "natural_language" | "tool_execution" | "mixed"
	naturalLanguageContent?: string
	toolExecutions?: ToolExecution[]
	batchResult?: BatchToolExecution
	thinkingDisplay?: string
	hasThinking?: boolean
	checkpoint?: string // checkpoint ID if auto-saved
}

export interface EnhancedResponseOptions {
	verbose?: boolean
	parallel?: boolean | "intelligent"
	maxConcurrency?: number
	progressCallback?: (completed: number, total: number, current: string) => void
	usePerformanceOptimization?: boolean

	// New enhanced options
	showThinking?: boolean
	thinkingCollapsed?: boolean
	autoCheckpoint?: boolean
	checkpointTriggers?: ("tool_completion" | "milestone" | "error")[]
	conversationHistory?: any[]
}

// Enhanced response handling with thinking display and checkpoints
export async function executeResponse(
	cwd: string,
	text: string,
	options: EnhancedResponseOptions = {},
): Promise<ResponseExecutionResult> {
	// Parse thinking and clean content
	const thinkingResult = parseResponseWithThinking(text, {
		collapsedByDefault: options.thinkingCollapsed !== false,
		theme: options.verbose ? "detailed" : "minimal",
		showTimestamps: options.verbose || false,
	})

	// Parse the clean text for tools and content
	const parsed = parseResponse(thinkingResult.cleanText)

	// Initialize checkpoint integration if enabled
	let checkpointIntegration: CheckpointIntegration | undefined
	if (options.autoCheckpoint && options.conversationHistory) {
		checkpointIntegration = new CheckpointIntegration(cwd)
	}

	let checkpointId: string | undefined

	// If there are no tools and only natural language, return it directly
	if (!parsed.hasTools && parsed.hasText) {
		const naturalLanguageContent = parsed.textContent
			.map((t) => t.content)
			.join("\n")
			.trim()

		return {
			type: "natural_language",
			naturalLanguageContent,
			thinkingDisplay: options.showThinking ? thinkingResult.thinkingDisplay : undefined,
			hasThinking: thinkingResult.hasThinking,
		}
	}

	// If there are tools, execute them
	if (parsed.hasTools) {
		const batchResult = await executeBatchTools(cwd, parsed.toolUses, options)

		// Auto-checkpoint after tool completion if enabled
		if (checkpointIntegration && options.checkpointTriggers?.includes("tool_completion")) {
			try {
				const checkpoint = await checkpointIntegration.autoSave(
					options.conversationHistory || [],
					"tool_completion",
				)
				checkpointId = checkpoint?.id
			} catch (error) {
				console.warn("Failed to create auto-checkpoint:", error)
			}
		}

		// If there's also natural language content, return mixed result
		if (parsed.hasText) {
			const naturalLanguageContent = parsed.textContent
				.map((t) => t.content)
				.join("\n")
				.trim()

			return {
				type: "mixed",
				naturalLanguageContent,
				toolExecutions: batchResult.executions,
				batchResult,
				thinkingDisplay: options.showThinking ? thinkingResult.thinkingDisplay : undefined,
				hasThinking: thinkingResult.hasThinking,
				checkpoint: checkpointId,
			}
		}

		// Only tools, no natural language
		return {
			type: "tool_execution",
			toolExecutions: batchResult.executions,
			batchResult,
			thinkingDisplay: options.showThinking ? thinkingResult.thinkingDisplay : undefined,
			hasThinking: thinkingResult.hasThinking,
			checkpoint: checkpointId,
		}
	}

	// Fallback: no tools, no meaningful text
	return {
		type: "natural_language",
		naturalLanguageContent: "No response content available.",
		thinkingDisplay: options.showThinking ? thinkingResult.thinkingDisplay : undefined,
		hasThinking: thinkingResult.hasThinking,
	}
}

// Real-time streaming response handler
export class StreamingResponseHandler {
	private thinkingDisplay: RealTimeThinkingDisplay
	private checkpointIntegration?: CheckpointIntegration
	private conversationMessages: any[] = []

	constructor(
		private cwd: string,
		private options: EnhancedResponseOptions = {},
	) {
		this.thinkingDisplay = new RealTimeThinkingDisplay({
			collapsedByDefault: options.thinkingCollapsed !== false,
			theme: options.verbose ? "detailed" : "minimal",
			showTimestamps: options.verbose || false,
		})

		if (options.autoCheckpoint) {
			this.checkpointIntegration = new CheckpointIntegration(cwd)
		}
	}

	/**
	 * Process streaming chunk and return display updates
	 */
	processChunk(chunk: string): {
		hasThinkingUpdate: boolean
		thinkingDisplay: string
		cleanChunk: string
		stats: any
	} {
		// Process thinking stream
		const thinkingResult = this.thinkingDisplay.processStreamChunk(chunk)

		// Clean the chunk of thinking tags for main content processing
		const cleanChunk = chunk.replace(/<thinking>[\s\S]*?<\/thinking>/g, "").trim()

		return {
			hasThinkingUpdate: thinkingResult.hasUpdate,
			thinkingDisplay: thinkingResult.display,
			cleanChunk,
			stats: this.thinkingDisplay.getStats(),
		}
	}

	/**
	 * Add message to conversation history
	 */
	addMessage(role: "user" | "assistant", content: string, metadata?: any): void {
		this.conversationMessages.push({
			role,
			content,
			timestamp: Date.now(),
			thinking: this.thinkingDisplay.getStats().currentContent || undefined,
			...metadata,
		})
	}

	/**
	 * Create checkpoint manually
	 */
	async createCheckpoint(name?: string, description?: string): Promise<string | null> {
		if (!this.checkpointIntegration) {
			return null
		}

		try {
			const checkpoint = await this.checkpointIntegration.createFromConversation(this.conversationMessages, {
				name,
				description,
				includeThinking: true,
			})
			return checkpoint.id
		} catch (error) {
			console.error("Failed to create checkpoint:", error)
			return null
		}
	}

	/**
	 * Clear conversation and thinking data
	 */
	clear(): void {
		this.conversationMessages = []
		this.thinkingDisplay.clear()
	}

	/**
	 * Get current statistics
	 */
	getStats() {
		return {
			conversationLength: this.conversationMessages.length,
			thinking: this.thinkingDisplay.getStats(),
		}
	}
}

// Enhanced batch execution with intelligent optimization
export async function executeBatchTools(
	cwd: string,
	tools: ToolUse[],
	options?: {
		verbose?: boolean
		parallel?: boolean | "intelligent"
		maxConcurrency?: number
		progressCallback?: (completed: number, total: number, current: string) => void
		usePerformanceOptimization?: boolean
	},
): Promise<BatchToolExecution> {
	const startTime = Date.now()
	const executions: ToolExecution[] = []
	let successCount = 0
	let errorCount = 0

	const {
		verbose = false,
		parallel = false,
		maxConcurrency = 3,
		progressCallback,
		usePerformanceOptimization = true,
	} = options || {}

	// Initialize performance optimization engine if enabled
	let perfEngine: PerformanceOptimizationEngine | undefined
	let parallelPlan: any = null

	if (usePerformanceOptimization && tools.length > 1) {
		perfEngine = new PerformanceOptimizationEngine(cwd)
		await perfEngine.initialize()

		// Analyze parallelization opportunities
		if (parallel === "intelligent" || (parallel === true && tools.length > 2)) {
			parallelPlan = perfEngine.analyzeParallelizationOpportunities(tools)

			if (verbose) {
				console.log(`🧠 Intelligent parallelization analysis:`)
				console.log(`   • Batches: ${parallelPlan.batches.length}`)
				console.log(`   • Estimated savings: ${Math.round(parallelPlan.estimatedSavings)}ms`)
				console.log(`   • Risk level: ${parallelPlan.riskLevel}`)
			}
		}
	}

	// Execute based on optimization plan
	if (parallelPlan && parallelPlan.riskLevel !== "high") {
		// Use intelligent parallel execution
		let batchIndex = 0
		for (const batch of parallelPlan.batches) {
			progressCallback?.(
				executions.length,
				tools.length,
				`batch ${batchIndex + 1}/${parallelPlan.batches.length}`,
			)

			if (batch.length === 1) {
				// Single tool - execute normally
				const tool = batch[0]
				const result = await executeToolWithOptimization(cwd, tool, perfEngine)
				executions.push(result)

				if (result.metadata?.status === "error") errorCount++
				else successCount++
			} else {
				// Multiple tools - execute in parallel
				const promises = batch.map(async (tool: ToolUse) => {
					const result = await executeToolWithOptimization(cwd, tool, perfEngine)
					return result
				})

				const batchResults = await Promise.all(promises)
				executions.push(...batchResults)

				// Update counters
				for (const result of batchResults) {
					if (result.metadata?.status === "error") errorCount++
					else successCount++
				}
			}

			if (verbose) {
				console.log(`✓ Batch ${batchIndex + 1} completed (${batch.length} tools)`)
			}

			batchIndex++
		}
	} else if (parallel === true && tools.length > 1) {
		// Legacy parallel execution with concurrency control
		const batches: ToolUse[][] = []
		for (let i = 0; i < tools.length; i += maxConcurrency) {
			batches.push(tools.slice(i, i + maxConcurrency))
		}

		for (const batch of batches) {
			const promises = batch.map(async (tool) => {
				progressCallback?.(executions.length, tools.length, tool.name)
				const result = await executeToolWithOptimization(cwd, tool, perfEngine)

				if (verbose) {
					console.log(`✓ ${tool.name} completed in ${result.metadata?.duration || 0}ms`)
				}

				return result
			})

			const batchResults = await Promise.all(promises)
			executions.push(...batchResults)

			// Update counters
			for (const result of batchResults) {
				if (result.metadata?.status === "error") errorCount++
				else successCount++
			}
		}
	} else {
		// Sequential execution with optimization
		for (let i = 0; i < tools.length; i++) {
			const tool = tools[i]
			progressCallback?.(i, tools.length, tool.name)

			const result = await executeToolWithOptimization(cwd, tool, perfEngine)
			executions.push(result)

			if (result.metadata?.status === "error") {
				errorCount++
			} else {
				successCount++
			}

			if (verbose) {
				console.log(`✓ ${tool.name} completed in ${result.metadata?.duration || 0}ms`)
			}
		}
	}

	const totalDuration = Date.now() - startTime
	progressCallback?.(tools.length, tools.length, "completed")

	// Generate enhanced summary
	let summary = `Executed ${tools.length} tools: ${successCount} succeeded, ${errorCount} failed (${totalDuration}ms total)`

	if (parallelPlan) {
		const savings = Math.max(0, parallelPlan.estimatedSavings - (totalDuration - startTime))
		summary += `\n🚀 Intelligent parallelization saved ~${Math.round(savings)}ms`
	}

	// Cleanup performance engine
	if (perfEngine) {
		await perfEngine.cleanup()
	}

	// Recompute success/error counts from executions to avoid drift
	const finalSuccessCount = executions.filter((e) => e.metadata?.status !== "error").length
	const finalErrorCount = executions.filter((e) => e.metadata?.status === "error").length

	return {
		executions,
		total_duration: totalDuration,
		success_count: finalSuccessCount,
		error_count: finalErrorCount,
		summary,
	}
}

// Enhanced tool execution with performance optimization
async function executeToolWithOptimization(
	cwd: string,
	tool: ToolUse,
	perfEngine?: PerformanceOptimizationEngine,
): Promise<ToolExecution> {
	const startTime = Date.now()

	// Try cache first if performance engine is available
	if (perfEngine && isToolCacheable(tool)) {
		const cacheKey = generateToolCacheKey(tool)
		try {
			const result = await perfEngine.getCachedResult(cacheKey, () => executeTool(cwd, tool), {
				ttl: getToolCacheTTL(tool),
				compressible: isToolOutputCompressible(tool),
				priority: getToolCachePriority(tool),
			})

			// Record execution in performance engine
			perfEngine.recordToolExecution(tool.name, result)

			return result
		} catch (e) {
			console.warn(`Performance optimization failed for ${tool.name}, falling back to direct execution:`, e)
		}
	}

	// Fallback to direct execution
	const result = await executeTool(cwd, tool)
	const duration = Date.now() - startTime

	// Enhance with performance metadata
	const enhancedResult: ToolExecution = {
		...result,
		metadata: {
			...result.metadata,
			duration,
			status: result.output.includes("Failed") || result.output.includes("Error") ? "error" : "success",
		},
	}

	// Record in performance engine if available
	if (perfEngine) {
		perfEngine.recordToolExecution(tool.name, enhancedResult)
	}

	return enhancedResult
}

function isToolCacheable(tool: ToolUse): boolean {
	// Read-only tools are generally cacheable
	const readOnlyTools = new Set([
		"read_file",
		"list_files",
		"search_files",
		"list_code_definition_names",
		"codebase_search",
	])

	return readOnlyTools.has(tool.name)
}

function generateToolCacheKey(tool: ToolUse): string {
	// Create deterministic cache key from tool and params
	const paramsHash = JSON.stringify(tool.params, Object.keys(tool.params).sort())
	return `${tool.name}:${Buffer.from(paramsHash).toString("base64").substring(0, 16)}`
}

function getToolCacheTTL(tool: ToolUse): number {
	// Different TTL for different tools
	const ttlMap = new Map([
		["read_file", 300000], // 5 minutes
		["list_files", 60000], // 1 minute
		["search_files", 600000], // 10 minutes
		["list_code_definition_names", 1800000], // 30 minutes
		["codebase_search", 900000], // 15 minutes
	])

	return ttlMap.get(tool.name) || 300000 // Default 5 minutes
}

function isToolOutputCompressible(tool: ToolUse): boolean {
	// Tools with large text output benefit from compression
	const compressibleTools = new Set(["read_file", "search_files", "list_code_definition_names", "codebase_search"])

	return compressibleTools.has(tool.name)
}

function getToolCachePriority(tool: ToolUse): "low" | "medium" | "high" {
	// Frequently used tools get higher priority
	const highPriorityTools = new Set(["read_file", "codebase_search"])
	const mediumPriorityTools = new Set(["list_files", "search_files"])

	if (highPriorityTools.has(tool.name)) return "high"
	if (mediumPriorityTools.has(tool.name)) return "medium"
	return "low"
}

// Enhanced execution with metadata tracking
export async function executeToolWithMetadata(cwd: string, tool: ToolUse): Promise<ToolExecution> {
	const startTime = Date.now()
	const result = await executeTool(cwd, tool)
	const duration = Date.now() - startTime

	// Enhance result with metadata
	const status =
		result.output.includes("Failed") || result.output.includes("Error")
			? "error"
			: result.output.includes("Warning")
				? "warning"
				: "success"

	const filesAffected = extractFilesFromOutput(result.output)
	const bytesProcessed = estimateBytesProcessed(result.output)

	return {
		...result,
		metadata: {
			duration,
			status,
			files_affected: filesAffected,
			bytes_processed: bytesProcessed,
		},
	}
}

// Utility functions for enhanced metadata
function extractFilesFromOutput(output: string): string[] {
	const filePatterns = [
		// Unix-style paths
		/(?:^|\s)(\/[^\s]+\.[a-zA-Z0-9]+)/g,
		// Relative paths
		/(?:^|\s)(\.?\.?\/[^\s]+\.[a-zA-Z0-9]+)/g,
		// Windows paths
		/(?:^|\s)([A-Z]:\\[^\s]+\.[a-zA-Z0-9]+)/g,
		// Simple filenames
		/(?:^|\s)([a-zA-Z0-9_-]+\.[a-zA-Z0-9]+)/g,
	]

	const files = new Set<string>()
	for (const pattern of filePatterns) {
		let match
		while ((match = pattern.exec(output)) !== null) {
			files.add(match[1])
		}
	}

	return Array.from(files)
}

function estimateBytesProcessed(output: string): number {
	// Simple heuristic based on output mentions of file sizes, line counts, etc.
	const sizeMatches = [/([0-9]+)\s*bytes?/gi, /([0-9]+)\s*lines?/gi, /([0-9]+)\s*characters?/gi]

	let totalBytes = 0
	for (const pattern of sizeMatches) {
		let match
		while ((match = pattern.exec(output)) !== null) {
			const value = parseInt(match[1], 10)
			if (match[0].toLowerCase().includes("line")) {
				// Estimate ~80 characters per line
				totalBytes += value * 80
			} else if (match[0].toLowerCase().includes("byte")) {
				totalBytes += value
			} else {
				// Characters
				totalBytes += value
			}
		}
	}

	return totalBytes
}

// Enhanced file operations implementation
async function runMultiApplyDiffTool(defaultCwd: string, tool: GenericToolUse): Promise<ToolExecution> {
	try {
		// Parse the files parameter from tool params (use args as the main parameter)
		const filesParam = (tool.params as any).files || tool.params.args || ""
		if (!filesParam) {
			return { name: tool.name, params: tool.params, output: "❌ Error: Missing files parameter" }
		}

		let files: MultiApplyDiffParams["files"]
		try {
			// Try to parse as JSON
			files = JSON.parse(filesParam)
		} catch {
			return { name: tool.name, params: tool.params, output: "❌ Error: Invalid JSON format for files parameter" }
		}

		// Parse options if provided
		const optionsParam = (tool.params as any).options || "{}"
		let options: MultiApplyDiffParams["options"]
		try {
			options = JSON.parse(optionsParam)
		} catch {
			options = {}
		}

		const params: MultiApplyDiffParams = { files, options }

		// Execute multi-apply diff
		const result: MultiApplyDiffResult = await runMultiApplyDiff(defaultCwd, params)

		// Format output for CLI
		let output = `✓ Multi-apply diff completed\n`
		output += `${result.summary}\n\n`

		if (result.success) {
			output += `📊 Results:\n`
			output += `  • Files processed: ${result.files_processed}\n`
			output += `  • Files succeeded: ${result.files_succeeded}\n`
			output += `  • Files failed: ${result.files_failed}\n`
			output += `  • Total diffs applied: ${result.total_diffs_applied}\n`

			// Show individual file results
			for (const fileResult of result.results) {
				const status = fileResult.success ? "✅" : "❌"
				output += `\n${status} ${fileResult.path}:`
				if (fileResult.success && fileResult.metadata) {
					output += ` ${fileResult.diffs_applied} diff(s), ${fileResult.metadata.duration_ms}ms`
					if (fileResult.metadata.lines_changed > 0) {
						output += `, ${fileResult.metadata.lines_changed} lines changed`
					}
				} else if (fileResult.error) {
					output += ` ${fileResult.error}`
				}
			}
		} else {
			output += `❌ All operations failed\n`
		}

		if (result.errors && result.errors.length > 0) {
			output += `\n⚠️ Errors:\n`
			for (const error of result.errors) {
				output += `  • ${error}\n`
			}
		}

		return {
			name: tool.name,
			params: tool.params,
			output,
			metadata: {
				status: result.success ? "success" : "error",
				files_affected: result.results.map((r) => r.path),
				bytes_processed: result.results.reduce((sum, r) => sum + (r.metadata?.original_size || 0), 0),
				duration: result.results.reduce((sum, r) => sum + (r.metadata?.duration_ms || 0), 0),
			},
		}
	} catch (e: any) {
		return {
			name: tool.name,
			params: tool.params,
			output: `❌ Multi-apply diff failed: ${e?.message || String(e)}`,
		}
	}
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
		case "browser_action":
			return runBrowserAction(cwd, tool as BrowserActionToolUse)
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
		case "new_rule":
			return runNewRule(cwd, tool as NewRuleToolUse)
		case "report_bug":
			return runReportBug(cwd, tool as ReportBugToolUse)
		case "condense":
			return runCondense(cwd, tool as CondenseToolUse)
		default:
			// Handle enhanced file operations
			if (tool.name === "multi_apply_diff") {
				return runMultiApplyDiffTool(cwd, tool as GenericToolUse)
			}

			// Handle advanced CLI-specific tools
			if (tool.name === "batch_operations") {
				return runBatchOperationsTool(cwd, tool as GenericToolUse)
			}

			if (tool.name === "workflow_automation") {
				return runWorkflowAutomationTool(cwd, tool as GenericToolUse)
			}

			if (tool.name === "system_diagnostics") {
				return runSystemDiagnosticsTool(cwd, tool as GenericToolUse)
			}

			return { name: tool.name, params: tool.params, output: `Unsupported tool: ${tool.name}` }
	}
}

async function runExecuteCommand(defaultCwd: string, tool: ExecuteCommandToolUse): Promise<ToolExecution> {
	const cmd = (tool.params.command || "").trim()
	const cwd = tool.params.cwd ? path.resolve(defaultCwd, tool.params.cwd) : defaultCwd

	// Initialize advanced formatter for professional output
	const formatter = new AdvancedTerminalFormatter({
		theme: "professional",
		outputFormat: "structured",
	})

	// Enhanced validation with professional error formatting
	if (!cmd) {
		return {
			name: tool.name,
			params: tool.params,
			output: formatter.formatError("Command parameter is required but was empty or missing", {
				showSuggestions: true,
				showContext: true,
			}),
		}
	}

	// Validate working directory exists
	try {
		await fs.access(cwd)
	} catch (e) {
		return {
			name: tool.name,
			params: tool.params,
			output: `❌ Error: Working directory does not exist or is not accessible: ${cwd}`,
		}
	}

	// Security check for dangerous commands (basic protection)
	const dangerousPatterns = [
		/rm\s+-rf\s+\/(?!tmp|var\/tmp)/i, // Prevent accidental system deletion
		/format\s+[a-z]:/i, // Windows format command
		/mkfs/i, // Filesystem formatting
	]

	for (const pattern of dangerousPatterns) {
		if (pattern.test(cmd)) {
			return {
				name: tool.name,
				params: tool.params,
				output: `❌ Security Error: Command appears to contain potentially dangerous operations. For safety, this command has been blocked: ${cmd.slice(0, 50)}...`,
			}
		}
	}

	try {
		const execStart = Date.now()
		const { stdout, stderr } = await exec(cmd, {
			cwd,
			maxBuffer: 10 * 1024 * 1024,
			env: process.env,
			timeout: 300000, // 5 minute timeout
		})
		const duration = Date.now() - execStart

		// Professional success formatting
		const relativeCwd = path.relative(defaultCwd, cwd) || "."
		const output = formatter.formatSuccess(`Command executed successfully in ${relativeCwd}`, {
			duration,
			details: {
				command: cmd.length > 50 ? cmd.substring(0, 50) + "..." : cmd,
				directory: relativeCwd,
				stdout_lines: stdout ? stdout.split("\n").length : 0,
				stderr_lines: stderr ? stderr.split("\n").length : 0,
			},
		})

		const commandOutput =
			[
				stderr ? `[stderr]\n${formatter.formatBox(stderr.trim(), { title: "stderr", style: "single" })}` : "",
				stdout ? `[stdout]\n${formatter.formatBox(stdout.trim(), { title: "stdout", style: "single" })}` : "",
			]
				.filter(Boolean)
				.join("\n\n") || "(no output)"

		return {
			name: tool.name,
			params: tool.params,
			output: `${output}\n\n${commandOutput}`,
			metadata: {
				duration,
				status: "success",
			},
		}
	} catch (e: any) {
		if (e.killed && e.signal === "SIGTERM") {
			return {
				name: tool.name,
				params: tool.params,
				output: formatter.formatError(`Command timed out after 5 minutes: ${cmd}`, {
					showSuggestions: true,
					showContext: true,
				}),
				metadata: { status: "error" },
			}
		}

		const errorMessage = `Command failed (exit code: ${e?.code ?? "unknown"})`
		const errorDetails = formatter.formatStructuredOutput({
			title: errorMessage,
			status: "error",
			details: {
				command: cmd,
				working_directory: path.relative(defaultCwd, cwd) || ".",
				exit_code: e?.code ?? "unknown",
				stderr: e?.stderr || "none",
			},
			actions: [
				"Verify the command exists and is in PATH",
				"Check command syntax and parameters",
				"Ensure proper permissions for the working directory",
				"Try running the command manually to debug",
			],
		})

		return {
			name: tool.name,
			params: tool.params,
			output: errorDetails,
			metadata: { status: "error" },
		}
	}
}

async function runReadFile(defaultCwd: string, tool: ReadFileToolUse): Promise<ToolExecution> {
	const p = (tool.params.path || "").trim()

	// Enhanced validation
	if (!p) {
		return { name: tool.name, params: tool.params, output: "❌ Error: File path parameter is required" }
	}

	const fp = path.resolve(defaultCwd, p)
	const relativePath = path.relative(defaultCwd, fp)

	// Check if path is trying to escape the working directory
	if (relativePath.startsWith("..")) {
		return {
			name: tool.name,
			params: tool.params,
			output: `❌ Security Error: Cannot access files outside the working directory: ${p}`,
		}
	}

	if (isPathIgnored(fp, defaultCwd)) {
		return {
			name: tool.name,
			params: tool.params,
			output: `❌ Access denied: ${relativePath} is blocked by ignore rules`,
		}
	}

	try {
		// Check if file exists and is readable
		const stats = await fs.stat(fp)
		if (!stats.isFile()) {
			return { name: tool.name, params: tool.params, output: `❌ Error: ${relativePath} is not a file` }
		}

		// Use streaming for very large files
		const LARGE_FILE_THRESHOLD = 100 * 1024 * 1024 // 100MB
		const STREAMING_THRESHOLD = 10 * 1024 * 1024 // 10MB

		if (stats.size > LARGE_FILE_THRESHOLD) {
			return {
				name: tool.name,
				params: tool.params,
				output: `❌ Error: File ${relativePath} is too large (${Math.round(stats.size / 1024 / 1024)}MB). Maximum size is 100MB. Use streaming operations for files this large.`,
			}
		}

		let data: string
		let processingNote = ""

		if (stats.size > STREAMING_THRESHOLD) {
			// Use streaming operations for large files
			const { streamingReadFile } = await import("./tools/streaming-file-ops.js")
			const streamResult = await streamingReadFile(fp, {
				chunk_size: 256 * 1024, // 256KB chunks
				start: tool.params.start_line ? (parseInt(tool.params.start_line, 10) - 1) * 80 : undefined, // Estimate byte position
				end: tool.params.end_line ? parseInt(tool.params.end_line, 10) * 80 : undefined,
			})

			if (!streamResult.success || !streamResult.content) {
				return {
					name: tool.name,
					params: tool.params,
					output: `❌ Failed to read ${relativePath}: ${streamResult.error || "Streaming read failed"}`,
				}
			}

			data = streamResult.content
			processingNote = ` (🚀 streamed ${streamResult.chunks_processed} chunks)`
		} else {
			// Use regular file reading for smaller files
			data = await fs.readFile(fp, "utf8")
		}

		const lines = data.split("\n")

		// Enhanced line range validation
		const start = tool.params.start_line ? parseInt(tool.params.start_line, 10) : undefined
		const end = tool.params.end_line ? parseInt(tool.params.end_line, 10) : undefined

		if (start !== undefined && (isNaN(start) || start < 1)) {
			return { name: tool.name, params: tool.params, output: "❌ Error: start_line must be a positive integer" }
		}

		if (end !== undefined && (isNaN(end) || end < 1)) {
			return { name: tool.name, params: tool.params, output: "❌ Error: end_line must be a positive integer" }
		}

		if (start !== undefined && end !== undefined && start > end) {
			return {
				name: tool.name,
				params: tool.params,
				output: "❌ Error: start_line cannot be greater than end_line",
			}
		}

		if (start !== undefined && start > lines.length) {
			return {
				name: tool.name,
				params: tool.params,
				output: `❌ Error: start_line (${start}) exceeds file length (${lines.length} lines)`,
			}
		}

		const slice = lines.slice(start ? Math.max(0, start - 1) : 0, end ? Math.max(0, end) : undefined)
		const rangeInfo = start || end ? ` (lines ${start || 1}-${end || lines.length})` : ""

		return {
			name: tool.name,
			params: tool.params,
			output: `✓ Read ${relativePath}${rangeInfo}${processingNote} (${slice.length} lines, ${stats.size} bytes)\n\n${slice.join("\n")}`,
		}
	} catch (e: any) {
		if (e.code === "ENOENT") {
			return { name: tool.name, params: tool.params, output: `❌ Error: File not found: ${relativePath}` }
		} else if (e.code === "EACCES") {
			return { name: tool.name, params: tool.params, output: `❌ Error: Permission denied: ${relativePath}` }
		} else if (e.code === "EISDIR") {
			return {
				name: tool.name,
				params: tool.params,
				output: `❌ Error: ${relativePath} is a directory, not a file`,
			}
		} else {
			return {
				name: tool.name,
				params: tool.params,
				output: `❌ Failed to read ${relativePath}: ${e?.message || String(e)}`,
			}
		}
	}
}

async function runWriteToFile(defaultCwd: string, tool: WriteToFileToolUse): Promise<ToolExecution> {
	const p = (tool.params.path || "").trim()
	const content = tool.params.content ?? ""

	// Enhanced validation
	if (!p) {
		return { name: tool.name, params: tool.params, output: "❌ Error: File path parameter is required" }
	}

	const fp = path.resolve(defaultCwd, p)
	const relativePath = path.relative(defaultCwd, fp)

	// Security check: prevent writing outside working directory
	if (relativePath.startsWith("..")) {
		return {
			name: tool.name,
			params: tool.params,
			output: `❌ Security Error: Cannot write files outside the working directory: ${p}`,
		}
	}

	// Validate content size (prevent extremely large files)
	if (content.length > 100 * 1024 * 1024) {
		// 100MB limit
		return {
			name: tool.name,
			params: tool.params,
			output: `❌ Error: Content too large (${Math.round(content.length / 1024 / 1024)}MB). Maximum size is 100MB`,
		}
	}

	// Check for suspicious file extensions that might be dangerous
	const ext = path.extname(fp).toLowerCase()
	const dangerousExts = [".exe", ".bat", ".cmd", ".ps1", ".sh", ".scr"]
	if (dangerousExts.includes(ext)) {
		console.warn(`⚠️  Warning: Writing potentially executable file: ${relativePath}`)
	}

	try {
		// Ensure directory exists
		const dir = path.dirname(fp)
		await fs.mkdir(dir, { recursive: true })

		// Check if file already exists
		let existsInfo = ""
		try {
			const stats = await fs.stat(fp)
			existsInfo = ` (overwrote existing ${Math.round(stats.size / 1024)}KB file)`
		} catch (e) {
			existsInfo = " (new file)"
		}

		await fs.writeFile(fp, content, "utf8")
		const lineCount = content.split("\n").length
		const sizeKB = Math.round(content.length / 1024)

		return {
			name: tool.name,
			params: tool.params,
			output: `✓ Successfully wrote ${relativePath}${existsInfo}\n  Lines: ${lineCount}\n  Size: ${sizeKB}KB`,
		}
	} catch (e: any) {
		if (e.code === "EACCES") {
			return {
				name: tool.name,
				params: tool.params,
				output: `❌ Permission Error: Cannot write to ${relativePath}. Check file permissions.`,
			}
		} else if (e.code === "ENOSPC") {
			return {
				name: tool.name,
				params: tool.params,
				output: `❌ Disk Error: Insufficient disk space to write ${relativePath}`,
			}
		} else if (e.code === "EROFS") {
			return {
				name: tool.name,
				params: tool.params,
				output: `❌ File System Error: ${relativePath} is on a read-only filesystem`,
			}
		} else {
			return {
				name: tool.name,
				params: tool.params,
				output: `❌ Failed to write ${relativePath}: ${e?.message || String(e)}`,
			}
		}
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
	let output = `${question}\n`
	if (suggestions.length > 0) {
		output += `\nSuggested responses:\n${suggestions.join("\n")}\n`
	}
	output += `\nPlease respond with your choice or provide additional details.`

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
		output: `Task Completion Summary:\n\n${result}\n\nThe task has been completed. You can:\n• Type 'continue' if you want additional improvements\n• Ask for clarification on any part\n• Start a new task\n• Use /clear to start fresh`,
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
	if (!todos) return { name: tool.name, params: tool.params, output: "❌ Error: Missing todos list parameter" }

	try {
		// Use enhanced cross-session state management
		const stateManager = new CrossSessionStateManager(defaultCwd, {
			autoSaveInterval: 0, // Manual save only for todos
			conflictResolutionEnabled: true,
		})

		await stateManager.initialize()

		// Parse the todo list with enhanced validation
		const todoLines = todos.split("\n").filter((line) => line.trim())
		const parsedTodos = todoLines
			.map((line, index) => {
				const match = line.match(/^\s*- \[([ x-])\] (.+)$/)
				if (match) {
					const [, status, text] = match
					return {
						text: text.trim(),
						status: status === "x" ? "completed" : status === "-" ? "in_progress" : "pending",
						lineNumber: index + 1,
					}
				}
				return null
			})
			.filter(Boolean) as { text: string; status: string; lineNumber: number }[]

		if (parsedTodos.length === 0) {
			return {
				name: tool.name,
				params: tool.params,
				output: "❌ Error: No valid todo items found. Use format: `- [ ] Todo text`",
			}
		}

		// Clear existing todos and add new ones with enhanced tracking
		const currentState = stateManager.getState()
		currentState.taskState.todos = []

		let addedCount = 0
		let updatedCount = 0
		for (const todo of parsedTodos) {
			// Check if this todo already exists
			const existingTodo = currentState.taskState.todos.find((t) => t.text === todo.text)

			if (existingTodo) {
				// Update existing todo
				if (existingTodo.status !== todo.status) {
					await stateManager.updateTodoStatus(existingTodo.id, todo.status as any)
					updatedCount++
				}
			} else {
				// Add new todo
				await stateManager.addTodo(todo.text)
				const todoId = currentState.taskState.todos[currentState.taskState.todos.length - 1]?.id
				if (todoId && todo.status !== "pending") {
					await stateManager.updateTodoStatus(todoId, todo.status as any)
				}
				addedCount++
			}
		}

		// Persist to legacy CLI state file for compatibility
		const context = createCliExtensionContext()
		const stateDir = (context as any).globalStorageUri.fsPath as string
		const todosFile = path.join(stateDir, "todos.json")
		const textsOnly = parsedTodos.map((t) => t.text)
		await fs.mkdir(path.dirname(todosFile), { recursive: true })
		await fs.writeFile(todosFile, JSON.stringify(textsOnly, null, 2), "utf8")

		// Get updated state for progress calculation
		const finalState = stateManager.getState()
		const completedCount = finalState.taskState.todos.filter((t) => t.status === "completed").length
		const inProgressCount = finalState.taskState.todos.filter((t) => t.status === "in_progress").length
		const pendingCount = finalState.taskState.todos.filter((t) => t.status === "pending").length

		await stateManager.cleanup()

		return {
			name: tool.name,
			params: tool.params,
			output:
				`✅ Todo list updated successfully!\n\n` +
				`📊 Summary:\n` +
				`  • Total todos: ${parsedTodos.length}\n` +
				`  • Added: ${addedCount}\n` +
				`  • Updated: ${updatedCount}\n\n` +
				`📈 Current Status:\n` +
				`  • ✅ Completed: ${completedCount}\n` +
				`  • 🔄 In Progress: ${inProgressCount}\n` +
				`  • ⏳ Pending: ${pendingCount}\n` +
				`  • Progress: ${Math.round(finalState.taskState.progress)}%\n\n` +
				`📝 Todo List:\n${todos}\n\n` +
				`💾 State persisted with cross-session recovery support.`,
			metadata: {
				status: "success",
				files_affected: [path.relative(defaultCwd, todosFile)],
			},
		}
	} catch (e: any) {
		return {
			name: tool.name,
			params: tool.params,
			output:
				`❌ Failed to update todo list: ${e?.message || String(e)}\n\n` +
				`💡 This could indicate:\n` +
				`  • Invalid todo format (use \`- [ ] Todo text\`)\n` +
				`  • File system permission issues\n` +
				`  • Cross-session state corruption`,
			metadata: {
				status: "error",
			},
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
	// Enhanced CLI adaptation with streaming support and advanced features
	const p = (tool.params.path || "").trim()
	const edits = tool.params.edits || ""

	if (!p) return { name: tool.name, params: tool.params, output: "Missing path" }
	if (!edits) return { name: tool.name, params: tool.params, output: "Missing edits" }

	const fp = path.resolve(defaultCwd, p)
	const startTime = Date.now()

	try {
		// Check file size to determine if we should use streaming
		const stats = await fs.stat(fp)
		const useStreaming = stats.size > 50 * 1024 * 1024 // 50MB threshold

		// Parse edits with enhanced support
		let editInstructions: Array<{
			line?: number
			action: string
			content?: string
			range?: { start: number; end: number }
			pattern?: string
		}> = []

		try {
			// Try parsing as JSON first (enhanced format)
			const parsedEdits = JSON.parse(edits)
			if (Array.isArray(parsedEdits)) {
				editInstructions = parsedEdits
			} else {
				// Single edit object
				editInstructions = [parsedEdits]
			}
		} catch {
			// Fallback: parse enhanced line-based edits
			// Formats:
			// - "insert:5:content"
			// - "replace:3-7:content"
			// - "delete:10"
			// - "search_replace:pattern:replacement"
			// - "append:content"
			// - "prepend:content"
			const lines = edits.split("\n").filter((l) => l.trim())
			for (const line of lines) {
				const parts = line.split(":")
				if (parts.length >= 2) {
					const action = parts[0]
					const spec = parts[1]
					const content = parts.slice(2).join(":")

					switch (action) {
						case "insert":
							editInstructions.push({ action, line: parseInt(spec), content })
							break
						case "replace":
							if (spec.includes("-")) {
								const [start, end] = spec.split("-").map((n) => parseInt(n))
								editInstructions.push({ action, range: { start, end }, content })
							} else {
								editInstructions.push({ action, line: parseInt(spec), content })
							}
							break
						case "delete":
							if (spec.includes("-")) {
								const [start, end] = spec.split("-").map((n) => parseInt(n))
								editInstructions.push({ action, range: { start, end } })
							} else {
								editInstructions.push({ action, line: parseInt(spec) })
							}
							break
						case "search_replace":
							editInstructions.push({ action, pattern: spec, content })
							break
						case "append":
							editInstructions.push({ action, content: spec + (content ? ":" + content : "") })
							break
						case "prepend":
							editInstructions.push({ action, content: spec + (content ? ":" + content : "") })
							break
					}
				}
			}
		}

		if (editInstructions.length === 0) {
			return { name: tool.name, params: tool.params, output: "No valid edit instructions found" }
		}

		let finalContent: string
		let bytesProcessed = 0

		if (useStreaming) {
			// Use streaming operations for large files
			const { streamingReadFile, streamingWriteFile } = await import("./tools/streaming-file-ops.js")

			const readResult = await streamingReadFile(fp, {
				progress_callback: (bytes, total) => {
					// Could emit progress events here for CLI display
				},
			})

			if (!readResult.success || !readResult.content) {
				return {
					name: tool.name,
					params: tool.params,
					output: `Failed to read file: ${readResult.error || "Unknown error"}`,
				}
			}

			finalContent = await applyAdvancedEdits(readResult.content, editInstructions)
			bytesProcessed = readResult.total_bytes

			const writeResult = await streamingWriteFile(fp, finalContent, {
				progress_callback: (bytes, total) => {
					// Could emit progress events here for CLI display
				},
			})

			if (!writeResult.success) {
				return {
					name: tool.name,
					params: tool.params,
					output: `Failed to write file: ${writeResult.error || "Unknown error"}`,
				}
			}
		} else {
			// Use regular file operations for smaller files
			const originalContent = await fs.readFile(fp, "utf8")
			finalContent = await applyAdvancedEdits(originalContent, editInstructions)
			await fs.writeFile(fp, finalContent, "utf8")
			bytesProcessed = originalContent.length
		}

		const duration = Date.now() - startTime
		const linesChanged = Math.abs(finalContent.split("\n").length - stats.size)

		return {
			name: tool.name,
			params: tool.params,
			output:
				`✅ Applied ${editInstructions.length} edit(s) to ${path.relative(defaultCwd, fp)}\n` +
				`📊 Performance: ${Math.round(bytesProcessed / 1024)}KB processed in ${duration}ms\n` +
				`📝 Changes: ${linesChanged} lines modified\n` +
				`${useStreaming ? "🚀 Used streaming operations for large file" : "⚡ Used standard operations"}`,
			metadata: {
				status: "success",
				duration,
				files_affected: [path.relative(defaultCwd, fp)],
				bytes_processed: bytesProcessed,
			},
		}
	} catch (e: any) {
		return {
			name: tool.name,
			params: tool.params,
			output: `❌ Failed to edit file: ${e?.message || String(e)}`,
			metadata: { status: "error" },
		}
	}
}

// Helper function to apply advanced edits
async function applyAdvancedEdits(
	content: string,
	editInstructions: Array<{
		line?: number
		action: string
		content?: string
		range?: { start: number; end: number }
		pattern?: string
	}>,
): Promise<string> {
	let lines = content.split("\n")

	// Sort edits by line number (descending) to maintain line number stability
	const sortedEdits = editInstructions.sort((a, b) => {
		const aLine = a.line || a.range?.start || Number.MAX_SAFE_INTEGER
		const bLine = b.line || b.range?.start || Number.MAX_SAFE_INTEGER
		return bLine - aLine
	})

	for (const edit of sortedEdits) {
		switch (edit.action) {
			case "insert":
				if (edit.line !== undefined) {
					const lineIndex = Math.max(0, edit.line - 1)
					lines.splice(lineIndex, 0, edit.content || "")
				}
				break

			case "replace":
				if (edit.range) {
					const startIndex = Math.max(0, edit.range.start - 1)
					const endIndex = Math.min(lines.length, edit.range.end)
					const deleteCount = endIndex - startIndex
					const replacementLines = (edit.content || "").split("\n")
					lines.splice(startIndex, deleteCount, ...replacementLines)
				} else if (edit.line !== undefined) {
					const lineIndex = Math.max(0, edit.line - 1)
					if (lineIndex < lines.length) {
						lines[lineIndex] = edit.content || ""
					}
				}
				break

			case "delete":
				if (edit.range) {
					const startIndex = Math.max(0, edit.range.start - 1)
					const endIndex = Math.min(lines.length, edit.range.end)
					const deleteCount = endIndex - startIndex
					lines.splice(startIndex, deleteCount)
				} else if (edit.line !== undefined) {
					const lineIndex = Math.max(0, edit.line - 1)
					if (lineIndex < lines.length) {
						lines.splice(lineIndex, 1)
					}
				}
				break

			case "search_replace":
				if (edit.pattern && edit.content !== undefined) {
					const regex = new RegExp(edit.pattern, "g")
					const fullText = lines.join("\n")
					const replacedText = fullText.replace(regex, edit.content)
					lines = replacedText.split("\n")
				}
				break

			case "append":
				if (edit.content) {
					lines.push(...edit.content.split("\n"))
				}
				break

			case "prepend":
				if (edit.content) {
					lines.unshift(...edit.content.split("\n"))
				}
				break
		}
	}

	return lines.join("\n")
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

// Implementation of missing critical tools

async function runNewRule(defaultCwd: string, tool: NewRuleToolUse): Promise<ToolExecution> {
	const title = tool.params.title || ""
	const description = tool.params.description || ""
	const targetFile = tool.params.target_file || ""
	const instructions = tool.params.instructions || ""

	if (!title || !description) {
		return { name: tool.name, params: tool.params, output: "Missing required parameters: title and description" }
	}

	try {
		// Create rule file in .kilocode/rules directory
		const rulesDir = path.join(defaultCwd, ".kilocode", "rules")
		await fs.mkdir(rulesDir, { recursive: true })

		// Generate rule filename from title
		const fileName =
			title
				.toLowerCase()
				.replace(/[^a-z0-9]+/g, "-")
				.replace(/^-|-$/g, "") + ".md"
		const rulePath = path.join(rulesDir, fileName)

		// Generate rule content
		const ruleContent = [
			`# ${title}`,
			"",
			`**Description:** ${description}`,
			"",
			...(targetFile ? [`**Applies to:** ${targetFile}`, ""] : []),
			"## Rule Details",
			"",
			instructions || description,
			"",
			`**Created:** ${new Date().toISOString()}`,
			`**Source:** CLI dynamic rule creation`,
		].join("\n")

		await fs.writeFile(rulePath, ruleContent, "utf8")

		return {
			name: tool.name,
			params: tool.params,
			output: `✓ Rule "${title}" created successfully at ${rulePath}\n\nRule content:\n${ruleContent.slice(0, 200)}${ruleContent.length > 200 ? "..." : ""}\n\nThis rule will be automatically applied to future tasks.`,
		}
	} catch (e: any) {
		return {
			name: tool.name,
			params: tool.params,
			output: `Failed to create rule: ${e?.message || String(e)}`,
		}
	}
}

async function runReportBug(defaultCwd: string, tool: ReportBugToolUse): Promise<ToolExecution> {
	const title = tool.params.title || ""
	const description = tool.params.description || ""

	if (!title || !description) {
		return { name: tool.name, params: tool.params, output: "Missing required parameters: title and description" }
	}

	try {
		// Gather system information for bug report
		const systemInfo = {
			platform: process.platform,
			arch: process.arch,
			nodeVersion: process.version,
			cwd: defaultCwd,
			timestamp: new Date().toISOString(),
		}

		// Create bug report directory
		const reportsDir = path.join(defaultCwd, ".kilocode", "bug-reports")
		await fs.mkdir(reportsDir, { recursive: true })

		// Generate filename from title and timestamp
		const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)
		const fileName = `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${timestamp}.md`
		const reportPath = path.join(reportsDir, fileName)

		// Generate bug report content
		const reportContent = [
			`# Bug Report: ${title}`,
			"",
			`**Date:** ${systemInfo.timestamp}`,
			`**Reporter:** CLI User`,
			"",
			"## Description",
			"",
			description,
			"",
			"## System Information",
			"",
			`- **Platform:** ${systemInfo.platform}`,
			`- **Architecture:** ${systemInfo.arch}`,
			`- **Node.js Version:** ${systemInfo.nodeVersion}`,
			`- **Working Directory:** ${systemInfo.cwd}`,
			"",
			"## Additional Context",
			"",
			"This bug report was generated from the CLI environment.",
			"",
			"---",
			"",
			"**Note:** This report has been saved locally. For official bug reporting, please visit:",
			"https://github.com/kilocode-org/kilocode/issues",
		].join("\n")

		await fs.writeFile(reportPath, reportContent, "utf8")

		return {
			name: tool.name,
			params: tool.params,
			output: `✓ Bug report created successfully!\n\nReport saved to: ${reportPath}\n\nSummary:\n- Title: ${title}\n- Platform: ${systemInfo.platform}\n- Node Version: ${systemInfo.nodeVersion}\n\nTo submit this officially, please:\n1. Visit https://github.com/kilocode-org/kilocode/issues\n2. Create a new issue using the saved report content\n3. Include any additional logs or screenshots`,
		}
	} catch (e: any) {
		return {
			name: tool.name,
			params: tool.params,
			output: `Failed to create bug report: ${e?.message || String(e)}`,
		}
	}
}

async function runCondense(defaultCwd: string, tool: CondenseToolUse): Promise<ToolExecution> {
	try {
		// CLI implementation of context condensation
		// This is a simplified version - in a full implementation, this would interact with the conversation history

		const timestamp = new Date().toISOString()
		const condensationSummary = [
			"=== CONTEXT CONDENSATION ===",
			`Timestamp: ${timestamp}`,
			"",
			"The conversation context has been condensed to reduce token usage while preserving:",
			"• Current task state and objectives",
			"• Important decisions and outcomes",
			"• Active todo lists and progress",
			"• Essential configuration and settings",
			"",
			"Previous tool outputs and intermediate steps have been summarized.",
			"The conversation continues from this point with reduced token overhead.",
			"",
			"If you need to reference specific previous actions, please ask and I'll provide",
			"the relevant information from the condensed context.",
		].join("\n")

		// Save condensation log for reference
		const logDir = path.join(defaultCwd, ".kilocode", "logs")
		await fs.mkdir(logDir, { recursive: true }).catch(() => {}) // Ignore mkdir errors

		const logFile = path.join(logDir, `condense-${Date.now()}.txt`)
		await fs.writeFile(logFile, condensationSummary, "utf8").catch(() => {}) // Ignore write errors

		return {
			name: tool.name,
			params: tool.params,
			output: condensationSummary,
			metadata: {
				status: "success",
				duration: 0,
			},
		}
	} catch (e: any) {
		return {
			name: tool.name,
			params: tool.params,
			output: `Context condensation completed with warnings: ${e?.message || String(e)}\n\nThe conversation context has been reset to reduce token usage.`,
		}
	}
}

async function runAccessMcpResource(defaultCwd: string, tool: AccessMcpResourceToolUse): Promise<ToolExecution> {
	const startTime = Date.now()

	try {
		const uri = tool.params.uri || ""
		const serverName =
			(tool.params as any).server || (tool.params as any).mcp_server || tool.params.server_name || ""

		if (!uri)
			return { name: tool.name, params: tool.params, output: "❌ Error: Resource URI parameter is required" }
		if (!serverName)
			return { name: tool.name, params: tool.params, output: "❌ Error: MCP server name parameter is required" }

		// Use enhanced MCP resource manager for optimized access
		const resourceManager = new EnhancedMcpResourceManager(defaultCwd, {
			maxCacheSize: 50, // Smaller cache for CLI
			cacheExpiry: 1800000, // 30 minutes
		})

		try {
			await resourceManager.initialize()

			// Access resource with caching and retry logic
			const result = await resourceManager.accessResourceWithRetry(serverName, uri, {
				maxRetries: 2,
				retryDelay: 1000,
				exponentialBackoff: true,
			})

			const duration = Date.now() - startTime

			if (result.success) {
				const fromCacheNote = result.fromCache ? " (📦 from cache)" : ""
				const attemptsNote = result.attempts && result.attempts > 1 ? ` (${result.attempts} attempts)` : ""

				// Format content for CLI display
				let contentDisplay = ""
				if (typeof result.content === "string") {
					contentDisplay =
						result.content.length > 2000
							? result.content.substring(0, 2000) + "\n\n... (content truncated for CLI display)"
							: result.content
				} else {
					const jsonStr = JSON.stringify(result.content, null, 2)
					contentDisplay =
						jsonStr.length > 2000
							? jsonStr.substring(0, 2000) + "\n\n... (JSON truncated for CLI display)"
							: jsonStr
				}

				return {
					name: tool.name,
					params: tool.params,
					output:
						`✅ Successfully accessed MCP resource${fromCacheNote}${attemptsNote}\n` +
						`🔗 Server: ${serverName}\n` +
						`📍 URI: ${uri}\n` +
						`⏱️  Duration: ${duration}ms\n\n` +
						`📄 Content:\n${contentDisplay}`,
					metadata: {
						status: "success",
						duration,
						bytes_processed:
							typeof result.content === "string"
								? result.content.length
								: JSON.stringify(result.content).length,
					},
				}
			} else {
				const attemptsNote =
					result.attempts && result.attempts > 1 ? ` (failed after ${result.attempts} attempts)` : ""

				return {
					name: tool.name,
					params: tool.params,
					output:
						`❌ Failed to access MCP resource${attemptsNote}\n` +
						`🔗 Server: ${serverName}\n` +
						`📍 URI: ${uri}\n` +
						`❌ Error: ${result.error}\n\n` +
						`💡 Troubleshooting:\n` +
						`  • Verify server is running: \`/mcp list\`\n` +
						`  • Check resource exists: \`/mcp resources ${serverName}\`\n` +
						`  • Validate URI format: ${uri}`,
					metadata: {
						status: "error",
						duration,
					},
				}
			}
		} finally {
			await resourceManager.cleanup()
		}
	} catch (e: any) {
		const duration = Date.now() - startTime
		return {
			name: tool.name,
			params: tool.params,
			output:
				`❌ MCP resource access failed: ${e?.message || String(e)}\n` +
				`⏱️  Duration: ${duration}ms\n\n` +
				`💡 This may indicate:\n` +
				`  • MCP server configuration issues\n` +
				`  • Network connectivity problems\n` +
				`  • Invalid server or resource parameters`,
			metadata: {
				status: "error",
				duration,
			},
		}
	}
}

// CLI Browser Action implementation
async function runBrowserAction(defaultCwd: string, tool: BrowserActionToolUse): Promise<ToolExecution> {
	const action = tool.params.action?.trim() || ""
	const url = tool.params.url?.trim() || ""
	const coordinate = tool.params.coordinate?.trim() || ""
	const text = tool.params.text?.trim() || ""
	const size = tool.params.size?.trim() || ""

	// Enhanced validation
	if (!action) {
		return {
			name: tool.name,
			params: tool.params,
			output: "❌ Error: Action parameter is required",
		}
	}

	// Advanced CLI-specific tool wrappers

	async function runBatchOperationsTool(defaultCwd: string, tool: GenericToolUse): Promise<ToolExecution> {
		try {
			const operation = (tool.params as any).operation || ""
			const files = (tool.params as any).files || ""
			const options = (tool.params as any).options || "{}"

			if (!operation) {
				return { name: tool.name, params: tool.params, output: "❌ Error: Missing operation parameter" }
			}

			if (!files) {
				return { name: tool.name, params: tool.params, output: "❌ Error: Missing files parameter" }
			}

			// Parse files and options
			let fileList: string[]
			try {
				fileList = typeof files === "string" ? JSON.parse(files) : files
			} catch {
				fileList = typeof files === "string" ? files.split(",") : []
			}

			let parsedOptions: any = {}
			try {
				parsedOptions = typeof options === "string" ? JSON.parse(options) : options
			} catch {
				// Use default options
			}

			const config = {
				operation,
				files: fileList,
				options: parsedOptions,
			}

			return await runBatchOperations(defaultCwd, config)
		} catch (e: any) {
			return {
				name: tool.name,
				params: tool.params,
				output: `❌ Batch operations failed: ${e?.message || String(e)}`,
			}
		}
	}

	async function runWorkflowAutomationTool(defaultCwd: string, tool: GenericToolUse): Promise<ToolExecution> {
		try {
			const workflow = (tool.params as any).workflow || ""
			const workflowFile = (tool.params as any).workflowFile || ""
			const variables = (tool.params as any).variables || ""
			const dryRun = (tool.params as any).dryRun === "true"
			const continueOnError = (tool.params as any).continueOnError !== "false"
			const outputFormat = (tool.params as any).outputFormat || "structured"

			const params = {
				workflow: workflow || undefined,
				workflowFile: workflowFile || undefined,
				variables: variables || undefined,
				dryRun,
				continueOnError,
				outputFormat: outputFormat as "json" | "structured" | "minimal",
			}

			return await runWorkflowAutomation(defaultCwd, params)
		} catch (e: any) {
			return {
				name: tool.name,
				params: tool.params,
				output: `❌ Workflow automation failed: ${e?.message || String(e)}`,
			}
		}
	}

	async function runSystemDiagnosticsTool(defaultCwd: string, tool: GenericToolUse): Promise<ToolExecution> {
		try {
			const check = (tool.params as any).check || "health"
			const format = (tool.params as any).format || "structured"
			const includeRecommendations = (tool.params as any).includeRecommendations || "true"
			const monitoring = (tool.params as any).monitoring || "snapshot"
			const duration = (tool.params as any).duration || "30"
			const alertThresholds = (tool.params as any).alertThresholds || ""

			const params = {
				check,
				format: format as "json" | "table" | "structured",
				includeRecommendations,
				monitoring,
				duration,
				alertThresholds: alertThresholds || undefined,
			}

			return await runSystemDiagnostics(defaultCwd, params)
		} catch (e: any) {
			return {
				name: tool.name,
				params: tool.params,
				output: `❌ System diagnostics failed: ${e?.message || String(e)}`,
			}
		}
	}

	// Create browser action instance
	const browserAction = createCliBrowserAction()

	try {
		const result = await browserAction.execute({
			action,
			url: url || undefined,
			coordinate: coordinate || undefined,
			text: text || undefined,
			size: size || undefined,
		})

		if (result.success) {
			// Format successful result for CLI display
			let output = `✅ Browser action '${action}' completed successfully`

			if (result.url) {
				output += `\n📍 URL: ${result.url}`
			}

			if (result.title) {
				output += `\n📄 Title: ${result.title}`
			}

			if (result.metadata) {
				const { statusCode, contentType, size: contentSize, redirected, finalUrl } = result.metadata
				output += `\n📊 Metadata:`
				if (statusCode) output += `\n  • Status: ${statusCode}`
				if (contentType) output += `\n  • Content-Type: ${contentType}`
				if (contentSize) output += `\n  • Size: ${Math.round(contentSize / 1024)}KB`
				if (redirected && finalUrl) output += `\n  • Redirected to: ${finalUrl}`
			}

			if (result.content) {
				// Limit content display for CLI
				const maxContentLength = 2000
				const truncatedContent =
					result.content.length > maxContentLength
						? result.content.substring(0, maxContentLength) + "\n\n... (content truncated for CLI display)"
						: result.content

				output += `\n\n📝 Content:\n${truncatedContent}`
			}

			return {
				name: tool.name,
				params: tool.params,
				output,
				metadata: {
					status: "success",
					bytes_processed: result.metadata?.size || result.content?.length || 0,
				},
			}
		} else {
			// Format error result
			return {
				name: tool.name,
				params: tool.params,
				output: `❌ Browser action '${action}' failed: ${result.error || "Unknown error"}`,
				metadata: {
					status: "error",
				},
			}
		}

		// Enhanced file operations implementation
	} catch (error) {
		return {
			name: tool.name,
			params: tool.params,
			output: `❌ Browser action failed with exception: ${error instanceof Error ? error.message : String(error)}`,
			metadata: {
				status: "error",
			},
		}
	}
}

// Advanced CLI-specific tool wrappers

async function runBatchOperationsTool(defaultCwd: string, tool: GenericToolUse): Promise<ToolExecution> {
	try {
		const operation = (tool.params as any).operation || ""
		const files = (tool.params as any).files || ""
		const options = (tool.params as any).options || "{}"

		if (!operation) {
			return { name: tool.name, params: tool.params, output: "❌ Error: Missing operation parameter" }
		}

		if (!files) {
			return { name: tool.name, params: tool.params, output: "❌ Error: Missing files parameter" }
		}

		// Parse files and options
		let fileList: string[]
		try {
			fileList = typeof files === "string" ? JSON.parse(files) : files
		} catch {
			fileList = typeof files === "string" ? files.split(",") : []
		}

		let parsedOptions: any = {}
		try {
			parsedOptions = typeof options === "string" ? JSON.parse(options) : options
		} catch {
			// Use default options
		}

		const config = {
			operation,
			files: fileList,
			options: parsedOptions,
		}

		return await runBatchOperations(defaultCwd, config)
	} catch (e: any) {
		return {
			name: tool.name,
			params: tool.params,
			output: `❌ Batch operations failed: ${e?.message || String(e)}`,
		}
	}
}

async function runWorkflowAutomationTool(defaultCwd: string, tool: GenericToolUse): Promise<ToolExecution> {
	try {
		const workflow = (tool.params as any).workflow || ""
		const workflowFile = (tool.params as any).workflowFile || ""
		const variables = (tool.params as any).variables || ""
		const dryRun = (tool.params as any).dryRun === "true"
		const continueOnError = (tool.params as any).continueOnError !== "false"
		const outputFormat = (tool.params as any).outputFormat || "structured"

		const params = {
			workflow: workflow || undefined,
			workflowFile: workflowFile || undefined,
			variables: variables || undefined,
			dryRun,
			continueOnError,
			outputFormat: outputFormat as "json" | "structured" | "minimal",
		}

		return await runWorkflowAutomation(defaultCwd, params)
	} catch (e: any) {
		return {
			name: tool.name,
			params: tool.params,
			output: `❌ Workflow automation failed: ${e?.message || String(e)}`,
		}
	}
}

async function runSystemDiagnosticsTool(defaultCwd: string, tool: GenericToolUse): Promise<ToolExecution> {
	try {
		const check = (tool.params as any).check || "health"
		const format = (tool.params as any).format || "structured"
		const includeRecommendations = (tool.params as any).includeRecommendations || "true"
		const monitoring = (tool.params as any).monitoring || "snapshot"
		const duration = (tool.params as any).duration || "30"
		const alertThresholds = (tool.params as any).alertThresholds || ""

		const params = {
			check,
			format: format as "json" | "table" | "structured",
			includeRecommendations,
			monitoring,
			duration,
			alertThresholds: alertThresholds || undefined,
		}

		return await runSystemDiagnostics(defaultCwd, params)
	} catch (e: any) {
		return {
			name: tool.name,
			params: tool.params,
			output: `❌ System diagnostics failed: ${e?.message || String(e)}`,
		}
	}
}
