// Mock VS Code message handler that intercepts postMessage calls and provides appropriate responses
import type { McpServer } from "@roo/mcp"

export class MockVSCodeStorage {
	private prefix = "kilocode-dev-"
	private MCP_SERVERS_KEY = this.prefix + "mcpServers"
	private PROFILES_KEY = this.prefix + "apiProfiles"

	constructor() {
		// Listen for postMessage calls from the app
		if (typeof window !== "undefined" && window.location.hostname === "localhost") {
			this.initializeMessageHandler()
		}
	}

	private initializeMessageHandler(): void {
		// Override window.postMessage to intercept VSCode API calls
		const originalPostMessage = window.postMessage.bind(window)
		window.postMessage = (
			message: any,
			targetOriginOrOptions?: string | WindowPostMessageOptions,
			transfer?: Transferable[],
		) => {
			if (targetOriginOrOptions === "*" && message && typeof message === "object") {
				// Handle VSCode API messages
				this.handlePostMessage(message)
			}
			// Still call original for other uses
			if (typeof targetOriginOrOptions === "string") {
				originalPostMessage(message, targetOriginOrOptions, transfer)
			} else {
				originalPostMessage(message, targetOriginOrOptions)
			}
		}
	}

	private handlePostMessage(message: any): void {
		const { type, ...payload } = message

		// Handle different message types
		switch (type) {
			case "webviewDidLaunch":
				this.handleWebviewDidLaunch(payload)
				break

			case "silentlyRefreshMcpMarketplace":
			case "fetchMcpMarketplace":
				this.handleMcpMarketplace()
				break

			case "fetchLatestMcpServersFromHub":
				this.handleFetchLatestMcpServers()
				break

			case "downloadMcp":
				this.handleDownloadMcp(payload)
				break

			case "fetchMarketplaceData":
				this.handleFetchMarketplaceData(payload)
				break

			// Provider profile management
			case "loadApiConfiguration":
				this.handleLoadApiConfiguration(payload?.text)
				break
			case "loadApiConfigurationById":
				this.handleLoadApiConfigurationById(payload?.text)
				break
			case "deleteApiConfiguration":
				this.handleDeleteApiConfiguration(payload?.text)
				break
			case "renameApiConfiguration":
				this.handleRenameApiConfiguration(payload?.oldName, payload?.newName)
				break

			case "requestCodeIndexSecretStatus":
				this.handleCodeIndexSecretStatus(payload)
				break

			case "requestIndexingStatus":
				this.handleIndexingStatus(payload)
				break

			case "requestRouterModels":
			case "requestOpenAiModels":
			case "requestOllamaModels":
			case "requestLmStudioModels":
			case "requestHuggingFaceModels":
			case "requestOpenRouterModels":
				this.handleRouterModels(payload)
				break

			case "upsertApiConfiguration":
				this.handleUpsertApiConfiguration(payload)
				break

			default:
				console.log(`[Mock VSCode] Unhandled message type: ${type}`, payload)
		}
	}

	// Normalize incoming/outgoing apiConfiguration objects to what the UI expects
	private normalizeApiConfiguration(cfg: any): any {
		if (!cfg || typeof cfg !== "object") return cfg
		const copy = { ...cfg }
		// Ensure provider is preserved
		if (!copy.apiProvider && copy.provider) copy.apiProvider = copy.provider
		// Kilocode provider expects `kilocodeModel`, not `modelId`
		if (copy.apiProvider === "kilocode") {
			if (!copy.kilocodeModel && copy.modelId) {
				copy.kilocodeModel = copy.modelId
			}
			// Keep token field consistent
			if (!copy.kilocodeToken && copy.apiKey) {
				// do not promote generic apiKey to token unless it's absent; better to leave undefined
			}
			// Remove legacy generic modelId to avoid UI fallbacks
			delete (copy as any).modelId
		}
		if (copy.apiProvider === "openai") {
			// Ensure required fields have sensible defaults in dev
			if (!copy.openAiBaseUrl) copy.openAiBaseUrl = "https://api.openai.com/v1"
			// If user typed a generic modelId somewhere, map it over
			if (!copy.openAiModelId && copy.apiModelId) copy.openAiModelId = copy.apiModelId
			if (!copy.openAiModelId && copy.modelId) copy.openAiModelId = copy.modelId
		}
		return copy
	}

