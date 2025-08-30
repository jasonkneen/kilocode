import fs from "node:fs/promises"
import fssync from "node:fs"
import path from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js"
// Older SDKs ship only stdio/sse; guard import for streamable-http by dynamic fallback
let StreamableHTTPClientTransport: any
try {
	// eslint-disable-next-line @typescript-eslint/no-var-requires
	StreamableHTTPClientTransport =
		require("@modelcontextprotocol/sdk/client/streamableHttp.js").StreamableHTTPClientTransport
} catch {}
import type { CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js"

export type McpServerConfig = {
	type?: "stdio" | "sse" | "streamable-http"
	command?: string
	args?: string[]
	cwd?: string
	env?: Record<string, string>
	url?: string
	headers?: Record<string, string>
	disabled?: boolean
}

export type McpSettings = { mcpServers: Record<string, McpServerConfig> }

export function resolveProjectMcpPath(cwd: string): string | null {
	const p1 = path.join(cwd, ".kilocode", "mcp.json")
	if (fssync.existsSync(p1)) return p1
	const p2 = path.join(cwd, ".mcp.json")
	if (fssync.existsSync(p2)) return p2
	// default to .kilocode/mcp.json under project
	const dir = path.join(cwd, ".kilocode")
	try {
		fssync.mkdirSync(dir, { recursive: true })
		return path.join(dir, "mcp.json")
	} catch {
		return null
	}
}

export async function readJson<T>(filePath: string): Promise<T | undefined> {
	try {
		return JSON.parse(await fs.readFile(filePath, "utf8")) as T
	} catch {
		return undefined
	}
}

export async function writeJson(filePath: string, data: any): Promise<void> {
	await fs.mkdir(path.dirname(filePath), { recursive: true })
	await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf8")
}

export async function loadMcpSettings(
	globalSettingsPath: string | undefined,
	projectPath: string | null,
): Promise<McpSettings> {
	const merged: McpSettings = { mcpServers: {} }
	if (globalSettingsPath) {
		const g = await readJson<McpSettings>(globalSettingsPath)
		if (g?.mcpServers) Object.assign(merged.mcpServers, g.mcpServers)
	}
	if (projectPath && fssync.existsSync(projectPath)) {
		const p = await readJson<McpSettings>(projectPath)
		if (p?.mcpServers) Object.assign(merged.mcpServers, p.mcpServers)
	}
	return merged
}

export async function saveProjectMcp(cwd: string, settings: McpSettings): Promise<string> {
	const file = resolveProjectMcpPath(cwd)!
	await writeJson(file, settings)
	return file
}

export async function callMcpTool(serverName: string, cfg: McpServerConfig, toolName: string, args: any): Promise<any> {
	if (cfg.disabled) throw new Error(`Server ${serverName} is disabled`)
	const client = new Client({ name: "Kilo Code CLI", version: "0.1.0" }, { capabilities: {} })
	let transport: StdioClientTransport | SSEClientTransport | StreamableHTTPClientTransport
	const type = cfg.type || (cfg.command ? "stdio" : "sse")
	if (type === "stdio") {
		const command =
			process.platform === "win32" && cfg.command && cfg.command.toLowerCase() !== "cmd.exe"
				? "cmd.exe"
				: cfg.command || ""
		const args =
			process.platform === "win32" && command === "cmd.exe"
				? ["/c", cfg.command!, ...(cfg.args || [])]
				: cfg.args || []
		transport = new StdioClientTransport({ command, args, cwd: cfg.cwd, env: cfg.env })
	} else if (type === "sse") {
		if (!cfg.url) throw new Error("sse server requires url")
		transport = new SSEClientTransport({ url: cfg.url, headers: cfg.headers })
	} else {
		if (!cfg.url) throw new Error("streamable-http server requires url")
		transport = new StreamableHTTPClientTransport({ url: cfg.url, headers: cfg.headers })
	}
	await client.connect(transport)
	try {
		const res = await client.tools.call({ name: toolName, arguments: args } as any)
		return res
	} finally {
		await client.close()
	}
}
