import type { WebviewApi } from "vscode-webview"

import { WebviewMessage } from "@roo/WebviewMessage"
// Initialize lightweight dev mocks when running in a browser (localhost)
// This keeps the production code path minimal and delegates mock behavior.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { mockStorage } from "./mockVSCodeStorage"

/**
 * A utility wrapper around the acquireVsCodeApi() function, which enables
 * message passing and state management between the webview and extension
 * contexts.
 *
 * This utility also enables webview code to be run in a web browser-based
 * dev server by using native web browser features that mock the functionality
 * enabled by acquireVsCodeApi.
 */
class VSCodeAPIWrapper {
	private readonly vsCodeApi: WebviewApi<unknown> | undefined
	// In-browser dev state for chat messages to emulate extension behavior
	private mockClineMessages: any[] = []
	// Prevent duplicate initial state blasts when multiple bundles mount
	private launchedOnce = false
	// Keys used for localStorage persistence in dev
	private readonly API_CONFIG_KEY = "kilocode-apiConfiguration"
	private readonly CURRENT_API_NAME_KEY = "kilocode-currentApiConfigName"
	// Project handle for File System Access API
	private projectHandle: any = null

	constructor() {
		// Check if the acquireVsCodeApi function exists in the current development
		// context (i.e. VS Code development window or web browser)
		if (typeof acquireVsCodeApi === "function") {
			this.vsCodeApi = acquireVsCodeApi()
		}
	}

	/**
	 * Post a message (i.e. send arbitrary data) to the owner of the webview.
	 *
	 * @remarks When running webview code inside a web browser, postMessage will instead
	 * log the given message to the console.
	 *
	 * @param message Arbitrary data (must be JSON serializable) to send to the extension context.
	 */
	public postMessage(message: WebviewMessage) {
		if (this.vsCodeApi) {
			this.vsCodeApi.postMessage(message)
		} else {
			// Dev server: forward messages to window so our mock storage can handle them
			try {
				window.postMessage(message as unknown as any, "*")
			} catch (err) {
				console.warn("Failed to dev-postMessage; falling back to log only", err, message)
			}

			// Only log important messages to reduce console noise in dev
			const routineTypes = new Set([
				"requestRouterModels",
				"language",
				"alwaysAllowReadOnly",
				"alwaysAllowWrite",
				"allowedCommands",
				"deniedCommands",
				"autoCondenseContext",
				"browserToolEnabled",
				"soundEnabled",
				"ttsEnabled",
				"diffEnabled",
				"enableCheckpoints",
				"mcpEnabled",
				"telemetrySetting",
				"systemNotificationsEnabled",
				"webviewDidLaunch",
				"requestCodeIndexSecretStatus",
				"requestIndexingStatus",
			])
			if (!routineTypes.has(message.type)) {
				console.log("vscode.postMessage:", message)
			}

			// Always handle dev-webview messages (folder pick, marketplace, routerModels, etc.).
			// Chat mocking (newTask/askResponse) is decided inside handleChatMessage.
			this.mockExtensionResponses(message)
		}
	}

	/**
	 * Get the persistent state stored for this webview.
	 *
	 * @remarks When running webview source code inside a web browser, getState will retrieve state
	 * from local storage (https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage).
	 *
	 * @return The current state or `undefined` if no state has been set.
	 */
	public getState(): unknown | undefined {
		if (this.vsCodeApi) {
			return this.vsCodeApi.getState()
		} else {
			const state = localStorage.getItem("vscodeState")
			return state ? JSON.parse(state) : undefined
		}
	}

	/**
	 * Set the persistent state stored for this webview.
	 *
	 * @remarks When running webview source code inside a web browser, setState will set the given
	 * state using local storage (https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage).
	 *
	 * @param newState New persisted state. This must be a JSON serializable object. Can be retrieved
	 * using {@link getState}.
	 *
	 * @return The new state.
	 */
	public setState<T extends unknown | undefined>(newState: T): T {
		if (this.vsCodeApi) {
			return this.vsCodeApi.setState(newState)
		} else {
			localStorage.setItem("vscodeState", JSON.stringify(newState))
			return newState
		}
	}