	private handleWebviewDidLaunch(_payload: any): void {
		console.log("[Mock VSCode] Webview launched - sending initial state")

		// Build a simple default active profile and profiles map
		const defaultActiveProfile = {
			id: "default",
			apiProvider: "kilocode",
			kilocodeToken: "mock-kilo-token",
			kilocodeModel: "claude-3-5-sonnet-20241022",
			maxTokens: 8192,
		}
		const defaultProfiles = {
			currentApiConfigName: "default",
			apiConfigs: { default: { ...defaultActiveProfile } },
		}

		// Load any previously stored profiles/active
		const storedProfilesRaw = localStorage.getItem(this.PROFILES_KEY)
		const storedActiveRaw = localStorage.getItem("kilocode-apiConfiguration")
		let profiles: any
		let activeProfile: any
		try {
			profiles = storedProfilesRaw ? JSON.parse(storedProfilesRaw) : defaultProfiles
		} catch {
			profiles = defaultProfiles
		}
		try {
			const parsed = storedActiveRaw
				? JSON.parse(storedActiveRaw)
				: profiles.apiConfigs[profiles.currentApiConfigName] || defaultActiveProfile
			activeProfile = this.normalizeApiConfiguration(parsed)
		} catch {
			activeProfile = this.normalizeApiConfiguration(
				profiles.apiConfigs[profiles.currentApiConfigName] || defaultActiveProfile,
			)
		}

		// Send initial state with proper API configuration to prevent welcome screen
		const mockState = {
			version: "1.0.0-dev",
			clineMessages: [],
			taskHistory: [],
			shouldShowAnnouncement: false,
			allowedCommands: [],
			deniedCommands: [],
			soundEnabled: false,
			soundVolume: 0.5,
			ttsEnabled: false,
			ttsSpeed: 1.0,
			diffEnabled: false,
			enableCheckpoints: true,
			fuzzyMatchThreshold: 1.0,
			language: "en",
			writeDelayMs: 1000,
			browserViewportSize: "900x600",
			screenshotQuality: 75,
			terminalOutputLineLimit: 500,
			terminalOutputCharacterLimit: 50000,
			terminalShellIntegrationTimeout: 4000,
			mcpEnabled: true,
			enableMcpServerCreation: false,
			remoteControlEnabled: false,
			alwaysApproveResubmit: false,
			alwaysAllowWrite: true,
			alwaysAllowReadOnly: true,
			requestDelaySeconds: 5,
			currentApiConfigName: profiles.currentApiConfigName,
			listApiConfigMeta: Object.entries(profiles.apiConfigs || {}).map(([name, cfg]: any) => ({
				id: cfg?.id || name,
				name,
				apiProvider: cfg?.apiProvider || "kilocode",
			})),
			mode: "code",
			customModePrompts: {},
			customSupportPrompts: {},
			experiments: {},
			enhancementApiConfigId: "",
			dismissedNotificationIds: [],
			commitMessageApiConfigId: "",
			ghostServiceSettings: {},
			condensingApiConfigId: "",
			customCondensingPrompt: "",
			hasOpenedModeSelector: false,
			autoApprovalEnabled: true,
			customModes: [],
			maxOpenTabsContext: 20,
			maxWorkspaceFiles: 200,
			cwd: "",
			browserToolEnabled: true,
			telemetrySetting: "unset",
			showRooIgnoredFiles: true,
			showAutoApproveMenu: false,
			renderContext: "sidebar",
			maxReadFileLine: -1,
			maxImageFileSize: 5,
			maxTotalImageSize: 20,
			pinnedApiConfigs: {},
			terminalZshOhMy: false,
			maxConcurrentFileReads: 5,
			allowVeryLargeReads: false,
			terminalZshP10k: false,
			terminalZdotdir: false,
			terminalCompressProgressBar: true,
			historyPreviewCollapsed: false,
			showTaskTimeline: true,
			kilocodeDefaultModel: "claude-3-5-sonnet-20241022",
			cloudUserInfo: null,
			cloudIsAuthenticated: false,
			sharingEnabled: false,
			organizationAllowList: { kind: "allow-all" },
			organizationSettingsVersion: -1,
			autoCondenseContext: true,
			autoCondenseContextPercent: 100,
			profileThresholds: {},
			codebaseIndexConfig: {
				codebaseIndexEnabled: true,
				codebaseIndexQdrantUrl: "http://localhost:6333",
				codebaseIndexEmbedderProvider: "openai",
				codebaseIndexEmbedderBaseUrl: "",
				codebaseIndexEmbedderModelId: "",
				codebaseIndexSearchMaxResults: undefined,
				codebaseIndexSearchMinScore: undefined,
			},
			codebaseIndexModels: { ollama: {}, openai: {} },
			alwaysAllowUpdateTodoList: true,
			includeDiagnosticMessages: true,
			maxDiagnosticMessages: 50,
			// Provide active profile only (matches extension behavior)
			apiConfiguration: { ...this.normalizeApiConfiguration(activeProfile) },
		}

		// Send the state message
		setTimeout(() => {
			window.postMessage(
				{
					type: "state",
					state: mockState,
				},
				"*",
			)
		}, 100)

		// Persist active and profiles map
		try {
			// Ensure storage reflects what we are sending
			localStorage.setItem(this.PROFILES_KEY, JSON.stringify(profiles))
			localStorage.setItem(
				"kilocode-apiConfiguration",
				JSON.stringify(this.normalizeApiConfiguration(activeProfile)),
			)
			localStorage.setItem("kilocode-currentApiConfigName", String(profiles.currentApiConfigName || "default"))
		} catch {
			// Silently ignore localStorage errors
		}

		// Also send any installed MCP servers persisted locally
		setTimeout(() => {
			const servers = this.getStoredMcpServers()
			window.postMessage({ type: "mcpServers", mcpServers: servers }, "*")
		}, 120)

		// Also send theme and workspace info
		setTimeout(() => {
			window.postMessage(
				{
					type: "theme",
					text: JSON.stringify({
						"editor.background": "#1e1e1e",
						"editor.foreground": "#d4d4d4",
						"activityBar.background": "#333333",
					}),
				},
				"*",
			)
		}, 150)

		setTimeout(() => {
			window.postMessage(
				{
					type: "workspaceUpdated",
					filePaths: ["src/index.js", "package.json", "README.md"],
					openedTabs: [
						{ label: "index.js", isActive: true, path: "src/index.js" },
						{ label: "package.json", isActive: false, path: "package.json" },
					],
				},
				"*",
			)
		}, 200)

		// Seed router models so model selectors have data immediately
		setTimeout(() => {
			this.handleRouterModels({})
		}, 220)
	}

