/**
 * Cross-Session State Management
 *
 * Provides advanced state persistence and recovery across CLI sessions:
 * - Conversation state preservation
 * - Task progress tracking
 * - Session metadata management
 * - State conflict resolution
 */

import fs from "node:fs/promises"
import fssync from "node:fs"
import path from "node:path"
import { createCliExtensionContext } from "../shims/vscode.js"

export interface SessionState {
	sessionId: string
	createdAt: string
	lastAccessedAt: string
	workingDirectory: string
	taskState: TaskProgressState
	conversationContext: ConversationContext
	toolHistory: ToolExecutionRecord[]
	userPreferences: SessionPreferences
	mcpServerStates: Record<string, any>
	errorHistory: ErrorRecord[]
}

export interface TaskProgressState {
	currentTask?: string
	taskId?: string
	mode: string
	progress: number
	todos: Array<{
		id: string
		text: string
		status: "pending" | "in_progress" | "completed"
		createdAt: string
		completedAt?: string
	}>
	checkpoint?: string
	estimatedCompletion?: number
}

export interface ConversationContext {
	messageCount: number
	tokenUsage: {
		total: number
		input: number
		output: number
		cost?: number
	}
	lastProvider: string
	lastModel: string
	conversationSummary?: string
	importantContext: string[]
}

export interface ToolExecutionRecord {
	toolName: string
	timestamp: string
	duration: number
	success: boolean
	inputSize: number
	outputSize: number
	errorMessage?: string
	metadata?: Record<string, any>
}

export interface SessionPreferences {
	autoSave: boolean
	verboseOutput: boolean
	autoApprove: string[]
	theme: string
	outputFormat: "json" | "text" | "structured"
	maxCacheSize: number
	preferredModels: Record<string, string>
}

export interface ErrorRecord {
	timestamp: string
	type: string
	message: string
	stack?: string
	context: {
		toolName?: string
		provider?: string
		workingDirectory: string
	}
	resolved?: boolean
}

export class CrossSessionStateManager {
	private cwd: string
	private sessionId: string
	private stateFile: string
	private backupFile: string
	private lockFile: string
	private currentState: SessionState
	private autoSaveInterval?: NodeJS.Timeout
	private conflictResolutionEnabled: boolean

	constructor(
		cwd: string,
		options: {
			sessionId?: string
			autoSaveInterval?: number
			conflictResolutionEnabled?: boolean
		} = {},
	) {
		this.cwd = cwd
		this.sessionId = options.sessionId || this.generateSessionId()
		this.conflictResolutionEnabled = options.conflictResolutionEnabled !== false

		const stateDir = path.join(cwd, ".kilocode", "sessions")
		this.stateFile = path.join(stateDir, `${this.sessionId}.json`)
		this.backupFile = path.join(stateDir, `${this.sessionId}.backup.json`)
		this.lockFile = path.join(stateDir, `${this.sessionId}.lock`)

		this.currentState = this.createInitialState()

		// Set up auto-save if requested
		if (options.autoSaveInterval && options.autoSaveInterval > 0) {
			this.autoSaveInterval = setInterval(() => this.saveState(), options.autoSaveInterval)
		}
	}

	async initialize(): Promise<SessionState> {
		try {
			// Check for existing state
			await this.acquireLock()

			const existingState = await this.loadExistingState()
			if (existingState) {
				this.currentState = existingState
				this.currentState.lastAccessedAt = new Date().toISOString()
			}

			// Save initial/updated state
			await this.saveState()

			return this.currentState
		} finally {
			await this.releaseLock()
		}
	}

	private generateSessionId(): string {
		return `cli-session-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`
	}

	private createInitialState(): SessionState {
		return {
			sessionId: this.sessionId,
			createdAt: new Date().toISOString(),
			lastAccessedAt: new Date().toISOString(),
			workingDirectory: this.cwd,
			taskState: {
				mode: "code",
				progress: 0,
				todos: [],
			},
			conversationContext: {
				messageCount: 0,
				tokenUsage: {
					total: 0,
					input: 0,
					output: 0,
				},
				lastProvider: "",
				lastModel: "",
				importantContext: [],
			},
			toolHistory: [],
			userPreferences: {
				autoSave: true,
				verboseOutput: false,
				autoApprove: [],
				theme: "default",
				outputFormat: "text",
				maxCacheSize: 100,
				preferredModels: {},
			},
			mcpServerStates: {},
			errorHistory: [],
		}
	}

