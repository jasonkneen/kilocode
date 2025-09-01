/**
 * Advanced Terminal Formatter
 *
 * Provides enterprise-grade CLI user experience including:
 * - Rich terminal formatting with colors and styles
 * - Intelligent progress indicators and spinners
 * - Enhanced error messages with actionable guidance
 * - Professional output formatting and layouts
 */

import { performance } from "node:perf_hooks"

export interface FormattingOptions {
	colorEnabled?: boolean
	unicodeEnabled?: boolean
	progressStyle?: "bar" | "spinner" | "dots" | "minimal"
	errorStyle?: "detailed" | "concise" | "minimal"
	outputFormat?: "structured" | "compact" | "verbose"
	theme?: "default" | "minimal" | "professional" | "debug"
}

export interface ProgressIndicatorOptions {
	total?: number
	showPercentage?: boolean
	showETA?: boolean
	showSpeed?: boolean
	showCounter?: boolean
	width?: number
	format?: string
}

export interface ErrorDisplayOptions {
	showStackTrace?: boolean
	showSuggestions?: boolean
	showContext?: boolean
	maxContextLines?: number
	groupSimilarErrors?: boolean
}

export class AdvancedTerminalFormatter {
	private options: Required<FormattingOptions>
	private progressState: Map<string, ProgressState> = new Map()
	private readonly colors: Record<string, string>
	private readonly symbols: Record<string, string | string[]>
	private readonly themes: Record<string, ThemeConfig>

	constructor(options: FormattingOptions = {}) {
		this.options = {
			colorEnabled: process.stdout.isTTY && process.env.NO_COLOR !== "1",
			unicodeEnabled: process.platform !== "win32" || process.env.TERM_PROGRAM === "vscode",
			progressStyle: "bar",
			errorStyle: "detailed",
			outputFormat: "structured",
			theme: "professional",
			...options,
		}

		// Color definitions
		this.colors = {
			reset: "\x1b[0m",
			bright: "\x1b[1m",
			dim: "\x1b[2m",
			red: "\x1b[31m",
			green: "\x1b[32m",
			yellow: "\x1b[33m",
			blue: "\x1b[34m",
			magenta: "\x1b[35m",
			cyan: "\x1b[36m",
			white: "\x1b[37m",
			gray: "\x1b[90m",
			bgRed: "\x1b[41m",
			bgGreen: "\x1b[42m",
			bgYellow: "\x1b[43m",
			bgBlue: "\x1b[44m",
		}

		// Symbol definitions based on unicode support
		this.symbols = this.options.unicodeEnabled
			? {
					success: "✅",
					error: "❌",
					warning: "⚠️",
					info: "ℹ️",
					progress: "🔄",
					bullet: "•",
					arrow: "→",
					doubleArrow: "⇒",
					clock: "⏱️",
					rocket: "🚀",
					gear: "⚙️",
					file: "📄",
					folder: "📁",
					link: "🔗",
					key: "🔑",
					shield: "🛡️",
					chart: "📊",
					memory: "💾",
					cpu: "🖥️",
					network: "🌐",
					database: "🗄️",
					spinner: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"],
				}
			: {
					success: "[✓]",
					error: "[✗]",
					warning: "[!]",
					info: "[i]",
					progress: "[~]",
					bullet: "*",
					arrow: "->",
					doubleArrow: "=>",
					clock: "[T]",
					rocket: "[^]",
					gear: "[=]",
					file: "[F]",
					folder: "[D]",
					link: "[L]",
					key: "[K]",
					shield: "[S]",
					chart: "[#]",
					memory: "[M]",
					cpu: "[C]",
					network: "[N]",
					database: "[DB]",
					spinner: ["|", "/", "-", "\\"],
				}

		// Theme configurations
		this.themes = {
			default: {
				primary: this.colors.blue,
				secondary: this.colors.cyan,
				success: this.colors.green,
				warning: this.colors.yellow,
				error: this.colors.red,
				muted: this.colors.gray,
				highlight: this.colors.bright,
			},
			minimal: {
				primary: "",
				secondary: "",
				success: "",
				warning: "",
				error: "",
				muted: this.colors.dim,
				highlight: this.colors.bright,
			},
			professional: {
				primary: this.colors.blue + this.colors.bright,
				secondary: this.colors.cyan,
				success: this.colors.green + this.colors.bright,
				warning: this.colors.yellow + this.colors.bright,
				error: this.colors.red + this.colors.bright,
				muted: this.colors.gray,
				highlight: this.colors.white + this.colors.bright,
			},
			debug: {
				primary: this.colors.magenta,
				secondary: this.colors.cyan,
				success: this.colors.green,
				warning: this.colors.yellow + this.colors.bright,
				error: this.colors.red + this.colors.bgRed + this.colors.white,
				muted: this.colors.gray,
				highlight: this.colors.white + this.colors.bright,
			},
		}
	}

