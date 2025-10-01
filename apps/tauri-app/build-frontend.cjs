#!/usr/bin/env node
const fs = require("fs")
const path = require("path")

// Paths
const webviewDist = path.join(__dirname, "../../src/webview-ui/build")
const tauriDist = path.join(__dirname, "dist")
const shimHtml = path.join(__dirname, "tauri-vscode-shim.html")

// Copy webview dist to tauri dist
console.log("Copying webview-ui dist to tauri dist...")
fs.cpSync(webviewDist, tauriDist, { recursive: true, force: true })

console.log("✓ Tauri frontend build complete - using web backend mode")
