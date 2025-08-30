/**
 * Enhanced MCP Resource Handling
 *
 * Provides advanced MCP resource management including:
 * - Resource caching and optimization
 * - Resource discovery and enumeration
 * - Cross-session resource state management
 * - Advanced error handling and retry logic
 */

import fs from "node:fs/promises"
import fssync from "node:fs"
import path from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js"
import { loadMcpSettings, resolveProjectMcpPath, type McpServerConfig } from "../mcp.js"
import { createCliExtensionContext } from "../shims/vscode.js"

export interface ResourceCacheEntry {
	uri: string
	serverName: string
	content: any
	contentType?: string
	size?: number
	lastAccessed: number
	lastModified?: number
	etag?: string
	expires?: number
}

export interface ResourceListEntry {
	uri: string
	name?: string
	description?: string
	mimeType?: string
	metadata?: Record<string, any>
}

export interface McrResourceStats {
	totalResources: number
	totalServers: number
	cacheHitRatio: number
	avgResponseTime: number
	lastSyncTime: number
}

export class EnhancedMcpResourceManager {
	private cwd: string
	private cache: Map<string, ResourceCacheEntry> = new Map()
	private serverClients: Map<string, Client> = new Map()
	private resourceLists: Map<string, ResourceListEntry[]> = new Map()
	private stats: McrResourceStats = {
		totalResources: 0,
		totalServers: 0,
		cacheHitRatio: 0,
		avgResponseTime: 0,
		lastSyncTime: 0,
	}
	private cacheFile: string
	private maxCacheSize: number
	private cacheExpiry: number

	constructor(
		cwd: string,
		options: {
			maxCacheSize?: number
			cacheExpiry?: number
		} = {},
	) {
		this.cwd = cwd
		this.maxCacheSize = options.maxCacheSize || 100 // Max cached resources
		this.cacheExpiry = options.cacheExpiry || 3600000 // 1 hour default
		this.cacheFile = path.join(cwd, ".kilocode", "mcp_resource_cache.json")
	}

	async initialize(): Promise<void> {
		// Load persistent cache
		await this.loadCacheFromDisk()

		// Initialize server connections
		await this.initializeServerConnections()

		// Perform initial resource discovery
		await this.discoverAllResources()
	}

	private async loadCacheFromDisk(): Promise<void> {
		try {
			if (fssync.existsSync(this.cacheFile)) {
				const cacheData = JSON.parse(await fs.readFile(this.cacheFile, "utf8"))

				// Load cache entries with expiry checking
				const now = Date.now()
				for (const [key, entry] of Object.entries(cacheData.cache || {})) {
					const cacheEntry = entry as ResourceCacheEntry
					if (!cacheEntry.expires || cacheEntry.expires > now) {
						this.cache.set(key, cacheEntry)
					}
				}

				// Load stats
				if (cacheData.stats) {
					this.stats = { ...this.stats, ...cacheData.stats }
				}

				// Load resource lists
				if (cacheData.resourceLists) {
					for (const [serverName, resources] of Object.entries(cacheData.resourceLists)) {
						this.resourceLists.set(serverName, resources as ResourceListEntry[])
					}
				}
			}
		} catch (e) {
			console.warn("Failed to load MCP resource cache:", e)
		}
	}

	private async saveCacheToDisk(): Promise<void> {
		try {
			const cacheData = {
				version: "1.0.0",
				lastSaved: new Date().toISOString(),
				cache: Object.fromEntries(this.cache),
				resourceLists: Object.fromEntries(this.resourceLists),
				stats: this.stats,
			}

			await fs.mkdir(path.dirname(this.cacheFile), { recursive: true })
			await fs.writeFile(this.cacheFile, JSON.stringify(cacheData, null, 2), "utf8")
		} catch (e) {
			console.warn("Failed to save MCP resource cache:", e)
		}
	}

