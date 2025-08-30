/**
 * Enhanced VS Code Settings Synchronization
 *
 * Provides advanced integration with VS Code settings including:
 * - Real-time settings synchronization
 * - Cross-session state management
 * - Provider profile sharing
 * - Workspace-level configuration support
 */

import fs from "node:fs/promises"
import fssync from "node:fs"
import path from "node:path"
import { watch, FSWatcher } from "node:fs"
import { createCliExtensionContext, detectVsCodeGlobalStorageDir } from "../shims/vscode.js"

export interface SettingsSyncOptions {
	enableRealTimeSync?: boolean
	syncInterval?: number
	watchForChanges?: boolean
	includeSecrets?: boolean
	workspaceLevel?: boolean
}

export interface ProfileConfig {
	id: string
	name: string
	provider: string
	model?: string
	settings: Record<string, any>
	apiKeys?: Record<string, string>
	lastUsed?: string
	shared?: boolean
}

export interface SyncState {
	lastSync: string
	version: string
	profiles: ProfileConfig[]
	workspaceSettings: Record<string, any>
	globalSettings: Record<string, any>
	mcpServers: Record<string, any>
}

export class EnhancedSettingsSync {
	private cwd: string
	private options: SettingsSyncOptions
	private watchers: FSWatcher[] = []
	private cache: Map<string, any> = new Map()
	private lastSyncTime: number = 0
	private syncInProgress: boolean = false

	constructor(cwd: string, options: SettingsSyncOptions = {}) {
		this.cwd = cwd
		this.options = {
			enableRealTimeSync: true,
			syncInterval: 5000,
			watchForChanges: true,
			includeSecrets: false,
			workspaceLevel: true,
			...options,
		}
	}

	async initialize(): Promise<void> {
		// Set up file watchers for real-time sync
		if (this.options.watchForChanges) {
			await this.setupFileWatchers()
		}

		// Initial sync
		await this.performFullSync()
	}

	async performFullSync(): Promise<SyncState> {
		if (this.syncInProgress) {
			return this.getLastSyncState()
		}

		this.syncInProgress = true
		const startTime = Date.now()

		try {
			const context = createCliExtensionContext()
			const vscodeStorageDir = detectVsCodeGlobalStorageDir()

			// Enhanced state collection
			const syncState: SyncState = {
				lastSync: new Date().toISOString(),
				version: "1.0.0",
				profiles: await this.syncProfiles(vscodeStorageDir),
				workspaceSettings: await this.syncWorkspaceSettings(),
				globalSettings: await this.syncGlobalSettings(vscodeStorageDir),
				mcpServers: await this.syncMcpSettings(vscodeStorageDir),
			}

			// Cache the sync state for performance
			this.cache.set("lastSyncState", syncState)
			this.lastSyncTime = startTime

			// Persist sync state for cross-session recovery
			await this.persistSyncState(syncState)

			return syncState
		} finally {
			this.syncInProgress = false
		}
	}

	private async syncProfiles(vscodeStorageDir?: string): Promise<ProfileConfig[]> {
		const profiles: ProfileConfig[] = []

		// Load CLI profiles
		const cliProfilesPath = path.join(this.cwd, ".kilocode", "profiles.json")
		try {
			if (fssync.existsSync(cliProfilesPath)) {
				const cliProfiles = JSON.parse(await fs.readFile(cliProfilesPath, "utf8"))
				profiles.push(...(cliProfiles.profiles || []))
			}
		} catch (e) {
			console.warn("Failed to load CLI profiles:", e)
		}

		// Load VS Code profiles
		if (vscodeStorageDir) {
			const vscodeProfilesPath = path.join(vscodeStorageDir, "profiles.json")
			try {
				if (fssync.existsSync(vscodeProfilesPath)) {
					const vscodeProfiles = JSON.parse(await fs.readFile(vscodeProfilesPath, "utf8"))

					// Merge VS Code profiles, but mark them as shared
					for (const profile of vscodeProfiles.profiles || []) {
						profiles.push({
							...profile,
							shared: true,
						})
					}
				}
			} catch (e) {
				console.warn("Failed to load VS Code profiles:", e)
			}
		}

		return profiles
	}

