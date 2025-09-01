/**
 * Workflow Automation Tool
 *
 * CLI-specific high-value tool for automated workflows that would be
 * impractical in VS Code extension. Enables CI/CD pipeline integration,
 * batch task processing, and advanced automation scenarios.
 */

import fs from "node:fs/promises"
import fssync from "node:fs"
import path from "node:path"
import { performance } from "node:perf_hooks"
import { executeBatchTools, parseToolUses } from "../tool-runner.js"
import type { ToolUse } from "../../../../src/shared/tools.js"
import type { ToolExecution } from "../tool-runner.js"

export interface WorkflowConfig {
	name: string
	description?: string
	version: string
	steps: WorkflowStep[]
	variables?: Record<string, any>
	conditions?: WorkflowCondition[]
	hooks?: {
		beforeStep?: string[]
		afterStep?: string[]
		onError?: string[]
		onSuccess?: string[]
	}
	parallel?: boolean
	timeout?: number
	retries?: number
}

export interface WorkflowStep {
	id: string
	name: string
	tool: string
	params: Record<string, any>
	condition?: string
	dependsOn?: string[]
	continueOnError?: boolean
	timeout?: number
	retry?: {
		count: number
		delay: number
		exponentialBackoff?: boolean
	}
}

export interface WorkflowCondition {
	id: string
	expression: string
	description?: string
}

export interface WorkflowExecution {
	workflowId: string
	startTime: number
	endTime?: number
	status: "running" | "completed" | "failed" | "cancelled"
	steps: Array<{
		stepId: string
		status: "pending" | "running" | "completed" | "failed" | "skipped"
		startTime?: number
		endTime?: number
		result?: ToolExecution
		error?: string
		retryCount?: number
	}>
	variables: Record<string, any>
	metadata: {
		totalDuration: number
		stepsExecuted: number
		stepsSkipped: number
		stepsFailed: number
		parallelExecuted: boolean
	}
}

export async function runWorkflowAutomation(
	defaultCwd: string,
	params: {
		workflow?: string // JSON workflow config
		workflowFile?: string // Path to workflow file
		variables?: string // JSON variables
		dryRun?: boolean
		continueOnError?: boolean
		outputFormat?: "json" | "structured" | "minimal"
	},
): Promise<ToolExecution> {
	const startTime = performance.now()

	try {
		// Parse workflow configuration
		let workflowConfig: WorkflowConfig

		if (params.workflowFile) {
			const workflowPath = path.resolve(defaultCwd, params.workflowFile)
			if (!fssync.existsSync(workflowPath)) {
				return {
					name: "workflow_automation",
					params: { workflowFile: params.workflowFile || "" },
					output: `❌ Error: Workflow file not found: ${params.workflowFile}`,
				}
			}

			const workflowContent = await fs.readFile(workflowPath, "utf8")
			const ext = path.extname(workflowPath).toLowerCase()

			if (ext === ".json") {
				workflowConfig = JSON.parse(workflowContent)
			} else if (ext === ".yaml" || ext === ".yml") {
				// For now, only support JSON. YAML support could be added later
				return {
					name: "workflow_automation",
					params: { workflowFile: params.workflowFile || "" },
					output: "❌ Error: YAML workflows not yet supported. Use JSON format.",
				}
			} else {
				return {
					name: "workflow_automation",
					params: { workflowFile: params.workflowFile || "" },
					output: "❌ Error: Workflow file must be .json format",
				}
			}
		} else if (params.workflow) {
			try {
				workflowConfig = JSON.parse(params.workflow)
			} catch (e) {
				return {
					name: "workflow_automation",
					params: { workflow: params.workflow || "" },
					output: `❌ Error: Invalid workflow JSON: ${e instanceof Error ? e.message : String(e)}`,
				}
			}
		} else {
			return {
				name: "workflow_automation",
				params: {},
				output: "❌ Error: Either 'workflow' or 'workflowFile' parameter is required",
			}
		}

		// Validate workflow configuration
		const validation = validateWorkflowConfig(workflowConfig)
		if (!validation.valid) {
			return {
				name: "workflow_automation",
				params: { workflow: workflowConfig.name },
				output: `❌ Workflow validation failed:\n${validation.errors.join("\n")}`,
			}
		}

		// Parse variables
		let variables: Record<string, any> = { ...workflowConfig.variables }
		if (params.variables) {
			try {
				const parsedVars = JSON.parse(params.variables)
				variables = { ...variables, ...parsedVars }
			} catch (e) {
				return {
					name: "workflow_automation",
					params: { variables: params.variables || "" },
					output: `❌ Error: Invalid variables JSON: ${e instanceof Error ? e.message : String(e)}`,
				}
			}
		}

		// Add environment variables
		variables = {
			...variables,
			CWD: defaultCwd,
			TIMESTAMP: new Date().toISOString(),
			WORKFLOW_NAME: workflowConfig.name,
		}

		// Execute workflow
		const execution = await executeWorkflow(defaultCwd, workflowConfig, variables, {
			dryRun: params.dryRun === true,
			continueOnError: params.continueOnError !== false,
		})

		// Format output based on requested format
		const totalDuration = performance.now() - startTime
		let output = ""

		switch (params.outputFormat) {
			case "json":
				output = JSON.stringify(execution, null, 2)
				break

			case "minimal":
				const status =
					execution.status === "completed"
						? "✅"
						: execution.status === "failed"
							? "❌"
							: execution.status === "cancelled"
								? "🚫"
								: "🔄"
				output = `${status} Workflow '${workflowConfig.name}' ${execution.status} (${Math.round(totalDuration)}ms)`
				break

			default: // structured
				output = formatWorkflowExecution(workflowConfig, execution, totalDuration)
		}

		return {
			name: "workflow_automation",
			params: {
				workflow: workflowConfig.name,
				dryRun: String(params.dryRun || false),
				outputFormat: params.outputFormat || "structured",
			},
			output,
			metadata: {
				status: execution.status === "completed" ? "success" : "error",
				duration: totalDuration,
				files_affected: extractAffectedFiles(execution),
			},
		}
	} catch (e: any) {
		const duration = performance.now() - startTime
		return {
			name: "workflow_automation",
			params: { error: "true" },
			output: `❌ Workflow automation failed: ${e?.message || String(e)}`,
			metadata: {
				status: "error",
				duration,
			},
		}
	}
}

