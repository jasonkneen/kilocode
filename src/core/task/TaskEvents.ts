/**
 * TaskEvents system for CLI and VSCode parity
 *
 * Defines comprehensive typed event system for task lifecycle,
 * progress tracking, delegation, and workflow orchestration.
 */

import { TaskStatus } from "./TaskStatus"

/**
 * Base event payload with common fields
 */
export interface BaseTaskEvent {
	taskId: string
	timestamp: number
	actor?: string // Who triggered the event (user, agent, system)
}

/**
 * Task lifecycle events
 */

export interface TaskCreatedEvent extends BaseTaskEvent {
	title: string
	description?: string
	parentId?: string
	assignedTo?: string
	metadata?: Record<string, unknown>
}

export interface TaskUpdatedEvent extends BaseTaskEvent {
	changes: {
		title?: string
		description?: string
		assignedTo?: string
		metadata?: Record<string, unknown>
	}
}

export interface TaskDeletedEvent extends BaseTaskEvent {
	reason?: string
}

export interface TaskStatusChangedEvent extends BaseTaskEvent {
	previousStatus: TaskStatus
	newStatus: TaskStatus
	reason?: string
	context?: Record<string, unknown>
}

/**
 * Task progress events
 */

export interface TaskProgress {
	percent: number // 0-100
	currentStep?: string
	totalSteps?: number
	estimatedTimeRemaining?: number // milliseconds
	message?: string
}

export interface TaskProgressUpdatedEvent extends BaseTaskEvent {
	progress: TaskProgress
	previousProgress?: TaskProgress
}

export interface TaskOutputAppendedEvent extends BaseTaskEvent {
	output: string
	outputType: "stdout" | "stderr" | "log" | "error" | "info" | "debug"
	source?: string // Which tool/process generated the output
}

/**
 * Task assignment and delegation events
 */

export interface TaskAssignedEvent extends BaseTaskEvent {
	assignedTo: string
	assignedBy?: string
	previousAssignee?: string
	capabilities?: string[]
}

export interface TaskDelegatedEvent extends BaseTaskEvent {
	delegatedTo: string
	delegatedBy: string
	delegationReason?: string
	expectedDuration?: number
	instructions?: string
}

/**
 * Subtask events
 */

export interface SubtaskCreatedEvent extends BaseTaskEvent {
	parentId: string
	subtaskId: string
	title: string
	assignedTo?: string
	order?: number
}

export interface SubtaskUpdatedEvent extends BaseTaskEvent {
	parentId: string
	subtaskId: string
	changes: {
		title?: string
		assignedTo?: string
		order?: number
	}
}

export interface SubtaskStatusChangedEvent extends BaseTaskEvent {
	parentId: string
	subtaskId: string
	previousStatus: TaskStatus
	newStatus: TaskStatus
	parentStatusUpdate?: {
		previousStatus: TaskStatus
		newStatus: TaskStatus
	}
}

/**
 * Workflow events
 */

export interface WorkflowStartedEvent extends BaseTaskEvent {
	workflowId: string
	workflowName: string
	initialState: string
	taskIds: string[]
}

export interface WorkflowTransitionedEvent extends BaseTaskEvent {
	workflowId: string
	previousState: string
	newState: string
	trigger?: string
	conditions?: Record<string, unknown>
}

export interface WorkflowCompletedEvent extends BaseTaskEvent {
	workflowId: string
	finalState: string
	duration: number
	outcome: "success" | "failure" | "cancelled"
	summary?: string
}

export interface WorkflowFailedEvent extends BaseTaskEvent {
	workflowId: string
	failedState: string
	error: string
	retryable?: boolean
}

/**
 * System events
 */

export interface TaskSystemEvent extends BaseTaskEvent {
	eventType: "heartbeat" | "resource_usage" | "performance" | "error"
	data: Record<string, unknown>
}

/**
 * Event name constants matching VSCode TaskEvents
 */
