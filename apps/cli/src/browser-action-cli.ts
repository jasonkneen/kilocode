import https from "node:https"
import http from "node:http"
import { URL } from "node:url"
import * as fs from "node:fs/promises"

export interface BrowserActionResult {
	success: boolean
	url?: string
	content?: string
	title?: string
	error?: string
	metadata?: {
		statusCode?: number
		contentType?: string
		size?: number
		redirected?: boolean
		finalUrl?: string
	}
}

export interface BrowserActionParams {
	action: string
	url?: string
	coordinate?: string
	text?: string
	size?: string
}

/**
 * CLI-appropriate browser action implementation
 * Provides web content fetching and basic navigation without GUI dependencies
 */
export class CliBrowserAction {
	private currentUrl?: string
	private userAgent = "Mozilla/5.0 (compatible; Kilocode-CLI/1.0; +https://kilocode.ai)"
	private timeout = 15000 // 15 seconds
	private maxRedirects = 5
	private maxContentSize = 10 * 1024 * 1024 // 10MB

	/**
	 * Execute a browser action in CLI-appropriate way
	 */
	async execute(params: BrowserActionParams): Promise<BrowserActionResult> {
		const { action, url, coordinate, text, size } = params

		try {
			switch (action) {
				case "launch":
					return await this.launch(url!)
				case "navigate":
					return await this.navigate(url!)
				case "click":
					return this.handleUnsupportedAction("click", "Coordinate-based clicking not supported in CLI mode")
				case "hover":
					return this.handleUnsupportedAction("hover", "Mouse hover not supported in CLI mode")
				case "type":
					return this.handleUnsupportedAction("type", "Text input not supported in CLI mode")
				case "scroll_down":
					return this.handleUnsupportedAction("scroll_down", "Scrolling not supported in CLI mode")
				case "scroll_up":
					return this.handleUnsupportedAction("scroll_up", "Scrolling not supported in CLI mode")
				case "resize":
					return this.handleUnsupportedAction("resize", "Window resizing not supported in CLI mode")
				case "close":
					return this.close()
				default:
					return {
						success: false,
						error: `Unknown browser action: ${action}`,
					}
			}
		} catch (error) {
			return {
				success: false,
				error: `Browser action failed: ${error instanceof Error ? error.message : String(error)}`,
			}
		}
	}

	/**
	 * Launch browser session by fetching initial URL
	 */
	private async launch(url: string): Promise<BrowserActionResult> {
		if (!url) {
			return {
				success: false,
				error: "URL parameter is required for launch action",
			}
		}

		const result = await this.fetchUrl(url)
		if (result.success) {
			this.currentUrl = result.url
		}
		return result
	}

	/**
	 * Navigate to a new URL
	 */
	private async navigate(url: string): Promise<BrowserActionResult> {
		if (!url) {
			return {
				success: false,
				error: "URL parameter is required for navigate action",
			}
		}

		const result = await this.fetchUrl(url)
		if (result.success) {
			this.currentUrl = result.url
		}
		return result
	}

	/**
	 * Close browser session
	 */
	private close(): BrowserActionResult {
		this.currentUrl = undefined
		return {
			success: true,
			content: "Browser session closed successfully",
		}
	}

	/**
	 * Handle actions that are not supported in CLI mode
	 */
	private handleUnsupportedAction(action: string, reason: string): BrowserActionResult {
		return {
			success: false,
			error: `${action} action not supported: ${reason}. Use basic navigation actions (launch, navigate, close) instead.`,
		}
	}