	// Advanced success formatting with metadata
	formatSuccess(
		message: string,
		metadata?: {
			duration?: number
			filesAffected?: string[]
			bytesProcessed?: number
			details?: Record<string, any>
		},
	): string {
		const theme = this.themes[this.options.theme]
		const timestamp = new Date().toLocaleTimeString()

		let output = `${theme.success}${this.symbols.success} ${message}${this.colors.reset}`

		if (metadata) {
			const details: string[] = []

			if (metadata.duration !== undefined) {
				const durationStr =
					metadata.duration < 1000 ? `${metadata.duration}ms` : `${(metadata.duration / 1000).toFixed(1)}s`
				details.push(`${this.symbols.clock} ${durationStr}`)
			}

			if (metadata.filesAffected && metadata.filesAffected.length > 0) {
				details.push(`${this.symbols.file} ${metadata.filesAffected.length} file(s)`)
			}

			if (metadata.bytesProcessed !== undefined) {
				const sizeStr = this.formatFileSize(metadata.bytesProcessed)
				details.push(`${this.symbols.memory} ${sizeStr}`)
			}

			if (details.length > 0) {
				output += `\n${theme.muted}  ${details.join(" • ")}${this.colors.reset}`
			}

			// Add structured details if available
			if (metadata.details && this.options.outputFormat === "verbose") {
				const detailLines = Object.entries(metadata.details)
					.map(([key, value]) => `    ${theme.secondary}${key}:${this.colors.reset} ${value}`)
					.join("\n")
				output += `\n${detailLines}`
			}
		}

		if (this.options.outputFormat === "verbose") {
			output += `\n${theme.muted}  ${this.symbols.clock} ${timestamp}${this.colors.reset}`
		}

		return output
	}

	// Enhanced error formatting with actionable guidance
	formatError(error: string, options: ErrorDisplayOptions = {}): string {
		const theme = this.themes[this.options.theme]
		const {
			showStackTrace = false,
			showSuggestions = true,
			showContext = true,
			maxContextLines = 3,
			groupSimilarErrors = true,
		} = options

		let output = `${theme.error}${this.symbols.error} Error: ${error}${this.colors.reset}`

		// Add error classification and suggestions
		if (showSuggestions) {
			const suggestions = this.generateErrorSuggestions(error)
			if (suggestions.length > 0) {
				output += `\n\n${theme.highlight}💡 Suggestions:${this.colors.reset}`
				suggestions.forEach((suggestion, index) => {
					output += `\n  ${theme.secondary}${index + 1}.${this.colors.reset} ${suggestion}`
				})
			}
		}

		// Add troubleshooting context
		if (showContext) {
			const context = this.generateTroubleshootingContext(error)
			if (context.length > 0) {
				output += `\n\n${theme.highlight}🔍 Troubleshooting:${this.colors.reset}`
				context.slice(0, maxContextLines).forEach((line) => {
					output += `\n  ${theme.muted}${this.symbols.arrow}${this.colors.reset} ${line}`
				})
			}
		}

		return output
	}

	private generateErrorSuggestions(error: string): string[] {
		const suggestions: string[] = []
		const errorLower = error.toLowerCase()

		// File operation errors
		if (errorLower.includes("enoent") || errorLower.includes("file not found")) {
			suggestions.push("Check if the file path is correct and the file exists")
			suggestions.push("Use `list_files` to verify the directory contents")
			suggestions.push("Ensure you have the correct working directory")
		}

		// Permission errors
		if (errorLower.includes("eacces") || errorLower.includes("permission denied")) {
			suggestions.push("Check file/directory permissions")
			suggestions.push("Try running with appropriate user permissions")
			suggestions.push("Verify the file is not locked by another process")
		}

		// MCP errors
		if (errorLower.includes("mcp") || errorLower.includes("server")) {
			suggestions.push("Verify MCP server is running: `/mcp list`")
			suggestions.push("Check server configuration in mcp.json")
			suggestions.push("Try refreshing the MCP connection")
		}

		// Command execution errors
		if (errorLower.includes("command") && errorLower.includes("failed")) {
			suggestions.push("Check if the command is available in PATH")
			suggestions.push("Verify command syntax and parameters")
			suggestions.push("Try running the command manually to test")
		}

		// Network/connectivity errors
		if (errorLower.includes("timeout") || errorLower.includes("connection")) {
			suggestions.push("Check internet connectivity")
			suggestions.push("Verify API endpoints and credentials")
			suggestions.push("Try increasing timeout values")
		}

		return suggestions
	}

