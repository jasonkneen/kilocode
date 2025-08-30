/**
 * TaskRepository - Persistent storage layer for tasks and workflows
 *
 * Provides durable storage for tasks across CLI sessions with pluggable
 * storage backends. Starts with JSON file store but allows for other
 * storage drivers to be added later.
 */

import * as path from "path"
import * as fs from "fs/promises"
import * as os from "os"
import { TaskStatus } from "../task/TaskStatus"
import { TaskProgress } from "../task/TaskEvents"

/**
 * Stored task data structure for persistence
 */
export interface StoredTask {
	id: string
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
 * Repository storage format
 */
interface StorageData {
	version: string
	tasks: Record<string, StoredTask>
	metadata: {
		lastSaved: number
		format: "json"
		schemaVersion: "1.0"
	}
}

/**
 * Legacy migration data structure (for existing CLI todos/sessions)
 */
export interface LegacyTodoItem {
	id?: string
	text: string
	completed?: boolean
	createdAt?: number
	metadata?: Record<string, unknown>
}

export interface LegacySessionData {
	todos?: LegacyTodoItem[]
	metadata?: Record<string, unknown>
	timestamp?: number
}

/**
 * Repository options
 */
export interface TaskRepositoryOptions {
	storageDir?: string
	filename?: string
	backupCount?: number
	lockTimeout?: number
	enableAutoSave?: boolean
	autoSaveInterval?: number
}

/**
 * Repository errors
 */
export class TaskRepositoryError extends Error {
	constructor(
		message: string,
		public override readonly cause?: unknown,
	) {
		super(message)
		this.name = "TaskRepositoryError"
	}
}

export class TaskLockError extends TaskRepositoryError {
	constructor(lockFile: string) {
		super(`Storage file is locked: ${lockFile}`)
		this.name = "TaskLockError"
	}
}

export class TaskMigrationError extends TaskRepositoryError {
	constructor(message: string, cause?: Error) {
		super(`Migration failed: ${message}`, cause)
		this.name = "TaskMigrationError"
	}
}

/**
 * Abstract storage driver interface for pluggable backends
 */
export interface StorageDriver {
	read(path: string): Promise<string>
	write(path: string, data: string): Promise<void>
	exists(path: string): Promise<boolean>
	remove(path: string): Promise<void>
	createDir(dirPath: string): Promise<void>
}

/**
 * Default JSON file storage driver
 */
export class JsonFileStorageDriver implements StorageDriver {
	async read(filePath: string): Promise<string> {
		try {
			return await fs.readFile(filePath, "utf8")
		} catch (error: any) {
			if (error.code === "ENOENT") {
				throw new TaskRepositoryError(`File not found: ${filePath}`)
			}
			throw new TaskRepositoryError(`Failed to read file: ${filePath}`, error)
		}
	}

	async write(filePath: string, data: string): Promise<void> {
		try {
			// Write to temp file first, then move for atomicity
			const tempFile = `${filePath}.tmp`
			await fs.writeFile(tempFile, data, "utf8")
			await fs.rename(tempFile, filePath)
		} catch (error: any) {
			throw new TaskRepositoryError(`Failed to write file: ${filePath}`, error)
		}
	}

	async exists(filePath: string): Promise<boolean> {
		try {
			await fs.access(filePath)
			return true
		} catch {
			return false
		}
	}

	async remove(filePath: string): Promise<void> {
		try {
			await fs.unlink(filePath)
		} catch (error: any) {
			if (error.code !== "ENOENT") {
				throw new TaskRepositoryError(`Failed to remove file: ${filePath}`, error)
			}
		}
	}

	async createDir(dirPath: string): Promise<void> {
		try {
			await fs.mkdir(dirPath, { recursive: true })
		} catch (error: any) {
			throw new TaskRepositoryError(`Failed to create directory: ${dirPath}`, error)
		}
	}
}

/**
 * TaskRepository implementation with JSON file storage
 */
export class TaskRepository {
	private readonly storageDir: string
	private readonly storageFile: string
	private readonly lockFile: string
	private readonly options: Required<TaskRepositoryOptions>
	private readonly storageDriver: StorageDriver

	private cache?: StorageData
	private autoSaveTimer?: NodeJS.Timeout