	/**
	 * Fetch URL content with comprehensive error handling
	 */
	private async fetchUrl(urlString: string, redirectCount = 0): Promise<BrowserActionResult> {
		try {
			// Validate URL
			const validation = this.validateUrl(urlString)
			if (!validation.valid) {
				return {
					success: false,
					error: validation.error,
				}
			}

			const url = new URL(urlString)
			const isHttps = url.protocol === "https:"
			const client = isHttps ? https : http

			return new Promise<BrowserActionResult>((resolve) => {
				const options = {
					hostname: url.hostname,
					port: url.port || (isHttps ? 443 : 80),
					path: url.pathname + url.search,
					method: "GET",
					headers: {
						"User-Agent": this.userAgent,
						Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
						"Accept-Language": "en-US,en;q=0.5",
						"Accept-Encoding": "gzip, deflate",
						Connection: "close",
					},
					timeout: this.timeout,
				}

				const req = client.request(options, (res) => {
					// Handle redirects
					if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
						if (redirectCount >= this.maxRedirects) {
							resolve({
								success: false,
								error: `Too many redirects (max ${this.maxRedirects})`,
							})
							return
						}

						const redirectUrl = new URL(res.headers.location, urlString).toString()
						this.fetchUrl(redirectUrl, redirectCount + 1).then(resolve)
						return
					}

					// Handle HTTP errors
					if (res.statusCode && res.statusCode >= 400) {
						resolve({
							success: false,
							error: `HTTP ${res.statusCode}: ${res.statusMessage || "Request failed"}`,
							metadata: {
								statusCode: res.statusCode,
								contentType: res.headers["content-type"],
							},
						})
						return
					}

					let data = ""
					let size = 0

					res.on("data", (chunk) => {
						size += chunk.length
						if (size > this.maxContentSize) {
							req.destroy()
							resolve({
								success: false,
								error: `Content too large (exceeds ${this.maxContentSize / 1024 / 1024}MB limit)`,
							})
							return
						}
						data += chunk.toString()
					})

					res.on("end", () => {
						const contentType = res.headers["content-type"] || ""
						const title = this.extractTitle(data, contentType)
						const cleanContent = this.cleanContent(data, contentType)

						resolve({
							success: true,
							url: urlString,
							content: cleanContent,
							title,
							metadata: {
								statusCode: res.statusCode,
								contentType,
								size,
								redirected: redirectCount > 0,
								finalUrl: redirectCount > 0 ? urlString : undefined,
							},
						})
					})
				})

				req.on("error", (error) => {
					resolve({
						success: false,
						error: `Network error: ${error.message}`,
					})
				})

				req.on("timeout", () => {
					req.destroy()
					resolve({
						success: false,
						error: `Request timeout after ${this.timeout}ms`,
					})
				})

				req.end()
			})
		} catch (error) {
			return {
				success: false,
				error: `Failed to fetch URL: ${error instanceof Error ? error.message : String(error)}`,
			}
		}
	}

	/**
	 * Validate URL format and security
	 */
	private validateUrl(urlString: string): { valid: boolean; error?: string } {
		try {
			const url = new URL(urlString)

			// Only allow HTTP and HTTPS protocols
			if (url.protocol !== "http:" && url.protocol !== "https:") {
				return {
					valid: false,
					error: `Unsupported protocol: ${url.protocol}. Only HTTP and HTTPS are allowed.`,
				}
			}

			// Block private/local IP addresses for security
			const hostname = url.hostname.toLowerCase()
			if (this.isPrivateIp(hostname)) {
				return {
					valid: false,
					error: `Access to private/local IP addresses is not allowed: ${hostname}`,
				}
			}

			// Block localhost variants
			if (hostname === "localhost" || hostname.endsWith(".localhost")) {
				// Allow localhost in development/test environments
				if (process.env.NODE_ENV === "development" || process.env.ALLOW_LOCALHOST === "true") {
					return { valid: true }
				}
				return {
					valid: false,
					error: `Access to localhost is not allowed in production mode`,
				}
			}

			return { valid: true }
		} catch (error) {
			return {
				valid: false,
				error: `Invalid URL format: ${error instanceof Error ? error.message : String(error)}`,
			}
		}
	}

	/**
	 * Check if hostname is a private IP address
	 */
	private isPrivateIp(hostname: string): boolean {
		// IPv4 private ranges: 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16
		const privateV4Patterns = [
			/^10\./,
			/^172\.(1[6-9]|2\d|3[01])\./,
			/^192\.168\./,
			/^127\./, // Loopback
			/^169\.254\./, // Link-local
		]

		// IPv6 private/local patterns
		const privateV6Patterns = [
			/^::1$/, // Loopback
			/^fe80:/, // Link-local
			/^fc00:/, // Unique local
			/^fd00:/, // Unique local
		]

		return (
			privateV4Patterns.some((pattern) => pattern.test(hostname)) ||
			privateV6Patterns.some((pattern) => pattern.test(hostname))
		)
	}

	/**
	 * Extract page title from HTML content
	 */
	private extractTitle(content: string, contentType: string): string {
		if (!contentType.includes("html")) {
			return "Non-HTML content"
		}

		try {
			const titleMatch = content.match(/<title[^>]*>(.*?)<\/title>/is)
			if (titleMatch && titleMatch[1]) {
				return titleMatch[1].replace(/\s+/g, " ").trim().substring(0, 200) // Limit title length
			}
		} catch (error) {
			// Ignore parsing errors
		}

		return "Untitled"
	}

	/**
	 * Clean and extract meaningful content
	 */
	private cleanContent(content: string, contentType: string): string {
		if (!contentType.includes("html")) {
			// For non-HTML content, return first few KB with basic cleanup
			return content
				.substring(0, 5000)
				.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "") // Remove control characters
				.trim()
		}

		try {
			// Basic HTML content extraction
			let cleaned = content
				// Remove script and style tags entirely
				.replace(/<(script|style)[^>]*>.*?<\/\1>/gis, "")
				// Remove HTML comments
				.replace(/<!--.*?-->/gs, "")
				// Convert common HTML entities
				.replace(/&amp;/g, "&")
				.replace(/&lt;/g, "<")
				.replace(/&gt;/g, ">")
				.replace(/&quot;/g, '"')
				.replace(/&#39;/g, "'")
				.replace(/&nbsp;/g, " ")
				// Remove HTML tags but keep content
				.replace(/<[^>]+>/g, " ")
				// Clean up whitespace
				.replace(/\s+/g, " ")
				.trim()

			// Limit content size for CLI output
			if (cleaned.length > 10000) {
				cleaned = cleaned.substring(0, 10000) + "\n\n... (content truncated for CLI display)"
			}

			return cleaned
		} catch (error) {
			return `Error parsing HTML content: ${error instanceof Error ? error.message : String(error)}`
		}
	}

	/**
	 * Get current session info
	 */
	getSessionInfo(): { currentUrl?: string } {
		return { currentUrl: this.currentUrl }
	}
}

/**
 * Factory function to create CLI browser action instance
 */
export function createCliBrowserAction(): CliBrowserAction {
	return new CliBrowserAction()
}
