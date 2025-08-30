import { contextBridge, ipcRenderer } from "electron"

// Add drag region and styles when DOM is ready
document.addEventListener("DOMContentLoaded", () => {
	// Add styles for drag region and button fixes
	const styles = document.createElement("style")
	styles.textContent = `
		/* Make top area draggable without blocking clicks */
		body {
			-webkit-app-region: drag;
			padding-top: 0 !important;
			margin-top: 0 !important;
		}
		
		/* Make all interactive elements non-draggable so they can be clicked */
		button, input, select, textarea, a, [role="button"], [tabindex], .clickable {
			-webkit-app-region: no-drag !important;
		}
		
		/* Make specific areas non-draggable for interactions */
		#root, .main-content, .sidebar, .toolbar, .menu {
			-webkit-app-region: no-drag;
		}
		
		/* Remove borders from buttons */
		button {
			border: none !important;
			outline: none !important;
		}
		
		/* Remove borders from specific button classes */
		.btn, .button, [role="button"] {
			border: none !important;
			outline: none !important;
		}
		
		/* Remove focus outlines that might appear as borders */
		button:focus, .btn:focus, .button:focus, [role="button"]:focus {
			border: none !important;
			outline: none !important;
			box-shadow: none !important;
		}
	`

	// Insert styles
	document.head.insertBefore(styles, document.head.firstChild)
})

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld("electronAPI", {
	// App info
	getVersion: () => ipcRenderer.invoke("app-version"),
	getPlatform: () => ipcRenderer.invoke("platform"),

	// Dialog methods
	showErrorDialog: (title: string, content: string) => ipcRenderer.invoke("show-error-dialog", title, content),
	showSaveDialog: (options: any) => ipcRenderer.invoke("show-save-dialog", options),
	showOpenDialog: (options: any) => ipcRenderer.invoke("show-open-dialog", options),

	// Listen for menu events
	onNewTask: (callback: () => void) => {
		ipcRenderer.on("new-task", callback)
		// Return cleanup function
		return () => ipcRenderer.removeListener("new-task", callback)
	},

	// Remove all listeners for cleanup
	removeAllListeners: (channel: string) => {
		ipcRenderer.removeAllListeners(channel)
	},
})

// Type definitions for the exposed API
declare global {
	interface Window {
		electronAPI: {
			getVersion: () => Promise<string>
			getPlatform: () => Promise<string>
			showErrorDialog: (title: string, content: string) => Promise<any>
			showSaveDialog: (options: any) => Promise<any>
			showOpenDialog: (options: any) => Promise<any>
			onNewTask: (callback: () => void) => () => void
			removeAllListeners: (channel: string) => void
		}
	}
}
