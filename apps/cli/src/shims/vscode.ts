// Minimal runtime shim for vscode APIs used by shared modules.
// This is not a full implementation; it provides just enough
// for prompt generation and config access in a CLI context.

type Storage = {
	get<T = any>(key: string): T | undefined
	update<T = any>(key: string, value: T | undefined): Promise<void>
}

export class FileBackedStorage implements Storage {
	private filePath: string
	private cache: Record<string, any> = {}
	constructor(dir: string, file: string) {
		this.filePath = require("node:path").join(dir, file)
		try {
			const raw = require("node:fs").readFileSync(this.filePath, "utf8")
			this.cache = JSON.parse(raw)
		} catch {}
	}
	get<T = any>(key: string): T | undefined {
		return this.cache[key]
	}
	async update<T = any>(key: string, value: T | undefined) {
		if (typeof value === "undefined") delete this.cache[key]
		else this.cache[key] = value
		await require("node:fs/promises").mkdir(require("node:path").dirname(this.filePath), { recursive: true })
		await require("node:fs/promises").writeFile(this.filePath, JSON.stringify(this.cache, null, 2), "utf8")
	}
}

class SecretStorage {
	private filePath: string
	private cache: Record<string, string | undefined> = {}
	constructor(dir: string) {
		this.filePath = require("node:path").join(dir, "secrets.json")
		try {
			const raw = require("node:fs").readFileSync(this.filePath, "utf8")
			this.cache = JSON.parse(raw)
		} catch {}
	}
	async get(key: string): Promise<string | undefined> {
		return this.cache[key]
	}
	async store(key: string, value: string): Promise<void> {
		this.cache[key] = value
		await this.flush()
	}
	async delete(key: string): Promise<void> {
		delete this.cache[key]
		await this.flush()
	}
	private async flush() {
		await require("node:fs/promises").mkdir(require("node:path").dirname(this.filePath), { recursive: true })
		await require("node:fs/promises").writeFile(this.filePath, JSON.stringify(this.cache, null, 2), "utf8")
	}
}

export const env = {
	language: process.env.LANG?.split(".")[0] || "en",
	shell: process.env.SHELL || (process.platform === "win32" ? "cmd.exe" : "/bin/bash"),
}

// Match VS Code API shape enough for call sites that reference it
export enum ConfigurationTarget {
	Global = 1,
	Workspace = 2,
	WorkspaceFolder = 3,
}

export const Uri = {
	file(p: string) {
		return { fsPath: p }
	},
}

export const window = {
	activeTextEditor: undefined as any,
	showInputBox: async (_opts?: any) => undefined as unknown as string | undefined,
	showInformationMessage: async (_msg: string) => undefined,
	showErrorMessage: async (_msg: string) => undefined,
}

export const workspace = {
	workspaceFolders: [{ uri: { fsPath: process.cwd() } }],
	getWorkspaceFolder(uri: { fsPath: string }) {
		return { uri }
	},
	getConfiguration(_section?: string) {
		// Minimal configuration object for `get`/`update`
		const configStore: Record<string, any> = {}
		return {
			get<T = any>(key: string, defaultValue?: T): T {
				return (configStore[key] as T) ?? (defaultValue as T)
			},
			async update<T = any>(_key: string, _value: T, _target?: ConfigurationTarget) {
				// no-op in CLI; use env vars or CLI flags for settings
			},
		}
	},
}

export type ExtensionContext = {
	extensionPath: string
	extensionMode: number
	extensionUri: { fsPath: string }
	globalStorageUri: { fsPath: string }
	logUri: { fsPath: string }
	globalState: Storage
	workspaceState: Storage
	secrets: SecretStorage
}

export function detectVsCodeGlobalStorageDir(): string | undefined {
	const home = process.env.HOME || process.env.USERPROFILE || process.cwd()
	const candidates = [] as string[]
	if (process.platform === "darwin") {
		candidates.push(`${home}/Library/Application Support/Code/User/globalStorage/kilocode.kilo-code`)
		candidates.push(`${home}/Library/Application Support/Code - Insiders/User/globalStorage/kilocode.kilo-code`)
	} else if (process.platform === "linux") {
		const base = process.env.XDG_CONFIG_HOME || `${home}/.config`
		candidates.push(`${base}/Code/User/globalStorage/kilocode.kilo-code`)
		candidates.push(`${base}/Code - Insiders/User/globalStorage/kilocode.kilo-code`)
	} else if (process.platform === "win32") {
		const appData = process.env.APPDATA || `${home}/AppData/Roaming`
		candidates.push(`${appData}/Code/User/globalStorage/kilocode.kilo-code`)
		candidates.push(`${appData}/Code - Insiders/User/globalStorage/kilocode.kilo-code`)
	}
	for (const p of candidates) {
		try {
			require("node:fs").mkdirSync(p, { recursive: true })
			return p
		} catch {}
	}
	return undefined
}

export function createCliExtensionContext(): ExtensionContext {
	const storageDir = process.env.KILOCODE_CLI_STATE_DIR || detectVsCodeGlobalStorageDir() || process.cwd()
	return {
		extensionPath: storageDir,
		extensionMode: 1,
		extensionUri: { fsPath: storageDir },
		globalStorageUri: { fsPath: storageDir },
		logUri: { fsPath: storageDir },
		globalState: new FileBackedStorage(storageDir, "global_state.json"),
		workspaceState: new FileBackedStorage(storageDir, "workspace_state.json"),
		secrets: new SecretStorage(storageDir),
	}
}
