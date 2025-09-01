/**
 * Thinking Stream Display
 * Handles parsing and displaying agent thinking in collapsed format
 */

export interface ThinkingBlock {
	content: string
	startTime: number
	endTime?: number
	isComplete: boolean
}

export interface ThinkingDisplayOptions {
	showTimestamps?: boolean
	collapsedByDefault?: boolean
	maxPreviewLength?: number
	theme?: "minimal" | "detailed" | "debug"
}

export class ThinkingStreamParser {
	private currentThinking: ThinkingBlock | null = null
	private completedThinking: ThinkingBlock[] = []
	private buffer = ""

	constructor(private options: ThinkingDisplayOptions = {}) {
		this.options = {
			showTimestamps: false,
			collapsedByDefault: true,
			maxPreviewLength: 100,
			theme: "minimal",
			...options,
		}
	}

	/**
	 * Process a chunk of text and extract thinking blocks
	 */
	processChunk(chunk: string): { hasNewThinking: boolean; display: string } {
		this.buffer += chunk
		let hasNewThinking = false

		// Look for thinking tags
		const startTag = "<thinking>"
		const endTag = "</thinking>"

		// Check if we're starting a new thinking block
		if (!this.currentThinking) {
			const startIndex = this.buffer.indexOf(startTag)
			if (startIndex !== -1) {
				this.currentThinking = {
					content: "",
					startTime: Date.now(),
					isComplete: false,
				}
				hasNewThinking = true
			}
		}

		// Process current thinking block
		if (this.currentThinking) {
			const startIndex = this.buffer.indexOf(startTag)

			if (startIndex !== -1) {
				const endIndex = this.buffer.indexOf(endTag, startIndex)

				if (endIndex !== -1) {
					// Complete thinking block found
					const thinkingContent = this.buffer.substring(startIndex + startTag.length, endIndex)
					this.currentThinking.content = thinkingContent.trim()
					this.currentThinking.endTime = Date.now()
					this.currentThinking.isComplete = true

					this.completedThinking.push(this.currentThinking)
					this.currentThinking = null
					hasNewThinking = true

					// Remove processed thinking from buffer
					this.buffer = this.buffer.substring(endIndex + endTag.length)
				} else {
					// Partial thinking - extract what we have so far
					const partialContent = this.buffer.substring(startIndex + startTag.length)
					if (partialContent !== this.currentThinking.content) {
						this.currentThinking.content = partialContent
						hasNewThinking = true
					}
				}
			}
		}

		const display = this.generateDisplay()
		return { hasNewThinking, display }
	}

	/**
	 * Generate the display string for thinking blocks
	 */
	private generateDisplay(): string {
		if (this.completedThinking.length === 0 && !this.currentThinking) {
			return ""
		}

		const parts: string[] = []

		// Show completed thinking blocks
		for (const thinking of this.completedThinking) {
			parts.push(this.formatThinkingBlock(thinking))
		}

		// Show current thinking if active
		if (this.currentThinking && this.currentThinking.content) {
			parts.push(this.formatThinkingBlock(this.currentThinking))
		}

		return parts.join("\n")
	}

	/**
	 * Format a single thinking block for display
	 */
	private formatThinkingBlock(thinking: ThinkingBlock): string {
		const { theme, collapsedByDefault, maxPreviewLength, showTimestamps } = this.options

		// Generate preview
		const preview =
			thinking.content.length > (maxPreviewLength || 100)
				? thinking.content.substring(0, maxPreviewLength) + "..."
				: thinking.content

		// Format timestamp
		const timestamp = showTimestamps && thinking.endTime ? ` (${thinking.endTime - thinking.startTime}ms)` : ""

		// Status indicator
		const status = thinking.isComplete ? "💭" : "🤔"
		const statusText = thinking.isComplete ? "completed" : "thinking..."

		switch (theme) {
			case "minimal":
				return `${status} ${preview}${timestamp}`

			case "detailed":
				if (collapsedByDefault) {
					return [
						`┌─ ${status} Thinking ${statusText}${timestamp}`,
						`│ ${preview}`,
						`└─ [Click to expand full thinking]`,
					].join("\n")
				} else {
					return [
						`┌─ ${status} Thinking ${statusText}${timestamp}`,
						...thinking.content.split("\n").map((line) => `│ ${line}`),
						`└─`,
					].join("\n")
				}

			case "debug":
				return [
					`=== THINKING BLOCK (${statusText}) ===`,
					`Start: ${new Date(thinking.startTime).toISOString()}`,
					thinking.endTime ? `End: ${new Date(thinking.endTime).toISOString()}` : "In progress...",
					thinking.endTime ? `Duration: ${thinking.endTime - thinking.startTime}ms` : "",
					"Content:",
					thinking.content,
					"=== END THINKING ===",
				]
					.filter(Boolean)
					.join("\n")

			default:
				return preview
		}
	}

	/**
	 * Get all thinking blocks
	 */
	getAllThinking(): ThinkingBlock[] {
		const all = [...this.completedThinking]
		if (this.currentThinking) {
			all.push(this.currentThinking)
		}
		return all
	}

	/**
	 * Clear all thinking data
	 */
	clear(): void {
		this.currentThinking = null
		this.completedThinking = []
		this.buffer = ""
	}

	/**
	 * Get summary statistics
	 */
	getStats() {
		const completed = this.completedThinking.length
		const totalTime = this.completedThinking.reduce((sum, t) => sum + (t.endTime ? t.endTime - t.startTime : 0), 0)
		const avgTime = completed > 0 ? totalTime / completed : 0

		return {
			completedBlocks: completed,
			activeThinking: this.currentThinking !== null,
			totalThinkingTime: totalTime,
			averageThinkingTime: Math.round(avgTime),
			currentContent: this.currentThinking?.content || "",
		}
	}
}

/**
 * Enhanced thinking parser that integrates with response flow
 */
export function parseResponseWithThinking(text: string, options?: ThinkingDisplayOptions) {
	const parser = new ThinkingStreamParser(options)
	const { hasNewThinking, display } = parser.processChunk(text)

	// Remove thinking tags from the main content
	const cleanText = text.replace(/<thinking>[\s\S]*?<\/thinking>/g, "").trim()

	return {
		cleanText,
		thinkingDisplay: display,
		hasThinking: hasNewThinking,
		stats: parser.getStats(),
	}
}

/**
 * Real-time thinking display formatter
 */
export class RealTimeThinkingDisplay {
	private parser: ThinkingStreamParser
	private lastDisplay = ""

	constructor(options?: ThinkingDisplayOptions) {
		this.parser = new ThinkingStreamParser(options)
	}

	/**
	 * Process streaming chunk and return display updates
	 */
	processStreamChunk(chunk: string): {
		hasUpdate: boolean
		display: string
		isNewThinking: boolean
	} {
		const { hasNewThinking, display } = this.parser.processChunk(chunk)
		const hasUpdate = display !== this.lastDisplay

		if (hasUpdate) {
			this.lastDisplay = display
		}

		return {
			hasUpdate,
			display,
			isNewThinking: hasNewThinking,
		}
	}

	/**
	 * Get current thinking stats
	 */
	getStats() {
		return this.parser.getStats()
	}

	/**
	 * Clear all thinking data
	 */
	clear(): void {
		this.parser.clear()
		this.lastDisplay = ""
	}
}
