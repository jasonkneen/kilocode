// kilocode_change - new file
import * as readline from "node:readline"

export const ANIMATION_DELAY_MS = 150

export class CliThinkingAnimation {
	private animationInterval: NodeJS.Timeout | null = null
	private animationState = 0
	private readonly spinnerFrames = ["⠦", "⠧", "⠇", "⠏", "⠋", "⠙", "⠸", "⠼"]
	private isActive = false
	private color: any

	constructor(color: any) {
		this.color = color
	}

	public startThinking(): void {
		if (this.isActive) return
		this.isActive = true
		this.animationState = 0

		// Show initial thinking indicator
		process.stdout.write(`\nThinking `)

		// Start animation
		this.animationInterval = setInterval(() => {
			this.updateAnimation()
		}, 150)
	}

	public startWorking(): void {
		this.stopAnimation()
		process.stdout.write(`Working`)
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

		// Simple spinner animation: cycle through frames
		this.animationState = (this.animationState + 1) % this.spinnerFrames.length
		this.updateDisplay()
	}

	private updateDisplay(): void {
		const spinnerChar = this.spinnerFrames[this.animationState]

		// Update the display
		readline.clearLine(process.stdout, 0)
		readline.cursorTo(process.stdout, 0)
		process.stdout.write(`Thinking ${spinnerChar}`)
	}

	public isAnimating(): boolean {
		return this.isActive
	}
}
