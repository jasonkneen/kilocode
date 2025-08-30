/**
 * CLI Task Adapter
 *
 * Bridges the existing CLI patterns with the core Task system.
 * Provides migration utilities and adapters for seamless integration.
 */

import { Task, TaskOptions } from "../../../src/core/task/Task"
import { TaskStatus } from "../../../src/core/task/TaskStatus"
import { eventBus } from "../../../src/core/events"
import { TaskEventNames, TaskEventFactory } from "../../../src/core/task/TaskEvents"
import type { Anthropic } from "@anthropic-ai/sdk"
import type { ClineProvider } from "../../../src/core/webview/ClineProvider"

/**
 * Legacy CLI session data structure
 */
export interface LegacySession {
	meta: {
		provider: string
		model: string
		mode: string
		updatedAt: string
	}
	messages: Anthropic.Messages.MessageParam[]
	todos?: string[]
}

/**
 * CLI-specific task metadata
 */
export interface CliTaskMetadata {
	sessionId: string
	provider: string
	model: string
	mode: string
	workingDirectory: string
	conversationHistory: Anthropic.Messages.MessageParam[]
	lastInteraction?: number
}

/**
 * CLI Task wrapper that extends core Task with CLI-specific features
 */
export class CliTask extends Task {
	private _sessionId: string
	private _conversationHistory: Anthropic.Messages.MessageParam[] = []

	constructor(options: TaskOptions & { sessionId?: string }) {
		super(options)
		this._sessionId = options.sessionId || `cli_${Date.now()}`

		// Subscribe to our own events to maintain conversation history
		eventBus.subscribe(TaskEventNames.TASK_OUTPUT_APPENDED, (payload) => {
			if (payload.taskId === this.taskId) {
				this.updateConversationHistory(payload.output, payload.outputType)
			}
		})
	}

	get sessionId(): string {
		return this._sessionId
	}

	get conversationHistory(): Anthropic.Messages.MessageParam[] {
		return [...this._conversationHistory]
	}

	/**
	 * Update conversation history from task output
	 */
	private updateConversationHistory(output: string, outputType: string): void {
		// Convert task output back to message format
		// This bridges the gap between old CLI message history and new task events
		if (outputType === "stdout" && output.trim()) {
			this._conversationHistory.push({
				role: "assistant",
				content: [{ type: "text", text: output }],
			})
		}
	}

	/**
	 * Add user input to conversation history
	 */
	addUserMessage(text: string): void {
		this._conversationHistory.push({
			role: "user",
			content: [{ type: "text", text }],
		})

		// Emit event for logging/tracking
		eventBus.emit(
			TaskEventNames.TASK_OUTPUT_APPENDED,
			TaskEventFactory.taskOutputAppended(this.taskId, text, "log", "user-input", "cli-user"),
		)
	}

	/**
	 * Convert to legacy session format for backward compatibility
	 */
	toLegacySession(): LegacySession {
		const metadata = this.getCliMetadata()
		return {
			meta: {
				provider: metadata.provider,
				model: metadata.model,
				mode: metadata.mode,
				updatedAt: new Date().toISOString(),
			},
			messages: this._conversationHistory,
			todos: this.todoList?.map((todo) => todo.text) || [],
		}
	}

	/**
	 * Get CLI-specific metadata
	 */
	private getCliMetadata(): CliTaskMetadata {
		const metadata = this.metadata as any
		return {
			sessionId: this._sessionId,
			provider: metadata.provider || "unknown",
			model: metadata.model || "unknown",
			mode: metadata.mode || "code",
			workingDirectory: metadata.workingDirectory || process.cwd(),
			conversationHistory: this._conversationHistory,
			lastInteraction: Date.now(),
		}
	}
}

/**
 * Migration utilities for converting legacy CLI data to Task system
 */
export class CliMigration {
	/**
	 * Convert legacy session to CliTask
	 */
	static fromLegacySession(sessionId: string, session: LegacySession, provider: ClineProvider): CliTask {
		// Extract task description from first user message
		const firstUserMessage = session.messages.find((msg) => msg.role === "user")
		const taskDescription = firstUserMessage
			? this.extractTextFromMessage(firstUserMessage)
			: `Restored session ${sessionId}`

		// Create task options
		const taskOptions: TaskOptions & { sessionId: string } = {
			context: provider.context,
			provider,
			apiConfiguration: {
				apiProvider: session.meta.provider as any,
				apiModelId: session.meta.model,
			},
			task: taskDescription,
			sessionId,
			// Convert legacy todos to new format
			initialTodos:
				session.todos?.map((text) => ({
					id: `todo_${Date.now()}_${Math.random()}`,
					text,
					completed: false,
					createdAt: Date.now(),
				})) || [],
		}

		// Create the task
		const task = new CliTask(taskOptions)

		// Restore conversation history
		;(task as any)._conversationHistory = [...session.messages]

		// Emit creation event
		eventBus.emit(
			TaskEventNames.TASK_CREATED,
			TaskEventFactory.taskCreated(task.taskId, taskDescription, {
				actor: "migration",
				metadata: {
					migratedFrom: "legacy-session",
					originalSessionId: sessionId,
				},
			}),
		)

		return task
	}