	private async initializeServerConnections(): Promise<void> {
		try {
			const context = createCliExtensionContext()
			const settingsDir = (context as any).globalStorageUri.fsPath as string
			const globalMcpPath = path.join(settingsDir, "mcp_settings.json")
			const projectMcpPath = resolveProjectMcpPath(this.cwd)

			const mcpSettings = await loadMcpSettings(globalMcpPath, projectMcpPath)

			for (const [serverName, config] of Object.entries(mcpSettings.mcpServers)) {
				if (config.disabled) continue

				try {
					await this.createServerClient(serverName, config)
				} catch (e) {
					console.warn(`Failed to initialize MCP server ${serverName}:`, e)
				}
			}

			this.stats.totalServers = this.serverClients.size
		} catch (e) {
			console.warn("Failed to initialize MCP server connections:", e)
		}
	}

	private async createServerClient(serverName: string, config: McpServerConfig): Promise<Client> {
		const client = new Client({ name: "Kilo Code CLI", version: "1.0.0" }, { capabilities: { resources: {} } })

		let transport: StdioClientTransport | SSEClientTransport
		const type = config.type || (config.command ? "stdio" : "sse")

		if (type === "stdio") {
			const command =
				process.platform === "win32" && config.command && config.command.toLowerCase() !== "cmd.exe"
					? "cmd.exe"
					: config.command || ""
			const args =
				process.platform === "win32" && command === "cmd.exe"
					? ["/c", config.command!, ...(config.args || [])]
					: config.args || []
			transport = new StdioClientTransport({ command, args, cwd: config.cwd, env: config.env })
		} else {
			if (!config.url) throw new Error("SSE server requires url")
			transport = new SSEClientTransport(new URL(config.url), config.headers)
		}

		await client.connect(transport)
		this.serverClients.set(serverName, client)
		return client
	}

	async discoverAllResources(): Promise<Map<string, ResourceListEntry[]>> {
		const discovered = new Map<string, ResourceListEntry[]>()

		for (const [serverName, client] of this.serverClients) {
			try {
				const resources = await this.discoverServerResources(serverName, client)
				discovered.set(serverName, resources)
				this.resourceLists.set(serverName, resources)
			} catch (e) {
				console.warn(`Failed to discover resources from ${serverName}:`, e)
			}
		}

		this.stats.totalResources = Array.from(discovered.values()).reduce((sum, list) => sum + list.length, 0)
		this.stats.lastSyncTime = Date.now()

		// Persist discoveries
		await this.saveCacheToDisk()

		return discovered
	}

	private async discoverServerResources(serverName: string, client: Client): Promise<ResourceListEntry[]> {
		try {
			// Use request method to call resources/list
			const response = await client.request({ method: "resources/list" }, undefined as any)

			if (response && (response as any).resources) {
				return (response as any).resources.map((resource: any) => ({
					uri: resource.uri,
					name: resource.name,
					description: resource.description,
					mimeType: resource.mimeType,
					metadata: resource.annotations || {},
				}))
			}
		} catch (e) {
			console.warn(`Failed to list resources from ${serverName}:`, e)
		}

		return []
	}