	private generateTroubleshootingContext(error: string): string[] {
		const context: string[] = []
		const errorLower = error.toLowerCase()

		// Add relevant debug commands
		if (errorLower.includes("file") || errorLower.includes("path")) {
			context.push("Use `/debug files` to check file system state")
			context.push("Check `.rooignore` if files seem missing")
		}

		if (errorLower.includes("mcp") || errorLower.includes("server")) {
			context.push("Use `/mcp status` to check server health")
			context.push("Check logs in `.kilocode/logs/` for details")
		}

		if (errorLower.includes("provider") || errorLower.includes("api")) {
			context.push("Use `/providers status` to check API connectivity")
			context.push("Verify API keys and quotas")
		}

		// Add documentation links
		context.push("For more help: https://docs.kilocode.org/troubleshooting")

		return context
	}

	// Advanced progress indicators
	createProgressIndicator(id: string, options: ProgressIndicatorOptions = {}): ProgressIndicator {
		const {
			total,
			showPercentage = true,
			showETA = true,
			showSpeed = false,
			showCounter = true,
			width = 40,
			format = "{bar} {percentage} {counter} {eta}",
		} = options

		const indicator = new ProgressIndicator(id, {
			total,
			showPercentage,
			showETA,
			showSpeed,
			showCounter,
			width,
			format,
			symbols: this.symbols,
			colors: this.colors,
			theme: this.themes[this.options.theme],
			style: this.options.progressStyle,
		})

		this.progressState.set(id, indicator.getState())
		return indicator
	}

	// Professional output formatting
	formatStructuredOutput(data: {
		title: string
		status: "success" | "warning" | "error" | "info"
		summary?: string
		details?: Record<string, any>
		metadata?: Record<string, any>
		actions?: string[]
	}): string {
		const theme = this.themes[this.options.theme]

		// Header with status
		const statusColors = {
			success: theme.success,
			warning: theme.warning,
			error: theme.error,
			info: theme.primary,
		}

		const statusSymbols = {
			success: this.symbols.success,
			warning: this.symbols.warning,
			error: this.symbols.error,
			info: this.symbols.info,
		}

		let output = `${statusColors[data.status]}${statusSymbols[data.status]} ${data.title}${this.colors.reset}`

		// Summary section
		if (data.summary) {
			output += `\n${theme.secondary}${data.summary}${this.colors.reset}`
		}

		// Details section
		if (data.details && Object.keys(data.details).length > 0) {
			output += `\n\n${theme.highlight}Details:${this.colors.reset}`

			for (const [key, value] of Object.entries(data.details)) {
				const formattedKey = key.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase())
				const formattedValue = this.formatValue(value)
				output += `\n  ${theme.primary}${formattedKey}:${this.colors.reset} ${formattedValue}`
			}
		}

		// Metadata section (for verbose output)
		if (data.metadata && this.options.outputFormat === "verbose") {
			output += `\n\n${theme.muted}Metadata:${this.colors.reset}`
			for (const [key, value] of Object.entries(data.metadata)) {
				output += `\n  ${theme.muted}${key}: ${value}${this.colors.reset}`
			}
		}

		// Actions section
		if (data.actions && data.actions.length > 0) {
			output += `\n\n${theme.highlight}Next Steps:${this.colors.reset}`
			data.actions.forEach((action, index) => {
				output += `\n  ${theme.secondary}${index + 1}.${this.colors.reset} ${action}`
			})
		}

