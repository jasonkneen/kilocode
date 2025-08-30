/**
 * TaskManager - Centralized task lifecycle orchestration
 *
 * Provides comprehensive task CRUD operations, lifecycle transitions,
 * and event emissions for both CLI and VSCode environments.
 */

import { EventBus } from "../events/EventBus"
import { Task } from "./Task"
import {
	TaskStatus,
	isValidTransition,
	isTerminalStatus,
	getValidNextStates,
	TASK_STATUS_TRANSITIONS,
} from "./TaskStatus"
import {
	TaskEventNames,
	TaskEventFactory,
	TaskProgress,
	TaskCreatedEvent,
	TaskUpdatedEvent,
	TaskDeletedEvent,
	TaskStatusChangedEvent,
	TaskProgressUpdatedEvent,
	TaskOutputAppendedEvent,
	TaskAssignedEvent,
	SubtaskCreatedEvent,
} from "./TaskEvents"
import { TaskRepository, StoredTask } from "../storage/TaskRepository"

/**
 * Task creation options for TaskManager
 */
export interface TaskManagerCreateOptions {
	title: string
	description?: string
	parentId?: string
	assignedTo?: string
	metadata?: Record<string, unknown>
	initialStatus?: TaskStatus
	actor?: string
}

/**
 * Task update options
 */
export interface TaskManagerUpdateOptions {
	title?: string
	description?: string
	assignedTo?: string
	metadata?: Record<string, unknown>
	actor?: string
}

/**
 * Task query options for filtering and searching
 */
export interface TaskQueryOptions {
	status?: TaskStatus | TaskStatus[]
	parentId?: string
	assignedTo?: string
	createdAfter?: Date
	createdBefore?: Date
	limit?: number
	offset?: number
}

/**
 * Progress update options
 */
export interface ProgressUpdateOptions {
	percent: number
	currentStep?: string
	totalSteps?: number
	estimatedTimeRemaining?: number
	message?: string
	actor?: string
}

/**
 * Task delegation options
 */
export interface TaskDelegationOptions {
	delegatedTo: string
	delegationReason?: string
	expectedDuration?: number
	instructions?: string
	actor?: string
}

/**
 * Task assignment options
 */
export interface TaskAssignmentOptions {
	assignedTo: string
	assignedBy?: string
	capabilities?: string[]
	actor?: string
}

/**
 * Internal task record for management
 */
interface TaskRecord {
	id: string
	task?: Task // Optional VSCode Task instance
	title: string
	description?: string
	status: TaskStatus
	parentId?: string
	assignedTo?: string
	progress: TaskProgress
	metadata: Record<string, unknown>
	createdAt: number
	updatedAt: number
	children: string[]
	logs: Array<{
		timestamp: number
		output: string
		type: "stdout" | "stderr" | "log" | "error" | "info" | "debug"
		source?: string
	}>
}

/**
 * TaskManager errors
 */
export class TaskManagerError extends Error {
	constructor(
		message: string,
		public readonly taskId?: string,
	) {
		super(message)
		this.name = "TaskManagerError"
	}
}

export class TaskNotFoundError extends TaskManagerError {
	constructor(taskId: string) {
		super(`Task not found: ${taskId}`, taskId)
		this.name = "TaskNotFoundError"
	}
}

export class InvalidTransitionError extends TaskManagerError {
	constructor(taskId: string, fromStatus: TaskStatus, toStatus: TaskStatus) {
		super(`Invalid transition from ${fromStatus} to ${toStatus} for task ${taskId}`, taskId)
		this.name = "InvalidTransitionError"
	}
}

/**
 * TaskManager implementation
 *
 * Provides centralized management of task lifecycle, status transitions,
 * progress tracking, and hierarchical relationships.
 */
export class TaskManager {
	private readonly tasks: Map<string, TaskRecord> = new Map()
	private readonly eventBus: EventBus
	private repository?: TaskRepository

	constructor(eventBus: EventBus, repository?: TaskRepository) {
		this.eventBus = eventBus
		this.repository = repository
	}