	async accessResourceWithCaching(
		serverName: string,
		uri: string,
		options: {
			bypassCache?: boolean
			maxAge?: number
		} = {},
	): Promise<{ success: boolean; content?: any; error?: string; fromCache?: boolean }> {
		const cacheKey = `${serverName}:${uri}`
		const now = Date.now()

		// Check cache first (unless bypassed)
		if (!options.bypassCache) {
			const cached = this.cache.get(cacheKey)
			if (cached && (!cached.expires || cached.expires > now)) {
				const maxAge = options.maxAge || this.cacheExpiry
				if (now - cached.lastAccessed < maxAge) {
					// Update access time
					cached.lastAccessed = now
					this.cache.set(cacheKey, cached)

					// Update cache hit ratio
					this.stats.cacheHitRatio = this.stats.cacheHitRatio * 0.9 + 1 * 0.1

					return {
						success: true,
						content: cached.content,
						fromCache: true,
					}
				}
			}
		}

		// Cache miss - fetch from server
		const startTime = Date.now()
		try {
			const client = this.serverClients.get(serverName)
			if (!client) {
				return {
					success: false,
					error: `MCP server ${serverName} not available`,
				}
			}

			const response = await client.request({ method: "resources/read" }, { uri } as any)
			const endTime = Date.now()

			if (response && (response as any).contents) {
				// Cache the result
				const cacheEntry: ResourceCacheEntry = {
					uri,
					serverName,
					content: (response as any).contents,
					lastAccessed: now,
					lastModified: now,
					expires: now + this.cacheExpiry,
					size: JSON.stringify((response as any).contents).length,
				}

				// Implement cache size management
				await this.manageCacheSize(cacheEntry)
				this.cache.set(cacheKey, cacheEntry)

				// Update performance stats
				this.stats.avgResponseTime = this.stats.avgResponseTime * 0.9 + (endTime - startTime) * 0.1
				this.stats.cacheHitRatio = this.stats.cacheHitRatio * 0.9 + 0 * 0.1

				// Save cache periodically
				await this.saveCacheToDisk()

				return {
					success: true,
					content: (response as any).contents,
					fromCache: false,
				}
			} else {
				return {
					success: false,
					error: "Empty response from MCP server",
				}
			}
		} catch (e) {
			return {
				success: false,
				error: `Failed to access resource: ${e instanceof Error ? e.message : String(e)}`,
			}
		}
	}

	private async manageCacheSize(newEntry: ResourceCacheEntry): Promise<void> {
		// If cache is full, remove oldest entries
		if (this.cache.size >= this.maxCacheSize) {
			const entries = Array.from(this.cache.entries())
			entries.sort((a, b) => a[1].lastAccessed - b[1].lastAccessed)

			// Remove 20% of oldest entries to make room
			const toRemove = Math.floor(this.maxCacheSize * 0.2)
			for (let i = 0; i < toRemove; i++) {
				this.cache.delete(entries[i][0])
			}
		}
	}

	async getResourcesForServer(serverName: string): Promise<ResourceListEntry[]> {
		// Check cache first
		const cached = this.resourceLists.get(serverName)
		if (cached && Date.now() - this.stats.lastSyncTime < 300000) {
			// 5 minute cache
			return cached
		}

		// Refresh from server
		const client = this.serverClients.get(serverName)
		if (!client) {
			throw new Error(`MCP server ${serverName} not available`)
		}

		const resources = await this.discoverServerResources(serverName, client)
		this.resourceLists.set(serverName, resources)
		await this.saveCacheToDisk()

		return resources
	}

	async getAllResources(): Promise<Map<string, ResourceListEntry[]>> {
		const allResources = new Map<string, ResourceListEntry[]>()

		for (const serverName of this.serverClients.keys()) {
			try {
				const resources = await this.getResourcesForServer(serverName)
				allResources.set(serverName, resources)
			} catch (e) {
				console.warn(`Failed to get resources from ${serverName}:`, e)
			}
		}

		return allResources
	}

	async searchResources(query: string): Promise<
		Array<{
			serverName: string
			resource: ResourceListEntry
			relevanceScore: number
		}>
	> {
		const results: Array<{
			serverName: string
			resource: ResourceListEntry
			relevanceScore: number
		}> = []

		const allResources = await this.getAllResources()
		const queryLower = query.toLowerCase()

		for (const [serverName, resources] of allResources) {
			for (const resource of resources) {
				let score = 0

				// Score based on URI match
				if (resource.uri.toLowerCase().includes(queryLower)) {
					score += 0.5
				}

				// Score based on name match
				if (resource.name && resource.name.toLowerCase().includes(queryLower)) {
					score += 0.3
				}

				// Score based on description match
				if (resource.description && resource.description.toLowerCase().includes(queryLower)) {
					score += 0.2
				}

				// Score based on metadata match
				if (resource.metadata) {
					const metadataText = JSON.stringify(resource.metadata).toLowerCase()
					if (metadataText.includes(queryLower)) {
						score += 0.1
					}
				}

				if (score > 0) {
					results.push({
						serverName,
						resource,
						relevanceScore: score,
					})
				}
			}
		}

		// Sort by relevance score
		return results.sort((a, b) => b.relevanceScore - a.relevanceScore)
	}

