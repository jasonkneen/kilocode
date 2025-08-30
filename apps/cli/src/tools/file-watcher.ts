import fs from "node:fs/promises"
import { watch, FSWatcher } from "node:fs"
import path from "node:path"
import { EventEmitter } from "node:events"

export interface WatchOptions {
	recursive?: boolean // Default: true
	ignored_patterns?: string[] // Glob patterns to ignore
	debounce_ms?: number // Default: 100ms
	include_patterns?: string[] // Only watch files matching these patterns
	max_files?: number // Maximum number of files to watch (default: 10000)
	poll_interval?: number // Polling interval for fallback (default: 1000ms)
	watch_directories?: boolean // Watch directory changes (default: true)
	watch_files?: boolean // Watch file changes (default: true)
}

export interface WatchEvent {
	type: "added" | "changed" | "removed" | "renamed"
	path: string
	stats?: {
		size: number
		mtime: Date
		isDirectory: boolean
		isFile: boolean
	}
	timestamp: Date
}

export interface WatcherStats {
	files_watched: number
	directories_watched: number
	events_processed: number
	uptime_ms: number
	last_event?: WatchEvent
	ignored_count: number
}

export class AdvancedFileWatcher extends EventEmitter {
	private watchers: Map<string, FSWatcher> = new Map()
	private watchedPaths: Set<string> = new Set()
	private options: Required<WatchOptions>
	private stats: WatcherStats
	private startTime: number
	private debounceTimers: Map<string, NodeJS.Timeout> = new Map()
	private ignoredPatterns: RegExp[]
	private includePatterns: RegExp[]

	constructor(options: WatchOptions = {}) {
		super()

		this.options = {
			recursive: true,
			ignored_patterns: [
				"node_modules/**",
				".git/**",
				"**/.DS_Store",
				"**/Thumbs.db",
				"**/*.tmp",
				"**/*.temp",
				"dist/**",
				"build/**",
				"out/**",
				...(options.ignored_patterns || []),
			],
			debounce_ms: 100,
			include_patterns: options.include_patterns || ["**/*"],
			max_files: 10000,
			poll_interval: 1000,
			watch_directories: true,
			watch_files: true,
			...options,
		}

		this.stats = {
			files_watched: 0,
			directories_watched: 0,
			events_processed: 0,
			uptime_ms: 0,
			ignored_count: 0,
		}

		this.startTime = Date.now()

		// Compile patterns to regex
		this.ignoredPatterns = this.options.ignored_patterns.map(
			(pattern) => new RegExp(pattern.replace(/\*\*/g, ".*").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]")),
		)

		this.includePatterns = this.options.include_patterns.map(
			(pattern) => new RegExp(pattern.replace(/\*\*/g, ".*").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]")),
		)
	}

	private shouldIgnorePath(filePath: string): boolean {
		const relativePath = path.relative(process.cwd(), filePath)

		// Check ignore patterns
		for (const pattern of this.ignoredPatterns) {
			if (pattern.test(relativePath) || pattern.test(filePath)) {
				return true
			}
		}

		// Check include patterns
		if (this.includePatterns.length > 0) {
			let shouldInclude = false
			for (const pattern of this.includePatterns) {
				if (pattern.test(relativePath) || pattern.test(filePath)) {
					shouldInclude = true
					break
				}
			}
			if (!shouldInclude) return true
		}

		return false
	}

	private async handleFileSystemEvent(eventType: string, filename: string, watchedPath: string) {
		if (!filename) return

		const fullPath = path.join(watchedPath, filename)

		if (this.shouldIgnorePath(fullPath)) {
			this.stats.ignored_count++
			return
		}

		// Debounce rapid events
		const debounceKey = `${eventType}:${fullPath}`
		const existingTimer = this.debounceTimers.get(debounceKey)
		if (existingTimer) {
			clearTimeout(existingTimer)
		}

		const timer = setTimeout(async () => {
			this.debounceTimers.delete(debounceKey)
			await this.processEvent(eventType, fullPath)
		}, this.options.debounce_ms)

		this.debounceTimers.set(debounceKey, timer)
	}

	private async processEvent(eventType: string, fullPath: string) {
		try {
			let stats
			let type: WatchEvent["type"] = "changed"

			try {
				const fileStats = await fs.stat(fullPath)
				stats = {
					size: fileStats.size,
					mtime: fileStats.mtime,
					isDirectory: fileStats.isDirectory(),
					isFile: fileStats.isFile(),
				}

				// Determine event type based on whether we were already watching this path
				if (!this.watchedPaths.has(fullPath)) {
					type = "added"
					this.watchedPaths.add(fullPath)

					if (stats.isDirectory) {
						this.stats.directories_watched++
					} else {
						this.stats.files_watched++
					}
				}
			} catch (error: any) {
				// File was removed or is inaccessible
				if (error.code === "ENOENT") {
					type = "removed"
					this.watchedPaths.delete(fullPath)
				} else {
					// Other errors, treat as changed
					type = "changed"
				}
			}

			// Check file count limit
			if (this.stats.files_watched + this.stats.directories_watched > this.options.max_files) {
				this.emit("error", new Error(`Maximum file limit (${this.options.max_files}) exceeded`))
				return
			}

			const event: WatchEvent = {
				type,
				path: fullPath,
				stats,
				timestamp: new Date(),
			}

			this.stats.events_processed++
			this.stats.last_event = event
			this.stats.uptime_ms = Date.now() - this.startTime

			this.emit("change", event)
			this.emit(type, event) // Emit specific event type as well
		} catch (error: any) {
			this.emit("error", error)
		}
	}