	constructor(options: TaskRepositoryOptions = {}, driver?: StorageDriver) {
		this.options = {
			storageDir: options.storageDir ?? this.getDefaultStorageDir(),
			filename: options.filename ?? "tasks.json",
			backupCount: options.backupCount ?? 3,
			lockTimeout: options.lockTimeout ?? 10000, // 10 seconds
			enableAutoSave: options.enableAutoSave ?? false,
			autoSaveInterval: options.autoSaveInterval ?? 30000, // 30 seconds
		}

		this.storageDir = this.options.storageDir
		this.storageFile = path.join(this.storageDir, this.options.filename)
		this.lockFile = path.join(this.storageDir, `${this.options.filename}.lock`)
		this.storageDriver = driver ?? new JsonFileStorageDriver()

		// Initialize auto-save if enabled
		if (this.options.enableAutoSave) {
			this.startAutoSave()
		}
	}

	/**
	 * Initialize repository - create directories and load data
	 */
	async initialize(): Promise<void> {
		try {
			// Create storage directory if it doesn't exist
			await this.storageDriver.createDir(this.storageDir)

			// Load existing data or create new
			if (await this.storageDriver.exists(this.storageFile)) {
				await this.load()
			} else {
				// Initialize with empty data
				this.cache = this.createEmptyStorage()
				await this.persistToStorage()
			}
		} catch (error) {
			throw new TaskRepositoryError("Failed to initialize repository", error as Error)
		}
	}

	/**
	 * Load all tasks from storage
	 */
	async loadAll(): Promise<StoredTask[]> {
		await this.ensureLoaded()
		return Object.values(this.cache!.tasks)
	}

	/**
	 * Load task by ID
	 */
	async loadById(taskId: string): Promise<StoredTask | undefined> {
		await this.ensureLoaded()
		return this.cache!.tasks[taskId]
	}

	/**
	 * Save a single task
	 */
	async save(task: StoredTask): Promise<void> {
		await this.ensureLoaded()

		this.cache!.tasks[task.id] = { ...task }
		this.cache!.metadata.lastSaved = Date.now()

		await this.persistToStorage()
	}

	/**
	 * Save multiple tasks in batch
	 */
	async saveMany(tasks: StoredTask[]): Promise<void> {
		await this.ensureLoaded()

		for (const task of tasks) {
			this.cache!.tasks[task.id] = { ...task }
		}
		this.cache!.metadata.lastSaved = Date.now()

		await this.persistToStorage()
	}

	/**
	 * Remove task by ID
	 */
	async remove(taskId: string): Promise<boolean> {
		await this.ensureLoaded()

		if (taskId in this.cache!.tasks) {
			delete this.cache!.tasks[taskId]
			this.cache!.metadata.lastSaved = Date.now()
			await this.persistToStorage()
			return true
		}

		return false
	}

	/**
	 * Get all task IDs
	 */
	async getTaskIds(): Promise<string[]> {
		await this.ensureLoaded()
		return Object.keys(this.cache!.tasks)
	}

	/**
	 * Check if task exists
	 */
	async exists(taskId: string): Promise<boolean> {
		await this.ensureLoaded()
		return taskId in this.cache!.tasks
	}

	/**
	 * Get storage statistics
	 */
	async getStats(): Promise<{
		totalTasks: number
		storageSize: number
		lastSaved: number
		byStatus: Record<TaskStatus, number>
	}> {
		await this.ensureLoaded()

		const tasks = Object.values(this.cache!.tasks)
		const byStatus = tasks.reduce(
			(counts, task) => {
				counts[task.status] = (counts[task.status] || 0) + 1
				return counts
			},
			{} as Record<TaskStatus, number>,
		)

		// Get file size
		let storageSize = 0
		try {
			const data = await this.storageDriver.read(this.storageFile)
			storageSize = Buffer.byteLength(data, "utf8")
		} catch {
			// File might not exist yet
		}

		return {
			totalTasks: tasks.length,
			storageSize,
			lastSaved: this.cache!.metadata.lastSaved,
			byStatus,
		}
	}

	/**
	 * Clear all tasks (useful for testing)
	 */
	async clear(): Promise<void> {
		this.cache = this.createEmptyStorage()
		await this.persistToStorage()
	}