	async getResourceStats(): Promise<McrResourceStats> {
		return { ...this.stats }
	}

	async clearCache(serverName?: string): Promise<void> {
		if (serverName) {
			// Clear cache for specific server
			for (const [key, entry] of this.cache) {
				if (entry.serverName === serverName) {
					this.cache.delete(key)
				}
			}
			this.resourceLists.delete(serverName)
		} else {
			// Clear all cache
			this.cache.clear()
			this.resourceLists.clear()
		}

		await this.saveCacheToDisk()
	}

	async refreshServerConnection(serverName: string): Promise<boolean> {
		try {
			// Close existing connection
			const existingClient = this.serverClients.get(serverName)
			if (existingClient) {
				await existingClient.close()
				this.serverClients.delete(serverName)
			}

			// Load fresh config
			const context = createCliExtensionContext()
			const settingsDir = (context as any).globalStorageUri.fsPath as string
			const globalMcpPath = path.join(settingsDir, "mcp_settings.json")
			const projectMcpPath = resolveProjectMcpPath(this.cwd)

			const mcpSettings = await loadMcpSettings(globalMcpPath, projectMcpPath)
			const config = mcpSettings.mcpServers[serverName]

			if (!config) {
				throw new Error(`Server ${serverName} not found in configuration`)
			}

			// Create new connection
			const client = await this.createServerClient(serverName, config)

			// Clear old cache for this server
			await this.clearCache(serverName)

			// Rediscover resources
			const resources = await this.discoverServerResources(serverName, client)
			this.resourceLists.set(serverName, resources)

			return true
		} catch (e) {
			console.warn(`Failed to refresh MCP server ${serverName}:`, e)
			return false
		}
	}

	async validateResourceAccess(
		serverName: string,
		uri: string,
	): Promise<{
		accessible: boolean
		exists: boolean
		error?: string
		metadata?: any
	}> {
		try {
			const client = this.serverClients.get(serverName)
			if (!client) {
				return {
					accessible: false,
					exists: false,
					error: `Server ${serverName} not available`,
				}
			}

			// Try to access the resource
			const response = await client.request({ method: "resources/read" }, { uri } as any)

			return {
				accessible: true,
				exists: !!(response as any)?.contents,
				metadata: {
					contentType: (response as any)?.mimeType,
					size: (response as any)?.contents ? JSON.stringify((response as any).contents).length : 0,
				},
			}
		} catch (e) {
			return {
				accessible: false,
				exists: false,
				error: e instanceof Error ? e.message : String(e),
			}
		}
	}

	async getResourcesWithFilter(filter: {
		serverName?: string
		mimeType?: string
		uriPattern?: RegExp
		metadata?: Record<string, any>
	}): Promise<
		Array<{
			serverName: string
			resource: ResourceListEntry
		}>
	> {
		const results: Array<{ serverName: string; resource: ResourceListEntry }> = []
		const allResources = await this.getAllResources()

		for (const [serverName, resources] of allResources) {
			// Filter by server name
			if (filter.serverName && serverName !== filter.serverName) {
				continue
			}

			for (const resource of resources) {
				let matches = true

				// Filter by MIME type
				if (filter.mimeType && resource.mimeType !== filter.mimeType) {
					matches = false
				}

				// Filter by URI pattern
				if (filter.uriPattern && !filter.uriPattern.test(resource.uri)) {
					matches = false
				}

				// Filter by metadata
				if (filter.metadata && resource.metadata) {
					for (const [key, value] of Object.entries(filter.metadata)) {
						if (resource.metadata[key] !== value) {
							matches = false
							break
						}
					}
				}

				if (matches) {
					results.push({ serverName, resource })
				}
			}
		}

		return results
	}

