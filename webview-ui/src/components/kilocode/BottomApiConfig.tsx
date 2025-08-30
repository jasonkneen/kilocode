import { ModelSelector } from "./chat/ModelSelector"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useSelectedModel } from "../ui/hooks/useSelectedModel"
import { vscode } from "@/utils/vscode"

export const BottomApiConfig = () => {
	const { currentApiConfigName, apiConfiguration, cwd, gitBranch } = useExtensionState()
	const { id: selectedModelId, provider: selectedProvider } = useSelectedModel(apiConfiguration)

	if (!apiConfiguration) {
		return null
	}

	const branch = gitBranch || "main"
	const project = cwd ? cwd.split("/").filter(Boolean).pop() || cwd : "select folder"

	return (
		<div className="flex items-center gap-2 min-w-0">
			<div className="w-auto overflow-hidden min-w-[140px]">
				<ModelSelector
					currentApiConfigName={currentApiConfigName}
					apiConfiguration={apiConfiguration}
					fallbackText={`${selectedProvider}:${selectedModelId}`}
					compact
				/>
			</div>
			<div className="flex items-center gap-1 shrink min-w-0">
				<button
					className="text-xs px-2 py-1 rounded-[var(--ui-border-radius)] bg-[color-mix(in_srgb,var(--vscode-editor-background)_85%,var(--vscode-sideBar-background))] border border-[var(--vscode-panel-border)] text-vscode-descriptionForeground hover:text-vscode-foreground"
					onClick={() => vscode.postMessage({ type: "pickWorkspaceFolder" })}
					title="Pick project folder">
					<span className="codicon codicon-root-folder mr-1" />
					<span className="truncate max-w-[160px] align-middle">{project}</span>
				</button>
				<button
					className="text-xs px-2 py-1 rounded-[var(--ui-border-radius)] bg-[color-mix(in_srgb,var(--vscode-editor-background)_85%,var(--vscode-sideBar-background))] border border-[var(--vscode-panel-border)] text-vscode-descriptionForeground hover:text-vscode-foreground"
					onClick={() => vscode.postMessage({ type: "setGitBranch" })}
					title="Set Git branch">
					<span className="codicon codicon-git-branch mr-1" />
					<span className="truncate max-w-[120px] align-middle">{branch}</span>
				</button>
			</div>
		</div>
	)
}