	private async syncWorkspaceSettings(): Promise<Record<string, any>> {
		const settings: Record<string, any> = {}

		// Check for workspace-level settings
		const workspaceSettingsPath = path.join(this.cwd, ".vscode", "settings.json")
		try {
			if (fssync.existsSync(workspaceSettingsPath)) {
				const workspaceSettings = JSON.parse(await fs.readFile(workspaceSettingsPath, "utf8"))

				// Extract kilocode-specific settings
				for (const [key, value] of Object.entries(workspaceSettings)) {
					if (key.startsWith("kilocode.") || key.startsWith("cline.")) {
						settings[key] = value
					}
				}
			}
		} catch (e) {
			console.warn("Failed to load workspace settings:", e)
		}

		// Check for .kilocode directory settings
		const kilocolCodeSettingsPath = path.join(this.cwd, ".kilocode", "settings.json")
		try {
			if (fssync.existsSync(kilocolCodeSettingsPath)) {
				const kilocolCodeSettings = JSON.parse(await fs.readFile(kilocolCodeSettingsPath, "utf8"))
				Object.assign(settings, kilocolCodeSettings)
			}
		} catch (e) {
			console.warn("Failed to load .kilocode settings:", e)
		}

		return settings
	}

	private async syncGlobalSettings(vscodeStorageDir?: string): Promise<Record<string, any>> {
		const settings: Record<string, any> = {}

		// Load CLI global settings
		const context = createCliExtensionContext()
		try {
			const globalSettings = context.globalState.get("settings") || {}
			Object.assign(settings, globalSettings)
		} catch (e) {
			console.warn("Failed to load CLI global settings:", e)
		}

		// Load VS Code global settings
		if (vscodeStorageDir) {
			try {
				const vscodeSettingsPath = path.join(vscodeStorageDir, "global_state.json")
				if (fssync.existsSync(vscodeSettingsPath)) {
					const vscodeSettings = JSON.parse(await fs.readFile(vscodeSettingsPath, "utf8"))

					// Merge compatible settings
					const compatibleKeys = [
						"apiProvider",
						"maxRequestsPerTask",
						"alwaysAllowExecuteCommand",
						"alwaysAllowBrowser",
						"customInstructions",
						"allowedCommands",
						"deniedCommands",
					]

					for (const key of compatibleKeys) {
						if (vscodeSettings[key] !== undefined) {
							settings[key] = vscodeSettings[key]
						}
					}
				}
			} catch (e) {
				console.warn("Failed to load VS Code global settings:", e)
			}
		}

		return settings
	}

	private async syncMcpSettings(vscodeStorageDir?: string): Promise<Record<string, any>> {
		const { loadMcpSettings, resolveProjectMcpPath } = await import("../mcp.js")
		const { GlobalFileNames } = await import("../../../../src/shared/globalFileNames.js")

		// Use existing MCP sync but with enhanced error handling
		try {
			const globalMcpPath = vscodeStorageDir
				? path.join(vscodeStorageDir, GlobalFileNames.mcpSettings)
				: undefined
			const projectMcpPath = resolveProjectMcpPath(this.cwd)

			const mcpSettings = await loadMcpSettings(globalMcpPath, projectMcpPath)
			return mcpSettings.mcpServers || {}
		} catch (e) {
			console.warn("Failed to sync MCP settings:", e)
			return {}
		}
	}

	private async setupFileWatchers(): Promise<void> {
		const watchPaths = [
			// VS Code settings
			path.join(this.cwd, ".vscode", "settings.json"),
			// Project-level kilocode settings
			path.join(this.cwd, ".kilocode", "settings.json"),
			path.join(this.cwd, ".kilocode", "profiles.json"),
			path.join(this.cwd, ".kilocode", "mcp.json"),
		]

		// Add VS Code global storage if available
		const vscodeStorageDir = detectVsCodeGlobalStorageDir()
		if (vscodeStorageDir) {
			watchPaths.push(
				path.join(vscodeStorageDir, "global_state.json"),
				path.join(vscodeStorageDir, "profiles.json"),
			)
		}

		for (const watchPath of watchPaths) {
			try {
				// Only watch if file exists or directory exists
				const dir = path.dirname(watchPath)
				if (fssync.existsSync(dir)) {
					const watcher = watch(dir, { persistent: false }, (eventType, filename) => {
						if (filename && path.join(dir, filename) === watchPath) {
							this.handleFileChange(watchPath, eventType)
						}
					})
					this.watchers.push(watcher as any)
				}
			} catch (e) {
				console.warn(`Failed to watch ${watchPath}:`, e)
			}
		}
	}

