import type { ModelInfo } from "../../../packages/types/src/model.js"

export const hasLoadedFullDetails = (_modelId: string): boolean => false
export const forceFullModelDetailsLoad = async (_baseUrl: string, _modelId: string): Promise<void> => {}
export async function getLMStudioModels(_baseUrl?: string): Promise<Record<string, ModelInfo>> {
	return {}
}