	private handleMcpMarketplace(): void {
		// Minimal, but real-shaped MCP catalog data
		const catalog = {
			items: [
				{
					mcpId: "github-issues",
					githubUrl: "https://github.com/example/github-issues-mcp",
					name: "GitHub Issues",
					author: "Example Org",
					description: "Query and manage GitHub issues via MCP.",
					codiconIcon: "github-inverted",
					logoUrl: "https://avatars.githubusercontent.com/u/9919?s=200&v=4",
					category: "Productivity",
					tags: ["github", "issues", "devops"],
					requiresApiKey: false,
					isRecommended: true,
					githubStars: 4200,
					downloadCount: 12000,
					createdAt: new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString(),
					updatedAt: new Date().toISOString(),
					lastGithubSync: new Date().toISOString(),
				},
				{
					mcpId: "weather",
					githubUrl: "https://github.com/example/weather-mcp",
					name: "Weather",
					author: "Example Org",
					description: "Fetch current weather and forecasts via MCP.",
					codiconIcon: "cloud",
					logoUrl: "",
					category: "Utilities",
					tags: ["weather", "api"],
					requiresApiKey: false,
					isRecommended: false,
					githubStars: 250,
					downloadCount: 800,
					createdAt: new Date(Date.now() - 20 * 24 * 3600 * 1000).toISOString(),
					updatedAt: new Date().toISOString(),
					lastGithubSync: new Date().toISOString(),
				},
			],
		}

		setTimeout(() => {
			window.postMessage({ type: "mcpMarketplaceCatalog", mcpMarketplaceCatalog: catalog }, "*")
		}, 50)
	}