	/**
	 * Create a new task
	 */
	async create(options: TaskManagerCreateOptions): Promise<string> {
		const taskId = this.generateTaskId()
		const now = Date.now()

		const taskRecord: TaskRecord = {
			id: taskId,
			title: options.title,
			description: options.description,
			status: options.initialStatus ?? TaskStatus.Pending,
			parentId: options.parentId,
			assignedTo: options.assignedTo,
			progress: { percent: 0 },
			metadata: options.metadata ?? {},
			createdAt: now,
			updatedAt: now,
			children: [],
			logs: [],
		}

		this.tasks.set(taskId, taskRecord)

		// Link parent-child relationship
		if (options.parentId) {
			await this.linkParentChild(options.parentId, taskId)
		}

		// Emit creation event
		const event = TaskEventFactory.taskCreated(taskId, options.title, {
			description: options.description,
			parentId: options.parentId,
			assignedTo: options.assignedTo,
			metadata: options.metadata,
			actor: options.actor,
		})

		this.eventBus.emit(TaskEventNames.TASK_CREATED, event)

		// Persist to repository
		await this.persistTask(taskRecord)

		return taskId
	}

	/**
	 * Update an existing task
	 */
	async update(taskId: string, options: TaskManagerUpdateOptions): Promise<void> {
		const taskRecord = this.getTaskRecord(taskId)
		const changes: Record<string, any> = {}

		if (options.title && options.title !== taskRecord.title) {
			changes.title = options.title
			taskRecord.title = options.title
		}

		if (options.description !== undefined && options.description !== taskRecord.description) {
			changes.description = options.description
			taskRecord.description = options.description
		}

		if (options.assignedTo && options.assignedTo !== taskRecord.assignedTo) {
			changes.assignedTo = options.assignedTo
			taskRecord.assignedTo = options.assignedTo
		}

		if (options.metadata) {
			changes.metadata = options.metadata
			taskRecord.metadata = { ...taskRecord.metadata, ...options.metadata }
		}

		taskRecord.updatedAt = Date.now()

		// Emit update event if there were changes
		if (Object.keys(changes).length > 0) {
			const event: TaskUpdatedEvent = {
				taskId,
				timestamp: taskRecord.updatedAt,
				actor: options.actor,
				changes,
			}

			this.eventBus.emit(TaskEventNames.TASK_UPDATED, event)

			// Persist to repository
			await this.persistTask(taskRecord)
		}
	}

	/**
	 * Delete a task and all its subtasks
	 */
	async delete(taskId: string, reason?: string, actor?: string): Promise<void> {
		const taskRecord = this.getTaskRecord(taskId)

		// Recursively delete children first
		for (const childId of taskRecord.children) {
			await this.delete(childId, reason, actor)
		}

		// Remove from parent's children if applicable
		if (taskRecord.parentId) {
			const parent = this.tasks.get(taskRecord.parentId)
			if (parent) {
				parent.children = parent.children.filter((id) => id !== taskId)
			}
		}

		this.tasks.delete(taskId)

		// Emit deletion event
		const event: TaskDeletedEvent = {
			taskId,
			timestamp: Date.now(),
			actor,
			reason,
		}

		this.eventBus.emit(TaskEventNames.TASK_DELETED, event)

		// Remove from repository
		await this.removeFromRepository(taskId)
	}

	/**
	 * Start a task (transition to running)
	 */
	async start(taskId: string, actor?: string): Promise<void> {
		await this.transitionStatus(taskId, TaskStatus.Running, "Task started", actor)
	}

	/**
	 * Pause a task
	 */
	async pause(taskId: string, actor?: string): Promise<void> {
		await this.transitionStatus(taskId, TaskStatus.Paused, "Task paused", actor)
	}

	/**
	 * Resume a paused task
	 */
	async resume(taskId: string, actor?: string): Promise<void> {
		await this.transitionStatus(taskId, TaskStatus.Running, "Task resumed", actor)
	}

	/**
	 * Complete a task successfully
	 */
	async complete(taskId: string, actor?: string): Promise<void> {
		await this.transitionStatus(taskId, TaskStatus.Succeeded, "Task completed", actor)
	}

	/**
	 * Mark task as failed
	 */
	async fail(taskId: string, error?: string, actor?: string): Promise<void> {
		await this.transitionStatus(taskId, TaskStatus.Failed, error ?? "Task failed", actor)
	}

	/**
	 * Cancel a task
	 */
	async cancel(taskId: string, reason?: string, actor?: string): Promise<void> {
		await this.transitionStatus(taskId, TaskStatus.Cancelled, reason ?? "Task cancelled", actor)
	}

	/**
	 * Set task progress
	 */
	async setProgress(taskId: string, options: ProgressUpdateOptions): Promise<void> {
		const taskRecord = this.getTaskRecord(taskId)
		const previousProgress = { ...taskRecord.progress }

		taskRecord.progress = {
			percent: Math.max(0, Math.min(100, options.percent)),
			currentStep: options.currentStep,
			totalSteps: options.totalSteps,
			estimatedTimeRemaining: options.estimatedTimeRemaining,
			message: options.message,
		}

		taskRecord.updatedAt = Date.now()

		// Emit progress event
		const event = TaskEventFactory.taskProgressUpdated(taskId, taskRecord.progress, previousProgress, options.actor)

		this.eventBus.emit(TaskEventNames.TASK_PROGRESS_UPDATED, event)

		// Persist progress update to repository
		await this.persistTask(taskRecord)
	}

