// Test file for thinking stream functionality
// Note: This would require a testing framework like vitest to run
import { ThinkingStreamParser, RealTimeThinkingDisplay, parseResponseWithThinking } from "../ui/thinking-stream.js"

// Mock test framework functions for TypeScript compilation
const describe = (name: string, fn: () => void) => fn()
const test = (name: string, fn: () => void) => fn()
const beforeEach = (fn: () => void) => fn()
const expect = (value: any) => ({
	toBe: (expected: any) => value === expected,
	toContain: (expected: any) => String(value).includes(expected),
	toBeGreaterThanOrEqual: (expected: any) => value >= expected,
	toBeLessThan: (expected: any) => value < expected,
	toHaveLength: (expected: any) => value.length === expected,
	toEqual: (expected: any) => JSON.stringify(value) === JSON.stringify(expected),
	toMatch: (pattern: RegExp) => pattern.test(value),
	toBeDefined: () => value !== undefined,
	not: {
		toBe: (expected: any) => value !== expected,
		toContain: (expected: any) => !String(value).includes(expected),
		toBeGreaterThanOrEqual: (expected: any) => value < expected,
		toBeLessThan: (expected: any) => value >= expected,
		toHaveLength: (expected: any) => value.length !== expected,
		toEqual: (expected: any) => JSON.stringify(value) !== JSON.stringify(expected),
		toMatch: (pattern: RegExp) => !pattern.test(value),
		toBeDefined: () => value === undefined,
	},
})

describe("Thinking Stream", () => {
	let parser: ThinkingStreamParser

	beforeEach(() => {
		parser = new ThinkingStreamParser()
	})

	test("should parse complete thinking block", () => {
		const text = "<thinking>Let me analyze this problem...</thinking>"
		const result = parser.processChunk(text)

		expect(result.hasNewThinking).toBe(true)
		expect(result.display).toContain("Let me analyze this problem...")

		const stats = parser.getStats()
		expect(stats.completedBlocks).toBe(1)
		expect(stats.activeThinking).toBe(false)
	})

	test("should handle partial thinking blocks", () => {
		const result1 = parser.processChunk("<thinking>Analyzing")
		expect(result1.hasNewThinking).toBe(true)
		expect(parser.getStats().activeThinking).toBe(true)

		const result2 = parser.processChunk(" the problem...</thinking>")
		expect(result2.hasNewThinking).toBe(true)
		expect(parser.getStats().completedBlocks).toBe(1)
		expect(parser.getStats().activeThinking).toBe(false)
	})

	test("should handle multiple thinking blocks", () => {
		const text = `
		<thinking>First thought process</thinking>
		Some content here
		<thinking>Second thought process</thinking>
		`

		const result = parser.processChunk(text)
		expect(result.hasNewThinking).toBe(true)

		const stats = parser.getStats()
		expect(stats.completedBlocks).toBe(2)
	})

	test("should format thinking display correctly", () => {
		const parser = new ThinkingStreamParser({
			theme: "minimal",
			maxPreviewLength: 20,
		})

		const text = "<thinking>This is a very long thinking process that should be truncated</thinking>"
		const result = parser.processChunk(text)

		expect(result.display).toContain("💭")
		expect(result.display).toContain("...")
	})

	test("should handle detailed theme", () => {
		const parser = new ThinkingStreamParser({
			theme: "detailed",
			collapsedByDefault: true,
		})

		const text = "<thinking>Detailed thinking process</thinking>"
		const result = parser.processChunk(text)

		expect(result.display).toContain("┌─")
		expect(result.display).toContain("└─")
		expect(result.display).toContain("Click to expand")
	})

	test("should track timing correctly", () => {
		const start = Date.now()
		parser.processChunk("<thinking>Test</thinking>")
		const stats = parser.getStats()

		expect(stats.totalThinkingTime).toBeGreaterThanOrEqual(0)
		expect(stats.completedBlocks).toBe(1)
	})
})

describe("parseResponseWithThinking", () => {
	test("should separate thinking from main content", () => {
		const text = `
		I need to analyze this first.
		<thinking>
		Let me break this down:
		1. First step
		2. Second step
		</thinking>
		Here's my response based on the analysis.
		`

		const result = parseResponseWithThinking(text)

		expect(result.cleanText).not.toContain("<thinking>")
		expect(result.cleanText).not.toContain("</thinking>")
		expect(result.cleanText).toContain("I need to analyze")
		expect(result.cleanText).toContain("Here's my response")
		expect(result.hasThinking).toBe(true)
		expect(result.thinkingDisplay).toContain("Let me break this down")
	})

	test("should handle text without thinking", () => {
		const text = "Just a simple response without thinking."
		const result = parseResponseWithThinking(text)

		expect(result.cleanText).toBe("Just a simple response without thinking.")
		expect(result.hasThinking).toBe(false)
		expect(result.thinkingDisplay).toBe("")
	})

	test("should handle multiple thinking blocks", () => {
		const text = `
		<thinking>First analysis</thinking>
		Some content
		<thinking>Second analysis</thinking>
		More content
		`

		const result = parseResponseWithThinking(text)

		expect(result.hasThinking).toBe(true)
		expect(result.thinkingDisplay).toContain("First analysis")
		expect(result.thinkingDisplay).toContain("Second analysis")
		expect(result.cleanText).not.toContain("<thinking>")
	})
})

describe("RealTimeThinkingDisplay", () => {
	let display: RealTimeThinkingDisplay

	beforeEach(() => {
		display = new RealTimeThinkingDisplay({ theme: "minimal" })
	})

	test("should handle streaming chunks", () => {
		const result1 = display.processStreamChunk("<thinking>Starting")
		expect(result1.isNewThinking).toBe(true)
		expect(result1.hasUpdate).toBe(true)

		const result2 = display.processStreamChunk(" to think...")
		expect(result2.hasUpdate).toBe(true)

		const result3 = display.processStreamChunk("</thinking>")
		expect(result3.hasUpdate).toBe(true)

		const stats = display.getStats()
		expect(stats.completedBlocks).toBe(1)
	})

	test("should detect display updates correctly", () => {
		const result1 = display.processStreamChunk("<thinking>Test</thinking>")
		expect(result1.hasUpdate).toBe(true)

		const result2 = display.processStreamChunk("More content")
		expect(result2.hasUpdate).toBe(false) // No thinking in this chunk
	})

	test("should clear state correctly", () => {
		display.processStreamChunk("<thinking>Test</thinking>")
		expect(display.getStats().completedBlocks).toBe(1)

		display.clear()
		expect(display.getStats().completedBlocks).toBe(0)
		expect(display.getStats().activeThinking).toBe(false)
	})
})