	private async loadExistingState(): Promise<SessionState | null> {
		try {
			// Try primary state file first
			if (fssync.existsSync(this.stateFile)) {
				const stateData = await fs.readFile(this.stateFile, "utf8")
				const state = JSON.parse(stateData) as SessionState

				// Validate state structure
				if (this.validateStateStructure(state)) {
					return state
				}
			}

			// Try backup file if primary is corrupt
			if (fssync.existsSync(this.backupFile)) {
				const backupData = await fs.readFile(this.backupFile, "utf8")
				const backupState = JSON.parse(backupData) as SessionState

				if (this.validateStateStructure(backupState)) {
					console.warn("Primary state file was corrupt, restored from backup")
					return backupState
				}
			}
		} catch (e) {
			console.warn("Failed to load existing session state:", e)
		}

		return null
	}

	private validateStateStructure(state: any): boolean {
		const requiredFields = [
			"sessionId",
			"createdAt",
			"workingDirectory",
			"taskState",
			"conversationContext",
			"toolHistory",
		]

		return requiredFields.every((field) => state && typeof state[field] !== "undefined")
	}

	async saveState(): Promise<void> {
		try {
			await this.acquireLock()

			// Create backup of current state
			if (fssync.existsSync(this.stateFile)) {
				await fs.copyFile(this.stateFile, this.backupFile)
			}

			// Ensure directory exists
			await fs.mkdir(path.dirname(this.stateFile), { recursive: true })

			// Save new state
			const stateData = {
				...this.currentState,
				lastAccessedAt: new Date().toISOString(),
			}

			await fs.writeFile(this.stateFile, JSON.stringify(stateData, null, 2), "utf8")
		} finally {
			await this.releaseLock()
		}
	}

	async updateTaskProgress(updates: Partial<TaskProgressState>): Promise<void> {
		this.currentState.taskState = {
			...this.currentState.taskState,
			...updates,
		}

		if (this.currentState.userPreferences.autoSave) {
			await this.saveState()
		}
	}

	async addTodo(text: string): Promise<string> {
		const todoId = `todo-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`
		const newTodo = {
			id: todoId,
			text,
			status: "pending" as const,
			createdAt: new Date().toISOString(),
		}

		this.currentState.taskState.todos.push(newTodo)

		if (this.currentState.userPreferences.autoSave) {
			await this.saveState()
		}

		return todoId
	}

	async updateTodoStatus(todoId: string, status: "pending" | "in_progress" | "completed"): Promise<boolean> {
		const todo = this.currentState.taskState.todos.find((t) => t.id === todoId)
		if (!todo) return false

		todo.status = status
		if (status === "completed") {
			todo.completedAt = new Date().toISOString()
		}

		// Update overall progress
		const completed = this.currentState.taskState.todos.filter((t) => t.status === "completed").length
		const total = this.currentState.taskState.todos.length
		this.currentState.taskState.progress = total > 0 ? (completed / total) * 100 : 0

		if (this.currentState.userPreferences.autoSave) {
			await this.saveState()
		}

		return true
	}

	async recordToolExecution(record: Omit<ToolExecutionRecord, "timestamp">): Promise<void> {
		const toolRecord: ToolExecutionRecord = {
			...record,
			timestamp: new Date().toISOString(),
		}

		this.currentState.toolHistory.push(toolRecord)

		// Keep only last 100 tool executions to prevent unbounded growth
		if (this.currentState.toolHistory.length > 100) {
			this.currentState.toolHistory = this.currentState.toolHistory.slice(-100)
		}

		if (this.currentState.userPreferences.autoSave) {
			await this.saveState()
		}
	}

	async updateConversationContext(updates: Partial<ConversationContext>): Promise<void> {
		this.currentState.conversationContext = {
			...this.currentState.conversationContext,
			...updates,
		}

		if (this.currentState.userPreferences.autoSave) {
			await this.saveState()
		}
	}