		return output
	}

	private formatValue(value: any): string {
		if (typeof value === "boolean") {
			return value
				? `${this.themes[this.options.theme].success}✓${this.colors.reset}`
				: `${this.themes[this.options.theme].error}✗${this.colors.reset}`
		}

		if (typeof value === "number") {
			// Format file sizes, durations, etc.
			if (value > 1024 * 1024) {
				return this.formatFileSize(value)
			} else if (value > 1000 && value < 10000) {
				// Likely a duration in ms
				return `${value}ms`
			}
		}

		if (Array.isArray(value)) {
			if (value.length === 0) return "none"
			if (value.length <= 3) return value.join(", ")
			return `${value.slice(0, 2).join(", ")} and ${value.length - 2} more`
		}

		return String(value)
	}

	private formatFileSize(bytes: number): string {
		const units = ["B", "KB", "MB", "GB", "TB"]
		let size = bytes
		let unitIndex = 0

		while (size >= 1024 && unitIndex < units.length - 1) {
			size /= 1024
			unitIndex++
		}

		return `${size.toFixed(1)}${units[unitIndex]}`
	}

	// Professional table formatting
	formatTable(data: {
		headers: string[]
		rows: string[][]
		title?: string
		alignment?: ("left" | "center" | "right")[]
	}): string {
		const theme = this.themes[this.options.theme]
		const { headers, rows, title, alignment = [] } = data

		// Calculate column widths
		const colWidths = headers.map((header, index) => {
			const maxContentWidth = Math.max(header.length, ...rows.map((row) => (row[index] || "").toString().length))
			return Math.min(maxContentWidth, 50) // Cap at 50 chars
		})

		// Helper function to pad text
		const padText = (text: string, width: number, align: "left" | "center" | "right" = "left"): string => {
			const truncated = text.length > width ? text.substring(0, width - 3) + "..." : text

			switch (align) {
				case "center":
					const padding = width - truncated.length
					const leftPad = Math.floor(padding / 2)
					const rightPad = padding - leftPad
					return " ".repeat(leftPad) + truncated + " ".repeat(rightPad)
				case "right":
					return truncated.padStart(width)
				default:
					return truncated.padEnd(width)
			}
		}

		let output = ""

		// Title
		if (title) {
			output += `${theme.highlight}${title}${this.colors.reset}\n`
		}

		// Headers
		const headerRow = headers
			.map(
				(header, index) =>
					`${theme.primary}${padText(header, colWidths[index], alignment[index])}${this.colors.reset}`,
			)
			.join(" | ")

		output += headerRow + "\n"

		// Separator
		const separator = colWidths.map((width) => "-".repeat(width)).join("-+-")
		output += `${theme.muted}${separator}${this.colors.reset}\n`

		// Data rows
		rows.forEach((row) => {
			const formattedRow = row
				.map((cell, index) => padText(cell?.toString() || "", colWidths[index], alignment[index]))
				.join(" | ")
			output += formattedRow + "\n"
		})

		return output
	}

	// Enhanced box formatting for important messages
	formatBox(
		content: string,
		options: {
			style?: "single" | "double" | "rounded" | "thick"
			padding?: number
			title?: string
			width?: number
			align?: "left" | "center" | "right"
		} = {},
	): string {
		const { style = "single", padding = 1, title, width = 80, align = "left" } = options

		const theme = this.themes[this.options.theme]

		// Box characters based on style
		const boxChars = this.options.unicodeEnabled
			? {
					single: { h: "─", v: "│", tl: "┌", tr: "┐", bl: "└", br: "┘" },
					double: { h: "═", v: "║", tl: "╔", tr: "╗", bl: "╚", br: "╝" },
					rounded: { h: "─", v: "│", tl: "╭", tr: "╮", bl: "╰", br: "╯" },
					thick: { h: "━", v: "┃", tl: "┏", tr: "┓", bl: "┗", br: "┛" },
				}
			: {
					single: { h: "-", v: "|", tl: "+", tr: "+", bl: "+", br: "+" },
					double: { h: "=", v: "|", tl: "+", tr: "+", bl: "+", br: "+" },
					rounded: { h: "-", v: "|", tl: "+", tr: "+", bl: "+", br: "+" },
					thick: { h: "#", v: "#", tl: "#", tr: "#", bl: "#", br: "#" },
				}

		const chars = boxChars[style]
		const innerWidth = width - 2

		// Prepare content lines
		const contentLines = content
			.split("\n")
			.map((line) => {
				if (line.length > innerWidth - 2 * padding) {
					// Wrap long lines
					const words = line.split(" ")
					const wrappedLines: string[] = []
					let currentLine = ""

					for (const word of words) {
						if ((currentLine + " " + word).length <= innerWidth - 2 * padding) {
							currentLine += (currentLine ? " " : "") + word
						} else {
							if (currentLine) wrappedLines.push(currentLine)
							currentLine = word
						}
					}
					if (currentLine) wrappedLines.push(currentLine)

					return wrappedLines
				}
				return [line]
			})
			.flat()

		// Build box
		let output = ""

		// Top border
		if (title) {
			const titlePadding = Math.max(0, Math.floor((innerWidth - title.length) / 2))
			const titleLine = " ".repeat(titlePadding) + title + " ".repeat(innerWidth - titlePadding - title.length)
			output += `${theme.primary}${chars.tl}${chars.h.repeat(Math.max(0, titlePadding - 1))} ${theme.highlight}${title}${theme.primary} ${chars.h.repeat(Math.max(0, innerWidth - titlePadding - title.length - 1))}${chars.tr}${this.colors.reset}\n`
		} else {
			output += `${theme.primary}${chars.tl}${chars.h.repeat(innerWidth)}${chars.tr}${this.colors.reset}\n`
		}

		// Content lines
		contentLines.forEach((line) => {
			const paddedLine =
				" ".repeat(padding) + line + " ".repeat(Math.max(0, innerWidth - padding * 2 - line.length))
			output += `${theme.primary}${chars.v}${this.colors.reset}${paddedLine}${theme.primary}${chars.v}${this.colors.reset}\n`
		})

		// Bottom border
		output += `${theme.primary}${chars.bl}${chars.h.repeat(innerWidth)}${chars.br}${this.colors.reset}`

		return output
	}

	// Enhanced list formatting
	formatList(
		items: Array<{
			text: string
			status?: "success" | "warning" | "error" | "info" | "pending"
			details?: string
			metadata?: Record<string, any>
		}>,
		options: {
			style?: "bullets" | "numbers" | "status" | "tree"
			indent?: number
			showMetadata?: boolean
		} = {},
	): string {
		const { style = "bullets", indent = 0, showMetadata = false } = options
		const theme = this.themes[this.options.theme]
		const baseIndent = " ".repeat(indent)

		return items
			.map((item, index) => {
				let output = baseIndent

				// Add prefix based on style
				switch (style) {
					case "numbers":
						output += `${theme.secondary}${index + 1}.${this.colors.reset} `
						break
					case "status":
						const statusSymbol = item.status
							? {
									success: this.symbols.success,
									warning: this.symbols.warning,
									error: this.symbols.error,
									info: this.symbols.info,
									pending: this.symbols.progress,
								}[item.status]
							: this.symbols.bullet
						output += `${statusSymbol} `
						break
					case "tree":
						const isLast = index === items.length - 1
						const connector = isLast ? "└── " : "├── "
						output += `${theme.muted}${connector}${this.colors.reset}`
						break
					default:
						output += `${theme.secondary}${this.symbols.bullet}${this.colors.reset} `
				}

				// Add main text with status coloring
				if (item.status) {
					const statusColor = {
						success: theme.success,
						warning: theme.warning,
						error: theme.error,
						info: theme.primary,
						pending: theme.muted,
					}[item.status]
					output += `${statusColor}${item.text}${this.colors.reset}`
				} else {
					output += item.text
				}

				// Add details
				if (item.details) {
					output += `\n${baseIndent}  ${theme.muted}${item.details}${this.colors.reset}`
				}

				// Add metadata for verbose output
				if (showMetadata && item.metadata) {
					const metadataEntries = Object.entries(item.metadata)
						.map(([key, value]) => `${key}: ${value}`)
						.join(", ")
					output += `\n${baseIndent}  ${theme.muted}(${metadataEntries})${this.colors.reset}`
				}

				return output
			})
			.join("\n")
	}

	// Banner and header formatting
	formatBanner(text: string, style: "simple" | "fancy" | "minimal" = "fancy"): string {
		const theme = this.themes[this.options.theme]

		if (style === "minimal") {
			return `${theme.highlight}${text}${this.colors.reset}`
		}

		if (style === "simple") {
			const border = "=".repeat(text.length + 4)
			return `${theme.primary}${border}\n  ${text}\n${border}${this.colors.reset}`
		}

		// Fancy banner with decorative elements
		const width = Math.max(text.length + 8, 60)
		const padding = Math.floor((width - text.length - 4) / 2)

		let banner = ""
		banner += `${theme.primary}${"═".repeat(width)}${this.colors.reset}\n`
		banner += `${theme.primary}║${" ".repeat(padding)}${theme.highlight}${text}${theme.primary}${" ".repeat(width - padding - text.length - 2)}║${this.colors.reset}\n`
		banner += `${theme.primary}${"═".repeat(width)}${this.colors.reset}`

		return banner
	}

	// Cleanup and disable features for testing
	cleanup(): void {
		this.progressState.clear()
	}

	// Utility: Strip ANSI codes for testing/logging
	stripAnsiCodes(text: string): string {
		return text.replace(/\x1b\[[0-9;]*m/g, "")
	}

	// Theme switching
	setTheme(theme: string): void {
		if (theme in this.themes) {
			this.options.theme = theme as "default" | "minimal" | "professional" | "debug"
		}
	}

	// Enable/disable colors dynamically
	setColorEnabled(enabled: boolean): void {
		this.options.colorEnabled = enabled
	}
}