	private mockExtensionResponses(message: any) {
		// Mock responses for dev server
		if (typeof window !== "undefined" && window.location.hostname === "localhost") {
			setTimeout(() => {
				switch (message.type) {
					case "webviewDidLaunch":
						this.handleWebviewDidLaunch()
						break
					case "newTask": {
						// Route to real chat handler (no mocks)
						this.handleChatMessage(message)
						break
					}
					case "askResponse": {
						// Route to real chat handler (no mocks)
						this.handleChatMessage(message)
						break
					}
					case "requestCodeIndexSecretStatus":
						window.postMessage({ type: "codeIndexSecretStatus", status: "available" }, "*")
						break
					case "requestIndexingStatus":
						window.postMessage(
							{
								type: "indexingStatus",
								isIndexing: false,
								progress: 100,
								totalFiles: 150,
								indexedFiles: 150,
								status: "complete",
							},
							"*",
						)
						break
					case "startIndexing": {
						console.log("[Mock VSCode] Starting codebase indexing")
						window.postMessage(
							{
								type: "indexingStatus",
								isIndexing: true,
								progress: 0,
								totalFiles: 150,
								indexedFiles: 0,
								status: "indexing",
							},
							"*",
						)
						// Simulate indexing progress
						let progress = 0
						const interval = setInterval(() => {
							progress += 20
							window.postMessage(
								{
									type: "indexingStatus",
									isIndexing: progress < 100,
									progress,
									totalFiles: 150,
									indexedFiles: Math.floor((150 * progress) / 100),
									status: progress < 100 ? "indexing" : "complete",
								},
								"*",
							)
							if (progress >= 100) {
								clearInterval(interval)
							}
						}, 500)
						break
					}
					case "requestRouterModels": {
						// Send a correctly shaped RouterModels object
						const routerModels = {
							openai: {
								"gpt-4o": { id: "gpt-4o", name: "GPT-4o" },
								"gpt-4o-mini": { id: "gpt-4o-mini", name: "GPT-4o mini" },
							},
							openrouter: {
								"claude-3-5-sonnet-20241022": {
									id: "claude-3-5-sonnet-20241022",
									name: "Claude 3.5 Sonnet",
								},
							},
							"kilocode-openrouter": {
								"claude-3-5-sonnet-20241022": {
									id: "claude-3-5-sonnet-20241022",
									name: "Claude 3.5 Sonnet",
								},
							},
						} as any
						window.postMessage({ type: "routerModels", routerModels }, "*")
						break
					}
					case "fetchMarketplaceData":
						this.handleFetchMarketplaceData()
						break
					case "loadApiConfiguration":
						console.log("[Mock VSCode] Loading API configuration:", message.text)
						this.handleLoadApiConfiguration(message.text || "default")
						break
					case "deleteApiConfiguration":
						console.log("[Mock VSCode] Deleting API configuration:", message.text)
						this.handleDeleteApiConfiguration(message.text)
						break
					case "renameApiConfiguration":
						console.log("[Mock VSCode] Renaming API configuration:", message.oldName, "to", message.newName)
						this.handleRenameApiConfiguration(message.oldName, message.newName)
						break
					case "requestOpenAiModels":
					case "requestOllamaModels":
					case "requestLmStudioModels":
					case "requestHuggingFaceModels":
					case "requestOpenRouterModels": {
						console.log("[Mock VSCode] Requesting models for provider:", message.type)
						const routerModels: any = {}
						if (message.type === "requestOpenAiModels") {
							routerModels.openai = {
								"gpt-5-nano": { id: "gpt-5-nano", name: "GPT-5 Nano" },
								"gpt-4o": { id: "gpt-4o", name: "GPT-4o" },
								"gpt-4o-mini": { id: "gpt-4o-mini", name: "GPT-4o mini" },
							}
						}
						if (message.type === "requestOpenRouterModels") {
							routerModels.openrouter = {
								"claude-3-5-sonnet-20241022": {
									id: "claude-3-5-sonnet-20241022",
									name: "Claude 3.5 Sonnet",
								},
							}
						}
						setTimeout(() => {
							window.postMessage({ type: "routerModels", routerModels }, "*")
						}, 30)
						break
					}
					case "fetchProfileDataRequest":
						console.log("[Mock VSCode] Fetching profile data - returning mock user")
						// Mock profile data response to prevent infinite requests
						setTimeout(() => {
							window.postMessage(
								{
									type: "profileData",
									profile: {
										id: "mock-user",
										email: "dev@kilocode.ai",
										name: "Development User",
										credits: 1000,
										isSubscribed: true,
									},
								},
								"*",
							)
						}, 50)
						break
					case "upsertApiConfiguration": {
						console.log("[Mock VSCode] Upsert API Configuration:", message.text)
						// Ensure target profile exists and persist
						this.handleUpsertApiConfiguration(message.text, message.apiConfiguration)
						// The key insight: WelcomeView checks showWelcome state which depends on checkExistKey
						// We need to ensure the apiConfiguration has valid keys to pass this check
						const _validApiConfig = {
							...message.apiConfiguration,
							// Ensure we have the required fields that checkExistKey looks for
							apiConfigs: message.apiConfiguration?.apiConfigs || {
								default: {
									id: "default",
									apiProvider: "kilocode",
									apiKey: "mock-api-key",
									kilocodeToken: "mock-kilo-token",
									modelId: "claude-3-5-sonnet-20241022",
								},
							},
						}

						// Send updated list and state reflecting persisted storage
						setTimeout(() => {
							const list = this.buildListFromStorage()
							const current = this.getCurrentConfigName()
							const storedCfg = this.getStoredApiConfig()
							window.postMessage({ type: "listApiConfig", listApiConfig: list }, "*")
							window.postMessage(
								{
									type: "state",
									state: {
										apiConfiguration: storedCfg,
										currentApiConfigName: current,
										listApiConfigMeta: list,
									},
								},
								"*",
							)
						}, 50)

						// Send action to switch to chat after configuration is saved
						setTimeout(() => {
							window.postMessage(
								{
									type: "action",
									action: "chatButtonClicked",
								},
								"*",
							)
						}, 100)
						break
					}
					// Authentication & Cloud
					case "rooCloudSignIn":
					case "rooCloudSignOut":
					case "openExternal":
					case "remoteControlEnabled":
						break
					// Auto-Approve
					case "autoApprovalEnabled":
						break
					// Checkpoints
					case "checkpointRestore":
						break
					// Chat & Tasks (no-ops in dev; already handled above where applicable)
					case "cancelTask":
					case "clearTask":
						this.handleClearTask()
						break
					case "condenseTaskContextRequest":
					case "selectImages":
					case "setHistoryPreviewCollapsed":
					case "updateTodoList":
						break
					// Command Execution
					case "allowedCommands":
					case "deniedCommands":
						break
					// File & Open Operations
					case "openFile":
					case "openImage":
					case "openMention":
						break
					// Indexing/Codebase
					case "clearIndexData":
						break
					// MCP/Marketplace
					case "enableMcpServerCreation":
					case "fetchLatestMcpServersFromHub":
					case "fetchMcpMarketplace":
					case "mcpEnabled":
						// Acknowledge without side effects in dev
						console.log(`[Mock VSCode] Handled: ${message.type}`)
						break
					case "openMcpSettings":
						// In dev, prompt user to save/open a global MCP config JSON only when explicitly requested
						this.handleOpenMcpSettings("global")
						break
					case "pickWorkspaceFolder":
						this.handlePickWorkspaceFolder()
						break
					case "setGitBranch":
						this.handleSetGitBranch((message as any).text)
						break
					case "requestGitBranches":
						this.handleRequestGitBranches()
						break
					case "openProjectMcpSettings":
						// In dev, prompt user to save/open a project MCP config JSON
						this.handleOpenMcpSettings("project")
						break
					case "refreshAllMcpServers":
					case "silentlyRefreshMcpMarketplace":
						break
					// History/Tasks
					case "deleteMultipleTasksWithIds":
					case "deleteTaskWithId":
					case "exportCurrentTask":
					case "exportTaskWithId":
					case "showTaskWithId":
					case "switchTab":
						break
					// Profile/Settings
					case "fetchBalanceDataRequest":
					case "refreshRules":
					case "openGlobalKeybindings":
					case "showFeedbackOptions":
					case "fetchKilocodeNotifications":
						break
					// Telemetry
					case "telemetrySetting":
						break
					// Terminal
					case "terminalOperation":
						break
					// UI/Misc
					case "didShowAnnouncement":
					case "focusPanelRequest":
					case "humanRelayResponse":
					case "humanRelayCancel":
					case "showMdmAuthRequiredNotification":
						console.log(`[Mock VSCode] Handled: ${message.type}`, message)
						// Generic acknowledgment for all handled message types
						break
				}
			}, 10)
		}
	}