	/**
	 * Migrate legacy CLI data (todos, sessions) to task format
	 */
	async migrateFromLegacy(legacyData: LegacySessionData): Promise<{
		migratedTasks: StoredTask[]
		skippedItems: number
		errors: string[]
	}> {
		const migratedTasks: StoredTask[] = []
		const errors: string[] = []
		let skippedItems = 0

		try {
			if (legacyData.todos && Array.isArray(legacyData.todos)) {
				for (const todo of legacyData.todos) {
					try {
						const migratedTask = this.migrateTodoToTask(todo, legacyData.timestamp)
						migratedTasks.push(migratedTask)
					} catch (error) {
						errors.push(`Failed to migrate todo "${todo.text}": ${error}`)
						skippedItems++
					}
				}
			}

			// Save migrated tasks
			if (migratedTasks.length > 0) {
				await this.saveMany(migratedTasks)
			}

			return {
				migratedTasks,
				skippedItems,
				errors,
			}
		} catch (error) {
			throw new TaskMigrationError("Failed to migrate legacy data", error as Error)
		}
	}

	/**
	 * Create backup of current storage
	 */
	async createBackup(): Promise<string> {
		const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
		const backupFile = path.join(this.storageDir, `${this.options.filename}.backup.${timestamp}`)

		try {
			if (await this.storageDriver.exists(this.storageFile)) {
				const data = await this.storageDriver.read(this.storageFile)
				await this.storageDriver.write(backupFile, data)
			}

			// Clean up old backups
			await this.cleanupOldBackups()

			return backupFile
		} catch (error) {
			throw new TaskRepositoryError("Failed to create backup", error as Error)
		}
	}

	/**
	 * Close repository and cleanup resources
	 */
	async close(): Promise<void> {
		// Stop auto-save timer
		if (this.autoSaveTimer) {
			clearInterval(this.autoSaveTimer)
			this.autoSaveTimer = undefined
		}

		// Final save if we have unsaved changes
		if (this.cache) {
			await this.persistToStorage()
		}

		// Release any locks
		await this.releaseLock()
	}

	/**
	 * Private: Ensure data is loaded from storage
	 */
	private async ensureLoaded(): Promise<void> {
		if (!this.cache) {
			await this.load()
		}
	}

	/**
	 * Private: Load data from storage
	 */
	private async load(): Promise<void> {
		try {
			await this.acquireLock()

			if (await this.storageDriver.exists(this.storageFile)) {
				const data = await this.storageDriver.read(this.storageFile)
				this.cache = JSON.parse(data)

				// Validate and upgrade schema if needed
				this.validateAndUpgradeSchema()
			} else {
				this.cache = this.createEmptyStorage()
			}
		} finally {
			await this.releaseLock()
		}
	}

	/**
	 * Private: Persist current cache to storage
	 */
	private async persistToStorage(): Promise<void> {
		if (!this.cache) {
			throw new TaskRepositoryError("No data to persist")
		}

		try {
			await this.acquireLock()

			const data = JSON.stringify(this.cache, null, 2)
			await this.storageDriver.write(this.storageFile, data)
		} finally {
			await this.releaseLock()
		}
	}

	/**
	 * Private: Acquire file lock to prevent concurrent access
	 */
	private async acquireLock(): Promise<void> {
		const startTime = Date.now()

		while (await this.storageDriver.exists(this.lockFile)) {
			if (Date.now() - startTime > this.options.lockTimeout) {
				throw new TaskLockError(this.lockFile)
			}
			await new Promise((resolve) => setTimeout(resolve, 100))
		}

		try {
			await this.storageDriver.write(
				this.lockFile,
				JSON.stringify({
					pid: process.pid,
					timestamp: Date.now(),
					hostname: os.hostname(),
				}),
			)
		} catch (error) {
			throw new TaskLockError(this.lockFile)
		}
	}

	/**
	 * Private: Release file lock
	 */
	private async releaseLock(): Promise<void> {
		try {
			await this.storageDriver.remove(this.lockFile)
		} catch {
			// Ignore errors - lock file might not exist
		}
	}

	/**
	 * Private: Create empty storage data structure
	 */
	private createEmptyStorage(): StorageData {
		return {
			version: "1.0",
			tasks: {},
			metadata: {
				lastSaved: Date.now(),
				format: "json",
				schemaVersion: "1.0",
			},
		}
	}

	/**
	 * Private: Validate and upgrade storage schema
	 */
	private validateAndUpgradeSchema(): void {
		if (!this.cache) return

		// Add schema migrations here as needed
		if (!this.cache.metadata) {
			this.cache.metadata = {
				lastSaved: Date.now(),
				format: "json",
				schemaVersion: "1.0",
			}
		}

		if (!this.cache.version) {
			this.cache.version = "1.0"
		}
	}