export const TaskEventNames = {
	// Lifecycle
	TASK_CREATED: "task.created",
	TASK_UPDATED: "task.updated",
	TASK_DELETED: "task.deleted",
	TASK_STATUS_CHANGED: "task.status.changed",

	// Progress
	TASK_PROGRESS_UPDATED: "task.progress.updated",
	TASK_OUTPUT_APPENDED: "task.output.appended",

	// Assignment
	TASK_ASSIGNED: "task.assigned",
	TASK_DELEGATED: "task.delegated",

	// Subtasks
	SUBTASK_CREATED: "task.subtask.created",
	SUBTASK_UPDATED: "task.subtask.updated",
	SUBTASK_STATUS_CHANGED: "task.subtask.status.changed",

	// Workflow
	WORKFLOW_STARTED: "workflow.started",
	WORKFLOW_TRANSITIONED: "workflow.transitioned",
	WORKFLOW_COMPLETED: "workflow.completed",
	WORKFLOW_FAILED: "workflow.failed",

	// System
	TASK_SYSTEM: "task.system",

	// Legacy VSCode compatibility events
	TASK_STARTED: "task.started",
	TASK_COMPLETED: "task.completed",
	TASK_ABORTED: "task.aborted",
	TASK_FOCUSED: "task.focused",
	TASK_UNFOCUSED: "task.unfocused",
	TASK_ACTIVE: "task.active",
	TASK_INTERACTIVE: "task.interactive",
	TASK_RESUMABLE: "task.resumable",
	TASK_IDLE: "task.idle",
	TASK_PAUSED: "task.paused",
	TASK_UNPAUSED: "task.unpaused",
	TASK_SPAWNED: "task.spawned",
	TASK_MODE_SWITCHED: "task.mode.switched",
	TASK_ASK_RESPONDED: "task.ask.responded",
	TASK_TOOL_FAILED: "task.tool.failed",
	TASK_TOKEN_USAGE_UPDATED: "task.token.usage.updated",
	MESSAGE: "message",
} as const

/**
 * Union type of all event names
 */
export type TaskEventName = (typeof TaskEventNames)[keyof typeof TaskEventNames]

/**
 * Comprehensive event payload mapping
 */
export interface TaskEventPayloads {
	// Lifecycle
	[TaskEventNames.TASK_CREATED]: TaskCreatedEvent
	[TaskEventNames.TASK_UPDATED]: TaskUpdatedEvent
	[TaskEventNames.TASK_DELETED]: TaskDeletedEvent
	[TaskEventNames.TASK_STATUS_CHANGED]: TaskStatusChangedEvent

	// Progress
	[TaskEventNames.TASK_PROGRESS_UPDATED]: TaskProgressUpdatedEvent
	[TaskEventNames.TASK_OUTPUT_APPENDED]: TaskOutputAppendedEvent

	// Assignment
	[TaskEventNames.TASK_ASSIGNED]: TaskAssignedEvent
	[TaskEventNames.TASK_DELEGATED]: TaskDelegatedEvent

	// Subtasks
	[TaskEventNames.SUBTASK_CREATED]: SubtaskCreatedEvent
	[TaskEventNames.SUBTASK_UPDATED]: SubtaskUpdatedEvent
	[TaskEventNames.SUBTASK_STATUS_CHANGED]: SubtaskStatusChangedEvent

	// Workflow
	[TaskEventNames.WORKFLOW_STARTED]: WorkflowStartedEvent
	[TaskEventNames.WORKFLOW_TRANSITIONED]: WorkflowTransitionedEvent
	[TaskEventNames.WORKFLOW_COMPLETED]: WorkflowCompletedEvent
	[TaskEventNames.WORKFLOW_FAILED]: WorkflowFailedEvent

	// System
	[TaskEventNames.TASK_SYSTEM]: TaskSystemEvent

	// Legacy VSCode compatibility events (minimal payloads for now)
	[TaskEventNames.TASK_STARTED]: BaseTaskEvent
	[TaskEventNames.TASK_COMPLETED]: BaseTaskEvent & { tokenUsage?: any; toolUsage?: any }
	[TaskEventNames.TASK_ABORTED]: BaseTaskEvent
	[TaskEventNames.TASK_FOCUSED]: BaseTaskEvent
	[TaskEventNames.TASK_UNFOCUSED]: BaseTaskEvent
	[TaskEventNames.TASK_ACTIVE]: BaseTaskEvent
	[TaskEventNames.TASK_INTERACTIVE]: BaseTaskEvent
	[TaskEventNames.TASK_RESUMABLE]: BaseTaskEvent
	[TaskEventNames.TASK_IDLE]: BaseTaskEvent
	[TaskEventNames.TASK_PAUSED]: BaseTaskEvent
	[TaskEventNames.TASK_UNPAUSED]: BaseTaskEvent
	[TaskEventNames.TASK_SPAWNED]: BaseTaskEvent & { spawnedTaskId: string }
	[TaskEventNames.TASK_MODE_SWITCHED]: BaseTaskEvent & { mode: string }
	[TaskEventNames.TASK_ASK_RESPONDED]: BaseTaskEvent
	[TaskEventNames.TASK_TOOL_FAILED]: BaseTaskEvent & { tool: string; error: string }
	[TaskEventNames.TASK_TOKEN_USAGE_UPDATED]: BaseTaskEvent & { tokenUsage: any }
	[TaskEventNames.MESSAGE]: BaseTaskEvent & { action: "created" | "updated"; message: any }
}

