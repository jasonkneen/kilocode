/**
 * Batch Operations Tool
 *
 * High-value CLI-specific tool for batch processing operations
 * that would be impractical in the VS Code extension GUI.
 * Provides enterprise-grade batch file processing capabilities.
 */

import fs from "node:fs/promises"
import fssync from "node:fs"
import path from "node:path"
import { performance } from "node:perf_hooks"
import type { ToolExecution } from "../tool-runner.js"

export interface BatchOperationConfig {
	operation: "read" | "write" | "transform" | "validate" | "backup"
	files: string[]
	options: {
		pattern?: string
		replacement?: string
		validation?: string
		encoding?: string
		createBackup?: boolean
		maxConcurrency?: number
		continueOnError?: boolean
		outputFormat?: "json" | "csv" | "table"
	}
}

export interface BatchOperationResult {
	success: boolean
	totalFiles: number
	processedFiles: number
	failedFiles: number
	results: Array<{
		file: string
		success: boolean
		error?: string
		size?: number
		duration?: number
		changes?: number
	}>
	summary: string
	metadata: {
		totalDuration: number
		avgFileTime: number
		totalBytesProcessed: number
		concurrencyUsed: number
	}
}

export async function runBatchOperations(defaultCwd: string, config: BatchOperationConfig): Promise<ToolExecution> {
	const startTime = performance.now()
	const { operation, files, options } = config

	if (!files || files.length === 0) {
		return {
			name: "batch_operations",
			params: {},
			output: "❌ Error: No files specified for batch operation",
		}
	}

	const maxConcurrency = Math.min(options.maxConcurrency || 5, 10)
	const results: BatchOperationResult["results"] = []
	let totalBytesProcessed = 0

	// Process files in batches to control concurrency
	const batches: string[][] = []
	for (let i = 0; i < files.length; i += maxConcurrency) {
		batches.push(files.slice(i, i + maxConcurrency))
	}

	for (const batch of batches) {
		const batchPromises = batch.map(async (filePath) => {
			const fileStart = performance.now()
			const resolvedPath = path.resolve(defaultCwd, filePath)
			const relativePath = path.relative(defaultCwd, resolvedPath)

			try {
				let fileResult: any = null
				let bytesProcessed = 0
				let changes = 0

				switch (operation) {
					case "read":
						fileResult = await processBatchRead(resolvedPath, options)
						break
					case "write":
						fileResult = await processBatchWrite(resolvedPath, options)
						break
					case "transform":
						fileResult = await processBatchTransform(resolvedPath, options)
						break
					case "validate":
						fileResult = await processBatchValidate(resolvedPath, options)
						break
					case "backup":
						fileResult = await processBatchBackup(resolvedPath, options)
						break
				}

				if (fileResult?.success) {
					bytesProcessed = fileResult.bytesProcessed || 0
					changes = fileResult.changes || 0
					totalBytesProcessed += bytesProcessed
				}

				const duration = performance.now() - fileStart

				return {
					file: relativePath,
					success: fileResult?.success || false,
					error: fileResult?.error,
					size: bytesProcessed,
					duration,
					changes,
				}
			} catch (e: any) {
				const duration = performance.now() - fileStart
				return {
					file: relativePath,
					success: false,
					error: e?.message || String(e),
					duration,
				}
			}
		})

		const batchResults = await Promise.allSettled(batchPromises)

		for (const result of batchResults) {
			if (result.status === "fulfilled") {
				results.push(result.value)
			} else {
				results.push({
					file: "unknown",
					success: false,
					error: result.reason instanceof Error ? result.reason.message : String(result.reason),
					duration: 0,
				})
			}

			// Stop on first error if continueOnError is false
			if (!options.continueOnError && result.status === "fulfilled" && !result.value?.success) {
				break
			}
		}
	}

	const totalDuration = performance.now() - startTime
	const successfulFiles = results.filter((r) => r.success).length
	const failedFiles = results.filter((r) => !r.success).length
	const avgFileTime = results.length > 0 ? results.reduce((sum, r) => sum + (r.duration || 0), 0) / results.length : 0

	// Generate formatted output based on requested format
	let output = ""

	switch (options.outputFormat) {
		case "json":
			output = JSON.stringify(
				{
					operation,
					summary: {
						total: files.length,
						successful: successfulFiles,
						failed: failedFiles,
						duration: totalDuration,
					},
					results,
				},
				null,
				2,
			)
			break

		case "csv":
			output =
				"file,success,duration,size,changes,error\n" +
				results
					.map(
						(r) =>
							`"${r.file}",${r.success},${r.duration || 0},${r.size || 0},${r.changes || 0},"${r.error || ""}"`,
					)
					.join("\n")
			break

		default: // table format
			output =
				`🔄 Batch ${operation} operation completed\n\n` +
				`📊 Summary:\n` +
				`  • Total files: ${files.length}\n` +
				`  • Successful: ${successfulFiles}\n` +
				`  • Failed: ${failedFiles}\n` +
				`  • Duration: ${Math.round(totalDuration)}ms\n` +
				`  • Avg per file: ${Math.round(avgFileTime)}ms\n` +
				`  • Total processed: ${Math.round(totalBytesProcessed / 1024)}KB\n\n`

			if (results.length <= 20) {
				// Show detailed results for small batches
				output += `📝 Results:\n`
				for (const result of results) {
					const status = result.success ? "✅" : "❌"
					const duration = result.duration ? `${Math.round(result.duration)}ms` : "0ms"
					const size = result.size ? `${Math.round(result.size / 1024)}KB` : "0KB"

					output += `  ${status} ${result.file} (${duration}, ${size})`
					if (result.changes) {
						output += ` - ${result.changes} changes`
					}
					if (result.error) {
						output += ` - ${result.error}`
					}
					output += "\n"
				}
			} else {
				// Show summary for large batches
				if (failedFiles > 0) {
					output += `❌ Failed files:\n`
					results
						.filter((r) => !r.success)
						.slice(0, 10)
						.forEach((r) => {
							output += `  • ${r.file}: ${r.error}\n`
						})
					if (failedFiles > 10) {
						output += `  ... and ${failedFiles - 10} more failures\n`
					}
				}
			}
	}

	return {
		name: "batch_operations",
		params: { operation, files: files.join(",") },
		output,
		metadata: {
			status: failedFiles === 0 ? "success" : successfulFiles > 0 ? "warning" : "error",
			duration: totalDuration,
			files_affected: results.filter((r) => r.success).map((r) => r.file),
			bytes_processed: totalBytesProcessed,
		},
	}
}