	async watch(targetPath: string): Promise<void> {
		const resolvedPath = path.resolve(targetPath)

		try {
			const stats = await fs.stat(resolvedPath)

			if (!stats.isDirectory()) {
				throw new Error(`Path must be a directory: ${targetPath}`)
			}

			// Create watcher
			const watcher = watch(
				resolvedPath,
				{
					recursive: this.options.recursive,
					persistent: true,
				},
				(eventType, filename) => this.handleFileSystemEvent(eventType, filename || "", resolvedPath),
			)

			watcher.on("error", (error) => {
				this.emit("error", error)
			})

			this.watchers.set(resolvedPath, watcher)

			// Initial scan to populate watched paths
			await this.initialScan(resolvedPath)

			this.emit("ready", { path: resolvedPath, stats: this.stats })
		} catch (error: any) {
			throw new Error(`Failed to watch ${targetPath}: ${error.message}`)
		}
	}

	private async initialScan(dirPath: string) {
		try {
			const entries = await fs.readdir(dirPath, { withFileTypes: true })

			for (const entry of entries) {
				const fullPath = path.join(dirPath, entry.name)

				if (this.shouldIgnorePath(fullPath)) {
					continue
				}

				this.watchedPaths.add(fullPath)

				if (entry.isDirectory()) {
					this.stats.directories_watched++
					if (this.options.recursive) {
						await this.initialScan(fullPath)
					}
				} else {
					this.stats.files_watched++
				}
			}
		} catch (error: any) {
			// Ignore permission errors during initial scan
			if (error.code !== "EACCES" && error.code !== "EPERM") {
				throw error
			}
		}
	}

	async unwatch(targetPath?: string): Promise<void> {
		if (targetPath) {
			const resolvedPath = path.resolve(targetPath)
			const watcher = this.watchers.get(resolvedPath)
			if (watcher) {
				watcher.close()
				this.watchers.delete(resolvedPath)
			}
		} else {
			// Close all watchers
			for (const watcher of this.watchers.values()) {
				watcher.close()
			}
			this.watchers.clear()
		}

		// Clear debounce timers
		for (const timer of this.debounceTimers.values()) {
			clearTimeout(timer)
		}
		this.debounceTimers.clear()
	}

	getStats(): WatcherStats {
		return {
			...this.stats,
			uptime_ms: Date.now() - this.startTime,
		}
	}

	isWatching(targetPath?: string): boolean {
		if (targetPath) {
			const resolvedPath = path.resolve(targetPath)
			return this.watchers.has(resolvedPath)
		}
		return this.watchers.size > 0
	}

	getWatchedPaths(): string[] {
		return Array.from(this.watchedPaths)
	}

	// Utility method to wait for specific events
	async waitForEvent(
		eventType: WatchEvent["type"],
		targetPath: string,
		timeout: number = 10000,
	): Promise<WatchEvent> {
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.removeListener(eventType, handler)
				reject(new Error(`Timeout waiting for ${eventType} event on ${targetPath}`))
			}, timeout)

			const handler = (event: WatchEvent) => {
				if (event.path === path.resolve(targetPath)) {
					clearTimeout(timer)
					this.removeListener(eventType, handler)
					resolve(event)
				}
			}

			this.on(eventType, handler)
		})
	}
}

// Factory function for easy usage
export function createFileWatcher(options: WatchOptions = {}): AdvancedFileWatcher {
	return new AdvancedFileWatcher(options)
}

// Utility function for simple one-time watching
export async function watchUntil(
	targetPath: string,
	condition: (event: WatchEvent) => boolean,
	options: WatchOptions & { timeout?: number } = {},
): Promise<WatchEvent> {
	const { timeout = 30000, ...watchOptions } = options
	const watcher = createFileWatcher(watchOptions)

	try {
		await watcher.watch(targetPath)

		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				watcher.unwatch()
				reject(new Error(`Timeout waiting for condition on ${targetPath}`))
			}, timeout)

			watcher.on("change", (event: WatchEvent) => {
				if (condition(event)) {
					clearTimeout(timer)
					watcher.unwatch()
					resolve(event)
				}
			})

			watcher.on("error", (error) => {
				clearTimeout(timer)
				watcher.unwatch()
				reject(error)
			})
		})
	} catch (error) {
		await watcher.unwatch()
		throw error
	}
}