	private handleFetchLatestMcpServers(): void {
		const servers = this.getStoredMcpServers()
		setTimeout(() => {
			window.postMessage({ type: "mcpServers", mcpServers: servers }, "*")
		}, 25)
	}

	private handleDownloadMcp(payload: any): void {
		const mcpId = payload?.mcpId || "unknown"
		// Provide a realistic download response structure
		const response = {
			mcpId,
			githubUrl: `https://github.com/example/${mcpId}`,
			name: mcpId.replace(/[-_]/g, " ").replace(/\b\w/g, (m: string) => m.toUpperCase()),
			author: "Example Org",
			description: `Instructions to install and use the ${mcpId} MCP server.`,
			readmeContent: `# ${mcpId} MCP\n\nThis is a mock README for ${mcpId}.\n\n## Install\n\n- Ensure Node.js is installed.\n- Run the setup script.\n\n## Usage\n\n- Start the MCP server and connect from the client.`,
			llmsInstallationContent: "\n\n## Additional Notes\nFollow best practices for your OS and shell.",
			requiresApiKey: false,
		}

		// Persist as installed and echo to the UI
		const servers = this.getStoredMcpServers()
		if (!servers.some((s) => s.name === mcpId)) {
			servers.push({
				name: mcpId,
				config: "{}",
				status: "connected",
				source: "global",
				instructions: "Installed via browser dev mock",
			} as McpServer)
			this.setStoredMcpServers(servers)
		}

		setTimeout(() => {
			window.postMessage({ type: "mcpDownloadDetails", mcpDownloadDetails: response }, "*")
			window.postMessage({ type: "mcpServers", mcpServers: servers }, "*")
			// Switch to chat view to mimic extension behavior after installation kickoff
			window.postMessage({ type: "action", action: "chatButtonClicked" }, "*")
		}, 80)
	}

	private handleFetchMarketplaceData(_payload: any): void {
		console.log("[Mock VSCode] Fetching marketplace data")

		// Mock marketplace data response
		const mockMarketplaceData = {
			marketplaceItems: [
				{
					id: "mock-extension-1",
					name: "Mock Extension 1",
					description: "A mock extension for testing marketplace functionality",
					version: "1.0.0",
					publisher: "Mock Publisher",
					category: "Other",
					tags: ["testing", "mock"],
					installed: false,
					downloadCount: 1000,
					rating: 4.5,
					lastUpdated: new Date().toISOString(),
				},
			],
			marketplaceInstalledMetadata: {
				project: {},
				global: {},
			},
			organizationMcps: [],
		}

		// Send the response via window.postMessage to match extension behavior
		setTimeout(() => {
			window.postMessage(
				{
					type: "marketplaceData",
					...mockMarketplaceData,
				},
				"*",
			)
		}, 100)
	}

	private handleCodeIndexSecretStatus(_payload: any): void {
		setTimeout(() => {
			window.postMessage({ type: "codeIndexSecretStatus", status: "available" }, "*")
		}, 10)
	}

	private handleIndexingStatus(_payload: any): void {
		setTimeout(() => {
			window.postMessage({ type: "indexingStatus", isIndexing: false, progress: 0 }, "*")
		}, 10)
	}

	private handleRouterModels(_payload: any): void {
		// Minimal but correctly shaped RouterModels object
		const models = {
			"kilocode-openrouter": {
				"claude-3-5-sonnet-20241022": { id: "claude-3-5-sonnet-20241022", name: "Claude 3.5 Sonnet" },
				"gpt-4o": { id: "gpt-4o", name: "GPT-4o" },
			},
			openrouter: {
				"claude-3-5-sonnet-20241022": { id: "claude-3-5-sonnet-20241022", name: "Claude 3.5 Sonnet" },
				"gpt-4o": { id: "gpt-4o", name: "GPT-4o" },
			},
			openai: {
				"gpt-5-nano": { id: "gpt-5-nano", name: "GPT-5 Nano" },
				"gpt-4o": { id: "gpt-4o", name: "GPT-4o" },
				"gpt-4o-mini": { id: "gpt-4o-mini", name: "GPT-4o mini" },
			},
			requesty: {
				"gpt-4o-mini": { id: "gpt-4o-mini", name: "GPT-4o-mini" },
			},
			glama: {},
			unbound: {},
			litellm: {},
			deepinfra: {},
			ollama: {},
			lmstudio: {},
			"io-intelligence": {},
		} as any

		setTimeout(() => {
			window.postMessage({ type: "routerModels", routerModels: models }, "*")
		}, 15)
	}

