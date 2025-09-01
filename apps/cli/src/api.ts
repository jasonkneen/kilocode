import type { Anthropic } from "@anthropic-ai/sdk"

import { ApiStream } from "../../../src/api/transform/stream"
import { OpenRouterHandler as SharedOpenRouterHandler } from "../../../src/api/providers/openrouter"
import OpenAI from "openai"
import { OpenAiHandler } from "../../../src/api/providers/openai"
import { AnthropicHandler } from "../../../src/api/providers/anthropic"
import { KilocodeOpenrouterHandler } from "../../../src/api/providers/kilocode-openrouter"
// kilocode_change - Activating major providers for Phase 1A
import { GroqHandler } from "../../../src/api/providers/groq"
import { GeminiHandler } from "../../../src/api/providers/gemini"
import { OllamaHandler } from "../../../src/api/providers/ollama"
import { LmStudioHandler } from "../../../src/api/providers/lm-studio"
import { VertexHandler } from "../../../src/api/providers/vertex"
import { AwsBedrockHandler } from "../../../src/api/providers/bedrock"
import { FireworksHandler } from "../../../src/api/providers/fireworks"
import { FeatherlessHandler } from "../../../src/api/providers/featherless"

// Additional providers for comprehensive coverage
import { OpenAiNativeHandler } from "../../../src/api/providers/openai-native"
import { MistralHandler } from "../../../src/api/providers/mistral"
import { XAIHandler } from "../../../src/api/providers/xai"
import { CerebrasHandler } from "../../../src/api/providers/cerebras"
import { DeepSeekHandler } from "../../../src/api/providers/deepseek"
import { HuggingFaceHandler } from "../../../src/api/providers/huggingface"
import { SambaNovaHandler } from "../../../src/api/providers/sambanova"

import type { ProviderSettings } from "../../../packages/types/src/provider-settings.js"

export interface ApiHandler {
	createMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: { mode?: string; taskId: string; previousResponseId?: string; suppressPreviousResponseId?: boolean },
	): ApiStream

	getModel(): { id: string; info: any }
}

// Simplified OpenRouter handler for CLI use
class SimpleOpenRouterHandler implements ApiHandler {
	private client: OpenAI
	private options: any

	constructor(options: any) {
		this.options = options
		const baseURL = options.openRouterBaseUrl || "https://openrouter.ai/api/v1"
		const apiKey = options.openRouterApiKey ?? "not-provided"
		this.client = new OpenAI({ baseURL, apiKey })
	}

	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[], metadata?: any): ApiStream {
		// Convert Anthropic messages to OpenAI format
		const openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			...messages.map((msg) => {
				if (typeof msg.content === "string") {
					return { role: msg.role as any, content: msg.content }
				} else {
					// Handle content array - for now just extract text
					const textContent = Array.isArray(msg.content)
						? msg.content.find((c) => c.type === "text")?.text || ""
						: ""
					return { role: msg.role as any, content: textContent }
				}
			}),
		]

		const modelId = this.options.openRouterModelId || "openai/gpt-4o"
		const stream = await this.client.chat.completions.create({
			model: modelId,
			messages: openAiMessages,
			stream: true,
			temperature: 0.7,
			max_tokens: 4000,
		})

		for await (const chunk of stream) {
			const delta = chunk.choices[0]?.delta
			if (delta?.content) {
				yield { type: "text", text: delta.content }
			}
		}
	}

	getModel() {
		const modelId = this.options.openRouterModelId || "openai/gpt-4o"
		return {
			id: modelId,
			info: {
				maxTokens: 4000,
				contextWindow: 128000,
				supportsImages: false,
			},
		}
	}
}

const OpenRouterHandler = SimpleOpenRouterHandler

export function buildCliApiHandler(configuration: ProviderSettings): ApiHandler {
	const { apiProvider, ...options } = configuration

	// kilocode_change - Add error handling for invalid providers
	if (!apiProvider) {
		throw new Error("Provider is required in configuration")
	}

	switch (apiProvider) {
		case "openrouter":
			return new SharedOpenRouterHandler(options as any)
		case "openai":
			return new OpenAiHandler(options as any)
		case "anthropic":
			return new AnthropicHandler(options as any)
		case "kilocode":
			return new KilocodeOpenrouterHandler(options as any)
		// kilocode_change - Activated major providers for Phase 1A
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
		// Additional providers for comprehensive coverage
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
		case "sambanova":
			return new SambaNovaHandler(options as any)
		default:
			throw new Error(`Unsupported provider: ${apiProvider}. Please check your configuration.`)
	}
}
