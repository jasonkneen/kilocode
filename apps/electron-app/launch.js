#!/usr/bin/env node

const { spawn } = require("child_process")
const path = require("path")
const fs = require("fs")

console.log("🚀 Starting Kilo Code Electron App...")

// Check if webview dev server is running
const portFile = path.join(__dirname, "..", "..", ".vite-port")
let webviewRunning = false
let port = "5174"

if (fs.existsSync(portFile)) {
	port = fs.readFileSync(portFile, "utf8").trim()
	webviewRunning = true
	console.log(`✅ Webview dev server found on port ${port}`)
} else {
	console.log("⚠️  Webview dev server not running")
	console.log("Starting webview dev server...")
}

if (!webviewRunning) {
	// Start webview dev server
	const webviewProcess = spawn("npm", ["run", "dev"], {
		cwd: path.join(__dirname, "..", "..", "webview-ui"),
		stdio: "inherit",
	})

	// Wait a bit for server to start
	setTimeout(() => {
		startElectron()
	}, 5000)
} else {
	startElectron()
}

function startElectron() {
	console.log("🖥️  Starting Electron app...")

	// Build main process if needed
	spawn("npm", ["run", "build:main"], {
		cwd: __dirname,
		stdio: "inherit",
	}).on("close", (code) => {
		if (code === 0) {
			// Start Electron using npx to use local version
			spawn("npx", ["electron", "dist/main.js"], {
				cwd: __dirname,
				stdio: "inherit",
			})
		} else {
			console.error("❌ Failed to build main process")
		}
	})
}
