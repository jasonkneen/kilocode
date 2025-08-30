import { app, BrowserWindow, shell } from "electron"
import { net } from "electron"
import path from "path"
import fs from "fs"

class ElectronApp {
	private mainWindow: BrowserWindow | null = null
	private isDev: boolean = process.env.NODE_ENV === "development" || !app.isPackaged

	constructor() {
		this.setupApp()
	}

	private setupApp(): void {
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
}

// Create app instance
new ElectronApp()