	// Batch resource access for improved performance
	async accessMultipleResources(
		requests: Array<{
			serverName: string
			uri: string
		}>,
	): Promise<
		Array<{
			serverName: string
			uri: string
			success: boolean
			content?: any
			error?: string
			fromCache?: boolean
		}>
	> {
		const results = await Promise.allSettled(
			requests.map(async (req) => {
				const result = await this.accessResourceWithCaching(req.serverName, req.uri)
				return {
					serverName: req.serverName,
					uri: req.uri,
					...result,
				}
			}),
		)

		return results.map((result, index) => {
			if (result.status === "fulfilled") {
				return result.value
			} else {
				return {
					serverName: requests[index].serverName,
					uri: requests[index].uri,
					success: false,
					error: result.reason instanceof Error ? result.reason.message : String(result.reason),
				}
			}
		})
	}

	async optimizeCachePerformance(): Promise<{
		cacheSize: number
		entriesRemoved: number
		memoryFreed: number
	}> {
		const startSize = this.cache.size
		const now = Date.now()
		let bytesFreed = 0

		// Remove expired entries
		for (const [key, entry] of this.cache) {
			if (entry.expires && entry.expires < now) {
				bytesFreed += entry.size || 0
				this.cache.delete(key)
			}
		}

		// Remove least recently used entries if cache is still too large
		if (this.cache.size > this.maxCacheSize * 0.8) {
			const entries = Array.from(this.cache.entries())
			entries.sort((a, b) => a[1].lastAccessed - b[1].lastAccessed)

			const toRemove = Math.max(1, Math.floor(this.cache.size * 0.2))
			for (let i = 0; i < toRemove && i < entries.length; i++) {
				const [key, entry] = entries[i]
				bytesFreed += entry.size || 0
				this.cache.delete(key)
			}
		}

		await this.saveCacheToDisk()

		return {
			cacheSize: this.cache.size,
			entriesRemoved: startSize - this.cache.size,
			memoryFreed: bytesFreed,
		}
	}

	async cleanup(): Promise<void> {
		// Close all server connections
		for (const [serverName, client] of this.serverClients) {
			try {
				await client.close()
			} catch (e) {
				console.warn(`Failed to close MCP server ${serverName}:`, e)
			}
		}

		this.serverClients.clear()

		// Save final cache state
		await this.saveCacheToDisk()

		// Clear in-memory state
		this.cache.clear()
		this.resourceLists.clear()
	}

	// Enhanced error handling with retry logic
	async accessResourceWithRetry(
		serverName: string,
		uri: string,
		options: {
			maxRetries?: number
			retryDelay?: number
			exponentialBackoff?: boolean
		} = {},
	): Promise<{ success: boolean; content?: any; error?: string; attempts?: number; fromCache?: boolean }> {
		const maxRetries = options.maxRetries || 3
		const baseDelay = options.retryDelay || 1000
		const useBackoff = options.exponentialBackoff !== false

		for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
			const result = await this.accessResourceWithCaching(serverName, uri, {
				bypassCache: attempt > 1, // Bypass cache on retries
			})

			if (result.success) {
				return { ...result, attempts: attempt }
			}

			// If this was the last attempt, return the error
			if (attempt > maxRetries) {
				return { ...result, attempts: attempt }
			}

			// Wait before retry
			const delay = useBackoff ? baseDelay * Math.pow(2, attempt - 1) : baseDelay
			await new Promise((resolve) => setTimeout(resolve, delay))

			console.warn(`MCP resource access attempt ${attempt} failed, retrying in ${delay}ms...`)
		}

		return {
			success: false,
			error: "Max retries exceeded",
			attempts: maxRetries + 1,
			fromCache: false,
		}
	}
}
