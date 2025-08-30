/**
 * EventBus - Core event-driven messaging system
 *
 * Provides a clean abstraction over Node.js EventEmitter for
 * application-wide event communication without GUI dependencies.
 */

import { EventEmitter } from "events"
import { TaskEventName, TaskEventPayload, TaskEventListener, EventSubscription } from "../task/TaskEvents"

/**
 * EventBus error types
 */
export class EventBusError extends Error {
	constructor(
		message: string,
		public override readonly cause?: unknown,
	) {
		super(message)
		this.name = "EventBusError"
	}
}

export class ListenerError extends EventBusError {
	constructor(eventName: string, listenerId: string, cause: Error) {
		super(`Error in listener ${listenerId} for event ${eventName}: ${cause.message}`, cause)
		this.name = "ListenerError"
	}
}

/**
 * Listener metadata for debugging and management
 */
export interface ListenerMetadata {
	id: string
	eventName: string
	addedAt: number
	callCount: number
	lastCalledAt?: number
	errorCount: number
	lastError?: Error
}

/**
 * EventBus configuration options
 */
export interface EventBusOptions {
	maxListeners?: number
	captureRejections?: boolean
	enableMetrics?: boolean
	errorHandler?: (error: ListenerError) => void
	debugMode?: boolean
}

/**
 * EventBus implementation
 *
 * Wraps Node.js EventEmitter with type safety and additional features:
 * - Type-safe event emission and subscription
 * - Listener lifecycle management
 * - Error handling and metrics
 * - Memory leak prevention
 * - Debug utilities
 */
export class EventBus {
	private readonly emitter: EventEmitter
	private readonly listeners: Map<string, ListenerMetadata> = new Map()
	private readonly options: EventBusOptions
	private listenerIdCounter = 0

	constructor(options: EventBusOptions = {}) {
		this.options = {
			maxListeners: options.maxListeners ?? 50,
			captureRejections: options.captureRejections ?? true,
			enableMetrics: options.enableMetrics ?? true,
			debugMode: options.debugMode ?? false,
			...options,
		}

		this.emitter = new EventEmitter({
			captureRejections: this.options.captureRejections,
		})

		this.emitter.setMaxListeners(this.options.maxListeners!)

		// Handle listener errors
		if (this.options.captureRejections) {
			this.emitter.on("[rejected]", (error: Error, eventName: string) => {
				const listenerError = new ListenerError(eventName, "unknown", error)
				this.handleListenerError(listenerError)
			})
		}

		// Debug mode logging
		if (this.options.debugMode) {
			this.emitter.on("newListener", (eventName, listener) => {
				console.debug(`[EventBus] New listener added for event: ${eventName}`)
			})

			this.emitter.on("removeListener", (eventName, listener) => {
				console.debug(`[EventBus] Listener removed for event: ${eventName}`)
			})
		}
	}

	/**
	 * Subscribe to an event with type safety
	 */
	subscribe<T extends TaskEventName>(
		eventName: T,
		listener: TaskEventListener<T>,
		options: { once?: boolean; id?: string } = {},
	): EventSubscription {
		const listenerId = options.id ?? this.generateListenerId()
		const metadata: ListenerMetadata = {
			id: listenerId,
			eventName,
			addedAt: Date.now(),
			callCount: 0,
			errorCount: 0,
		}

		// Wrap listener with error handling and metrics
		const wrappedListener = async (payload: TaskEventPayload<T>) => {
			if (this.options.enableMetrics) {
				metadata.callCount++
				metadata.lastCalledAt = Date.now()
			}

			try {
				await listener(payload)
			} catch (error) {
				if (this.options.enableMetrics) {
					metadata.errorCount++
					metadata.lastError = error as Error
				}

				const listenerError = new ListenerError(eventName, listenerId, error as Error)
				this.handleListenerError(listenerError)
			}
		}

		// Store metadata if metrics enabled
		if (this.options.enableMetrics) {
			this.listeners.set(listenerId, metadata)
		}

		// Add listener to emitter
		if (options.once) {
			this.emitter.once(eventName, wrappedListener)
		} else {
			this.emitter.on(eventName, wrappedListener)
		}

		// Return subscription interface
		return {
			unsubscribe: () => {
				this.emitter.removeListener(eventName, wrappedListener)
				this.listeners.delete(listenerId)

				if (this.options.debugMode) {
					console.debug(`[EventBus] Unsubscribed listener ${listenerId} from ${eventName}`)
				}
			},
		}
	}

	/**
	 * Subscribe to an event once (auto-unsubscribe after first emission)
	 */
	once<T extends TaskEventName>(
		eventName: T,
		listener: TaskEventListener<T>,
		options: { id?: string } = {},
	): EventSubscription {
		return this.subscribe(eventName, listener, { ...options, once: true })
	}