	private handleWebviewDidLaunch(): void {
		if (this.launchedOnce) return
		this.launchedOnce = true
		console.log("[Mock VSCode] Webview launched - sending initial state")

		// Load from storage if available
		const stored = this.getStoredApiConfig()
		const listMeta = this.buildListFromStorage()
		const currentName = this.getCurrentConfigName() || stored?.currentApiConfigName || "default"

		// Send initial state with proper API configuration to prevent welcome screen
		const mockState = {
			version: "1.0.0-dev",
			clineMessages: [],
			// Only add mock task history in localhost development
			taskHistory:
				typeof window !== "undefined" && window.location.hostname === "localhost"
					? [
							{
								id: "mock-task-1",
								ts: Date.now() - 86400000, // 1 day ago
								task: "Create a React component for user authentication",
								tokensIn: 1250,
								tokensOut: 890,
								totalCost: 0.025,
							},
							{
								id: "mock-task-2",
								ts: Date.now() - 3600000, // 1 hour ago
								task: "Debug API connection timeout issues",
								tokensIn: 850,
								tokensOut: 1200,
								totalCost: 0.018,
							},
						]
					: [],
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
			currentApiConfigName: currentName,
			listApiConfigMeta: listMeta.length
				? listMeta
				: [{ id: "default", name: "default", apiProvider: "kilocode" }],
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
			cwd: (() => {
				try {
					return `/${localStorage.getItem("kilocode-dev-cwd") || ""}`
				} catch {
					return ""
				}
			})(),
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
			organizationAllowList: {
				allowAll: true,
				providers: {},
			},
			organizationMcps: [],
			organizationSettingsVersion: -1,
			autoCondenseContext: true,
			autoCondenseContextPercent: 100,
			profileThresholds: {},
			codebaseIndexConfig: {
				codebaseIndexEnabled: true,
				codebaseIndexQdrantUrl: "http://localhost:6333",
				codebaseIndexEmbedderProvider: "openai",
				codebaseIndexEmbedderBaseUrl: "",
				codebaseIndexEmbedderModelId: "text-embedding-ada-002",
				codebaseIndexSearchMaxResults: 10,
				codebaseIndexSearchMinScore: 0.7,
			},
			codebaseIndexModels: { ollama: {}, openai: {} },
			alwaysAllowUpdateTodoList: true,
			includeDiagnosticMessages: true,
			maxDiagnosticMessages: 50,
			// This is the key part - provide a valid API configuration
			apiConfiguration: stored ?? {
				currentApiConfigName: "default",
				apiProvider: "kilocode",
				apiKey: "mock-dev-key",
				kilocodeToken: "mock-kilo-token",
				kilocodeModel: "claude-3-5-sonnet-20241022",
				apiConfigs: {
					default: {
						id: "default",
						apiProvider: "kilocode",
						apiKey: "mock-dev-key",
						kilocodeToken: "mock-kilo-token",
						modelId: "claude-3-5-sonnet-20241022",
						baseURL: "",
						maxTokens: 8192,
					},
				},
			},
		}

		// Initialize mock messages state and send the state message
		this.mockClineMessages = mockState.clineMessages || []
		setTimeout(() => {
			window.postMessage(
				{
					type: "state",
					state: mockState,
				},
				"*",
			)
		}, 100)

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
	}