	/**
	 * Append output to task logs
	 */
	async appendOutput(
		taskId: string,
		output: string,
		outputType: "stdout" | "stderr" | "log" | "error" | "info" | "debug" = "log",
		source?: string,
		actor?: string,
	): Promise<void> {
		const taskRecord = this.getTaskRecord(taskId)

		const logEntry = {
			timestamp: Date.now(),
			output,
			type: outputType,
			source,
		}

		taskRecord.logs.push(logEntry)
		taskRecord.updatedAt = logEntry.timestamp

		// Emit output event
		const event = TaskEventFactory.taskOutputAppended(taskId, output, outputType, source, actor)

		this.eventBus.emit(TaskEventNames.TASK_OUTPUT_APPENDED, event)

		// Persist output to repository
		await this.persistTask(taskRecord)
	}

	/**
	 * Assign task to agent/user
	 */
	async assignAgent(taskId: string, options: TaskAssignmentOptions): Promise<void> {
		const taskRecord = this.getTaskRecord(taskId)
		const previousAssignee = taskRecord.assignedTo

		taskRecord.assignedTo = options.assignedTo
		taskRecord.updatedAt = Date.now()

		// Emit assignment event
		const event: TaskAssignedEvent = {
			taskId,
			timestamp: taskRecord.updatedAt,
			actor: options.actor,
			assignedTo: options.assignedTo,
			assignedBy: options.assignedBy,
			previousAssignee,
			capabilities: options.capabilities,
		}

		this.eventBus.emit(TaskEventNames.TASK_ASSIGNED, event)

		// Persist assignment to repository
		await this.persistTask(taskRecord)
	}

	/**
	 * Add a subtask
	 */
	async addSubtask(parentId: string, subtaskOptions: TaskManagerCreateOptions): Promise<string> {
		const subtaskId = await this.create({
			...subtaskOptions,
			parentId,
		})

		// Emit subtask creation event
		const event = TaskEventFactory.subtaskCreated(parentId, subtaskId, subtaskOptions.title, {
			assignedTo: subtaskOptions.assignedTo,
			actor: subtaskOptions.actor,
		})

		this.eventBus.emit(TaskEventNames.SUBTASK_CREATED, event)

		return subtaskId
	}

	/**
	 * Link parent-child relationship
	 */
	async linkParentChild(parentId: string, childId: string): Promise<void> {
		const parent = this.getTaskRecord(parentId)
		const child = this.getTaskRecord(childId)

		if (!parent.children.includes(childId)) {
			parent.children.push(childId)
		}

		child.parentId = parentId
		child.updatedAt = Date.now()

		// Persist parent-child link changes
		await this.persistTask(parent)
		await this.persistTask(child)
	}

	/**
	 * Calculate aggregated status for parent task based on children
	 */
	async aggregateStatus(parentId: string): Promise<TaskStatus> {
		const parent = this.getTaskRecord(parentId)
		const children = parent.children.map((id) => this.getTaskRecord(id))

		if (children.length === 0) {
			return parent.status
		}

		// Count children by status
		const statusCounts = children.reduce(
			(counts, child) => {
				counts[child.status] = (counts[child.status] || 0) + 1
				return counts
			},
			{} as Record<TaskStatus, number>,
		)

		// Aggregation rules
		if (statusCounts[TaskStatus.Failed] > 0) {
			return TaskStatus.Failed
		}

		if (statusCounts[TaskStatus.Running] > 0) {
			return TaskStatus.Running
		}

		if (statusCounts[TaskStatus.Paused] > 0) {
			return TaskStatus.Paused
		}

		if (statusCounts[TaskStatus.Blocked] > 0) {
			return TaskStatus.Blocked
		}

		const totalChildren = children.length
		const completedChildren = statusCounts[TaskStatus.Succeeded] || 0

		if (completedChildren === totalChildren) {
			return TaskStatus.Succeeded
		}

		// Default to parent's current status if no clear aggregation
		return parent.status
	}

	/**
	 * Find task by ID
	 */
	findById(taskId: string): TaskRecord | undefined {
		return this.tasks.get(taskId)
	}

