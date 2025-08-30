/**
 * Checkpoint Management System
 * Handles saving and restoring conversation states
 */

import fs from "node:fs/promises"
import path from "node:path"
import { createHash } from "node:crypto"

export interface ConversationCheckpoint {
	id: string
	name?: string
	description?: string
	timestamp: number
	messages: ChatMessage[]
	context: {
		workingDirectory: string
		activeTodos?: string[]
		settings?: Record<string, any>
		metadata?: Record<string, any>
	}
	stats: {
		messageCount: number
		toolExecutions: number
		thinkingBlocks: number
		totalTokens?: number
	}
	version: string
}

export interface ChatMessage {
	role: "user" | "assistant" | "system"
	content: string
	timestamp: number
	toolCalls?: any[]
	thinking?: string
	metadata?: Record<string, any>
}

export interface CheckpointListOptions {
	limit?: number
	sortBy?: "timestamp" | "name"
	ascending?: boolean
	filter?: {
		minMessages?: number
		maxAge?: number // in milliseconds
		namePattern?: string
	}
}

export class CheckpointManager {
	private checkpointsDir: string
	private maxCheckpoints = 100
	private compressionEnabled = true

	constructor(workingDir: string) {
		this.checkpointsDir = path.join(workingDir, ".kilocode", "checkpoints")
	}

	/**
	 * Initialize checkpoint directory
	 */
	async initialize(): Promise<void> {
		await fs.mkdir(this.checkpointsDir, { recursive: true })
	}

	/**
	 * Create a new checkpoint
	 */
	async createCheckpoint(
		messages: ChatMessage[],
		options: {
			name?: string
			description?: string
			context?: Record<string, any>
			autoGenerate?: boolean
		} = {},
	): Promise<ConversationCheckpoint> {
		await this.initialize()

		const timestamp = Date.now()
		const id = this.generateCheckpointId(messages, timestamp)

		// Auto-generate name if not provided
		const name = options.name || this.generateCheckpointName(messages, timestamp)

		const checkpoint: ConversationCheckpoint = {
			id,
			name,
			description: options.description,
			timestamp,
			messages,
			context: {
				workingDirectory: process.cwd(),
				...options.context,
			},
			stats: this.calculateStats(messages),
			version: "1.0.0",
		}

		// Save to disk
		const filename = `${id}.json`
		const filepath = path.join(this.checkpointsDir, filename)

		const content = JSON.stringify(checkpoint, null, 2)
		await fs.writeFile(filepath, content, "utf8")

		// Clean up old checkpoints if needed
		await this.cleanupOldCheckpoints()

		return checkpoint
	}

	/**
	 * Load a checkpoint by ID
	 */
	async loadCheckpoint(id: string): Promise<ConversationCheckpoint | null> {
		try {
			const filepath = path.join(this.checkpointsDir, `${id}.json`)
			const content = await fs.readFile(filepath, "utf8")
			return JSON.parse(content) as ConversationCheckpoint
		} catch (error) {
			if ((error as any).code === "ENOENT") {
				return null
			}
			throw error
		}
	}

	/**
	 * List all available checkpoints
	 */
	async listCheckpoints(options: CheckpointListOptions = {}): Promise<ConversationCheckpoint[]> {
		await this.initialize()

		try {
			const files = await fs.readdir(this.checkpointsDir)
			const checkpointFiles = files.filter((f) => f.endsWith(".json"))

			const checkpoints: ConversationCheckpoint[] = []

			for (const file of checkpointFiles) {
				try {
					const content = await fs.readFile(path.join(this.checkpointsDir, file), "utf8")
					const checkpoint = JSON.parse(content) as ConversationCheckpoint

					// Apply filters
					if (this.matchesFilter(checkpoint, options.filter)) {
						checkpoints.push(checkpoint)
					}
				} catch (error) {
					console.warn(`Failed to parse checkpoint file ${file}:`, error)
					continue
				}
			}

			// Sort checkpoints
			const sortBy = options.sortBy || "timestamp"
			const ascending = options.ascending || false

			checkpoints.sort((a, b) => {
				let aValue: any, bValue: any

				if (sortBy === "timestamp") {
					aValue = a.timestamp
					bValue = b.timestamp
				} else if (sortBy === "name") {
					aValue = a.name || ""
					bValue = b.name || ""
				}

				const result = aValue < bValue ? -1 : aValue > bValue ? 1 : 0
				return ascending ? result : -result
			})

			// Apply limit
			if (options.limit) {
				return checkpoints.slice(0, options.limit)
			}

			return checkpoints
		} catch (error) {
			if ((error as any).code === "ENOENT") {
				return []
			}
			throw error
		}
	}

	/**
	 * Delete a checkpoint
	 */
	async deleteCheckpoint(id: string): Promise<boolean> {
		try {
			const filepath = path.join(this.checkpointsDir, `${id}.json`)
			await fs.unlink(filepath)
			return true
		} catch (error) {
			if ((error as any).code === "ENOENT") {
				return false
			}
			throw error
		}
	}