	private async handleFileChange(filePath: string, eventType: string): Promise<void> {
		// Debounce rapid changes
		const now = Date.now()
		if (now - this.lastSyncTime < (this.options.syncInterval || 5000)) {
			return
		}

		console.log(`📡 Settings change detected: ${path.basename(filePath)} (${eventType})`)

		// Trigger incremental sync
		try {
			await this.performIncrementalSync(filePath)
		} catch (e) {
			console.warn("Failed to perform incremental sync:", e)
		}
	}

	private async performIncrementalSync(changedFile: string): Promise<void> {
		// Update only the specific part that changed for performance
		const basename = path.basename(changedFile)

		switch (basename) {
			case "settings.json":
				await this.updateCachedSettings(changedFile)
				break
			case "profiles.json":
				await this.updateCachedProfiles(changedFile)
				break
			case "mcp.json":
				await this.updateCachedMcpSettings(changedFile)
				break
			case "global_state.json":
				await this.updateCachedGlobalState(changedFile)
				break
		}

		this.lastSyncTime = Date.now()
	}

	private async updateCachedSettings(filePath: string): Promise<void> {
		try {
			const settings = JSON.parse(await fs.readFile(filePath, "utf8"))
			const lastSyncState = this.cache.get("lastSyncState") as SyncState

			if (lastSyncState) {
				if (filePath.includes(".vscode")) {
					lastSyncState.workspaceSettings = settings
				} else {
					Object.assign(lastSyncState.globalSettings, settings)
				}
				this.cache.set("lastSyncState", lastSyncState)
			}
		} catch (e) {
			console.warn("Failed to update cached settings:", e)
		}
	}

	private async updateCachedProfiles(filePath: string): Promise<void> {
		try {
			const profileData = JSON.parse(await fs.readFile(filePath, "utf8"))
			const lastSyncState = this.cache.get("lastSyncState") as SyncState

			if (lastSyncState && profileData.profiles) {
				// Update profiles, maintaining shared flag for VS Code profiles
				const isVsCodeProfile = filePath.includes("globalStorage")
				const updatedProfiles = profileData.profiles.map((p: any) => ({
					...p,
					shared: isVsCodeProfile,
				}))

				lastSyncState.profiles = updatedProfiles
				this.cache.set("lastSyncState", lastSyncState)
			}
		} catch (e) {
			console.warn("Failed to update cached profiles:", e)
		}
	}

	private async updateCachedMcpSettings(filePath: string): Promise<void> {
		try {
			const mcpData = JSON.parse(await fs.readFile(filePath, "utf8"))
			const lastSyncState = this.cache.get("lastSyncState") as SyncState

			if (lastSyncState && mcpData.mcpServers) {
				Object.assign(lastSyncState.mcpServers, mcpData.mcpServers)
				this.cache.set("lastSyncState", lastSyncState)
			}
		} catch (e) {
			console.warn("Failed to update cached MCP settings:", e)
		}
	}

	private async updateCachedGlobalState(filePath: string): Promise<void> {
		try {
			const globalState = JSON.parse(await fs.readFile(filePath, "utf8"))
			const lastSyncState = this.cache.get("lastSyncState") as SyncState

			if (lastSyncState) {
				Object.assign(lastSyncState.globalSettings, globalState)
				this.cache.set("lastSyncState", lastSyncState)
			}
		} catch (e) {
			console.warn("Failed to update cached global state:", e)
		}
	}

	async getLastSyncState(): Promise<SyncState> {
		const cached = this.cache.get("lastSyncState")
		if (cached && Date.now() - this.lastSyncTime < (this.options.syncInterval || 5000)) {
			return cached
		}

		// Force fresh sync if cache is stale
		return await this.performFullSync()
	}

