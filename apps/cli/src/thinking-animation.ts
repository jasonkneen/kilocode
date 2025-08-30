// kilocode_change - new file
import * as readline from "node:readline"

export const ANIMATION_DELAY_MS = 150

export class CliThinkingAnimation {
	private animationInterval: NodeJS.Timeout | null = null
	private animationState = 0
	private isTypingPhase = true
	private readonly animationFrames = ["█", "K█", "KI█", "KIL█", "KILO█"]
	private isBlockVisible = true
	private isActive = false
	private currentLine = ""
	private color: any

	constructor(color: any) {
		this.color = color
	}

	public startThinking(): void {
		if (this.isActive) return
		this.isActive = true
		this.animationState = 0
		this.isTypingPhase = true
		this.isBlockVisible = true

		// Show initial thinking indicator
		process.stdout.write(`\n${this.color.magenta}💭 Thinking${this.color.reset} `)

		// Start animation
		this.animationInterval = setInterval(() => {
			this.updateAnimation()
		}, 100)
	}

	public startWorking(): void {
		this.stopAnimation()
		process.stdout.write(`${this.color.yellow}⚙︎ Working${this.color.reset}`)
	}

	public hide(): void {
		this.stopAnimation()
		if (this.isActive) {
			// Clear the current line
			readline.clearLine(process.stdout, 0)
			readline.cursorTo(process.stdout, 0)
			this.isActive = false
		}
	}

	public stopAnimation(): void {
		if (this.animationInterval) {
			clearInterval(this.animationInterval)
			this.animationInterval = null
		}
		if (this.isActive) {
			// Move to next line to preserve the thinking indicator
			process.stdout.write("\n")
			this.isActive = false
		}
	}

	private updateAnimation(): void {
		if (!this.isActive) return

		// Animation with two phases like VS Code extension:
		// 1. Typing out "KILO" (block moves to the right) - faster (100ms)
		// 2. Blinking block at the end when fully spelled - slower (200ms)
		if (this.animationState < this.animationFrames.length - 1) {
			// Phase 1: Spell out "KILO" with block cursor
			this.animationState++
		} else {
			// Check if we just reached the end of typing phase
			if (this.isTypingPhase) {
				// Transition from typing to blinking phase
				this.isTypingPhase = false

				// Clear current interval and create a new one with slower timing (200ms)
				if (this.animationInterval) {
					clearInterval(this.animationInterval)
				}

				this.animationInterval = setInterval(() => {
					this.updateAnimation()
				}, 200)
			}

			// Phase 2: Blink the block cursor at the end
			this.isBlockVisible = !this.isBlockVisible
		}

		this.updateDisplay()
	}

	private updateDisplay(): void {
		let text: string

		// When fully spelled and in blinking mode
		if (this.animationState === this.animationFrames.length - 1) {
			// Show either the full frame with block, or just "KILO" without block
			text = this.isBlockVisible ? this.animationFrames[this.animationState] : "KILO"
		} else {
			// Normal animation frames (with block)
			text = this.animationFrames[this.animationState]
		}

		// Update the display
		readline.clearLine(process.stdout, 0)
		readline.cursorTo(process.stdout, 0)
		process.stdout.write(
			`${this.color.magenta}💭 Thinking${this.color.reset} ${this.color.dim}${text}${this.color.reset}`,
		)
	}

	public isAnimating(): boolean {
		return this.isActive
	}
}
