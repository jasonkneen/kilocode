import type { Anthropic } from "@anthropic-ai/sdk"

import { ApiStream } from "../../../src/api/transform/stream.js"
import { OpenRouterHandler } from "../../../src/api/providers/openrouter.js"
import { OpenAiHandler } from "../../../src/api/providers/openai.js"
import { AnthropicHandler } from "../../../src/api/providers/anthropic.js"
import { KilocodeOpenrouterHandler } from "../../../src/api/providers/kilocode-openrouter.js"
import { GroqHandler } from "../../../src/api/providers/groq.js"
import { GeminiHandler } from "../../../src/api/providers/gemini.js"
import { OllamaHandler } from "../../../src/api/providers/ollama.js"
import { LmStudioHandler } from "../../../src/api/providers/lm-studio.js"
import { VertexHandler } from "../../../src/api/providers/vertex.js"
import { AwsBedrockHandler } from "../../../src/api/providers/bedrock.js"
import { FireworksHandler } from "../../../src/api/providers/fireworks.js"
import { FeatherlessHandler } from "../../../src/api/providers/featherless.js"

// High-priority missing providers
import { OpenAiNativeHandler } from "../../../src/api/providers/openai-native.js"
import { MistralHandler } from "../../../src/api/providers/mistral.js"
import { XAIHandler } from "../../../src/api/providers/xai.js"
import { CerebrasHandler } from "../../../src/api/providers/cerebras.js"
import { DeepSeekHandler } from "../../../src/api/providers/deepseek.js"
import { HuggingFaceHandler } from "../../../src/api/providers/huggingface.js"
import { NativeOllamaHandler } from "../../../src/api/providers/native-ollama.js"
import { LiteLLMHandler } from "../../../src/api/providers/lite-llm.js"
import { SambaNovaHandler } from "../../../src/api/providers/sambanova.js"

import type { ProviderSettings } from "../../../packages/types/src/provider-settings.js"

export interface ApiHandler {
	createMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: { mode?: string; taskId: string; previousResponseId?: string; suppressPreviousResponseId?: boolean },
	): ApiStream

	getModel(): { id: string; info: any }
}

export function buildCliApiHandler(configuration: ProviderSettings): ApiHandler {
	const { apiProvider, ...options } = configuration
	switch (apiProvider) {
		case "openrouter":
			return new OpenRouterHandler(options as any)
		case "openai":
			return new OpenAiHandler(options as any)
		case "anthropic":
			return new AnthropicHandler(options as any)
		case "kilocode":
			return new KilocodeOpenrouterHandler(options as any)
		case "groq":
			return new GroqHandler(options as any)
		case "gemini":
			return new GeminiHandler(options as any)
		case "ollama":
			return new OllamaHandler(options as any)
		case "lmstudio":
			return new LmStudioHandler(options as any)
		case "vertex":
			return new VertexHandler(options as any)
		case "bedrock":
			return new AwsBedrockHandler(options as any)
		case "fireworks":
			return new FireworksHandler(options as any)
		case "featherless":
			return new FeatherlessHandler(options as any)
		// High-priority missing providers
		case "openai-native":
			return new OpenAiNativeHandler(options as any)
		case "mistral":
			return new MistralHandler(options as any)
		case "xai":
			return new XAIHandler(options as any)
		case "cerebras":
			return new CerebrasHandler(options as any)
		case "deepseek":
			return new DeepSeekHandler(options as any)
		case "huggingface":
			return new HuggingFaceHandler(options as any)
		// case "native-ollama":
		// 	return new NativeOllamaHandler(options as any)
		// case "lite-llm":
		// 	return new LiteLLMHandler(options as any)
		case "sambanova":
			return new SambaNovaHandler(options as any)
		default:
			return new OpenRouterHandler(options as any)
	}
}