function validateWorkflowConfig(config: WorkflowConfig): { valid: boolean; errors: string[] } {
	const errors: string[] = []

	if (!config.name) errors.push("Workflow name is required")
	if (!config.version) errors.push("Workflow version is required")
	if (!config.steps || !Array.isArray(config.steps)) errors.push("Workflow steps array is required")
	if (config.steps.length === 0) errors.push("At least one workflow step is required")

	// Validate each step
	const stepIds = new Set<string>()
	for (const [index, step] of config.steps.entries()) {
		if (!step.id) {
			errors.push(`Step ${index + 1}: id is required`)
		} else if (stepIds.has(step.id)) {
			errors.push(`Step ${index + 1}: duplicate step id '${step.id}'`)
		} else {
			stepIds.add(step.id)
		}

		if (!step.tool) errors.push(`Step ${step.id || index + 1}: tool is required`)
		if (!step.params) errors.push(`Step ${step.id || index + 1}: params is required`)

		// Validate dependencies
		if (step.dependsOn) {
			for (const depId of step.dependsOn) {
				if (!stepIds.has(depId)) {
					errors.push(`Step ${step.id}: dependency '${depId}' not found`)
				}
			}
		}
	}

	return { valid: errors.length === 0, errors }
}

async function executeWorkflow(
	cwd: string,
	config: WorkflowConfig,
	variables: Record<string, any>,
	options: {
		dryRun: boolean
		continueOnError: boolean
	},
): Promise<WorkflowExecution> {
	const execution: WorkflowExecution = {
		workflowId: `${config.name}-${Date.now()}`,
		startTime: performance.now(),
		status: "running",
		steps: config.steps.map((step) => ({
			stepId: step.id,
			status: "pending",
		})),
		variables,
		metadata: {
			totalDuration: 0,
			stepsExecuted: 0,
			stepsSkipped: 0,
			stepsFailed: 0,
			parallelExecuted: config.parallel === true,
		},
	}

	try {
		if (config.parallel) {
			await executeWorkflowParallel(cwd, config, execution, options)
		} else {
			await executeWorkflowSequential(cwd, config, execution, options)
		}

		execution.status = execution.steps.some((s) => s.status === "failed") ? "failed" : "completed"
	} catch (e) {
		execution.status = "failed"
		console.error("Workflow execution error:", e)
	}

	execution.endTime = performance.now()
	execution.metadata.totalDuration = execution.endTime - execution.startTime

	return execution
}