	async recordError(error: Omit<ErrorRecord, "timestamp">): Promise<void> {
		const errorRecord: ErrorRecord = {
			...error,
			timestamp: new Date().toISOString(),
		}

		this.currentState.errorHistory.push(errorRecord)

		// Keep only last 50 errors
		if (this.currentState.errorHistory.length > 50) {
			this.currentState.errorHistory = this.currentState.errorHistory.slice(-50)
		}

		if (this.currentState.userPreferences.autoSave) {
			await this.saveState()
		}
	}

	async updateUserPreferences(updates: Partial<SessionPreferences>): Promise<void> {
		this.currentState.userPreferences = {
			...this.currentState.userPreferences,
			...updates,
		}

		await this.saveState()
	}

	async updateMcpServerState(serverName: string, state: any): Promise<void> {
		this.currentState.mcpServerStates[serverName] = {
			...this.currentState.mcpServerStates[serverName],
			...state,
			lastUpdated: new Date().toISOString(),
		}

		if (this.currentState.userPreferences.autoSave) {
			await this.saveState()
		}
	}

	getState(): SessionState {
		return { ...this.currentState }
	}

	async createCheckpoint(name: string, description?: string): Promise<string> {
		const checkpointId = `checkpoint-${Date.now()}`
		const checkpointFile = path.join(path.dirname(this.stateFile), `${this.sessionId}-${checkpointId}.json`)

		const checkpoint = {
			checkpointId,
			name,
			description,
			createdAt: new Date().toISOString(),
			state: { ...this.currentState },
		}

		await fs.writeFile(checkpointFile, JSON.stringify(checkpoint, null, 2), "utf8")

		// Update current state to reference this checkpoint
		this.currentState.taskState.checkpoint = checkpointId

		if (this.currentState.userPreferences.autoSave) {
			await this.saveState()
		}

		return checkpointId
	}

	async restoreFromCheckpoint(checkpointId: string): Promise<boolean> {
		try {
			const checkpointFile = path.join(path.dirname(this.stateFile), `${this.sessionId}-${checkpointId}.json`)

			if (!fssync.existsSync(checkpointFile)) {
				return false
			}

			const checkpointData = JSON.parse(await fs.readFile(checkpointFile, "utf8"))

			if (checkpointData.state && this.validateStateStructure(checkpointData.state)) {
				this.currentState = checkpointData.state
				this.currentState.lastAccessedAt = new Date().toISOString()
				await this.saveState()
				return true
			}
		} catch (e) {
			console.warn(`Failed to restore from checkpoint ${checkpointId}:`, e)
		}

		return false
	}

	async listCheckpoints(): Promise<
		Array<{
			checkpointId: string
			name: string
			description?: string
			createdAt: string
			size: number
		}>
	> {
		try {
			const sessionDir = path.dirname(this.stateFile)
			const files = await fs.readdir(sessionDir)
			const checkpoints: any[] = []

			for (const file of files) {
				if (file.startsWith(`${this.sessionId}-checkpoint-`) && file.endsWith(".json")) {
					try {
						const filePath = path.join(sessionDir, file)
						const stats = await fs.stat(filePath)
						const data = JSON.parse(await fs.readFile(filePath, "utf8"))

						checkpoints.push({
							checkpointId: data.checkpointId,
							name: data.name,
							description: data.description,
							createdAt: data.createdAt,
							size: stats.size,
						})
					} catch (e) {
						console.warn(`Failed to read checkpoint ${file}:`, e)
					}
				}
			}

			return checkpoints.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
		} catch (e) {
			console.warn("Failed to list checkpoints:", e)
			return []
		}
	}