	private handleClearTask() {
		// Reset in-memory chat and notify webview
		this.mockClineMessages = []
		const list = this.buildListFromStorage()
		const current = this.getCurrentConfigName()
		const storedCfg = this.getStoredApiConfig()
		// Send a minimal state update that clears the conversation but preserves config
		window.postMessage(
			{
				type: "state",
				state: {
					clineMessages: [],
					apiConfiguration: storedCfg,
					currentApiConfigName: current,
					listApiConfigMeta: list,
				},
			},
			"*",
		)
	}

	// --- Real chat in dev (best-effort) ---
	private getActiveApiConfiguration(): any | undefined {
		try {
			const raw = localStorage.getItem(this.API_CONFIG_KEY)
			const stored = raw ? JSON.parse(raw) : undefined
			if (!stored) return undefined
			// Prefer active profile if a profiles map is present
			const currentName = stored.currentApiConfigName || this.getCurrentConfigName()
			const base = stored.apiConfigs?.[currentName] || stored.apiConfigs?.[stored.name] || {}
			// Prefer top-level (current session) fields over profile defaults
			const active = { ...base, ...stored }
			// Determine normalized provider
			const rawProvider: string | undefined = active.apiProvider || active.provider
			let normalizedProvider: string | undefined = rawProvider
			if (rawProvider) {
				const p = String(rawProvider).toLowerCase()
				if (p.startsWith("openai")) normalizedProvider = "openai"
				else if (p.startsWith("openrouter")) normalizedProvider = "openrouter"
			}
			if (!normalizedProvider) {
				if (
					active.apiProvider === "openai" ||
					active.openAiApiKey ||
					active.openAiModelId ||
					active.openAiNativeApiKey
				)
					normalizedProvider = "openai"
				else if (active.apiProvider === "openrouter" || active.openRouterApiKey || active.openRouterModelId)
					normalizedProvider = "openrouter"
				else if (active.apiProvider === "claude-code") normalizedProvider = "claude-code"
				else if (active.apiProvider === "anthropic" || active.anthropicApiKey || active.anthropicModelId)
					normalizedProvider = "anthropic"
				else if (active.kilocodeToken) normalizedProvider = "kilocode"
			}
			;(active as any)._normalizedProvider = normalizedProvider

			// Normalize keys for OpenAI variants (openai, openai-native)
			if (normalizedProvider === "openai") {
				if (!active.openAiApiKey) active.openAiApiKey = active.openAiNativeApiKey || active.apiKey
				if (!active.openAiModelId)
					active.openAiModelId = active.openAiNativeModelId || active.apiModelId || active.modelId
			}
			// Normalize keys for OpenRouter
			if (normalizedProvider === "openrouter") {
				if (!active.openRouterApiKey) active.openRouterApiKey = active.apiKey
				if (!active.openRouterModelId) active.openRouterModelId = active.apiModelId || active.modelId
			}
			// Normalize keys for Anthropic
			if (normalizedProvider === "anthropic") {
				if (!active.anthropicApiKey) active.anthropicApiKey = active.apiKey
				if (!active.anthropicModelId) active.anthropicModelId = active.apiModelId || active.modelId
			}
			return active
		} catch {
			return undefined
		}
	}

