// kilocode_change - new file
import * as readline from "node:readline"

// Language-specific syntax highlighting color maps
const SYNTAX_COLORS = {
	javascript: {
		keyword: "\x1b[35m", // magenta
		string: "\x1b[32m", // green
		comment: "\x1b[90m", // dim
		number: "\x1b[33m", // yellow
		function: "\x1b[36m", // cyan
		operator: "\x1b[37m", // white
	},
	typescript: {
		keyword: "\x1b[35m", // magenta
		string: "\x1b[32m", // green
		comment: "\x1b[90m", // dim
		number: "\x1b[33m", // yellow
		function: "\x1b[36m", // cyan
		operator: "\x1b[37m", // white
		type: "\x1b[94m", // bright blue
	},
	json: {
		key: "\x1b[94m", // bright blue
		string: "\x1b[32m", // green
		number: "\x1b[33m", // yellow
		boolean: "\x1b[35m", // magenta
		null: "\x1b[90m", // dim
	},
	css: {
		selector: "\x1b[36m", // cyan
		property: "\x1b[94m", // bright blue
		value: "\x1b[32m", // green
		comment: "\x1b[90m", // dim
	},
	html: {
		tag: "\x1b[36m", // cyan
		attribute: "\x1b[33m", // yellow
		string: "\x1b[32m", // green
		comment: "\x1b[90m", // dim
	},
	bash: {
		command: "\x1b[36m", // cyan
		flag: "\x1b[33m", // yellow
		string: "\x1b[32m", // green
		comment: "\x1b[90m", // dim
		variable: "\x1b[35m", // magenta
	},
}

const RESET = "\x1b[0m"
const DIM = "\x1b[2m"
const BOLD = "\x1b[1m"

export class MarkdownRenderer {
	private color: any

	constructor(color: any) {
		this.color = color
	}

	public render(text: string): string {
		// Split into lines and process each one
		const lines = text.split("\n")
		const processedLines: string[] = []
		let inCodeBlock = false
		let codeBlockLang = ""
		let codeBlockLines: string[] = []

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i]

			// Handle code blocks
			if (line.startsWith("```")) {
				if (inCodeBlock) {
					// End of code block - render it
					const rendered = this.renderCodeBlock(codeBlockLines.join("\n"), codeBlockLang)
					processedLines.push(rendered)
					processedLines.push("") // Add spacing after code block
					inCodeBlock = false
					codeBlockLang = ""
					codeBlockLines = []
				} else {
					// Start of code block
					inCodeBlock = true
					codeBlockLang = line.slice(3).trim().toLowerCase()
					processedLines.push("") // Add spacing before code block
				}
				continue
			}

			if (inCodeBlock) {
				codeBlockLines.push(line)
				continue
			}

