/**
 * Tests for getKilocodeDefaultModel:
 * - Throws when token is missing (no fallback)
 * - Throws when fetch fails (no fallback)
 * - Throws when response has no defaultModel (no fallback)
 * - Returns the fetched defaultModel on success
 */

// vitest globals (describe, it, expect, vi) are available per repo rules

describe("getKilocodeDefaultModel()", () => {
	beforeEach(() => {
		vi.resetModules()
		vi.clearAllMocks()
	})

	it("throws when token is missing (no fallback)", async () => {
		vi.doMock("@roo-code/telemetry", () => ({ TelemetryService: {} }))
		// No fetch mock needed; module should throw before fetch
		const mod = await import("../../../api/providers/kilocode/getKilocodeDefaultModel")
		await expect(mod.getKilocodeDefaultModel(undefined as any)).rejects.toThrow(/KILOCODE_TOKEN/i)
	})

	it("throws when fetching defaults fails (no fallback)", async () => {
		vi.resetModules()
		vi.clearAllMocks()
		vi.doMock("@roo-code/telemetry", () => ({
			TelemetryService: { instance: { captureException: vi.fn() } },
		}))
		vi.doMock("../../../api/providers/kilocode/fetchWithTimeout", () => ({
			fetchWithTimeout: () => async () => {
				throw new Error("network down")
			},
		}))

		const mod = await import("../../../api/providers/kilocode/getKilocodeDefaultModel")
		await expect(mod.getKilocodeDefaultModel("tok_fail")).rejects.toThrow(
			/default model fetch failed|network down/i,
		)
	})

	it("throws when response contains no defaultModel (no fallback)", async () => {
		vi.resetModules()
		vi.clearAllMocks()
		vi.doMock("@roo-code/telemetry", () => ({
			TelemetryService: { instance: { captureException: vi.fn() } },
		}))
		vi.doMock("../../../api/providers/kilocode/fetchWithTimeout", () => ({
			fetchWithTimeout: () => async () =>
				({
					ok: true,
					json: async () => ({}), // missing defaultModel
				}) as any,
		}))

		const mod = await import("../../../api/providers/kilocode/getKilocodeDefaultModel")
		await expect(mod.getKilocodeDefaultModel("tok_empty")).rejects.toThrow(/empty|failed/i)
	})

	it("returns the fetched defaultModel on success", async () => {
		vi.resetModules()
		vi.clearAllMocks()
		vi.doMock("@roo-code/telemetry", () => ({ TelemetryService: {} }))
		vi.doMock("../../../api/providers/kilocode/fetchWithTimeout", () => ({
			fetchWithTimeout: () => async () =>
				({
					ok: true,
					json: async () => ({ defaultModel: "model-works-1" }),
				}) as any,
		}))

		const mod = await import("../../../api/providers/kilocode/getKilocodeDefaultModel")
		await expect(mod.getKilocodeDefaultModel("tok_ok")).resolves.toBe("model-works-1")
	})
})