/**
 * Helper type to extract event payload for a given event name
 */
export type TaskEventPayload<T extends TaskEventName> = TaskEventPayloads[T]

/**
 * Event listener function type
 */
export type TaskEventListener<T extends TaskEventName> = (payload: TaskEventPayload<T>) => void | Promise<void>

/**
 * Event subscription interface
 */
export interface EventSubscription {
	unsubscribe(): void
}

/**
 * Utility functions for event creation
 */
export class TaskEventFactory {
	static createBaseEvent(taskId: string, actor?: string): BaseTaskEvent {
		return {
			taskId,
			timestamp: Date.now(),
			actor,
		}
	}

	static taskCreated(taskId: string, title: string, options: Partial<TaskCreatedEvent> = {}): TaskCreatedEvent {
		return {
			...this.createBaseEvent(taskId, options.actor),
			title,
			description: options.description,
			parentId: options.parentId,
			assignedTo: options.assignedTo,
			metadata: options.metadata,
		}
	}

	static taskStatusChanged(
		taskId: string,
		previousStatus: TaskStatus,
		newStatus: TaskStatus,
		options: Partial<TaskStatusChangedEvent> = {},
	): TaskStatusChangedEvent {
		return {
			...this.createBaseEvent(taskId, options.actor),
			previousStatus,
			newStatus,
			reason: options.reason,
			context: options.context,
		}
	}

	static taskProgressUpdated(
		taskId: string,
		progress: TaskProgress,
		previousProgress?: TaskProgress,
		actor?: string,
	): TaskProgressUpdatedEvent {
		return {
			...this.createBaseEvent(taskId, actor),
			progress,
			previousProgress,
		}
	}

	static taskOutputAppended(
		taskId: string,
		output: string,
		outputType: TaskOutputAppendedEvent["outputType"],
		source?: string,
		actor?: string,
	): TaskOutputAppendedEvent {
		return {
			...this.createBaseEvent(taskId, actor),
			output,
			outputType,
			source,
		}
	}

	static subtaskCreated(
		parentId: string,
		subtaskId: string,
		title: string,
		options: Partial<SubtaskCreatedEvent> = {},
	): SubtaskCreatedEvent {
		return {
			...this.createBaseEvent(parentId, options.actor),
			parentId,
			subtaskId,
			title,
			assignedTo: options.assignedTo,
			order: options.order,
		}
	}
}

/**
 * Event filtering and querying utilities
 */
export class TaskEventFilters {
	static byTaskId(taskId: string) {
		return (event: BaseTaskEvent) => event.taskId === taskId
	}

	static byEventType<T extends TaskEventName>(eventName: T) {
		return (event: any): event is TaskEventPayload<T> => true // Runtime type checking would go here
	}

	static byTimeRange(startTime: number, endTime: number) {
		return (event: BaseTaskEvent) => event.timestamp >= startTime && event.timestamp <= endTime
	}

	static byActor(actor: string) {
		return (event: BaseTaskEvent) => event.actor === actor
	}
}

/**
 * Event aggregation utilities
 */
export class TaskEventAggregators {
	static countByType(events: BaseTaskEvent[]): Record<string, number> {
		const counts: Record<string, number> = {}
		events.forEach((event) => {
			// In practice, you'd need to track the event type
			const type = "unknown" // This would be filled in with actual event type
			counts[type] = (counts[type] || 0) + 1
		})
		return counts
	}

	static groupByTimeWindow(events: BaseTaskEvent[], windowMs: number): BaseTaskEvent[][] {
		const groups: BaseTaskEvent[][] = []
		const sortedEvents = [...events].sort((a, b) => a.timestamp - b.timestamp)

		let currentGroup: BaseTaskEvent[] = []
		let groupStartTime = 0

		for (const event of sortedEvents) {
			if (currentGroup.length === 0) {
				groupStartTime = event.timestamp
				currentGroup = [event]
			} else if (event.timestamp - groupStartTime <= windowMs) {
				currentGroup.push(event)
			} else {
				groups.push(currentGroup)
				groupStartTime = event.timestamp
				currentGroup = [event]
			}
		}

		if (currentGroup.length > 0) {
			groups.push(currentGroup)
		}

		return groups
	}
}