async function processBatchRead(filePath: string, options: any): Promise<any> {
	try {
		const stats = await fs.stat(filePath)
		if (!stats.isFile()) {
			return { success: false, error: "Not a file" }
		}

		const content = (await fs.readFile(filePath, { encoding: options.encoding || "utf8" })) as unknown as string

		return {
			success: true,
			bytesProcessed: content.length,
			content: options.returnContent ? content : undefined,
		}
	} catch (e: any) {
		return { success: false, error: e?.message || String(e) }
	}
}

async function processBatchWrite(filePath: string, options: any): Promise<any> {
	try {
		const content = options.content || ""
		await fs.mkdir(path.dirname(filePath), { recursive: true })
		await fs.writeFile(filePath, content, options.encoding || "utf8")

		return {
			success: true,
			bytesProcessed: content.length,
		}
	} catch (e: any) {
		return { success: false, error: e?.message || String(e) }
	}
}

async function processBatchTransform(filePath: string, options: any): Promise<any> {
	try {
		const content = (await fs.readFile(filePath, { encoding: options.encoding || "utf8" })) as unknown as string
		let transformedContent = content
		let changes = 0

		if (options.pattern && options.replacement !== undefined) {
			const regex = new RegExp(options.pattern, "g")
			const matches = content.match(regex)
			changes = matches ? matches.length : 0
			transformedContent = content.replace(regex, options.replacement)
		}

		if (changes > 0) {
			await fs.writeFile(filePath, transformedContent, options.encoding || "utf8")
		}

		return {
			success: true,
			bytesProcessed: content.length,
			changes,
		}
	} catch (e: any) {
		return { success: false, error: e?.message || String(e) }
	}
}

async function processBatchValidate(filePath: string, options: any): Promise<any> {
	try {
		const content = (await fs.readFile(filePath, { encoding: options.encoding || "utf8" })) as unknown as string
		let isValid = true
		let validationError = ""

		// Basic validation types
		if (options.validation === "json") {
			try {
				JSON.parse(content)
			} catch (e) {
				isValid = false
				validationError = "Invalid JSON format"
			}
		} else if (options.validation === "utf8") {
			// Check for valid UTF-8
			const buffer = Buffer.from(content, "utf8")
			if (buffer.toString("utf8") !== content) {
				isValid = false
				validationError = "Invalid UTF-8 encoding"
			}
		}

		return {
			success: isValid,
			bytesProcessed: content.length,
			error: validationError || undefined,
		}
	} catch (e: any) {
		return { success: false, error: e?.message || String(e) }
	}
}

async function processBatchBackup(filePath: string, options: any): Promise<any> {
	try {
		const stats = await fs.stat(filePath)
		if (!stats.isFile()) {
			return { success: false, error: "Not a file" }
		}

		const backupPath = filePath + `.backup.${Date.now()}`
		await fs.copyFile(filePath, backupPath)

		return {
			success: true,
			bytesProcessed: stats.size,
			backupPath,
		}
	} catch (e: any) {
		return { success: false, error: e?.message || String(e) }
	}
}