	private handleUpsertApiConfiguration(payload: any): void {
		// Persist active apiConfiguration and update profiles map
		const apiConfiguration = this.normalizeApiConfiguration(payload?.apiConfiguration)
		const name = payload?.text || apiConfiguration?.id || "default"
		if (!apiConfiguration || typeof apiConfiguration !== "object") return

		try {
			// Persist active
			localStorage.setItem(
				"kilocode-apiConfiguration",
				JSON.stringify(this.normalizeApiConfiguration(apiConfiguration)),
			)
			localStorage.setItem("kilocode-currentApiConfigName", name)

			// Update profiles map
			const profiles = this.getStoredApiProfiles()
			profiles.currentApiConfigName = name
			profiles.apiConfigs = profiles.apiConfigs || {}
			profiles.apiConfigs[name] = this.normalizeApiConfiguration({
				...(profiles.apiConfigs[name] || {}),
				...apiConfiguration,
				id: name,
			})
			localStorage.setItem(this.PROFILES_KEY, JSON.stringify(profiles))

			const list = this.buildListFromProfiles(profiles)
			setTimeout(() => {
				window.postMessage({ type: "listApiConfig", listApiConfig: list }, "*")
				window.postMessage(
					{ type: "state", state: { apiConfiguration, currentApiConfigName: name, listApiConfigMeta: list } },
					"*",
				)
				window.postMessage({ type: "action", action: "chatButtonClicked" }, "*")
			}, 25)
		} catch (err) {
			console.warn("[Mock VSCode] Failed to upsert api configuration", err)
		}
	}

	private handleLoadApiConfiguration(name?: string): void {
		if (!name) return
		const profiles = this.getStoredApiProfiles()
		const active = this.normalizeApiConfiguration(profiles.apiConfigs?.[name])
		if (!active) return
		profiles.currentApiConfigName = name
		try {
			localStorage.setItem(this.PROFILES_KEY, JSON.stringify(profiles))
			localStorage.setItem("kilocode-apiConfiguration", JSON.stringify(this.normalizeApiConfiguration(active)))
			localStorage.setItem("kilocode-currentApiConfigName", name)
		} catch {
			// Silently ignore localStorage errors
		}
		const list = this.buildListFromProfiles(profiles)
		setTimeout(() => {
			window.postMessage({ type: "listApiConfig", listApiConfig: list }, "*")
			window.postMessage(
				{
					type: "state",
					state: { apiConfiguration: active, currentApiConfigName: name, listApiConfigMeta: list },
				},
				"*",
			)
		}, 10)
	}

	private handleLoadApiConfigurationById(id?: string): void {
		if (!id) return
		const stored = this.getStoredApiProfiles()
		const entry = Object.entries(stored.apiConfigs || {}).find(([_, v]: any) => (v as any)?.id === id)
		if (!entry) return
		this.handleLoadApiConfiguration(entry[0])
	}

	private handleDeleteApiConfiguration(name?: string): void {
		if (!name) return
		const stored = this.getStoredApiProfiles()
		if (!stored.apiConfigs) return
		delete stored.apiConfigs[name]
		if (stored.currentApiConfigName === name) {
			stored.currentApiConfigName = Object.keys(stored.apiConfigs)[0] || "default"
		}
		try {
			localStorage.setItem(this.PROFILES_KEY, JSON.stringify(stored))
		} catch {
			// Silently ignore localStorage errors
		}
		const list = this.buildListFromProfiles(stored)
		const active = this.normalizeApiConfiguration(stored.apiConfigs[stored.currentApiConfigName])
		if (active) {
			try {
				localStorage.setItem(
					"kilocode-apiConfiguration",
					JSON.stringify(this.normalizeApiConfiguration(active)),
				)
				localStorage.setItem("kilocode-currentApiConfigName", stored.currentApiConfigName)
			} catch {
				// Silently ignore localStorage errors
			}
		}
		setTimeout(() => {
			window.postMessage({ type: "listApiConfig", listApiConfig: list }, "*")
			window.postMessage(
				{
					type: "state",
					state: {
						apiConfiguration: active,
						currentApiConfigName: stored.currentApiConfigName,
						listApiConfigMeta: list,
					},
				},
				"*",
			)
		}, 10)
	}