	/**
	 * Convert legacy todo list to Task instances
	 */
	static todosToTasks(todos: string[], provider: ClineProvider, parentTaskId?: string): CliTask[] {
		return todos.map((todoText, index) => {
			const taskOptions: TaskOptions & { sessionId: string } = {
				context: provider.context,
				provider,
				apiConfiguration: {
					apiProvider: "anthropic" as any,
				},
				task: todoText,
				sessionId: `todo_${Date.now()}_${index}`,
				parentTask: parentTaskId ? ({ taskId: parentTaskId } as any) : undefined,
			}

			const task = new CliTask(taskOptions)

			// Set status to ready since these are actionable todos
			eventBus.emit(
				TaskEventNames.TASK_STATUS_CHANGED,
				TaskEventFactory.taskStatusChanged(task.taskId, TaskStatus.None, TaskStatus.Ready, {
					actor: "migration",
					reason: "converted-from-todo",
				}),
			)

			return task
		})
	}

	/**
	 * Detect if migration is needed by checking for legacy data
	 */
	static async needsMigration(stateDir: string): Promise<{
		needsSessionMigration: boolean
		needsTodoMigration: boolean
		sessionFiles: string[]
		todoFile: string | null
	}> {
		const fs = require("fs")
		const path = require("path")

		const sessionsDir = path.join(stateDir, "sessions")
		const todosFile = path.join(stateDir, "todos.json")

		let sessionFiles: string[] = []
		let needsSessionMigration = false

		try {
			if (fs.existsSync(sessionsDir)) {
				sessionFiles = (await fs.promises.readdir(sessionsDir)).filter((f: string) => f.endsWith(".json"))
				needsSessionMigration = sessionFiles.length > 0
			}
		} catch {
			// Directory doesn't exist or can't be read
		}

		const needsTodoMigration = fs.existsSync(todosFile)

		return {
			needsSessionMigration,
			needsTodoMigration,
			sessionFiles,
			todoFile: needsTodoMigration ? todosFile : null,
		}
	}

	/**
	 * Perform full migration of legacy CLI data
	 */
	static async migrate(
		stateDir: string,
		provider: ClineProvider,
	): Promise<{
		migratedTasks: CliTask[]
		errors: string[]
	}> {
		const migrationInfo = await this.needsMigration(stateDir)
		const migratedTasks: CliTask[] = []
		const errors: string[] = []

		// Migrate sessions
		if (migrationInfo.needsSessionMigration) {
			for (const sessionFile of migrationInfo.sessionFiles) {
				try {
					const sessionPath = require("path").join(stateDir, "sessions", sessionFile)
					const sessionData = JSON.parse(require("fs").readFileSync(sessionPath, "utf8"))
					const sessionId = sessionFile.replace(".json", "")

					const task = this.fromLegacySession(sessionId, sessionData, provider)
					migratedTasks.push(task)
				} catch (error) {
					errors.push(`Failed to migrate session ${sessionFile}: ${error}`)
				}
			}
		}

		// Migrate todos
		if (migrationInfo.needsTodoMigration && migrationInfo.todoFile) {
			try {
				const todosData = JSON.parse(require("fs").readFileSync(migrationInfo.todoFile, "utf8"))
				if (Array.isArray(todosData)) {
					const todoTasks = this.todosToTasks(todosData, provider)
					migratedTasks.push(...todoTasks)
				}
			} catch (error) {
				errors.push(`Failed to migrate todos: ${error}`)
			}
		}

		console.log(`Migration completed: ${migratedTasks.length} tasks migrated, ${errors.length} errors`)

		return { migratedTasks, errors }
	}

	/**
	 * Extract text content from Anthropic message
	 */
	private static extractTextFromMessage(message: Anthropic.Messages.MessageParam): string {
		if (typeof message.content === "string") {
			return message.content
		}

		if (Array.isArray(message.content)) {
			return message.content
				.filter((block) => block.type === "text")
				.map((block) => (block as any).text)
				.join(" ")
		}

		return "Untitled task"
	}
}

/**
 * CLI-specific task factory
 */
export class CliTaskFactory {
	/**
	 * Create a new CLI task for interactive conversation
	 */
	static createConversationTask(
		description: string,
		provider: ClineProvider,
		options: Partial<TaskOptions> = {},
	): CliTask {
		const sessionId = `conv_${Date.now()}`

		const taskOptions: TaskOptions & { sessionId: string } = {
			context: provider.context,
			provider,
			apiConfiguration: options.apiConfiguration || {
				apiProvider: "anthropic" as any,
			},
			task: description,
			sessionId,
			...options,
		}

		return new CliTask(taskOptions)
	}

	/**
	 * Create a task from user input
	 */
	static fromUserInput(input: string, provider: ClineProvider, currentSession?: CliTask): CliTask {
		if (currentSession) {
			// Add to existing task
			currentSession.addUserMessage(input)
			return currentSession
		} else {
			// Create new task
			return this.createConversationTask(input, provider)
		}
	}
}
