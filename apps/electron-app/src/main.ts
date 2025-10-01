import { app, BrowserWindow, shell, ipcMain } from "electron"
import { net } from "electron"
import path from "path"
import fs from "fs"
import { spawn } from "child_process"
import { kiloCodeBackend } from "./kilocode-backend"

class ElectronApp {
	private mainWindow: BrowserWindow | null = null
	private isDev: boolean = process.env.NODE_ENV === "development" || !app.isPackaged

	constructor() {
		this.setupApp()
	}

	private setupApp(): void {
		// Setup IPC handlers
		this.setupIpcHandlers()

		app.whenReady().then(() => {
			this.createMainWindow()
		})

		app.on("activate", () => {
			if (BrowserWindow.getAllWindows().length === 0) {
				this.createMainWindow()
			}
		})

		app.on("window-all-closed", () => {
			if (process.platform !== "darwin") {
				app.quit()
			}
		})

		// Security: Handle external links
		app.on("web-contents-created", (_, contents) => {
			contents.setWindowOpenHandler(({ url }) => {
				shell.openExternal(url)
				return { action: "deny" }
			})
		})
	}

	private createMainWindow(): void {
		this.mainWindow = new BrowserWindow({
			width: 1200,
			height: 800,
			minWidth: 800,
			minHeight: 600,
			webPreferences: {
				nodeIntegration: false,
				contextIsolation: true,
				webSecurity: !this.isDev, // Only disable security in development
				allowRunningInsecureContent: false,
				experimentalFeatures: false,
				preload: path.join(__dirname, "preload.js"),
			},
			titleBarStyle: process.platform === "darwin" ? "hidden" : "hidden",
			titleBarOverlay:
				process.platform === "win32"
					? {
							color: "#1f1f1f",
							symbolColor: "#ffffff",
							height: 30,
						}
					: false,
			trafficLightPosition: process.platform === "darwin" ? { x: 15, y: 13 } : undefined,
			show: false,
		})

		// Load from dev server using dynamic port with retry logic
		this.loadWebviewWithRetry()

		this.mainWindow.once("ready-to-show", () => {
			if (this.mainWindow) {
				this.mainWindow.show()
				this.mainWindow.webContents.openDevTools()
			}
		})

		this.mainWindow.on("closed", () => {
			this.mainWindow = null
		})

		// Handle external links with modern API
		this.mainWindow.webContents.setWindowOpenHandler(({ url }) => {
			shell.openExternal(url)
			return { action: "deny" }
		})

		// Add error handling for failed loads
		this.mainWindow.webContents.on("did-fail-load", (event, errorCode, errorDescription, validatedURL) => {
			console.error(`❌ Failed to load ${validatedURL}: ${errorDescription} (${errorCode})`)
		})

		// Add console message logging
		this.mainWindow.webContents.on("console-message", (event, level, message, line, sourceId) => {
			if (level >= 2) {
				// Error level
				console.error(`🔴 Renderer Error: ${message} (${sourceId}:${line})`)
			}
		})
	}

	private async loadWebviewWithRetry(): Promise<void> {
		const ports = ["5174", "5173", "5175", "5176"] // Try common Vite ports

		console.log(`🔧 Development mode: ${this.isDev}`)
		console.log(`🔒 Web security: ${!this.isDev ? "enabled" : "disabled (dev only)"}`)

		// Wait a bit for server to be ready
		await new Promise((resolve) => setTimeout(resolve, 2000))

		for (let attempt = 0; attempt < 3; attempt++) {
			for (const port of ports) {
				const url = `http://localhost:${port}`
				console.log(`🌐 Attempt ${attempt + 1}: Trying to load webview from: ${url}`)

				try {
					// Check if server is responding first with Electron's net module
					const request = net.request(url)
					const response = await new Promise<any>((resolve, reject) => {
						request.on("response", resolve)
						request.on("error", reject)
						request.end()
					})

					if (response.statusCode === 200) {
						await this.mainWindow?.loadURL(url)
						console.log(`✅ Successfully loaded from port ${port}`)
						return
					} else {
						console.log(`❌ Server on port ${port} returned status: ${response.statusCode}`)
					}
				} catch (error) {
					console.log(`❌ Failed to connect to port ${port}:`, error)
					continue
				}
			}

			if (attempt < 2) {
				console.log("⏳ Waiting 3 seconds before retry...")
				await new Promise((resolve) => setTimeout(resolve, 3000))
			}
		}

		console.error("❌ Failed to load webview from any port after all attempts")
		// Show error page
		this.mainWindow?.loadURL(
			`data:text/html,<h1>Error: Could not connect to webview server</h1><p>Make sure the webview dev server is running on ports 5173-5176.</p>`,
		)
	}

	private getDevServerPort(): string {
		try {
			const portFile = path.join(__dirname, "..", "..", "..", ".vite-port")
			if (fs.existsSync(portFile)) {
				const port = fs.readFileSync(portFile, "utf8").trim()
				return port
			}
		} catch (error) {
			console.log("Could not read .vite-port file:", error)
		}
		// Fallback to default Vite port
		return "5173"
	}