	/**
	 * Create auto-checkpoint during conversation
	 */
	async autoCheckpoint(
		messages: ChatMessage[],
		trigger: "tool_completion" | "milestone" | "error" | "manual",
	): Promise<ConversationCheckpoint | null> {
		// Only create auto-checkpoints for significant conversations
		if (messages.length < 3) {
			return null
		}

		const name = this.generateAutoCheckpointName(trigger, messages.length)
		const description = `Auto-checkpoint created after ${trigger.replace("_", " ")}`

		return await this.createCheckpoint(messages, {
			name,
			description,
			autoGenerate: true,
		})
	}

	/**
	 * Export checkpoint to file
	 */
	async exportCheckpoint(id: string, exportPath: string): Promise<void> {
		const checkpoint = await this.loadCheckpoint(id)
		if (!checkpoint) {
			throw new Error(`Checkpoint ${id} not found`)
		}

		const exportData = {
			...checkpoint,
			exportedAt: new Date().toISOString(),
			exportedBy: "kilocode-cli",
		}

		await fs.writeFile(exportPath, JSON.stringify(exportData, null, 2), "utf8")
	}

	/**
	 * Import checkpoint from file
	 */
	async importCheckpoint(importPath: string, options: { rename?: string } = {}): Promise<ConversationCheckpoint> {
		const content = await fs.readFile(importPath, "utf8")
		const importedData = JSON.parse(content)

		// Remove export metadata
		delete importedData.exportedAt
		delete importedData.exportedBy

		// Optionally rename
		if (options.rename) {
			importedData.name = options.rename
		}

		// Generate new ID to avoid conflicts
		importedData.id = this.generateCheckpointId(importedData.messages, Date.now())
		importedData.timestamp = Date.now()

		// Save as new checkpoint
		const filename = `${importedData.id}.json`
		const filepath = path.join(this.checkpointsDir, filename)
		await fs.writeFile(filepath, JSON.stringify(importedData, null, 2), "utf8")

		return importedData as ConversationCheckpoint
	}

	/**
	 * Get checkpoint statistics
	 */
	async getCheckpointStats() {
		const checkpoints = await this.listCheckpoints()

		if (checkpoints.length === 0) {
			return {
				totalCheckpoints: 0,
				oldestCheckpoint: null,
				newestCheckpoint: null,
				totalMessages: 0,
				totalToolExecutions: 0,
				averageMessagesPerCheckpoint: 0,
				diskUsage: 0,
			}
		}

		const totalMessages = checkpoints.reduce((sum, cp) => sum + cp.stats.messageCount, 0)
		const totalToolExecutions = checkpoints.reduce((sum, cp) => sum + cp.stats.toolExecutions, 0)

		const oldestCheckpoint = checkpoints.reduce((oldest, cp) => (cp.timestamp < oldest.timestamp ? cp : oldest))
		const newestCheckpoint = checkpoints.reduce((newest, cp) => (cp.timestamp > newest.timestamp ? cp : newest))

		// Calculate disk usage
		let diskUsage = 0
		try {
			const files = await fs.readdir(this.checkpointsDir)
			for (const file of files) {
				if (file.endsWith(".json")) {
					const stat = await fs.stat(path.join(this.checkpointsDir, file))
					diskUsage += stat.size
				}
			}
		} catch (error) {
			// Ignore disk usage calculation errors
		}

		return {
			totalCheckpoints: checkpoints.length,
			oldestCheckpoint,
			newestCheckpoint,
			totalMessages,
			totalToolExecutions,
			averageMessagesPerCheckpoint: Math.round(totalMessages / checkpoints.length),
			diskUsage,
		}
	}

	/**
	 * Generate unique checkpoint ID
	 */
	private generateCheckpointId(messages: ChatMessage[], timestamp: number): string {
		const content = JSON.stringify(messages.slice(-3)) // Use last 3 messages for uniqueness
		const hash = createHash("sha256")
			.update(content + timestamp)
			.digest("hex")
		return `cp_${timestamp}_${hash.substring(0, 8)}`
	}