	/**
	 * Emit an event with type safety
	 */
	emit<T extends TaskEventName>(eventName: T, payload: TaskEventPayload<T>): boolean {
		if (this.options.debugMode) {
			console.debug(`[EventBus] Emitting event: ${eventName}`, payload)
		}

		return this.emitter.emit(eventName, payload)
	}

	/**
	 * Remove all listeners for a specific event
	 */
	removeAllListeners(eventName?: TaskEventName): void {
		if (eventName) {
			// Remove specific event listeners from metadata
			if (this.options.enableMetrics) {
				for (const [listenerId, metadata] of this.listeners.entries()) {
					if (metadata.eventName === eventName) {
						this.listeners.delete(listenerId)
					}
				}
			}

			this.emitter.removeAllListeners(eventName)
		} else {
			// Remove all listeners
			this.listeners.clear()
			this.emitter.removeAllListeners()
		}
	}

	/**
	 * Get listener count for an event
	 */
	getListenerCount(eventName: TaskEventName): number {
		return this.emitter.listenerCount(eventName)
	}

	/**
	 * Get all event names that have listeners
	 */
	getEventNames(): string[] {
		return this.emitter.eventNames() as string[]
	}

	/**
	 * Get listener metadata for debugging
	 */
	getListenerMetadata(): ListenerMetadata[] {
		return Array.from(this.listeners.values())
	}

	/**
	 * Get statistics about the event bus
	 */
	getStats(): {
		totalListeners: number
		totalEvents: number
		eventStats: Record<string, { listenerCount: number; totalCalls: number; errorCount: number }>
	} {
		const stats = {
			totalListeners: this.listeners.size,
			totalEvents: this.getEventNames().length,
			eventStats: {} as Record<string, { listenerCount: number; totalCalls: number; errorCount: number }>,
		}

		// Aggregate stats by event type
		for (const metadata of this.listeners.values()) {
			const eventName = metadata.eventName
			if (!stats.eventStats[eventName]) {
				stats.eventStats[eventName] = {
					listenerCount: 0,
					totalCalls: 0,
					errorCount: 0,
				}
			}

			stats.eventStats[eventName].listenerCount++
			stats.eventStats[eventName].totalCalls += metadata.callCount
			stats.eventStats[eventName].errorCount += metadata.errorCount
		}

		return stats
	}

	/**
	 * Wait for a specific event to be emitted
	 */
	waitFor<T extends TaskEventName>(
		eventName: T,
		timeout?: number,
		condition?: (payload: TaskEventPayload<T>) => boolean,
	): Promise<TaskEventPayload<T>> {
		return new Promise((resolve, reject) => {
			let subscription: EventSubscription
			let timeoutId: NodeJS.Timeout | undefined

			const cleanup = () => {
				subscription?.unsubscribe()
				if (timeoutId) {
					clearTimeout(timeoutId)
				}
			}

			subscription = this.subscribe(eventName, (payload) => {
				if (!condition || condition(payload)) {
					cleanup()
					resolve(payload)
				}
			})

			if (timeout) {
				timeoutId = setTimeout(() => {
					cleanup()
					reject(new Error(`Timeout waiting for event ${eventName} after ${timeout}ms`))
				}, timeout)
			}
		})
	}

	/**
	 * Destroy the event bus and cleanup resources
	 */
	destroy(): void {
		this.removeAllListeners()
		this.emitter.removeAllListeners()

		if (this.options.debugMode) {
			console.debug("[EventBus] Event bus destroyed")
		}
	}

	/**
	 * Generate unique listener ID
	 */
	private generateListenerId(): string {
		return `listener_${++this.listenerIdCounter}_${Date.now()}`
	}

	/**
	 * Handle listener errors
	 */
	private handleListenerError(error: ListenerError): void {
		if (this.options.errorHandler) {
			try {
				this.options.errorHandler(error)
			} catch (handlerError) {
				console.error("[EventBus] Error handler failed:", handlerError)
				console.error("[EventBus] Original error:", error)
			}
		} else {
			console.error("[EventBus] Unhandled listener error:", error)
		}
	}
}

/**
 * EventBus factory with common configurations
 */
export class EventBusFactory {
	/**
	 * Create a development event bus with debugging enabled
	 */
	static development(options: Partial<EventBusOptions> = {}): EventBus {
		return new EventBus({
			debugMode: true,
			enableMetrics: true,
			captureRejections: true,
			...options,
		})
	}

	/**
	 * Create a production event bus with optimized settings
	 */
	static production(options: Partial<EventBusOptions> = {}): EventBus {
		return new EventBus({
			debugMode: false,
			enableMetrics: false,
			captureRejections: true,
			maxListeners: 100,
			...options,
		})
	}

	/**
	 * Create a testing event bus with strict error handling
	 */
	static testing(options: Partial<EventBusOptions> = {}): EventBus {
		return new EventBus({
			debugMode: true,
			enableMetrics: true,
			captureRejections: true,
			maxListeners: 10,
			errorHandler: (error) => {
				throw error // Fail fast in tests
			},
			...options,
		})
	}
}
