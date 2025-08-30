// CLI shim for countTokens that disables worker usage
import { Anthropic } from "@anthropic-ai/sdk"
import { tiktoken } from "../../../../src/utils/tiktoken.js"

export type CountTokensOptions = {
	useWorker?: boolean
}

export async function countTokens(
	content: Anthropic.Messages.ContentBlockParam[],
	options: CountTokensOptions = {},
): Promise<number> {
	// Always use non-worker implementation in CLI
	return tiktoken(content)
}
