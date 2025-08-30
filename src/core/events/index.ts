/**
 * EventBus module - Centralized event system
 *
 * Provides singleton EventBus instance and utilities for
 * application-wide event communication.
 */

import { EventBus, EventBusFactory, EventBusOptions } from "./EventBus"

/**
 * Global singleton EventBus instance
 *
 * This instance is shared across the application to ensure
 * consistent event communication. The instance is configured
 * based on the NODE_ENV environment variable:
 *
 * - development: Debug mode enabled with metrics
 * - test: Strict error handling, fail fast
 * - production: Optimized for performance
 */
let globalEventBus: EventBus | undefined

/**
 * Get the global EventBus instance
 * Creates one if it doesn't exist, using environment-appropriate configuration
 */
export function getEventBus(): EventBus {
	if (!globalEventBus) {
		const env = process.env.NODE_ENV || "development"

		switch (env) {
			case "test":
				globalEventBus = EventBusFactory.testing()
				break
			case "production":
				globalEventBus = EventBusFactory.production()
				break
			case "development":
			default:
				globalEventBus = EventBusFactory.development()
				break
		}
	}

	return globalEventBus
}

/**
 * Reset the global EventBus instance
 * Useful for testing or when configuration needs to change
 */
export function resetEventBus(options?: EventBusOptions): void {
	if (globalEventBus) {
		globalEventBus.destroy()
	}

	if (options) {
		globalEventBus = new EventBus(options)
	} else {
		globalEventBus = undefined
	}
}

/**
 * Destroy the global EventBus instance and cleanup resources
 */
export function destroyEventBus(): void {
	if (globalEventBus) {
		globalEventBus.destroy()
		globalEventBus = undefined
	}
}

/**
 * Convenience singleton instance
 * Direct access to the global event bus for easy importing
 */
export const eventBus = {
	get instance() {
		return getEventBus()
	},

	// Delegate common methods for convenience
	subscribe: <T extends import("../task/TaskEvents").TaskEventName>(
		eventName: T,
		listener: import("../task/TaskEvents").TaskEventListener<T>,
		options?: { once?: boolean; id?: string },
	) => getEventBus().subscribe(eventName, listener, options),

	once: <T extends import("../task/TaskEvents").TaskEventName>(
		eventName: T,
		listener: import("../task/TaskEvents").TaskEventListener<T>,
		options?: { id?: string },
	) => getEventBus().once(eventName, listener, options),

	emit: <T extends import("../task/TaskEvents").TaskEventName>(
		eventName: T,
		payload: import("../task/TaskEvents").TaskEventPayload<T>,
	) => getEventBus().emit(eventName, payload),

	waitFor: <T extends import("../task/TaskEvents").TaskEventName>(
		eventName: T,
		timeout?: number,
		condition?: (payload: import("../task/TaskEvents").TaskEventPayload<T>) => boolean,
	) => getEventBus().waitFor(eventName, timeout, condition),

	getStats: () => getEventBus().getStats(),

	removeAllListeners: (eventName?: import("../task/TaskEvents").TaskEventName) =>
		getEventBus().removeAllListeners(eventName),
}

// Re-export types and classes for convenience
export { EventBus, EventBusFactory } from "./EventBus"
export type { EventBusOptions, ListenerMetadata, EventBusError, ListenerError } from "./EventBus"

export type { TaskEventName, TaskEventPayload, TaskEventListener, EventSubscription } from "../task/TaskEvents"

/**
 * EventBus lifecycle management for applications
 */
export class EventBusManager {
	private static instance: EventBusManager
	private eventBus: EventBus
	private subscriptions: Set<import("../task/TaskEvents").EventSubscription> = new Set()

	private constructor(options?: EventBusOptions) {
		this.eventBus = new EventBus(options)
	}

	static getInstance(options?: EventBusOptions): EventBusManager {
		if (!EventBusManager.instance) {
			EventBusManager.instance = new EventBusManager(options)
		}
		return EventBusManager.instance
	}

	getEventBus(): EventBus {
		return this.eventBus
	}

	/**
	 * Subscribe and track the subscription for cleanup
	 */
	subscribe<T extends import("../task/TaskEvents").TaskEventName>(
		eventName: T,
		listener: import("../task/TaskEvents").TaskEventListener<T>,
		options?: { once?: boolean; id?: string },
	): import("../task/TaskEvents").EventSubscription {
		const subscription = this.eventBus.subscribe(eventName, listener, options)
		this.subscriptions.add(subscription)

		// Return wrapped subscription that also removes from tracking
		return {
			unsubscribe: () => {
				subscription.unsubscribe()
				this.subscriptions.delete(subscription)
			},
		}
	}

	/**
	 * Cleanup all managed subscriptions
	 */
	cleanup(): void {
		for (const subscription of this.subscriptions) {
			subscription.unsubscribe()
		}
		this.subscriptions.clear()
	}

	/**
	 * Destroy the manager and cleanup resources
	 */
	destroy(): void {
		this.cleanup()
		this.eventBus.destroy()
		EventBusManager.instance = undefined as any
	}
}

/**
 * Process cleanup handler to ensure EventBus is properly destroyed
 */
if (typeof process !== "undefined") {
	const cleanup = () => {
		destroyEventBus()
	}

	process.on("exit", cleanup)
	process.on("SIGINT", cleanup)
	process.on("SIGTERM", cleanup)
	process.on("uncaughtException", (error) => {
		console.error("Uncaught exception:", error)
		cleanup()
		process.exit(1)
	})
}