	// Advanced session analytics
	async getSessionAnalytics(): Promise<{
		sessionDuration: number
		toolUsageStats: Record<string, number>
		errorRate: number
		performanceMetrics: {
			avgToolExecutionTime: number
			successRate: number
			tokenEfficiency: number
		}
		productivityMetrics: {
			tasksCompleted: number
			todosCompleted: number
			filesModified: number
		}
	}> {
		const now = Date.now()
		const sessionStart = new Date(this.currentState.createdAt).getTime()
		const sessionDuration = now - sessionStart

		// Tool usage statistics
		const toolUsageStats: Record<string, number> = {}
		for (const record of this.currentState.toolHistory) {
			toolUsageStats[record.toolName] = (toolUsageStats[record.toolName] || 0) + 1
		}

		// Error rate calculation
		const totalExecutions = this.currentState.toolHistory.length
		const errors = this.currentState.toolHistory.filter((t) => !t.success).length
		const errorRate = totalExecutions > 0 ? (errors / totalExecutions) * 100 : 0

		// Performance metrics
		const successfulExecutions = this.currentState.toolHistory.filter((t) => t.success)
		const avgToolExecutionTime =
			successfulExecutions.length > 0
				? successfulExecutions.reduce((sum, t) => sum + t.duration, 0) / successfulExecutions.length
				: 0
		const successRate = totalExecutions > 0 ? (successfulExecutions.length / totalExecutions) * 100 : 0
		const tokenEfficiency =
			this.currentState.conversationContext.tokenUsage.total > 0
				? (this.currentState.conversationContext.messageCount /
						this.currentState.conversationContext.tokenUsage.total) *
					1000
				: 0

		// Productivity metrics
		const tasksCompleted = this.currentState.taskState.progress === 100 ? 1 : 0
		const todosCompleted = this.currentState.taskState.todos.filter((t) => t.status === "completed").length
		const filesModified = this.currentState.toolHistory.filter((t) =>
			["write_to_file", "apply_diff", "insert_content"].includes(t.toolName),
		).length

		return {
			sessionDuration,
			toolUsageStats,
			errorRate,
			performanceMetrics: {
				avgToolExecutionTime,
				successRate,
				tokenEfficiency,
			},
			productivityMetrics: {
				tasksCompleted,
				todosCompleted,
				filesModified,
			},
		}
	}

	// Session recovery and conflict resolution
	async detectSessionConflicts(): Promise<{
		hasConflicts: boolean
		conflicts: Array<{
			type: string
			description: string
			suggestedResolution: string
		}>
	}> {
		const conflicts: Array<{
			type: string
			description: string
			suggestedResolution: string
		}> = []

		// Check for concurrent sessions
		try {
			const sessionDir = path.dirname(this.stateFile)
			const files = await fs.readdir(sessionDir)
			const activeSessions = []

			for (const file of files) {
				if (file.endsWith(".json") && !file.includes("backup") && !file.includes("checkpoint")) {
					try {
						const filePath = path.join(sessionDir, file)
						const stats = await fs.stat(filePath)
						const lastModified = stats.mtime.getTime()

						// Consider session active if modified in last 10 minutes
						if (Date.now() - lastModified < 600000) {
							activeSessions.push(file)
						}
					} catch (e) {
						// Ignore invalid session files
					}
				}
			}

			if (activeSessions.length > 1) {
				conflicts.push({
					type: "concurrent_sessions",
					description: `Multiple active sessions detected: ${activeSessions.join(", ")}`,
					suggestedResolution: "Merge sessions or choose primary session",
				})
			}
		} catch (e) {
			console.warn("Failed to detect session conflicts:", e)
		}

		// Check for workspace conflicts
		const context = createCliExtensionContext()
		const globalState = context.globalState.get("lastWorkspaceState") as any

		if (globalState && globalState.workingDirectory !== this.cwd) {
			conflicts.push({
				type: "workspace_conflict",
				description: `Working directory changed from ${globalState.workingDirectory} to ${this.cwd}`,
				suggestedResolution: "Update workspace state or create new session",
			})
		}

		return {
			hasConflicts: conflicts.length > 0,
			conflicts,
		}
	}

	async resolveSessionConflicts(): Promise<void> {
		if (!this.conflictResolutionEnabled) return

		const { hasConflicts, conflicts } = await this.detectSessionConflicts()

		if (!hasConflicts) return

		for (const conflict of conflicts) {
			switch (conflict.type) {
				case "concurrent_sessions":
					await this.resolveConcurrentSessions()
					break
				case "workspace_conflict":
					await this.resolveWorkspaceConflict()
					break
			}
		}
	}