	async exportSettingsToVsCode(): Promise<string> {
		const syncState = await this.getLastSyncState()
		const vscodeStorageDir = detectVsCodeGlobalStorageDir()

		if (!vscodeStorageDir) {
			throw new Error("VS Code storage directory not found")
		}

		// Write CLI-specific settings to VS Code storage
		const exportPath = path.join(vscodeStorageDir, "cli_export.json")
		await fs.writeFile(
			exportPath,
			JSON.stringify(
				{
					exported_at: new Date().toISOString(),
					cli_version: "1.0.0",
					settings: syncState.globalSettings,
					profiles: syncState.profiles.filter((p) => !p.shared),
					workspace_settings: syncState.workspaceSettings,
				},
				null,
				2,
			),
			"utf8",
		)

		return exportPath
	}

	async importSettingsFromVsCode(): Promise<void> {
		await this.performFullSync()

		const syncState = this.cache.get("lastSyncState") as SyncState
		if (!syncState) return

		// Apply VS Code settings to CLI
		const context = createCliExtensionContext()

		// Update global state
		await context.globalState.update("settings", syncState.globalSettings)

		// Update profiles
		const cliProfilesPath = path.join(this.cwd, ".kilocode", "profiles.json")
		await fs.mkdir(path.dirname(cliProfilesPath), { recursive: true })
		await fs.writeFile(
			cliProfilesPath,
			JSON.stringify(
				{
					version: "1.0.0",
					profiles: syncState.profiles,
					lastUpdated: new Date().toISOString(),
				},
				null,
				2,
			),
			"utf8",
		)

		// Update workspace settings if enabled
		if (this.options.workspaceLevel && Object.keys(syncState.workspaceSettings).length > 0) {
			const workspaceSettingsPath = path.join(this.cwd, ".kilocode", "settings.json")
			await fs.writeFile(workspaceSettingsPath, JSON.stringify(syncState.workspaceSettings, null, 2), "utf8")
		}
	}

	private async persistSyncState(syncState: SyncState): Promise<void> {
		const statePath = path.join(this.cwd, ".kilocode", "sync_state.json")
		await fs.mkdir(path.dirname(statePath), { recursive: true })
		await fs.writeFile(statePath, JSON.stringify(syncState, null, 2), "utf8")
	}

	async createSharedProfile(profile: Omit<ProfileConfig, "id" | "shared">): Promise<ProfileConfig> {
		const profileId = `shared-${Date.now()}`
		const sharedProfile: ProfileConfig = {
			id: profileId,
			shared: true,
			lastUsed: new Date().toISOString(),
			...profile,
		}

		// Save to both CLI and VS Code if available
		const profiles = await this.syncProfiles()
		profiles.push(sharedProfile)

		// Update CLI profiles
		const cliProfilesPath = path.join(this.cwd, ".kilocode", "profiles.json")
		await fs.mkdir(path.dirname(cliProfilesPath), { recursive: true })
		await fs.writeFile(
			cliProfilesPath,
			JSON.stringify(
				{
					version: "1.0.0",
					profiles,
					lastUpdated: new Date().toISOString(),
				},
				null,
				2,
			),
			"utf8",
		)

		// Update VS Code profiles if available
		const vscodeStorageDir = detectVsCodeGlobalStorageDir()
		if (vscodeStorageDir) {
			try {
				const vscodeProfilesPath = path.join(vscodeStorageDir, "profiles.json")
				const existingVsCodeProfiles = (await this.loadJsonFile(vscodeProfilesPath)) || { profiles: [] }
				existingVsCodeProfiles.profiles.push(sharedProfile)
				await fs.writeFile(vscodeProfilesPath, JSON.stringify(existingVsCodeProfiles, null, 2), "utf8")
			} catch (e) {
				console.warn("Failed to save shared profile to VS Code:", e)
			}
		}

		return sharedProfile
	}

	async getCrossSessionState(): Promise<Record<string, any>> {
		// Load persisted session state
		const statePath = path.join(this.cwd, ".kilocode", "session_state.json")
		return (await this.loadJsonFile(statePath)) || {}
	}