	/**
	 * Generate human-readable checkpoint name
	 */
	private generateCheckpointName(messages: ChatMessage[], timestamp: number): string {
		const date = new Date(timestamp)
		const timeStr = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })

		// Try to extract a meaningful topic from recent messages
		const recentMessages = messages.slice(-5)
		const userMessages = recentMessages.filter((m) => m.role === "user")

		if (userMessages.length > 0) {
			const lastUserMessage = userMessages[userMessages.length - 1]
			const words = lastUserMessage.content.toLowerCase().split(/\s+/)
			const keywords = words.filter(
				(w) => w.length > 3 && !["this", "that", "with", "from", "they", "have", "will", "been"].includes(w),
			)

			if (keywords.length > 0) {
				const topic = keywords.slice(0, 2).join(" ")
				return `${topic} - ${timeStr}`
			}
		}

		return `Checkpoint ${timeStr}`
	}

	/**
	 * Generate auto-checkpoint name
	 */
	private generateAutoCheckpointName(trigger: string, messageCount: number): string {
		const timestamp = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
		const triggerMap: Record<string, string> = {
			tool_completion: "🔧 After tools",
			milestone: "🎯 Milestone",
			error: "⚠️ Error state",
			manual: "💾 Manual save",
		}

		return `${triggerMap[trigger] || trigger} (${messageCount} messages) - ${timestamp}`
	}

	/**
	 * Calculate checkpoint statistics
	 */
	private calculateStats(messages: ChatMessage[]) {
		const toolExecutions = messages.filter((m) => m.toolCalls && m.toolCalls.length > 0).length
		const thinkingBlocks = messages.filter((m) => m.thinking).length

		return {
			messageCount: messages.length,
			toolExecutions,
			thinkingBlocks,
			totalTokens: undefined, // Could be calculated if we track token usage
		}
	}

	/**
	 * Check if checkpoint matches filter criteria
	 */
	private matchesFilter(checkpoint: ConversationCheckpoint, filter?: CheckpointListOptions["filter"]): boolean {
		if (!filter) return true

		if (filter.minMessages && checkpoint.stats.messageCount < filter.minMessages) {
			return false
		}

		if (filter.maxAge && Date.now() - checkpoint.timestamp > filter.maxAge) {
			return false
		}

		if (filter.namePattern && checkpoint.name) {
			const pattern = new RegExp(filter.namePattern, "i")
			if (!pattern.test(checkpoint.name)) {
				return false
			}
		}

		return true
	}

	/**
	 * Clean up old checkpoints when limit exceeded
	 */
	private async cleanupOldCheckpoints(): Promise<void> {
		const checkpoints = await this.listCheckpoints({ sortBy: "timestamp", ascending: false })

		if (checkpoints.length > this.maxCheckpoints) {
			const toDelete = checkpoints.slice(this.maxCheckpoints)

			for (const checkpoint of toDelete) {
				await this.deleteCheckpoint(checkpoint.id)
			}
		}
	}
}

/**
 * Utility functions for checkpoint integration
 */
export class CheckpointIntegration {
	private checkpointManager: CheckpointManager

	constructor(workingDir: string) {
		this.checkpointManager = new CheckpointManager(workingDir)
	}

	/**
	 * Create checkpoint from conversation messages
	 */
	async createFromConversation(
		messages: any[],
		options: {
			name?: string
			description?: string
			includeThinking?: boolean
		} = {},
	): Promise<ConversationCheckpoint> {
		// Convert messages to checkpoint format
		const chatMessages: ChatMessage[] = messages.map((msg, index) => ({
			role: msg.role || (index % 2 === 0 ? "user" : "assistant"),
			content: msg.content || "",
			timestamp: msg.timestamp || Date.now() - (messages.length - index) * 1000,
			toolCalls: msg.toolCalls,
			thinking: options.includeThinking ? msg.thinking : undefined,
		}))

		return await this.checkpointManager.createCheckpoint(chatMessages, options)
	}

	/**
	 * Auto-save checkpoint after significant events
	 */
	async autoSave(
		messages: any[],
		event: "tool_completion" | "milestone" | "error",
	): Promise<ConversationCheckpoint | null> {
		const chatMessages: ChatMessage[] = messages.map((msg, index) => ({
			role: msg.role || (index % 2 === 0 ? "user" : "assistant"),
			content: msg.content || "",
			timestamp: msg.timestamp || Date.now() - (messages.length - index) * 1000,
			toolCalls: msg.toolCalls,
		}))

		return await this.checkpointManager.autoCheckpoint(chatMessages, event)
	}

	/**
	 * List available checkpoints with formatted display
	 */
	async listFormatted(limit: number = 10): Promise<string> {
		const checkpoints = await this.checkpointManager.listCheckpoints({
			limit,
			sortBy: "timestamp",
			ascending: false,
		})

		if (checkpoints.length === 0) {
			return "No checkpoints found. Create one with /checkpoint save"
		}

		const lines = ["📁 Available Checkpoints:\n"]

		for (const cp of checkpoints) {
			const date = new Date(cp.timestamp).toLocaleString()
			const age = this.formatAge(Date.now() - cp.timestamp)
			lines.push(`🔹 ${cp.name || cp.id}`)
			lines.push(`   ID: ${cp.id}`)
			lines.push(`   Created: ${date} (${age} ago)`)
			lines.push(`   Messages: ${cp.stats.messageCount}, Tools: ${cp.stats.toolExecutions}`)
			if (cp.description) {
				lines.push(`   ${cp.description}`)
			}
			lines.push("")
		}

		return lines.join("\n")
	}

	/**
	 * Format age in human-readable format
	 */
	private formatAge(ms: number): string {
		const seconds = Math.floor(ms / 1000)
		const minutes = Math.floor(seconds / 60)
		const hours = Math.floor(minutes / 60)
		const days = Math.floor(hours / 24)

		if (days > 0) return `${days} day${days > 1 ? "s" : ""}`
		if (hours > 0) return `${hours} hour${hours > 1 ? "s" : ""}`
		if (minutes > 0) return `${minutes} min${minutes > 1 ? "s" : ""}`
		return `${seconds} sec${seconds !== 1 ? "s" : ""}`
	}

	/**
	 * Get manager instance for direct access
	 */
	getManager(): CheckpointManager {
		return this.checkpointManager
	}
}
