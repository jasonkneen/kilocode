import { openRouterDefaultModelId, type ProviderSettings } from "@roo-code/types"
import { getKiloBaseUriFromToken } from "../../../shared/kilocode/token"
import { TelemetryService } from "@roo-code/telemetry"
import { z } from "zod"
import { fetchWithTimeout } from "./fetchWithTimeout"
import { DEFAULT_HEADERS } from "../constants"

type KilocodeToken = string

type OrganizationId = string

const cache = new Map<string, Promise<string>>()

const defaultsSchema = z.object({
	defaultModel: z.string().nullish(),
})

const fetcher = fetchWithTimeout(5000)

async function fetchKilocodeDefaultModel(
	kilocodeToken: KilocodeToken,
	organizationId?: OrganizationId,
	providerSettings?: ProviderSettings,
): Promise<string> {
	try {
		const path = organizationId ? `/organizations/${organizationId}/defaults` : `/defaults`
		const url = `${getKiloBaseUriFromToken(kilocodeToken)}/api${path}`

		const headers: Record<string, string> = {
			...DEFAULT_HEADERS,
			Authorization: `Bearer ${kilocodeToken}`,
		}

		// Add X-KILOCODE-TESTER: SUPPRESS header if the setting is enabled
		if (
			providerSettings?.kilocodeTesterWarningsDisabledUntil &&
			providerSettings.kilocodeTesterWarningsDisabledUntil > Date.now()
		) {
			headers["X-KILOCODE-TESTER"] = "SUPPRESS"
		}

		const response = await fetcher(url, { headers })
		if (!response.ok) {
			throw new Error(`Fetching default model from ${url} failed: ${response.status}`)
		}
		const defaultModel = (await defaultsSchema.parseAsync(await response.json())).defaultModel
		if (!defaultModel) {
			throw new Error(`Default model from ${url} was empty`)
		}
		// console.info(`Fetched default model from ${url}: ${defaultModel}`)
		return defaultModel
	} catch (err) {
		console.error("Failed to get default model", err)
		try {
			;(TelemetryService as any)?.instance?.captureException?.(err, { context: "getKilocodeDefaultModel" })
		} catch {}
		throw new Error(`Kilocode default model fetch failed: ${err instanceof Error ? err.message : String(err)}`)
	}
}

export async function getKilocodeDefaultModel(
	kilocodeToken?: KilocodeToken,
	organizationId?: OrganizationId,
	providerSettings?: ProviderSettings,
): Promise<string> {
	if (!kilocodeToken) {
		throw new Error("KILOCODE_TOKEN is required to resolve Kilocode default model")
	}
	const key = JSON.stringify({
		kilocodeToken,
		organizationId,
		testerSuppressed: providerSettings?.kilocodeTesterWarningsDisabledUntil,
	})
	let defaultModelPromise = cache.get(key)
	if (!defaultModelPromise) {
		defaultModelPromise = fetchKilocodeDefaultModel(kilocodeToken, organizationId, providerSettings)
		cache.set(key, defaultModelPromise)
	}
	return await defaultModelPromise
}
