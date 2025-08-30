/**
 * Enhanced TaskStatus enum for CLI and VSCode parity
 *
 * Extends the existing TaskStatus from packages/types/src/task.ts
 * with additional statuses needed for comprehensive task management.
 */

/**
 * Comprehensive task status enumeration
 */
export enum TaskStatus {
	// Existing statuses from VSCode implementation
	Running = "running",
	Interactive = "interactive",
	Resumable = "resumable",
	Idle = "idle",
	None = "none",

	// Additional statuses for full lifecycle support
	Pending = "pending", // Task created but not started
	Ready = "ready", // Task ready to be started
	Paused = "paused", // Task paused by user/system
	Blocked = "blocked", // Task blocked waiting for dependency
	Succeeded = "succeeded", // Task completed successfully
	Failed = "failed", // Task failed with error
	Cancelled = "cancelled", // Task cancelled by user

	// Workflow-specific statuses
	Delegated = "delegated", // Task assigned to another agent
	Queued = "queued", // Task queued for execution
}

/**
 * Task status transition matrix
 * Defines valid state transitions to prevent invalid operations
 */
export const TASK_STATUS_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
	[TaskStatus.None]: [TaskStatus.Pending],
	[TaskStatus.Pending]: [TaskStatus.Ready, TaskStatus.Cancelled, TaskStatus.Blocked],
	[TaskStatus.Ready]: [TaskStatus.Running, TaskStatus.Queued, TaskStatus.Delegated, TaskStatus.Cancelled],
	[TaskStatus.Queued]: [TaskStatus.Running, TaskStatus.Cancelled],
	[TaskStatus.Running]: [
		TaskStatus.Paused,
		TaskStatus.Interactive,
		TaskStatus.Resumable,
		TaskStatus.Idle,
		TaskStatus.Succeeded,
		TaskStatus.Failed,
		TaskStatus.Cancelled,
		TaskStatus.Blocked,
	],
	[TaskStatus.Paused]: [TaskStatus.Running, TaskStatus.Cancelled],
	[TaskStatus.Interactive]: [TaskStatus.Running, TaskStatus.Paused, TaskStatus.Cancelled],
	[TaskStatus.Resumable]: [TaskStatus.Running, TaskStatus.Cancelled],
	[TaskStatus.Idle]: [TaskStatus.Running, TaskStatus.Succeeded, TaskStatus.Cancelled],
	[TaskStatus.Blocked]: [TaskStatus.Ready, TaskStatus.Running, TaskStatus.Cancelled],
	[TaskStatus.Delegated]: [TaskStatus.Running, TaskStatus.Cancelled, TaskStatus.Failed],
	[TaskStatus.Succeeded]: [], // Terminal state
	[TaskStatus.Failed]: [TaskStatus.Ready, TaskStatus.Running], // Can retry
	[TaskStatus.Cancelled]: [], // Terminal state
}

/**
 * Check if a status transition is valid
 */
export function isValidTransition(from: TaskStatus, to: TaskStatus): boolean {
	return TASK_STATUS_TRANSITIONS[from]?.includes(to) ?? false
}

/**
 * Get all valid next states for a given status
 */
export function getValidNextStates(status: TaskStatus): TaskStatus[] {
	return TASK_STATUS_TRANSITIONS[status] ?? []
}

/**
 * Check if a status is terminal (no further transitions possible)
 */
export function isTerminalStatus(status: TaskStatus): boolean {
	return TASK_STATUS_TRANSITIONS[status]?.length === 0
}

/**
 * Check if a status indicates the task is actively running
 */
export function isActiveStatus(status: TaskStatus): boolean {
	return [TaskStatus.Running, TaskStatus.Interactive, TaskStatus.Resumable, TaskStatus.Idle].includes(status)
}

/**
 * Check if a status indicates the task has completed (successfully or not)
 */
export function isCompletedStatus(status: TaskStatus): boolean {
	return [TaskStatus.Succeeded, TaskStatus.Failed, TaskStatus.Cancelled].includes(status)
}

/**
 * Status categories for grouping and filtering
 */
export enum TaskStatusCategory {
	Pending = "pending", // Not yet started
	Active = "active", // Currently executing
	Waiting = "waiting", // Paused or blocked
	Completed = "completed", // Finished (any outcome)
}

/**
 * Map status to category
 */
export function getStatusCategory(status: TaskStatus): TaskStatusCategory {
	switch (status) {
		case TaskStatus.None:
		case TaskStatus.Pending:
		case TaskStatus.Ready:
		case TaskStatus.Queued:
			return TaskStatusCategory.Pending

		case TaskStatus.Running:
		case TaskStatus.Interactive:
		case TaskStatus.Resumable:
		case TaskStatus.Idle:
		case TaskStatus.Delegated:
			return TaskStatusCategory.Active

		case TaskStatus.Paused:
		case TaskStatus.Blocked:
			return TaskStatusCategory.Waiting

		case TaskStatus.Succeeded:
		case TaskStatus.Failed:
		case TaskStatus.Cancelled:
			return TaskStatusCategory.Completed

		default:
			return TaskStatusCategory.Pending
	}
}

/**
 * Status display information for UI rendering
 */
export interface TaskStatusDisplay {
	label: string
	color: string
	icon: string
	description: string
}

/**
 * Status display mapping for consistent UI representation
 */
export const TASK_STATUS_DISPLAY: Record<TaskStatus, TaskStatusDisplay> = {
	[TaskStatus.None]: {
		label: "None",
		color: "gray",
		icon: "○",
		description: "Task not initialized",
	},
	[TaskStatus.Pending]: {
		label: "Pending",
		color: "yellow",
		icon: "⏳",
		description: "Task created, waiting to start",
	},
	[TaskStatus.Ready]: {
		label: "Ready",
		color: "blue",
		icon: "▶",
		description: "Task ready to execute",
	},
	[TaskStatus.Queued]: {
		label: "Queued",
		color: "cyan",
		icon: "⏸",
		description: "Task queued for execution",
	},
	[TaskStatus.Running]: {
		label: "Running",
		color: "green",
		icon: "▶",
		description: "Task actively executing",
	},
	[TaskStatus.Paused]: {
		label: "Paused",
		color: "orange",
		icon: "⏸",
		description: "Task paused by user",
	},
	[TaskStatus.Interactive]: {
		label: "Interactive",
		color: "magenta",
		icon: "❓",
		description: "Task waiting for user input",
	},
	[TaskStatus.Resumable]: {
		label: "Resumable",
		color: "cyan",
		icon: "↩",
		description: "Task can be resumed",
	},
	[TaskStatus.Idle]: {
		label: "Idle",
		color: "gray",
		icon: "⏸",
		description: "Task idle, no activity",
	},
	[TaskStatus.Blocked]: {
		label: "Blocked",
		color: "red",
		icon: "⛔",
		description: "Task blocked by dependency",
	},
	[TaskStatus.Delegated]: {
		label: "Delegated",
		color: "purple",
		icon: "↗",
		description: "Task delegated to agent",
	},
	[TaskStatus.Succeeded]: {
		label: "Succeeded",
		color: "green",
		icon: "✅",
		description: "Task completed successfully",
	},
	[TaskStatus.Failed]: {
		label: "Failed",
		color: "red",
		icon: "❌",
		description: "Task failed with error",
	},
	[TaskStatus.Cancelled]: {
		label: "Cancelled",
		color: "gray",
		icon: "⏹",
		description: "Task cancelled by user",
	},
}