	/**
	 * List tasks with optional filtering
	 */
	list(options: TaskQueryOptions = {}): TaskRecord[] {
		let results = Array.from(this.tasks.values())

		// Apply filters
		if (options.status) {
			const statuses = Array.isArray(options.status) ? options.status : [options.status]
			results = results.filter((task) => statuses.includes(task.status))
		}

		if (options.parentId !== undefined) {
			results = results.filter((task) => task.parentId === options.parentId)
		}

		if (options.assignedTo) {
			results = results.filter((task) => task.assignedTo === options.assignedTo)
		}

		if (options.createdAfter) {
			results = results.filter((task) => task.createdAt >= options.createdAfter!.getTime())
		}

		if (options.createdBefore) {
			results = results.filter((task) => task.createdAt <= options.createdBefore!.getTime())
		}

		// Sort by creation time (newest first)
		results.sort((a, b) => b.createdAt - a.createdAt)

		// Apply pagination
		if (options.offset) {
			results = results.slice(options.offset)
		}

		if (options.limit) {
			results = results.slice(0, options.limit)
		}

		return results
	}

	/**
	 * List tasks by status
	 */
	listByStatus(status: TaskStatus): TaskRecord[] {
		return this.list({ status })
	}

	/**
	 * List subtasks of a parent
	 */
	listByParent(parentId: string): TaskRecord[] {
		return this.list({ parentId })
	}

	/**
	 * Get task statistics
	 */
	getStats(): {
		total: number
		byStatus: Record<TaskStatus, number>
		byAssignee: Record<string, number>
	} {
		const tasks = Array.from(this.tasks.values())

		const byStatus = tasks.reduce(
			(counts, task) => {
				counts[task.status] = (counts[task.status] || 0) + 1
				return counts
			},
			{} as Record<TaskStatus, number>,
		)

		const byAssignee = tasks.reduce(
			(counts, task) => {
				if (task.assignedTo) {
					counts[task.assignedTo] = (counts[task.assignedTo] || 0) + 1
				}
				return counts
			},
			{} as Record<string, number>,
		)

		return {
			total: tasks.length,
			byStatus,
			byAssignee,
		}
	}

	/**
	 * Associate a VSCode Task instance with a managed task
	 */
	setTaskInstance(taskId: string, task: Task): void {
		const taskRecord = this.getTaskRecord(taskId)
		taskRecord.task = task
	}

	/**
	 * Get associated VSCode Task instance
	 */
	getTaskInstance(taskId: string): Task | undefined {
		const taskRecord = this.tasks.get(taskId)
		return taskRecord?.task
	}

	/**
	 * Private: Transition task status with validation
	 */
	private async transitionStatus(
		taskId: string,
		newStatus: TaskStatus,
		reason?: string,
		actor?: string,
		context?: Record<string, unknown>,
	): Promise<void> {
		const taskRecord = this.getTaskRecord(taskId)
		const previousStatus = taskRecord.status

		// Validate transition
		if (!isValidTransition(previousStatus, newStatus)) {
			throw new InvalidTransitionError(taskId, previousStatus, newStatus)
		}

		// Update status
		taskRecord.status = newStatus
		taskRecord.updatedAt = Date.now()

		// Emit status change event
		const event = TaskEventFactory.taskStatusChanged(taskId, previousStatus, newStatus, { reason, actor, context })

		this.eventBus.emit(TaskEventNames.TASK_STATUS_CHANGED, event)

		// Persist status change to repository
		await this.persistTask(taskRecord)

		// Emit legacy VSCode events for compatibility
		this.emitLegacyStatusEvents(taskId, newStatus)

		// Update parent status if this is a subtask
		if (taskRecord.parentId) {
			await this.updateParentStatus(taskRecord.parentId)
		}
	}

	/**
	 * Private: Update parent task status based on child aggregation
	 */
	private async updateParentStatus(parentId: string): Promise<void> {
		const aggregatedStatus = await this.aggregateStatus(parentId)
		const parentRecord = this.getTaskRecord(parentId)

		if (parentRecord.status !== aggregatedStatus) {
			await this.transitionStatus(parentId, aggregatedStatus, "Status updated from child task changes", "system")
		}
	}

