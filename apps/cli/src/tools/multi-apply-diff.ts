import fs from "node:fs/promises"
import path from "node:path"
import { MultiFileSearchReplaceDiffStrategy } from "../../../../src/core/diff/strategies/multi-file-search-replace.js"
import { DiffResult } from "../../../../src/shared/tools.js"

export interface MultiApplyDiffParams {
	files: Array<{
		path: string
		diffs: Array<{
			content: string
			start_line?: number
		}>
	}>
	options?: {
		fuzzy_threshold?: number
		buffer_lines?: number
		validation_mode?: "strict" | "permissive"
		continue_on_error?: boolean
	}
}

export interface MultiApplyDiffResult {
	success: boolean
	files_processed: number
	files_succeeded: number
	files_failed: number
	total_diffs_applied: number
	results: Array<{
		path: string
		success: boolean
		diffs_applied: number
		error?: string
		content?: string
		metadata?: {
			original_size: number
			new_size: number
			lines_changed: number
			duration_ms: number
		}
	}>
	summary: string
	errors?: string[]
}

export async function runMultiApplyDiff(
	defaultCwd: string,
	params: MultiApplyDiffParams,
): Promise<MultiApplyDiffResult> {
	const startTime = Date.now()
	const results: MultiApplyDiffResult["results"] = []
	const errors: string[] = []
	let totalDiffsApplied = 0
	let filesSucceeded = 0
	let filesFailed = 0

	const {
		fuzzy_threshold = 1.0,
		buffer_lines = 40,
		validation_mode = "strict",
		continue_on_error = true,
	} = params.options || {}

	// Create diff strategy with specified options
	const diffStrategy = new MultiFileSearchReplaceDiffStrategy(fuzzy_threshold, buffer_lines)

	for (const fileSpec of params.files) {
		const fileStartTime = Date.now()
		const filePath = path.resolve(defaultCwd, fileSpec.path.trim())
		const relativePath = path.relative(defaultCwd, filePath)

		try {
			// Security check: prevent escaping working directory
			if (relativePath.startsWith("..")) {
				throw new Error(`Security error: Cannot access files outside working directory: ${fileSpec.path}`)
			}

			// Read original file
			const originalContent = await fs.readFile(filePath, "utf8")
			const originalSize = originalContent.length

			// Apply diffs using the multi-file strategy
			const diffResult = await diffStrategy.applyDiff(originalContent, fileSpec.diffs)

			if (diffResult.success && diffResult.content) {
				// Write updated content
				await fs.writeFile(filePath, diffResult.content, "utf8")

				const newSize = diffResult.content.length
				const linesChanged = Math.abs(
					diffResult.content.split("\n").length - originalContent.split("\n").length,
				)

				results.push({
					path: relativePath,
					success: true,
					diffs_applied: fileSpec.diffs.length,
					content: diffResult.content,
					metadata: {
						original_size: originalSize,
						new_size: newSize,
						lines_changed: linesChanged,
						duration_ms: Date.now() - fileStartTime,
					},
				})

				totalDiffsApplied += fileSpec.diffs.length
				filesSucceeded++
			} else {
				// Extract error messages from the failed diff result
				const errorMessages: string[] = []

				// Check if this is a failed diff result with error field
				if (!diffResult.success && diffResult.error) {
					errorMessages.push(diffResult.error)
				}

				// Also check failParts for additional error details
				if (diffResult.failParts) {
					for (const failPart of diffResult.failParts) {
						if (!failPart.success && failPart.error) {
							errorMessages.push(failPart.error)
						}
					}
				}

				const errorMsg = errorMessages.length > 0 ? errorMessages.join("; ") : "Unknown diff application error"

				if (validation_mode === "strict" && !continue_on_error) {
					throw new Error(errorMsg)
				}

				results.push({
					path: relativePath,
					success: false,
					diffs_applied: 0,
					error: errorMsg,
				})

				errors.push(`${relativePath}: ${errorMsg}`)
				filesFailed++
			}
		} catch (error: any) {
			const errorMsg = error?.message || String(error)

			results.push({
				path: relativePath,
				success: false,
				diffs_applied: 0,
				error: errorMsg,
			})

			errors.push(`${relativePath}: ${errorMsg}`)
			filesFailed++

			// In strict mode, stop processing if continue_on_error is false
			if (validation_mode === "strict" && !continue_on_error) {
				break
			}
		}
	}

	const totalDuration = Date.now() - startTime
	const filesProcessed = results.length

	return {
		success: filesSucceeded > 0,
		files_processed: filesProcessed,
		files_succeeded: filesSucceeded,
		files_failed: filesFailed,
		total_diffs_applied: totalDiffsApplied,
		results,
		summary: `Multi-apply diff completed: ${filesSucceeded}/${filesProcessed} files succeeded, ${totalDiffsApplied} diffs applied in ${totalDuration}ms`,
		errors: errors.length > 0 ? errors : undefined,
	}
}