	async updateCrossSessionState(updates: Record<string, any>): Promise<void> {
		const currentState = await this.getCrossSessionState()
		const newState = { ...currentState, ...updates, lastUpdated: new Date().toISOString() }

		const statePath = path.join(this.cwd, ".kilocode", "session_state.json")
		await fs.mkdir(path.dirname(statePath), { recursive: true })
		await fs.writeFile(statePath, JSON.stringify(newState, null, 2), "utf8")
	}

	private async loadJsonFile(filePath: string): Promise<any> {
		try {
			if (fssync.existsSync(filePath)) {
				return JSON.parse(await fs.readFile(filePath, "utf8"))
			}
		} catch (e) {
			console.warn(`Failed to load JSON file ${filePath}:`, e)
		}
		return null
	}

	async cleanup(): Promise<void> {
		// Close all file watchers
		for (const watcher of this.watchers) {
			watcher.close()
		}
		this.watchers = []
		this.cache.clear()
	}

	// Advanced settings conflict resolution
	async resolveSettingsConflicts(): Promise<{ conflicts: any[]; resolved: any[] }> {
		const syncState = await this.getLastSyncState()
		const conflicts: any[] = []
		const resolved: any[] = []

		// Check for conflicting provider settings
		const cliSettings = syncState.globalSettings
		const workspaceSettings = syncState.workspaceSettings

		for (const [key, value] of Object.entries(workspaceSettings)) {
			if (cliSettings[key] !== undefined && cliSettings[key] !== value) {
				conflicts.push({
					key,
					cliValue: cliSettings[key],
					workspaceValue: value,
					source: "workspace_vs_global",
				})

				// Auto-resolve: workspace settings take precedence
				resolved.push({
					key,
					resolvedValue: value,
					reason: "workspace_precedence",
				})
			}
		}

		// Check for conflicting profiles
		const profileNames = new Set<string>()
		const duplicateProfiles: any[] = []

		for (const profile of syncState.profiles) {
			if (profileNames.has(profile.name)) {
				duplicateProfiles.push(profile)
			} else {
				profileNames.add(profile.name)
			}
		}

		if (duplicateProfiles.length > 0) {
			conflicts.push({
				type: "duplicate_profiles",
				profiles: duplicateProfiles,
			})

			// Auto-resolve: keep most recently used
			for (const dupProfile of duplicateProfiles) {
				const existing = syncState.profiles.find((p) => p.name === dupProfile.name && p !== dupProfile)
				if (existing && dupProfile.lastUsed && existing.lastUsed) {
					const keepDuplicate = new Date(dupProfile.lastUsed) > new Date(existing.lastUsed)
					resolved.push({
						action: "remove_profile",
						profile: keepDuplicate ? existing : dupProfile,
						reason: "keep_most_recent",
					})
				}
			}
		}

		return { conflicts, resolved }
	}

	// Enhanced MCP resource caching
	async getCachedMcpResources(serverName: string): Promise<any[]> {
		const cacheKey = `mcp_resources_${serverName}`
		const cached = this.cache.get(cacheKey)

		if (cached && cached.timestamp && Date.now() - cached.timestamp < 60000) {
			// 1 minute cache
			return cached.resources
		}

		// Cache miss - this would trigger a fresh fetch in the caller
		return []
	}

	async setCachedMcpResources(serverName: string, resources: any[]): Promise<void> {
		const cacheKey = `mcp_resources_${serverName}`
		this.cache.set(cacheKey, {
			timestamp: Date.now(),
			resources,
		})
	}

	// Performance optimization: get settings without full sync
	async getSettingsQuick(key: string): Promise<any> {
		// Try cache first
		const cached = this.cache.get(`settings_${key}`)
		if (cached && Date.now() - cached.timestamp < 30000) {
			// 30 second cache
			return cached.value
		}

		// Quick direct read
		try {
			const context = createCliExtensionContext()
			const value = context.globalState.get(key)

			this.cache.set(`settings_${key}`, {
				timestamp: Date.now(),
				value,
			})

			return value
		} catch (e) {
			console.warn(`Failed to get setting ${key}:`, e)
			return undefined
		}
	}
}