	private async handleChatMessage(message: any) {
		try {
			console.log("[Mock VSCode] chat message", { type: message.type })
		} catch {
			// Silently ignore errors
		}
		const ts = Date.now()
		// For a brand new task, the first message should be the task text
		if (message.type === "newTask") {
			this.mockClineMessages.push({
				type: "say",
				say: "text",
				ts,
				text: message.text ?? "",
				images: message.images ?? [],
			})
			// Indicate request started so UI can show thinking state
			this.mockClineMessages.push({
				type: "say",
				say: "api_req_started",
				ts: ts + 0.1,
				text: JSON.stringify({}),
			} as any)
			// Immediately reflect the new task in UI
			this.emitMockStateUpdate()
		} else {
			// Follow-ups appear as user_feedback bubbles
			this.mockClineMessages.push({
				type: "say",
				say: "user_feedback",
				ts,
				text: message.text ?? "",
				images: message.images ?? [],
			})
			// Indicate request started so UI shows thinking
			this.mockClineMessages.push({
				type: "say",
				say: "api_req_started",
				ts: ts + 0.1,
				text: JSON.stringify({}),
			} as any)
			// Reflect user message before provider responds
			this.emitMockStateUpdate()
		}

		// Try real provider call using active configuration
		try {
			const cfg = this.getActiveApiConfiguration() || {}
			const provider = (cfg as any)._normalizedProvider || cfg.apiProvider || cfg.provider
			console.log("[Mock VSCode] Provider check:", {
				provider,
				hasAnthropicKey: !!cfg.anthropicApiKey,
				hasAnthropicModel: !!(cfg.anthropicModelId || cfg.apiModelId || cfg.modelId),
				cfg,
			})
			let assistant = ""
			if (provider === "openai" && cfg.openAiApiKey && (cfg.openAiModelId || cfg.apiModelId || cfg.modelId)) {
				const model = cfg.openAiModelId || cfg.apiModelId || cfg.modelId
				assistant = await this.callOpenAI(model, cfg.openAiApiKey, message.text || "")
			} else if (
				provider === "openrouter" &&
				cfg.openRouterApiKey &&
				(cfg.openRouterModelId || cfg.apiModelId || cfg.modelId)
			) {
				const model = cfg.openRouterModelId || cfg.apiModelId || cfg.modelId
				assistant = await this.callOpenRouter(model, cfg.openRouterApiKey, message.text || "")
			} else if (
				provider === "anthropic" &&
				cfg.anthropicApiKey &&
				(cfg.anthropicModelId || cfg.apiModelId || cfg.modelId)
			) {
				const model = cfg.anthropicModelId || cfg.apiModelId || cfg.modelId
				assistant = await this.callAnthropic(model, cfg.anthropicApiKey, message.text || "")
			} else if (provider === "claude-code") {
				// Check if we're in Electron with IPC available
				if (typeof window !== "undefined" && (window as any).electronAPI?.executeClaudeStream) {
					const model =
						cfg.claudeCodeModelId ||
						cfg.anthropicModelId ||
						cfg.apiModelId ||
						cfg.modelId ||
						"claude-3-5-sonnet-20241022"
					const systemPrompt = "You are a helpful coding assistant."

					// Show API request started in UI
					this.mockClineMessages.push({
						type: "say",
						say: "api_req_started",
						ts: ts + 0.1,
						text: JSON.stringify({
							model,
							max_tokens: cfg.claudeCodeMaxOutputTokens || 8192,
							system: systemPrompt.substring(0, 100) + "...",
						}),
					} as any)
					this.emitMockStateUpdate()

					// Use streaming if available
					try {
						// Track streaming chunks for real-time display
						let fullResponse = ""
						let isStreaming = false

						assistant = await new Promise((resolve, reject) => {
							const cleanup = (window as any).electronAPI.executeClaudeStream(
								{
									path: cfg.claudeCodePath,
									systemPrompt,
									prompt: message.text || "",
									model,
									maxOutputTokens: cfg.claudeCodeMaxOutputTokens || 8192,
								},
								(chunk: any) => {
									console.log("[Electron Stream Chunk]:", chunk)
									if (chunk.type === "text") {
										fullResponse += chunk.text
										// Emit streaming update to UI
										if (!isStreaming) {
											isStreaming = true
											// Clear the API request started message and start showing text
											this.mockClineMessages = this.mockClineMessages.filter(
												(m) => !(m.say === "api_req_started" && m.ts === ts + 0.1),
											)
										}
										// Update the assistant message with streaming text
										const existingMsg = this.mockClineMessages.find(
											(m) => m.say === "text" && m.ts === ts + 1,
										)
										if (existingMsg) {
											existingMsg.text = fullResponse
										} else {
											this.mockClineMessages.push({
												type: "say",
												say: "text",
												ts: ts + 1,
												text: fullResponse,
												partial: true, // Mark as streaming
											})
										}
										this.emitMockStateUpdate()
									} else if (chunk.type === "tool_use") {
										// Handle tool use from claude
										fullResponse += `\n[Tool Use: ${chunk.tool}]\n`
										console.log("[Tool Use]:", chunk.tool, chunk.input)
									} else if (chunk.type === "tool_result") {
										// Handle tool results
										fullResponse += `\n[Tool Result]\n`
										console.log("[Tool Result]:", chunk.output)
									} else if (chunk.type === "done") {
										cleanup()
										// Mark streaming as complete
										const streamMsg = this.mockClineMessages.find(
											(m) => m.say === "text" && m.ts === ts + 1,
										)
										if (streamMsg) {
											streamMsg.partial = false
										}
										// If no response text, provide feedback
										if (!fullResponse.trim()) {
											fullResponse = "Claude completed the task but provided no text response."
										}
										resolve(fullResponse)
									} else if (chunk.type === "error") {
										cleanup()
										reject(new Error(chunk.error))
									}
								},
							)
						})
					} catch (err: any) {
						throw err
					}
				} else if (typeof window !== "undefined" && (window as any).electronAPI?.executeClaude) {
					// Fallback to non-streaming version
					const model =
						cfg.claudeCodeModelId ||
						cfg.anthropicModelId ||
						cfg.apiModelId ||
						cfg.modelId ||
						"claude-3-5-sonnet-20241022"
					const systemPrompt = "You are a helpful coding assistant."
					try {
						assistant = await (window as any).electronAPI.executeClaude({
							path: cfg.claudeCodePath,
							systemPrompt,
							prompt: message.text || "",
							model,
							maxOutputTokens: cfg.claudeCodeMaxOutputTokens || 8192,
						})
					} catch (err: any) {
						throw new Error(`Claude CLI error: ${err.message}`)
					}
				} else {
					// Browser dev environment
					throw new Error(
						"Claude Code requires the VS Code extension or Electron app with claude CLI installed.",
					)
				}
			} else {
				throw new Error(
					"Provider not configured: set OpenAI, OpenRouter, Anthropic, or Claude Code with key and model in Settings",
				)
			}

			// Only add the text message if it wasn't already added during streaming
			const existingTextMsg = this.mockClineMessages.find((m) => m.say === "text" && m.ts === ts + 1)
			if (!existingTextMsg) {
				this.mockClineMessages.push({ type: "say", say: "text", ts: ts + 1, text: assistant })
			}

			// Mark request finished so spinner stops
			this.mockClineMessages.push({
				type: "say",
				say: "api_req_finished",
				ts: ts + 1.1,
				text: JSON.stringify({ cost: 0 }),
			} as any)
			// Remove the completion_result message - we don't want "Start New Task" button
			// Instead, just leave it in a state where the user can continue chatting
			// The api_req_finished message is enough to stop the spinner
			this.emitMockStateUpdate()
		} catch (err: any) {
			this.mockClineMessages.push({
				type: "say",
				say: "text",
				ts: ts + 1,
				text: `Chat error: ${err?.message || String(err)}`,
			})
			// Mark request finished even on error
			this.mockClineMessages.push({
				type: "say",
				say: "api_req_finished",
				ts: ts + 1.1,
				text: JSON.stringify({ cost: 0 }),
			} as any)
			// Remove the completion_result message - we don't want "Start New Task" button
			// Instead, just leave it in a state where the user can continue chatting
			this.emitMockStateUpdate()
		}
	}