	/**
	 * Private: Emit legacy VSCode-compatible events
	 */
	private emitLegacyStatusEvents(taskId: string, status: TaskStatus): void {
		const baseEvent = { taskId, timestamp: Date.now() }

		switch (status) {
			case TaskStatus.Running:
				this.eventBus.emit(TaskEventNames.TASK_STARTED, baseEvent)
				this.eventBus.emit(TaskEventNames.TASK_ACTIVE, baseEvent)
				break
			case TaskStatus.Interactive:
				this.eventBus.emit(TaskEventNames.TASK_INTERACTIVE, baseEvent)
				break
			case TaskStatus.Resumable:
				this.eventBus.emit(TaskEventNames.TASK_RESUMABLE, baseEvent)
				break
			case TaskStatus.Idle:
				this.eventBus.emit(TaskEventNames.TASK_IDLE, baseEvent)
				break
			case TaskStatus.Paused:
				this.eventBus.emit(TaskEventNames.TASK_PAUSED, baseEvent)
				break
			case TaskStatus.Succeeded:
			case TaskStatus.Failed:
			case TaskStatus.Cancelled:
				this.eventBus.emit(TaskEventNames.TASK_COMPLETED, {
					...baseEvent,
					tokenUsage: {}, // TODO: Get actual usage
					toolUsage: {}, // TODO: Get actual usage
				})
				break
		}
	}

	/**
	 * Private: Get task record with validation
	 */
	private getTaskRecord(taskId: string): TaskRecord {
		const taskRecord = this.tasks.get(taskId)
		if (!taskRecord) {
			throw new TaskNotFoundError(taskId)
		}
		return taskRecord
	}

	/**
	 * Private: Generate unique task ID
	 */
	private generateTaskId(): string {
		return `task_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
	}

	/**
	 * Get all managed tasks for debugging
	 */
	getAllTasks(): Map<string, TaskRecord> {
		return new Map(this.tasks)
	}

	/**
	 * Clear all tasks (useful for testing)
	 */
	clear(): void {
		this.tasks.clear()
	}

	/**
	 * Load tasks from repository on startup
	 */
	async loadFromRepository(): Promise<void> {
		if (!this.repository) {
			return
		}

		try {
			const storedTasks = await this.repository.loadAll()

			for (const storedTask of storedTasks) {
				const taskRecord = this.storedTaskToTaskRecord(storedTask)
				this.tasks.set(taskRecord.id, taskRecord)
			}
		} catch (error) {
			throw new TaskManagerError("Failed to load tasks from repository", undefined)
		}
	}

	/**
	 * Save tasks to repository
	 */
	async saveToRepository(): Promise<void> {
		if (!this.repository) {
			return
		}

		try {
			const tasksToSave = Array.from(this.tasks.values()).map((taskRecord) =>
				this.taskRecordToStoredTask(taskRecord),
			)

			await this.repository.saveMany(tasksToSave)
		} catch (error) {
			throw new TaskManagerError("Failed to save tasks to repository", undefined)
		}
	}

	/**
	 * Save a single task to repository immediately
	 */
	private async persistTask(taskRecord: TaskRecord): Promise<void> {
		if (!this.repository) {
			return
		}

		try {
			const storedTask = this.taskRecordToStoredTask(taskRecord)
			await this.repository.save(storedTask)
		} catch (error) {
			// Log error but don't throw - persistence failures shouldn't break operations
			console.error(`Failed to persist task ${taskRecord.id}:`, error)
		}
	}

	/**
	 * Remove task from repository
	 */
	private async removeFromRepository(taskId: string): Promise<void> {
		if (!this.repository) {
			return
		}

		try {
			await this.repository.remove(taskId)
		} catch (error) {
			// Log error but don't throw
			console.error(`Failed to remove task ${taskId} from repository:`, error)
		}
	}

	/**
	 * Convert StoredTask to TaskRecord
	 */
	private storedTaskToTaskRecord(storedTask: StoredTask): TaskRecord {
		return {
			id: storedTask.id,
			task: undefined, // VSCode Task instance not persisted
			title: storedTask.title,
			description: storedTask.description,
			status: storedTask.status,
			parentId: storedTask.parentId,
			assignedTo: storedTask.assignedTo,
			progress: storedTask.progress,
			metadata: storedTask.metadata,
			createdAt: storedTask.createdAt,
			updatedAt: storedTask.updatedAt,
			children: storedTask.children,
			logs: storedTask.logs,
		}
	}

	/**
	 * Convert TaskRecord to StoredTask
	 */
	private taskRecordToStoredTask(taskRecord: TaskRecord): StoredTask {
		return {
			id: taskRecord.id,
			title: taskRecord.title,
			description: taskRecord.description,
			status: taskRecord.status,
			parentId: taskRecord.parentId,
			assignedTo: taskRecord.assignedTo,
			progress: taskRecord.progress,
			metadata: taskRecord.metadata,
			createdAt: taskRecord.createdAt,
			updatedAt: taskRecord.updatedAt,
			children: taskRecord.children,
			logs: taskRecord.logs,
		}
	}
}