interface ProgressState {
	id: string
	current: number
	total?: number
	startTime: number
	lastUpdate: number
}

interface ThemeConfig {
	primary: string
	secondary: string
	success: string
	warning: string
	error: string
	muted: string
	highlight: string
}

export class ProgressIndicator {
	private state: ProgressState
	private options: Required<ProgressIndicatorOptions> & {
		symbols: Record<string, any>
		colors: Record<string, string>
		theme: ThemeConfig
		style: string
	}
	private spinnerIndex: number = 0

	constructor(id: string, options: any) {
		this.state = {
			id,
			current: 0,
			total: options.total,
			startTime: performance.now(),
			lastUpdate: performance.now(),
		}
		this.options = options
	}

	update(current: number, message?: string): string {
		this.state.current = current
		this.state.lastUpdate = performance.now()

		return this.render(message)
	}

	increment(message?: string): string {
		this.state.current++
		this.state.lastUpdate = performance.now()

		return this.render(message)
	}

	private render(message?: string): string {
		const { theme, colors, symbols } = this.options
		const elapsed = this.state.lastUpdate - this.state.startTime

		let output = ""

		// Progress bar or spinner
		if (this.options.style === "bar" && this.state.total) {
			const percentage = Math.min(100, (this.state.current / this.state.total) * 100)
			const completed = Math.floor((this.options.width * percentage) / 100)
			const remaining = this.options.width - completed

			const bar = `${theme.success}${"█".repeat(completed)}${theme.muted}${"░".repeat(remaining)}${colors.reset}`
			output += `${bar}`

			if (this.options.showPercentage) {
				output += ` ${theme.primary}${percentage.toFixed(1)}%${colors.reset}`
			}

			if (this.options.showCounter) {
				output += ` ${theme.secondary}(${this.state.current}/${this.state.total})${colors.reset}`
			}
		} else {
			// Spinner mode
			const spinner = symbols.spinner[this.spinnerIndex % symbols.spinner.length]
			this.spinnerIndex++
			output += `${theme.primary}${spinner}${colors.reset}`
		}

		// ETA calculation
		if (this.options.showETA && this.state.total && this.state.current > 0) {
			const rate = this.state.current / (elapsed / 1000) // items per second
			const remaining = this.state.total - this.state.current
			const etaSeconds = remaining / rate

			if (etaSeconds > 0 && etaSeconds < 3600) {
				// Only show if under 1 hour
				const etaStr =
					etaSeconds < 60
						? `${Math.round(etaSeconds)}s`
						: `${Math.floor(etaSeconds / 60)}m${Math.round(etaSeconds % 60)}s`
				output += ` ${theme.muted}ETA: ${etaStr}${colors.reset}`
			}
		}

		// Current message
		if (message) {
			output += ` ${theme.secondary}${message}${colors.reset}`
		}

		return output
	}

	getState(): ProgressState {
		return { ...this.state }
	}

	complete(message?: string): string {
		this.state.current = this.state.total || this.state.current
		const elapsed = performance.now() - this.state.startTime

		const { theme, colors, symbols } = this.options

		return (
			`${theme.success}${symbols.success} ${message || "Complete"}${colors.reset} ` +
			`${theme.muted}(${Math.round(elapsed)}ms)${colors.reset}`
		)
	}
}
