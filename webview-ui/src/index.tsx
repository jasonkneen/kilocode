import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import "./index.css"
import App from "./App"
import "../node_modules/@vscode/codicons/dist/codicon.css"
import "./codicon-custom.css" // kilocode_change

import { getHighlighter } from "./utils/highlighter"

// Dev-only: emulate minimal VS Code theme controls in browser
if (import.meta.env.DEV) {
	// Lazy import so production bundle is unaffected
	import("./dev/vscode-dev-shim").catch(() => {})
}

// Initialize Shiki early to hide initialization latency (async)
getHighlighter().catch((error: Error) => console.error("Failed to initialize Shiki highlighter:", error))

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<App />
	</StrictMode>,
)