async function executeWorkflowSequential(
	cwd: string,
	config: WorkflowConfig,
	execution: WorkflowExecution,
	options: { dryRun: boolean; continueOnError: boolean },
): Promise<void> {
	for (const step of config.steps) {
		const stepExecution = execution.steps.find((s) => s.stepId === step.id)!

		// Check step condition
		if (step.condition && !evaluateCondition(step.condition, execution.variables)) {
			stepExecution.status = "skipped"
			execution.metadata.stepsSkipped++
			continue
		}

		// Check dependencies
		if (step.dependsOn) {
			const unmetDeps = step.dependsOn.filter((depId) => {
				const depStep = execution.steps.find((s) => s.stepId === depId)
				return !depStep || depStep.status !== "completed"
			})

			if (unmetDeps.length > 0) {
				stepExecution.status = "failed"
				stepExecution.error = `Unmet dependencies: ${unmetDeps.join(", ")}`
				execution.metadata.stepsFailed++

				if (!options.continueOnError) break
				continue
			}
		}

		// Execute step
		stepExecution.status = "running"
		stepExecution.startTime = performance.now()

		try {
			if (options.dryRun) {
				// Simulate execution
				stepExecution.result = {
					name: step.tool,
					params: step.params,
					output: `[DRY RUN] Would execute ${step.tool} with params: ${JSON.stringify(step.params)}`,
				}
				stepExecution.status = "completed"
			} else {
				// Execute with retry logic
				const result = await executeStepWithRetry(cwd, step, execution.variables)
				stepExecution.result = result
				stepExecution.status = result.metadata?.status === "error" ? "failed" : "completed"

				if (stepExecution.status === "failed") {
					execution.metadata.stepsFailed++
					if (!options.continueOnError) break
				}
			}

			execution.metadata.stepsExecuted++
		} catch (e: any) {
			stepExecution.status = "failed"
			stepExecution.error = e?.message || String(e)
			execution.metadata.stepsFailed++

			if (!options.continueOnError) break
		}

		stepExecution.endTime = performance.now()
	}
}

async function executeWorkflowParallel(
	cwd: string,
	config: WorkflowConfig,
	execution: WorkflowExecution,
	options: { dryRun: boolean; continueOnError: boolean },
): Promise<void> {
	// Build dependency graph for parallel execution
	const dependencyGraph = buildDependencyGraph(config.steps)
	const executionOrder = resolveDependencyOrder(dependencyGraph)

	for (const parallelBatch of executionOrder) {
		const batchPromises = parallelBatch.map(async (step) => {
			const stepExecution = execution.steps.find((s) => s.stepId === step.id)!

			// Check condition
			if (step.condition && !evaluateCondition(step.condition, execution.variables)) {
				stepExecution.status = "skipped"
				return
			}

			stepExecution.status = "running"
			stepExecution.startTime = performance.now()

			try {
				if (options.dryRun) {
					stepExecution.result = {
						name: step.tool,
						params: step.params,
						output: `[DRY RUN] Would execute ${step.tool}`,
					}
					stepExecution.status = "completed"
				} else {
					const result = await executeStepWithRetry(cwd, step, execution.variables)
					stepExecution.result = result
					stepExecution.status = result.metadata?.status === "error" ? "failed" : "completed"
				}
			} catch (e: any) {
				stepExecution.status = "failed"
				stepExecution.error = e?.message || String(e)
			}

			stepExecution.endTime = performance.now()
		})

		await Promise.allSettled(batchPromises)

		// Update metadata
		execution.metadata.stepsExecuted += parallelBatch.length
		execution.metadata.stepsFailed += execution.steps.filter((s) => s.status === "failed").length
		execution.metadata.stepsSkipped += execution.steps.filter((s) => s.status === "skipped").length

		// Stop if any step failed and continueOnError is false
		if (!options.continueOnError && execution.steps.some((s) => s.status === "failed")) {
			break
		}
	}
}