	private handleRenameApiConfiguration(oldName?: string, newName?: string): void {
		if (!oldName || !newName) return
		const stored = this.getStoredApiProfiles()
		stored.apiConfigs = stored.apiConfigs || {}
		stored.apiConfigs[newName] = { ...(stored.apiConfigs[oldName] || {}), id: newName, name: newName }
		delete stored.apiConfigs[oldName]
		if (stored.currentApiConfigName === oldName) stored.currentApiConfigName = newName
		try {
			localStorage.setItem(this.PROFILES_KEY, JSON.stringify(stored))
			const active = this.normalizeApiConfiguration(stored.apiConfigs[stored.currentApiConfigName])
			if (active)
				localStorage.setItem(
					"kilocode-apiConfiguration",
					JSON.stringify(this.normalizeApiConfiguration(active)),
				)
		} catch {
			// Silently ignore localStorage errors
		}
		const list = this.buildListFromProfiles(stored)
		setTimeout(() => {
			window.postMessage({ type: "listApiConfig", listApiConfig: list }, "*")
			window.postMessage(
				{
					type: "state",
					state: {
						apiConfiguration: stored.apiConfigs[stored.currentApiConfigName],
						currentApiConfigName: stored.currentApiConfigName,
						listApiConfigMeta: list,
					},
				},
				"*",
			)
		}, 10)
	}

	private getStoredApiProfiles(): any {
		try {
			const raw = localStorage.getItem(this.PROFILES_KEY)
			return raw ? JSON.parse(raw) : { currentApiConfigName: "default", apiConfigs: {} }
		} catch {
			return { currentApiConfigName: "default", apiConfigs: {} }
		}
	}

	private buildListFromProfiles(stored: any): Array<{ id: string; name: string; apiProvider?: string }> {
		const cfgs = stored?.apiConfigs || {}
		return Object.entries(cfgs).map(([name, cfg]: any) => ({
			id: cfg?.id || name,
			name,
			apiProvider: cfg?.apiProvider || stored.apiProvider || "kilocode",
		}))
	}

	// Keep the original localStorage methods for backward compatibility
	async get<T>(key: string, defaultValue?: T): Promise<T | undefined> {
		try {
			const stored = localStorage.getItem(this.prefix + key)
			return stored ? JSON.parse(stored) : defaultValue
		} catch {
			return defaultValue
		}
	}

	async update<T>(key: string, value: T): Promise<void> {
		try {
			localStorage.setItem(this.prefix + key, JSON.stringify(value))
		} catch (err) {
			console.error("Failed to save setting:", key, err)
		}
	}

	// Persistent MCP server helpers
	private getStoredMcpServers(): McpServer[] {
		try {
			const raw = localStorage.getItem(this.MCP_SERVERS_KEY)
			return raw ? (JSON.parse(raw) as McpServer[]) : []
		} catch {
			return []
		}
	}

	private setStoredMcpServers(servers: McpServer[]): void {
		try {
			localStorage.setItem(this.MCP_SERVERS_KEY, JSON.stringify(servers))
		} catch (err) {
			console.warn("Failed to persist MCP servers", err)
		}
	}

	async store(key: string, value: string): Promise<void> {
		try {
			localStorage.setItem(this.prefix + key, value)
		} catch (err) {
			console.error("Failed to store secret:", key, err)
		}
	}

	async delete(key: string): Promise<void> {
		localStorage.removeItem(this.prefix + key)
	}
}

export const mockStorage = new MockVSCodeStorage()