			// Process regular markdown
			processedLines.push(this.renderInline(line))
		}

		return processedLines.join("\n")
	}

	private renderCodeBlock(code: string, lang: string): string {
		// Map common language aliases
		const langMap: Record<string, string> = {
			js: "javascript",
			jsx: "javascript",
			ts: "typescript",
			tsx: "typescript",
			sh: "bash",
			shell: "bash",
		}

		const normalizedLang = langMap[lang] || lang
		const highlighted = this.highlightCode(code, normalizedLang)

		// Create a bordered code block
		const lines = highlighted.split("\n")
		const maxLength = Math.max(...lines.map((l) => this.stripAnsi(l).length))
		const border = `${this.color.dim}${"─".repeat(Math.min(maxLength + 4, 80))}${this.color.reset}`

		const result = [
			`${this.color.dim}╭${border.slice(1)}╮${this.color.reset}`,
			...lines.map((line) => {
				const paddedLine = line.padEnd(maxLength)
				return `${this.color.dim}│${this.color.reset} ${paddedLine} ${this.color.dim}│${this.color.reset}`
			}),
			`${this.color.dim}╰${border.slice(1)}╯${this.color.reset}`,
		]

		return result.join("\n")
	}

	private highlightCode(code: string, lang: string): string {
		const colors = SYNTAX_COLORS[lang as keyof typeof SYNTAX_COLORS]
		if (!colors) {
			// No syntax highlighting for unknown languages, but still apply code styling
			return `${this.color.dim}${code}${this.color.reset}`
		}

		switch (lang) {
			case "javascript":
			case "typescript":
				return this.highlightJavaScript(code, colors)
			case "json":
				return this.highlightJson(code, colors)
			case "css":
				return this.highlightCss(code, colors)
			case "html":
				return this.highlightHtml(code, colors)
			case "bash":
				return this.highlightBash(code, colors)
			default:
				return `${this.color.dim}${code}${this.color.reset}`
		}
	}

	private highlightJavaScript(code: string, colors: any): string {
		const keywords =
			/\b(async|await|function|const|let|var|if|else|for|while|return|import|export|from|class|extends|try|catch|finally|throw|new|this|super|static|public|private|protected|interface|type|enum)\b/g
		const strings = /(["'`])((?:\\.|(?!\1)[^\\])*?)\1/g
		const comments = /(\/\/.*$|\/\*[\s\S]*?\*\/)/gm
		const numbers = /\b\d+(\.\d+)?\b/g
		const functions = /\b(\w+)(?=\s*\()/g

		let highlighted = code
		highlighted = highlighted.replace(comments, `${colors.comment}$1${RESET}`)
		highlighted = highlighted.replace(strings, `${colors.string}$1$2$1${RESET}`)
		highlighted = highlighted.replace(keywords, `${colors.keyword}$1${RESET}`)
		highlighted = highlighted.replace(numbers, `${colors.number}$1${RESET}`)
		highlighted = highlighted.replace(functions, `${colors.function}$1${RESET}`)

		return highlighted
	}

	private highlightJson(code: string, colors: any): string {
		const keys = /"([^"]+)"(?=\s*:)/g
		const strings = /"([^"]*)"(?!\s*:)/g
		const numbers = /\b\d+(\.\d+)?\b/g
		const booleans = /\b(true|false)\b/g
		const nulls = /\bnull\b/g

		let highlighted = code
		highlighted = highlighted.replace(keys, `${colors.key}"$1"${RESET}`)
		highlighted = highlighted.replace(strings, `${colors.string}"$1"${RESET}`)
		highlighted = highlighted.replace(numbers, `${colors.number}$1${RESET}`)
		highlighted = highlighted.replace(booleans, `${colors.boolean}$1${RESET}`)
		highlighted = highlighted.replace(nulls, `${colors.null}$1${RESET}`)

		return highlighted
	}

	private highlightCss(code: string, colors: any): string {
		const selectors = /^([^{]+)(?=\s*\{)/gm
		const properties = /(\w+)(?=\s*:)/g
		const values = /:([^;]+);/g
		const comments = /(\/\*[\s\S]*?\*\/)/g

		let highlighted = code
		highlighted = highlighted.replace(comments, `${colors.comment}$1${RESET}`)
		highlighted = highlighted.replace(selectors, `${colors.selector}$1${RESET}`)
		highlighted = highlighted.replace(properties, `${colors.property}$1${RESET}`)
		highlighted = highlighted.replace(values, `:${colors.value}$1${RESET};`)

		return highlighted
	}

	private highlightHtml(code: string, colors: any): string {
		const tags = /<\/?(\w+)[^>]*>/g
		const attributes = /(\w+)=("[^"]*"|'[^']*')/g
		const comments = /(<!--[\s\S]*?-->)/g

		let highlighted = code
		highlighted = highlighted.replace(comments, `${colors.comment}$1${RESET}`)
		highlighted = highlighted.replace(attributes, `${colors.attribute}$1${RESET}=${colors.string}$2${RESET}`)
		highlighted = highlighted.replace(tags, `${colors.tag}$&${RESET}`)

		return highlighted
	}

	private highlightBash(code: string, colors: any): string {
		const comments = /(#.*$)/gm
		const strings = /(["'])((?:\\.|(?!\1)[^\\])*?)\1/g
		const commands = /^\s*(\w+)/gm
		const flags = /(\s-+\w+)/g
		const variables = /(\$\w+|\$\{[^}]+\})/g

		let highlighted = code
		highlighted = highlighted.replace(comments, `${colors.comment}$1${RESET}`)
		highlighted = highlighted.replace(strings, `${colors.string}$1$2$1${RESET}`)
		highlighted = highlighted.replace(variables, `${colors.variable}$1${RESET}`)
		highlighted = highlighted.replace(commands, `${colors.command}$1${RESET}`)
		highlighted = highlighted.replace(flags, `${colors.flag}$1${RESET}`)

		return highlighted
	}

	private renderInline(line: string): string {
		// Handle headers
		if (line.startsWith("#")) {
			const level = line.match(/^#+/)?.[0].length || 1
			const text = line.replace(/^#+\s*/, "")
			const color = level === 1 ? this.color.bright + this.color.cyan : this.color.cyan
			return `${color}${text}${this.color.reset}`
		}

		// Handle bold
		line = line.replace(/\*\*(.*?)\*\*/g, `${BOLD}$1${RESET}`)

		// Handle italic (using dim for terminal compatibility)
		line = line.replace(/\*(.*?)\*/g, `${DIM}$1${RESET}`)

		// Handle inline code
		line = line.replace(/`([^`]+)`/g, `${this.color.yellow}$1${this.color.reset}`)

		// Handle links - show as underlined text
		line = line.replace(/\[([^\]]+)\]\([^)]+\)/g, `${this.color.blue}$1${this.color.reset}`)

		return line
	}

	private stripAnsi(str: string): string {
		// Remove ANSI escape codes for length calculation
		return str.replace(/\x1b\[[0-9;]*m/g, "")
	}
}