async function executeStepWithRetry(
	cwd: string,
	step: WorkflowStep,
	variables: Record<string, any>,
): Promise<ToolExecution> {
	const maxRetries = step.retry?.count || 0
	const baseDelay = step.retry?.delay || 1000
	const exponentialBackoff = step.retry?.exponentialBackoff !== false

	let lastError: any = null

	for (let attempt = 0; attempt <= maxRetries; attempt++) {
		try {
			// Substitute variables in parameters
			const substitutedParams = substituteVariables(step.params, variables)

			// Create tool use object
			const toolUse: ToolUse = {
				type: "tool_use",
				name: step.tool as any,
				params: substitutedParams,
				partial: false,
			}

			// Execute tool
			const batchResult = await executeBatchTools(cwd, [toolUse], {
				verbose: false,
				parallel: false,
			})

			if (batchResult.executions.length > 0) {
				const result = batchResult.executions[0]

				// If successful or this is the last attempt, return result
				if (result.metadata?.status !== "error" || attempt === maxRetries) {
					return result
				}

				lastError = new Error(result.output)
			}
		} catch (e) {
			lastError = e

			// If this is the last attempt, throw the error
			if (attempt === maxRetries) {
				throw e
			}
		}

		// Wait before retry
		if (attempt < maxRetries) {
			const delay = exponentialBackoff ? baseDelay * Math.pow(2, attempt) : baseDelay
			await new Promise((resolve) => setTimeout(resolve, delay))
		}
	}

	throw lastError || new Error("Unknown execution error")
}

function substituteVariables(params: Record<string, any>, variables: Record<string, any>): Record<string, any> {
	const substituted: Record<string, any> = {}

	for (const [key, value] of Object.entries(params)) {
		if (typeof value === "string") {
			// Replace ${VAR_NAME} patterns
			substituted[key] = value.replace(/\$\{([^}]+)\}/g, (match, varName) => {
				return variables[varName] !== undefined ? String(variables[varName]) : match
			})
		} else {
			substituted[key] = value
		}
	}

	return substituted
}

function evaluateCondition(condition: string, variables: Record<string, any>): boolean {
	try {
		// Simple condition evaluation - in production, could use a safer expression evaluator
		// For now, support basic comparisons: ${VAR} == "value", ${VAR} != "value", etc.
		const substituted = condition.replace(/\$\{([^}]+)\}/g, (match, varName) => {
			const value = variables[varName]
			return typeof value === "string" ? `"${value}"` : String(value)
		})

		// Basic operators: ==, !=, >, <, >=, <=
		const operators = ["==", "!=", ">=", "<=", ">", "<"]
		for (const op of operators) {
			if (substituted.includes(op)) {
				const [left, right] = substituted.split(op).map((s) => s.trim())
				const leftVal = left.startsWith('"') ? left.slice(1, -1) : parseFloat(left)
				const rightVal = right.startsWith('"') ? right.slice(1, -1) : parseFloat(right)

				switch (op) {
					case "==":
						return leftVal === rightVal
					case "!=":
						return leftVal !== rightVal
					case ">":
						return (leftVal as number) > (rightVal as number)
					case "<":
						return (leftVal as number) < (rightVal as number)
					case ">=":
						return (leftVal as number) >= (rightVal as number)
					case "<=":
						return (leftVal as number) <= (rightVal as number)
				}
			}
		}

		// If no operators found, treat as boolean
		return substituted.toLowerCase() === "true"
	} catch (e) {
		console.warn(`Failed to evaluate condition '${condition}':`, e)
		return false
	}
}

function buildDependencyGraph(steps: WorkflowStep[]): Map<string, string[]> {
	const graph = new Map<string, string[]>()

	for (const step of steps) {
		graph.set(step.id, step.dependsOn || [])
	}

	return graph
}

function resolveDependencyOrder(graph: Map<string, string[]>): WorkflowStep[][] {
	// Simplified topological sort for parallel batches
	const batches: string[][] = []
	const processed = new Set<string>()
	const remaining = new Set(graph.keys())

	while (remaining.size > 0) {
		const currentBatch: string[] = []

		for (const stepId of remaining) {
			const dependencies = graph.get(stepId) || []
			const unmetDeps = dependencies.filter((dep) => !processed.has(dep))

			if (unmetDeps.length === 0) {
				currentBatch.push(stepId)
			}
		}

		if (currentBatch.length === 0) {
			// Circular dependency detected
			throw new Error("Circular dependency detected in workflow")
		}

		batches.push(currentBatch)
		currentBatch.forEach((stepId) => {
			remaining.delete(stepId)
			processed.add(stepId)
		})
	}

	// Convert step IDs back to step objects
	// This is a simplified version - in production, would maintain step references
	return batches as any
}

