// Minimal placeholders to satisfy bundling when not using the provider
export type Message = { role: "user" | "assistant" | "system"; content: string }
export class Ollama {
	constructor(_opts?: any) {}
}
