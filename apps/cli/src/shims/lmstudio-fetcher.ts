// Simple shim for LM Studio fetcher to avoid complex dependencies
export const hasLoadedFullDetails = (_modelId: string): boolean => false
export const forceFullModelDetailsLoad = async (_baseUrl: string, _modelId: string): Promise<void> => {}
export async function getLMStudioModels(_baseUrl?: string): Promise<Record<string, any>> {
	return {}
}
