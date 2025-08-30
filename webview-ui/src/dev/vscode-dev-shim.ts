/*
 * Minimal dev-only shim to emulate VS Code theme switching in the browser.
 *
 * - Reads ?theme=light|dark from the URL or falls back to localStorage
 * - Applies body classes (vscode-light / vscode-dark)
 * - Sets `data-vscode-theme-kind` so hooks can react to changes
 * - Exposes window.__setTheme('light'|'dark') for quick toggling
 */

const THEME_KEY = "kilocode-dev-theme"

type ThemeKind = "light" | "dark"

function applyTheme(kind: ThemeKind) {
	const body = document.body
	body.classList.toggle("vscode-light", kind === "light")
	body.classList.toggle("vscode-dark", kind === "dark")
	body.setAttribute("data-vscode-theme-kind", kind === "light" ? "vscode-light" : "vscode-dark")
}

function parseThemeFromUrl(): ThemeKind | undefined {
	try {
		const url = new URL(window.location.href)
		const t = url.searchParams.get("theme")?.toLowerCase()
		if (t === "light" || t === "dark") return t
	} catch {}
	return undefined
}

;(() => {
	if (typeof window === "undefined") return
	if (window.location.hostname !== "localhost") return

	const urlTheme = parseThemeFromUrl()
	const stored = (localStorage.getItem(THEME_KEY) as ThemeKind | null) || null
	const initial: ThemeKind = urlTheme ?? stored ?? "dark"
	applyTheme(initial)
	try {
		localStorage.setItem(THEME_KEY, initial)
	} catch {}

	;(window as any).__setTheme = (next: ThemeKind) => {
		if (next !== "light" && next !== "dark") return
		applyTheme(next)
		try {
			localStorage.setItem(THEME_KEY, next)
		} catch {}
	}
})()
