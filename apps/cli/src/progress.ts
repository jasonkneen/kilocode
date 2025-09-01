/**
 * CLI Progress Indicator Utilities
 * Provides enhanced terminal progress visualization for batch operations
 */

import process from "node:process"

export interface ProgressOptions {
	title?: string
	width?: number
	showPercentage?: boolean
	showTime?: boolean
	showThroughput?: boolean
}

export class ProgressIndicator {
	private current = 0
	private total = 0
	private startTime = Date.now()
	private title = ""
	private width = 40
	private showPercentage = true
	private showTime = true
	private showThroughput = false
	private lastUpdateTime = 0
	private isFinished = false

	constructor(total: number, options: ProgressOptions = {}) {
		this.total = total
		this.title = options.title || "Progress"
		this.width = options.width || 40
		this.showPercentage = options.showPercentage ?? true
		this.showTime = options.showTime ?? true
		this.showThroughput = options.showThroughput ?? false
		this.lastUpdateTime = Date.now()
	}

	update(current: number, description?: string): void {
		if (this.isFinished) return

		this.current = Math.min(current, this.total)
		const now = Date.now()

		// Throttle updates to avoid flooding the terminal (max 10 updates per second)
		if (now - this.lastUpdateTime < 100 && current < this.total) {
			return
		}
		this.lastUpdateTime = now

		this.render(description)
	}

	increment(description?: string): void {
		this.update(this.current + 1, description)
	}

	finish(finalMessage?: string): void {
		if (this.isFinished) return

		this.current = this.total
		this.isFinished = true
		this.render(finalMessage)
		process.stdout.write("\n")
	}

	private render(description?: string): void {
		const percent = this.total > 0 ? this.current / this.total : 0
		const filledWidth = Math.round(this.width * percent)
		const emptyWidth = this.width - filledWidth

		// Create progress bar
		const filled = "█".repeat(filledWidth)
		const empty = "░".repeat(emptyWidth)
		const bar = `[${filled}${empty}]`

		// Build status line
		let status = `\r${this.title}: ${bar}`

		if (this.showPercentage) {
			status += ` ${Math.round(percent * 100)}%`
		}

		status += ` (${this.current}/${this.total})`

		if (this.showTime || this.showThroughput) {
			const elapsed = Date.now() - this.startTime
			const elapsedSeconds = elapsed / 1000

			if (this.showTime) {
				if (this.current < this.total && this.current > 0) {
					// Estimate time remaining
					const rate = this.current / elapsedSeconds
					const remaining = (this.total - this.current) / rate
					status += ` ETA: ${this.formatTime(remaining)}`
				} else {
					status += ` Time: ${this.formatTime(elapsedSeconds)}`
				}
			}

			if (this.showThroughput && this.current > 0) {
				const rate = this.current / elapsedSeconds
				status += ` (${rate.toFixed(1)}/s)`
			}
		}

		if (description) {
			// Truncate description to fit terminal width
			const maxDescLength = Math.max(20, process.stdout.columns - status.length - 3)
			const truncated =
				description.length > maxDescLength ? description.substring(0, maxDescLength - 3) + "..." : description
			status += ` - ${truncated}`
		}

		// Clear line and write status
		process.stdout.clearLine(0)
		process.stdout.cursorTo(0)
		process.stdout.write(status)
	}

	private formatTime(seconds: number): string {
		if (seconds < 60) {
			return `${Math.round(seconds)}s`
		} else if (seconds < 3600) {
			const minutes = Math.floor(seconds / 60)
			const remainingSeconds = Math.round(seconds % 60)
			return `${minutes}m ${remainingSeconds}s`
		} else {
			const hours = Math.floor(seconds / 3600)
			const minutes = Math.floor((seconds % 3600) / 60)
			return `${hours}h ${minutes}m`
		}
	}
}

export class SpinnerIndicator {
	private frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
	private currentFrame = 0
	private timer?: NodeJS.Timeout
	private message = ""
	private isSpinning = false

	constructor(message = "Loading...") {
		this.message = message
	}

	start(): void {
		if (this.isSpinning) return

		this.isSpinning = true
		this.timer = setInterval(() => {
			process.stdout.clearLine(0)
			process.stdout.cursorTo(0)
			process.stdout.write(`${this.frames[this.currentFrame]} ${this.message}`)
			this.currentFrame = (this.currentFrame + 1) % this.frames.length
		}, 80)
	}

	updateMessage(message: string): void {
		this.message = message
	}

	stop(finalMessage?: string): void {
		if (!this.isSpinning) return

		this.isSpinning = false
		if (this.timer) {
			clearInterval(this.timer)
			this.timer = undefined
		}

		process.stdout.clearLine(0)
		process.stdout.cursorTo(0)
		if (finalMessage) {
			process.stdout.write(`✓ ${finalMessage}\n`)
		} else {
			process.stdout.write(`✓ ${this.message}\n`)
		}
	}

	fail(errorMessage?: string): void {
		if (!this.isSpinning) return

		this.isSpinning = false
		if (this.timer) {
			clearInterval(this.timer)
			this.timer = undefined
		}

		process.stdout.clearLine(0)
		process.stdout.cursorTo(0)
		if (errorMessage) {
			process.stdout.write(`✗ ${errorMessage}\n`)
		} else {
			process.stdout.write(`✗ ${this.message}\n`)
		}
	}
}

export function createProgressIndicator(total: number, options?: ProgressOptions): ProgressIndicator {
	return new ProgressIndicator(total, options)
}

export function createSpinner(message?: string): SpinnerIndicator {
	return new SpinnerIndicator(message)
}

// Utility for displaying file operation summaries
export function displayOperationSummary(
	operations: {
		name: string
		status: "success" | "warning" | "error"
		duration?: number
		details?: string
	}[],
): void {
	console.log("\n📊 Operation Summary:")
	console.log("─".repeat(60))

	const successful = operations.filter((op) => op.status === "success").length
	const warnings = operations.filter((op) => op.status === "warning").length
	const errors = operations.filter((op) => op.status === "error").length
	const totalDuration = operations.reduce((sum, op) => sum + (op.duration || 0), 0)

	operations.forEach((op) => {
		const icon = op.status === "success" ? "✓" : op.status === "warning" ? "⚠" : "✗"
		const color = op.status === "success" ? "\x1b[32m" : op.status === "warning" ? "\x1b[33m" : "\x1b[31m"
		const reset = "\x1b[0m"

		const duration = op.duration ? ` (${op.duration}ms)` : ""
		const details = op.details ? ` - ${op.details}` : ""

		console.log(`${color}${icon} ${op.name}${duration}${details}${reset}`)
	})

	console.log("─".repeat(60))
	console.log(
		`Total: ${operations.length} operations | ` +
			`✓ ${successful} successful | ` +
			`⚠ ${warnings} warnings | ` +
			`✗ ${errors} errors`,
	)

	if (totalDuration > 0) {
		console.log(`Total time: ${totalDuration}ms`)
	}
	console.log("")
}