	private async callOpenAI(model: string, apiKey: string, prompt: string): Promise<string> {
		const url = "https://api.openai.com/v1/chat/completions"
		const body = {
			model,
			messages: [
				{ role: "system", content: "You are a helpful coding assistant." },
				{ role: "user", content: prompt },
			],
			stream: false,
		}
		const res = await fetch(url, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${apiKey}`,
			},
			body: JSON.stringify(body),
		})
		if (!res.ok) {
			const text = await res.text().catch(() => "")
			throw new Error(`OpenAI request failed: ${res.status} ${res.statusText} ${text}`)
		}
		const data: any = await res.json()
		return data?.choices?.[0]?.message?.content || "(no content)"
	}

	private async callOpenRouter(model: string, apiKey: string, prompt: string): Promise<string> {
		const url = "https://openrouter.ai/api/v1/chat/completions"
		const body = {
			model,
			messages: [
				{ role: "system", content: "You are a helpful coding assistant." },
				{ role: "user", content: prompt },
			],
			stream: false,
		}
		const res = await fetch(url, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${apiKey}`,
			},
			body: JSON.stringify(body),
		})
		if (!res.ok) {
			const text = await res.text().catch(() => "")
			throw new Error(`OpenRouter request failed: ${res.status} ${res.statusText} ${text}`)
		}
		const data: any = await res.json()
		return data?.choices?.[0]?.message?.content || "(no content)"
	}

	private async callAnthropic(model: string, apiKey: string, prompt: string): Promise<string> {
		const url = "https://api.anthropic.com/v1/messages"
		const body = {
			model,
			max_tokens: 4096,
			messages: [{ role: "user", content: prompt }],
		}
		const res = await fetch(url, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"x-api-key": apiKey,
				"anthropic-version": "2023-06-01",
			},
			body: JSON.stringify(body),
		})
		if (!res.ok) {
			const text = await res.text().catch(() => "")
			throw new Error(`Anthropic request failed: ${res.status} ${res.statusText} ${text}`)
		}
		const data: any = await res.json()
		return data?.content?.[0]?.text || "(no content)"
	}

	private async persistProjectHandle(handle: any): Promise<void> {
		// Mock implementation for persisting project handle
		try {
			localStorage.setItem("kilocode-project-handle", JSON.stringify(handle))
		} catch {
			// Silently ignore errors
		}
	}

	private async updateWorkspaceFromProjectHandle(): Promise<void> {
		// Mock implementation for updating workspace from project handle
		// This would normally read files from the project handle and update the workspace
		console.log("[Mock VSCode] Updating workspace from project handle")
	}

	// --- Dev storage helpers ---

	private async handlePickWorkspaceFolder() {
		try {
			if (!(window as any).showDirectoryPicker) {
				console.warn("[Mock VSCode] File System Access API not available in this browser")
				return
			}
			const dir: any = await (window as any).showDirectoryPicker({ mode: "readwrite" })
			try {
				const q = await (dir as any).queryPermission?.({ mode: "readwrite" })
				if (q !== "granted") await (dir as any).requestPermission?.({ mode: "readwrite" })
			} catch {
				// Silently ignore errors
			}
			this.projectHandle = dir
			await this.persistProjectHandle(dir)
			localStorage.setItem("kilocode-dev-cwd", dir?.name || "")
			const storedCfg = this.getStoredApiConfig()
			const currentName = this.getCurrentConfigName()
			window.postMessage(
				{
					type: "state",
					state: {
						cwd: `/${dir?.name || ""}`,
						apiConfiguration: storedCfg,
						currentApiConfigName: currentName,
					},
				},
				"*",
			)
			await this.updateWorkspaceFromProjectHandle()
		} catch (e) {
			console.warn("[Mock VSCode] pickWorkspaceFolder failed", e)
		}
	}

	private handleSetGitBranch(name?: string) {
		let branch = name
		if (!branch)
			branch =
				window.prompt("Git branch name:", localStorage.getItem("kilocode-dev-git-branch") || "main") ||
				undefined
		if (!branch) return
		localStorage.setItem("kilocode-dev-git-branch", branch)
		// Ensure branch appears in branches list
		try {
			const raw = localStorage.getItem("kilocode-dev-git-branches")
			const list: string[] = raw ? JSON.parse(raw) : []
			if (!list.includes(branch)) {
				list.unshift(branch)
				localStorage.setItem("kilocode-dev-git-branches", JSON.stringify(list.slice(0, 20)))
			}
		} catch {
			// Silently ignore errors
		}
		setTimeout(() => {
			const storedCfg = this.getStoredApiConfig()
			const currentName = this.getCurrentConfigName()
			window.postMessage(
				{
					type: "state",
					state: { gitBranch: branch, apiConfiguration: storedCfg, currentApiConfigName: currentName },
				} as any,
				"*",
			)
		}, 10)
	}

	private handleRequestGitBranches() {
		let branches: string[] = []
		try {
			const raw = localStorage.getItem("kilocode-dev-git-branches")
			branches = raw ? JSON.parse(raw) : []
		} catch {
			// Silently ignore errors
		}
		if (!branches || branches.length === 0) {
			branches = ["main", "develop", "feature/example"]
		}
		setTimeout(() => {
			window.postMessage({ type: "gitBranches", branches }, "*")
		}, 10)
	}

	private async handleOpenMcpSettings(scope: "global" | "project") {
		try {
			const fileName = scope === "global" ? "mcp.global.json" : "mcp.project.json"
			const example = {
				mcpServers: {
					"example-server": {
						command: process.platform === "win32" ? "node example-server.js" : "node ./example-server.js",
						args: [],
						env: {},
						alwaysAllow: [],
						disabledTools: [],
					},
				},
			}

			const contents = JSON.stringify(example, null, 2)

			// Try File System Access API first
			if ((window as any).showSaveFilePicker) {
				const picker = await (window as any).showSaveFilePicker({
					suggestedName: fileName,
					types: [
						{
							description: "JSON",
							accept: { "application/json": [".json"] },
						},
					],
				})
				const writable = await picker.createWritable()
				await writable.write(new Blob([contents], { type: "application/json" }))
				await writable.close()
				console.log(`[Mock VSCode] Saved ${scope} MCP config to`, picker.name || fileName)
				return
			}

			// Fallback to a download
			const blob = new Blob([contents], { type: "application/json" })
			const url = URL.createObjectURL(blob)
			const a = document.createElement("a")
			a.href = url
			a.download = fileName
			document.body.appendChild(a)
			a.click()
			document.body.removeChild(a)
			URL.revokeObjectURL(url)
			console.log(`[Mock VSCode] Triggered download for ${scope} MCP config`)
		} catch (err) {
			console.warn("[Mock VSCode] Failed to open/save MCP settings:", err)
		}
	}
	private getStoredApiConfig(): any | undefined {
		try {
			const raw = localStorage.getItem(this.API_CONFIG_KEY)
			return raw ? JSON.parse(raw) : undefined
		} catch {
			return undefined
		}
	}

	private persistApiConfiguration(apiConfiguration: any, currentName?: string) {
		try {
			if (apiConfiguration) {
				localStorage.setItem(this.API_CONFIG_KEY, JSON.stringify(apiConfiguration))
			}
			if (currentName) {
				localStorage.setItem(this.CURRENT_API_NAME_KEY, currentName)
			}
		} catch {
			// Silently ignore errors
		}
	}

	private getCurrentConfigName(): string {
		try {
			const name = localStorage.getItem(this.CURRENT_API_NAME_KEY)
			return name || this.getStoredApiConfig()?.currentApiConfigName || "default"
		} catch {
			return "default"
		}
	}

	private buildListFromStorage(): Array<{ id: string; name: string; apiProvider?: string }> {
		const stored = this.getStoredApiConfig()
		if (!stored?.apiConfigs) return []
		return Object.values(stored.apiConfigs).map((cfg: any) => ({
			id: cfg.id || cfg.name || "default",
			name: cfg.name || cfg.id || "default",
			apiProvider: cfg.apiProvider || stored?.apiProvider || "kilocode",
		}))
	}

	private handleLoadApiConfiguration(name: string) {
		const stored = this.getStoredApiConfig() || { currentApiConfigName: "default", apiConfigs: {} }
		// Ensure apiConfigs exists
		if (!stored.apiConfigs) {
			stored.apiConfigs = {}
		}
		const exists = !!stored.apiConfigs[name]
		if (!exists) {
			// If missing, create a basic entry
			stored.apiConfigs[name] = {
				id: name,
				name,
				apiProvider: "kilocode",
				apiKey: "mock-api-key",
				kilocodeToken: "mock-kilo-token",
				modelId: "claude-3-5-sonnet-20241022",
				maxTokens: 8192,
			}
		}
		stored.currentApiConfigName = name
		this.persistApiConfiguration(stored, name)
		setTimeout(() => {
			const list = this.buildListFromStorage()
			window.postMessage({ type: "listApiConfig", listApiConfig: list }, "*")
			window.postMessage(
				{
					type: "state",
					state: { apiConfiguration: stored, currentApiConfigName: name, listApiConfigMeta: list },
				},
				"*",
			)
		}, 10)
	}

	private handleDeleteApiConfiguration(name?: string) {
		if (!name) return
		const stored = this.getStoredApiConfig() || { currentApiConfigName: "default", apiConfigs: {} }
		// Ensure apiConfigs exists
		if (!stored.apiConfigs) {
			stored.apiConfigs = {}
		}
		if (stored.apiConfigs[name]) {
			delete stored.apiConfigs[name]
			// Reset current if deleted
			if (stored.currentApiConfigName === name) {
				stored.currentApiConfigName = Object.keys(stored.apiConfigs)[0] || "default"
				localStorage.setItem(this.CURRENT_API_NAME_KEY, stored.currentApiConfigName)
			}
			this.persistApiConfiguration(stored, stored.currentApiConfigName)
		}
		setTimeout(() => {
			window.postMessage({ type: "listApiConfig", listApiConfig: this.buildListFromStorage() }, "*")
			window.postMessage(
				{
					type: "state",
					state: { apiConfiguration: stored, currentApiConfigName: this.getCurrentConfigName() },
				},
				"*",
			)
		}, 10)
	}

	private handleRenameApiConfiguration(oldName?: string, newName?: string) {
		if (!oldName || !newName) return
		const stored = this.getStoredApiConfig() || { currentApiConfigName: "default", apiConfigs: {} }
		// Ensure apiConfigs exists
		if (!stored.apiConfigs) {
			stored.apiConfigs = {}
		}
		const existing = stored.apiConfigs[oldName]
		if (!existing) return
		stored.apiConfigs[newName] = { ...existing, id: newName, name: newName }
		delete stored.apiConfigs[oldName]
		if (stored.currentApiConfigName === oldName) {
			stored.currentApiConfigName = newName
			localStorage.setItem(this.CURRENT_API_NAME_KEY, newName)
		}
		this.persistApiConfiguration(stored, stored.currentApiConfigName)
		setTimeout(() => {
			window.postMessage({ type: "listApiConfig", listApiConfig: this.buildListFromStorage() }, "*")
			window.postMessage(
				{
					type: "state",
					state: { apiConfiguration: stored, currentApiConfigName: this.getCurrentConfigName() },
				},
				"*",
			)
		}, 10)
	}

	private handleUpsertApiConfiguration(name?: string, incoming?: any) {
		const configName = name || "default"
		const stored = this.getStoredApiConfig() || { currentApiConfigName: "default", apiConfigs: {} }
		// Ensure apiConfigs exists
		if (!stored.apiConfigs) {
			stored.apiConfigs = {}
		}
		// Ensure target profile exists by copying from current or making a default
		if (!stored.apiConfigs[configName]) {
			const base = stored.apiConfigs[stored.currentApiConfigName] || {
				id: configName,
				name: configName,
				apiProvider: stored.apiProvider || "kilocode",
				apiKey: stored.apiKey || "mock-api-key",
				kilocodeToken: stored.kilocodeToken || "mock-kilo-token",
				modelId: stored.kilocodeModel || "claude-3-5-sonnet-20241022",
				maxTokens: 8192,
			}
			stored.apiConfigs[configName] = { ...base, id: configName, name: configName }
		}
		stored.currentApiConfigName = configName
		// Merge incoming top-level fields (e.g., model selection keys)
		if (incoming && typeof incoming === "object") {
			Object.assign(stored, incoming)
		}
		this.persistApiConfiguration(stored, configName)
	}

	private emitMockStateUpdate(): void {
		// Emit a state update reflecting current mock cline messages and persisted config
		const list = this.buildListFromStorage()
		const current = this.getCurrentConfigName()
		const storedCfg = this.getStoredApiConfig()
		window.postMessage({ type: "listApiConfig", listApiConfig: list }, "*")
		window.postMessage(
			{
				type: "state",
				state: {
					clineMessages: this.mockClineMessages,
					apiConfiguration: storedCfg,
					currentApiConfigName: current,
					listApiConfigMeta: list,
				},
			},
			"*",
		)
	}

	private handleFetchMarketplaceData(): void {
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
}

// Exports class singleton to prevent multiple invocations of acquireVsCodeApi.
export const vscode = new VSCodeAPIWrapper()

// kilocode_change start
// Make vscode available globally - this allows the playwright tests
// to post messages directly so we can setup provider credentials
// without having to go through the Settings UI in every test.
if (typeof window !== "undefined") {
	;(window as unknown as { vscode: VSCodeAPIWrapper }).vscode = vscode

	// Add fetch mocking for OpenRouter endpoints in browser-based dev mode
	// Patch fetch to support URL as input for TS compatibility
	if (window.location.hostname === "localhost") {
		const originalFetch = window.fetch
		window.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
			const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url
			switch (url) {
				// Mock OpenRouter model provider endpoints for dev server
				case "https://openrouter.ai/api/v1/models/claude-3-5-sonnet-20241022/endpoints":
					return new Response(
						JSON.stringify({
							endpoints: [
								{
									id: "openrouter",
									name: "OpenRouter Default Endpoint",
									status: "online",
									quota: "unlimited",
									cost: 0,
								},
							],
						}),
						{ status: 200, headers: { "Content-Type": "application/json" } },
					)
				default:
					return originalFetch(input, init)
			}
		}) as typeof window.fetch
	}
}
// kilocode_change end