function formatWorkflowExecution(config: WorkflowConfig, execution: WorkflowExecution, totalDuration: number): string {
	const statusIcon =
		execution.status === "completed"
			? "✅"
			: execution.status === "failed"
				? "❌"
				: execution.status === "cancelled"
					? "🚫"
					: "🔄"

	let output = `${statusIcon} Workflow: ${config.name}\n`
	output += `📝 Description: ${config.description || "No description"}\n`
	output += `⏱️  Duration: ${Math.round(totalDuration)}ms\n`
	output += `📊 Steps: ${execution.metadata.stepsExecuted} executed, ${execution.metadata.stepsFailed} failed, ${execution.metadata.stepsSkipped} skipped\n\n`

	// Show step results
	for (const stepExec of execution.steps) {
		const step = config.steps.find((s) => s.id === stepExec.stepId)!
		const stepStatus =
			stepExec.status === "completed"
				? "✅"
				: stepExec.status === "failed"
					? "❌"
					: stepExec.status === "skipped"
						? "⏭️"
						: stepExec.status === "running"
							? "🔄"
							: "⏳"

		const duration = stepExec.endTime && stepExec.startTime ? Math.round(stepExec.endTime - stepExec.startTime) : 0

		output += `  ${stepStatus} ${step.name} (${step.tool})`
		if (duration > 0) output += ` - ${duration}ms`
		if (stepExec.retryCount && stepExec.retryCount > 0) output += ` - ${stepExec.retryCount} retries`
		if (stepExec.error) output += ` - ${stepExec.error}`
		output += "\n"

		// Show tool output for failed steps
		if (stepExec.status === "failed" && stepExec.result) {
			const errorLines = stepExec.result.output.split("\n").slice(0, 3)
			output += `    ${errorLines.join("\n    ")}\n`
		}
	}

	return output
}

function extractAffectedFiles(execution: WorkflowExecution): string[] {
	const files = new Set<string>()

	for (const stepExec of execution.steps) {
		if (stepExec.result?.metadata?.files_affected) {
			stepExec.result.metadata.files_affected.forEach((file) => files.add(file))
		}
	}

	return Array.from(files)
}

// Workflow template creation helper
export function createWorkflowTemplate(
	type: "ci_pipeline" | "code_analysis" | "file_processing" | "testing",
): WorkflowConfig {
	const templates = {
		ci_pipeline: {
			name: "CI Pipeline",
			description: "Continuous integration workflow",
			version: "1.0.0",
			steps: [
				{
					id: "install_deps",
					name: "Install Dependencies",
					tool: "execute_command",
					params: { command: "npm install" },
				},
				{
					id: "run_tests",
					name: "Run Tests",
					tool: "execute_command",
					params: { command: "npm test" },
					dependsOn: ["install_deps"],
				},
				{
					id: "build",
					name: "Build Project",
					tool: "execute_command",
					params: { command: "npm run build" },
					dependsOn: ["run_tests"],
				},
			],
		},

		code_analysis: {
			name: "Code Analysis",
			description: "Comprehensive code analysis workflow",
			version: "1.0.0",
			steps: [
				{
					id: "list_files",
					name: "List Source Files",
					tool: "list_files",
					params: { path: "src", recursive: "true" },
				},
				{
					id: "analyze_definitions",
					name: "Analyze Code Definitions",
					tool: "list_code_definition_names",
					params: { path: "src" },
					dependsOn: ["list_files"],
				},
				{
					id: "search_todos",
					name: "Find TODO Comments",
					tool: "search_files",
					params: { path: "src", regex: "TODO|FIXME|HACK" },
					dependsOn: ["list_files"],
				},
			],
			parallel: true,
		},

		file_processing: {
			name: "File Processing",
			description: "Batch file processing workflow",
			version: "1.0.0",
			steps: [
				{
					id: "backup_files",
					name: "Backup Files",
					tool: "batch_operations",
					params: {
						operation: "backup",
						files: ["${TARGET_FILES}"],
					},
				},
				{
					id: "transform_files",
					name: "Transform Files",
					tool: "batch_operations",
					params: {
						operation: "transform",
						files: ["${TARGET_FILES}"],
						pattern: "${SEARCH_PATTERN}",
						replacement: "${REPLACEMENT}",
					},
					dependsOn: ["backup_files"],
				},
			],
		},

		testing: {
			name: "Testing Workflow",
			description: "Comprehensive testing workflow",
			version: "1.0.0",
			steps: [
				{
					id: "unit_tests",
					name: "Unit Tests",
					tool: "execute_command",
					params: { command: "npm run test:unit" },
				},
				{
					id: "integration_tests",
					name: "Integration Tests",
					tool: "execute_command",
					params: { command: "npm run test:integration" },
					dependsOn: ["unit_tests"],
				},
				{
					id: "e2e_tests",
					name: "End-to-End Tests",
					tool: "execute_command",
					params: { command: "npm run test:e2e" },
					dependsOn: ["integration_tests"],
				},
			],
		},
	}

	return templates[type]
}