	private setupIpcHandlers(): void {
		// Handler for executing claude CLI with streaming support
		ipcMain.handle("execute-claude-stream", (event, args) => {
			const claudePath = args.path || "claude"

			// Match KiloCode's exact arguments
			const claudeArgs = [
				"-p",
				"--system-prompt",
				args.systemPrompt,
				"--verbose",
				"--output-format",
				"stream-json",
				"--max-turns",
				"20",
			]

			if (args.model) {
				claudeArgs.push("--model", args.model)
			}

			const claudeProcess = spawn(claudePath, claudeArgs, {
				env: {
					...process.env,
					CLAUDE_CODE_MAX_OUTPUT_TOKENS: args.maxOutputTokens?.toString() || "8192",
				},
			})

			let stderr = ""

			const readline = require("readline")
			const rl = readline.createInterface({
				input: claudeProcess.stdout,
			})

			// Stream chunks back to renderer
			rl.on("line", (line: string) => {
				console.log("[Claude CLI Output]:", line) // Debug logging
				try {
					const chunk = JSON.parse(line)

					// Handle claude CLI stream-json format
					if (chunk.type === "assistant" && chunk.message && chunk.message.content) {
						// Extract text from the message content array
						for (const content of chunk.message.content) {
							if (content.type === "text") {
								// Send text chunk to renderer
								event.sender.send("claude-stream-chunk", { type: "text", text: content.text })
							} else if (content.type === "tool_use") {
								// Handle tool use
								console.log("[Claude Tool Use]:", content)
								event.sender.send("claude-stream-chunk", {
									type: "tool_use",
									tool: content.name,
									input: content.input,
								})
							}
						}
					} else if (chunk.type === "result" && chunk.subtype === "success") {
						// Final result - send done signal
						console.log("[Claude Complete] Success")
						event.sender.send("claude-stream-chunk", { type: "done" })
					} else if (chunk.type === "system" && chunk.subtype === "init") {
						// Initialization message - can log available tools
						console.log("[Claude Init] Tools:", chunk.tools?.length || 0, "tools available")
					} else if (chunk.type === "tool_result") {
						console.log("[Claude Tool Result]:", chunk)
						// Handle tool results
						event.sender.send("claude-stream-chunk", {
							type: "tool_result",
							output: chunk.output,
						})
					}
				} catch (e) {
					// Not JSON, treat as text
					console.log("[Claude Parse Error]:", e)
					event.sender.send("claude-stream-chunk", { type: "text", text: line })
				}
			})

			claudeProcess.stderr.on("data", (data) => {
				stderr += data.toString()
			})

			claudeProcess.on("close", (code) => {
				if (code !== 0) {
					event.sender.send("claude-stream-chunk", {
						type: "error",
						error: `Claude CLI exited with code ${code}: ${stderr}`,
					})
				} else {
					event.sender.send("claude-stream-chunk", { type: "done" })
				}
			})

			claudeProcess.on("error", (err) => {
				let errorMessage = `Failed to execute claude CLI: ${err.message}`
				if (err.message.includes("ENOENT")) {
					errorMessage = `Claude CLI not found. Please install it from https://docs.anthropic.com/en/docs/claude-code/setup`
				}
				event.sender.send("claude-stream-chunk", { type: "error", error: errorMessage })
			})

			// Send messages as JSON array via stdin
			const messages = [{ role: "user", content: args.prompt }]
			claudeProcess.stdin.write(JSON.stringify(messages))
			claudeProcess.stdin.end()

			// Return immediately to indicate streaming has started
			return { streaming: true }
		})

		// Keep the old non-streaming version for compatibility
		ipcMain.handle("execute-claude", async (event, args) => {
			return new Promise((resolve, reject) => {
				const claudePath = args.path || "claude"

				// Match KiloCode's exact arguments
				const claudeArgs = [
					"-p",
					"--system-prompt",
					args.systemPrompt,
					"--verbose",
					"--output-format",
					"stream-json",
					"--max-turns",
					"20",
				]

				if (args.model) {
					claudeArgs.push("--model", args.model)
				}

				const claudeProcess = spawn(claudePath, claudeArgs, {
					env: {
						...process.env,
						CLAUDE_CODE_MAX_OUTPUT_TOKENS: args.maxOutputTokens?.toString() || "8192",
					},
				})

				let stdout = ""
				let stderr = ""
				let result = ""

				const readline = require("readline")
				const rl = readline.createInterface({
					input: claudeProcess.stdout,
				})

				rl.on("line", (line: string) => {
					try {
						const chunk = JSON.parse(line)
						if (chunk.type === "assistant" && chunk.message) {
							for (const content of chunk.message.content) {
								if (content.type === "text") {
									result += content.text
								}
							}
						} else if (typeof chunk === "string") {
							result += chunk
						}
					} catch {
						// Not JSON, treat as text
						result += line
					}
				})

				claudeProcess.stderr.on("data", (data) => {
					stderr += data.toString()
				})

				claudeProcess.on("close", (code) => {
					if (code !== 0) {
						reject(new Error(`Claude CLI exited with code ${code}: ${stderr}`))
					} else {
						resolve(result || stdout)
					}
				})

				claudeProcess.on("error", (err) => {
					if (err.message.includes("ENOENT")) {
						reject(
							new Error(
								`Claude CLI not found. Please install it from https://docs.anthropic.com/en/docs/claude-code/setup`,
							),
						)
					} else {
						reject(new Error(`Failed to execute claude CLI: ${err.message}`))
					}
				})

				// Send messages as JSON array via stdin
				const messages = [{ role: "user", content: args.prompt }]
				claudeProcess.stdin.write(JSON.stringify(messages))
				claudeProcess.stdin.end()
			})
		})
	}
}

// Create app instance
new ElectronApp()
