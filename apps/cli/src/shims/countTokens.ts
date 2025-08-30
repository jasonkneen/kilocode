// CLI shim for countTokens that disables worker usage
import { Anthropic } from "@anthropic-ai/sdk"

export type CountTokensOptions = {
	useWorker?: boolean
}

export async function countTokens(
	content: Anthropic.Messages.ContentBlockParam[],
	options: CountTokensOptions = {},
): Promise<number> {
	// Simple token approximation for CLI - avoid complex tiktoken dependencies
	const textContent = content
		.filter((block) => block.type === "text")
		.map((block) => (block as any).text || "")
		.join(" ")

	// Rough approximation: ~4 chars per token
	return Math.ceil(textContent.length / 4)
}