	private async resolveConcurrentSessions(): Promise<void> {
		try {
			// Find all active sessions and merge their important state
			const sessionDir = path.dirname(this.stateFile)
			const files = await fs.readdir(sessionDir)
			const sessions: SessionState[] = []

			for (const file of files) {
				if (file.endsWith(".json") && !file.includes("backup") && !file.includes("checkpoint")) {
					try {
						const filePath = path.join(sessionDir, file)
						const sessionData = JSON.parse(await fs.readFile(filePath, "utf8"))
						if (this.validateStateStructure(sessionData)) {
							sessions.push(sessionData)
						}
					} catch (e) {
						// Ignore corrupt session files
					}
				}
			}

			if (sessions.length > 1) {
				// Merge sessions by keeping most recent data
				sessions.sort((a, b) => new Date(b.lastAccessedAt).getTime() - new Date(a.lastAccessedAt).getTime())

				const primarySession = sessions[0]

				// Merge todos from all sessions
				const allTodos = sessions.flatMap((s) => s.taskState.todos)
				const uniqueTodos = Array.from(new Map(allTodos.map((t) => [t.text, t])).values())

				primarySession.taskState.todos = uniqueTodos

				// Merge tool history
				const allToolHistory = sessions.flatMap((s) => s.toolHistory)
				primarySession.toolHistory = allToolHistory
					.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
					.slice(0, 100) // Keep most recent 100

				// Update current state
				this.currentState = primarySession
				await this.saveState()

				// Clean up other session files
				for (let i = 1; i < sessions.length; i++) {
					const sessionFile = path.join(sessionDir, `${sessions[i].sessionId}.json`)
					try {
						await fs.unlink(sessionFile)
					} catch (e) {
						console.warn(`Failed to clean up session file ${sessionFile}:`, e)
					}
				}
			}
		} catch (e) {
			console.warn("Failed to resolve concurrent sessions:", e)
		}
	}

	private async resolveWorkspaceConflict(): Promise<void> {
		// Update global workspace state
		const context = createCliExtensionContext()
		await context.globalState.update("lastWorkspaceState", {
			workingDirectory: this.cwd,
			sessionId: this.sessionId,
			lastAccessed: new Date().toISOString(),
		})
	}

	private async acquireLock(): Promise<void> {
		const maxWait = 5000 // 5 seconds max wait
		const checkInterval = 100 // Check every 100ms
		let waited = 0

		while (fssync.existsSync(this.lockFile) && waited < maxWait) {
			await new Promise((resolve) => setTimeout(resolve, checkInterval))
			waited += checkInterval
		}

		if (waited >= maxWait) {
			console.warn("Lock acquisition timeout, proceeding anyway")
		}

		// Create lock file
		await fs.mkdir(path.dirname(this.lockFile), { recursive: true })
		await fs.writeFile(
			this.lockFile,
			JSON.stringify({
				sessionId: this.sessionId,
				pid: process.pid,
				timestamp: new Date().toISOString(),
			}),
			"utf8",
		)
	}

	private async releaseLock(): Promise<void> {
		try {
			if (fssync.existsSync(this.lockFile)) {
				await fs.unlink(this.lockFile)
			}
		} catch (e) {
			console.warn("Failed to release lock:", e)
		}
	}

	async exportSessionData(): Promise<string> {
		const exportData = {
			exportedAt: new Date().toISOString(),
			exportVersion: "1.0.0",
			session: this.currentState,
			analytics: await this.getSessionAnalytics(),
			checkpoints: await this.listCheckpoints(),
		}

		const exportFile = path.join(path.dirname(this.stateFile), `export-${this.sessionId}-${Date.now()}.json`)

		await fs.writeFile(exportFile, JSON.stringify(exportData, null, 2), "utf8")
		return exportFile
	}

	async cleanup(): Promise<void> {
		// Clear auto-save interval
		if (this.autoSaveInterval) {
			clearInterval(this.autoSaveInterval)
		}

		// Final save
		await this.saveState()

		// Release any locks
		await this.releaseLock()
	}
}
