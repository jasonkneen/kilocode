import * as fs from "node:fs/promises"
import * as path from "node:path"

export async function safeWriteJson(filePath: string, data: any): Promise<void> {
	const absoluteFilePath = path.resolve(filePath)
	await fs.mkdir(path.dirname(absoluteFilePath), { recursive: true })
	const json = JSON.stringify(data ?? null)
	await fs.writeFile(absoluteFilePath, json, "utf8")
}

export default { safeWriteJson }