	/**
	 * Private: Migrate legacy todo item to task
	 */
	private migrateTodoToTask(todo: LegacyTodoItem, sessionTimestamp?: number): StoredTask {
		const now = Date.now()
		const createdAt = todo.createdAt ?? sessionTimestamp ?? now

		return {
			id: todo.id ?? `migrated_${createdAt}_${Math.random().toString(36).substring(2, 8)}`,
			title: todo.text || "Untitled Task",
			description: undefined,
			status: todo.completed ? TaskStatus.Succeeded : TaskStatus.Pending,
			parentId: undefined,
			assignedTo: undefined,
			progress: {
				percent: todo.completed ? 100 : 0,
			},
			metadata: {
				...todo.metadata,
				migratedFrom: "legacy-todo",
				migratedAt: now,
			},
			createdAt,
			updatedAt: now,
			children: [],
			logs: [
				{
					timestamp: now,
					output: "Task migrated from legacy CLI data",
					type: "info",
					source: "migration",
				},
			],
		}
	}

	/**
	 * Private: Get default storage directory
	 */
	private getDefaultStorageDir(): string {
		// Use standard user config directory
		const configDir = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config")

		return path.join(configDir, "kilocode", "tasks")
	}

	/**
	 * Private: Start auto-save timer
	 */
	private startAutoSave(): void {
		if (this.autoSaveTimer) return

		this.autoSaveTimer = setInterval(async () => {
			if (this.cache) {
				try {
					await this.persistToStorage()
				} catch (error) {
					console.error("Auto-save failed:", error)
				}
			}
		}, this.options.autoSaveInterval)
	}

	/**
	 * Private: Clean up old backup files
	 */
	private async cleanupOldBackups(): Promise<void> {
		try {
			const files = await fs.readdir(this.storageDir)
			const backupFiles = files
				.filter((file) => file.startsWith(`${this.options.filename}.backup.`))
				.map((file) => ({
					name: file,
					path: path.join(this.storageDir, file),
					time: file.split(".backup.")[1],
				}))
				.sort((a, b) => b.time.localeCompare(a.time)) // Sort by time descending

			// Remove excess backups
			if (backupFiles.length > this.options.backupCount) {
				const filesToRemove = backupFiles.slice(this.options.backupCount)
				for (const file of filesToRemove) {
					await this.storageDriver.remove(file.path)
				}
			}
		} catch (error) {
			// Don't fail on backup cleanup errors
			console.warn("Failed to cleanup old backups:", error)
		}
	}
}

/**
 * Factory for creating repository instances
 */
export class TaskRepositoryFactory {
	/**
	 * Create a repository with default JSON file storage
	 */
	static async createJsonRepository(options: TaskRepositoryOptions = {}): Promise<TaskRepository> {
		const repository = new TaskRepository(options, new JsonFileStorageDriver())
		await repository.initialize()
		return repository
	}

	/**
	 * Create a repository with custom storage driver
	 */
	static async createRepository(driver: StorageDriver, options: TaskRepositoryOptions = {}): Promise<TaskRepository> {
		const repository = new TaskRepository(options, driver)
		await repository.initialize()
		return repository
	}

	/**
	 * Create an in-memory repository for testing
	 */
	static async createInMemoryRepository(): Promise<TaskRepository> {
		const memoryDriver = new InMemoryStorageDriver()
		const repository = new TaskRepository(
			{
				storageDir: "/tmp/memory",
				enableAutoSave: false,
			},
			memoryDriver,
		)
		await repository.initialize()
		return repository
	}
}

/**
 * In-memory storage driver for testing
 */
class InMemoryStorageDriver implements StorageDriver {
	private storage: Map<string, string> = new Map()
	private directories: Set<string> = new Set()

	async read(filePath: string): Promise<string> {
		const content = this.storage.get(filePath)
		if (content === undefined) {
			throw new TaskRepositoryError(`File not found: ${filePath}`)
		}
		return content
	}

	async write(filePath: string, data: string): Promise<void> {
		this.storage.set(filePath, data)
	}

	async exists(filePath: string): Promise<boolean> {
		return this.storage.has(filePath)
	}

	async remove(filePath: string): Promise<void> {
		this.storage.delete(filePath)
	}

	async createDir(dirPath: string): Promise<void> {
		this.directories.add(dirPath)
	}
}

/**
 * Export types for external use
 */
// Types are already exported above via their declarations
