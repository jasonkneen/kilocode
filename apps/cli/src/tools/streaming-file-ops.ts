import fs from "node:fs/promises"
import { createReadStream, createWriteStream } from "node:fs"
import { pipeline } from "node:stream/promises"
import { Transform } from "node:stream"
import path from "node:path"

export interface StreamingReadOptions {
	chunk_size?: number // Default: 64KB
	encoding?: BufferEncoding // Default: 'utf8'
	start?: number // Start byte position
	end?: number // End byte position
	line_mode?: boolean // Read line by line instead of chunks
	progress_callback?: (bytesRead: number, totalBytes: number) => void
}

export interface StreamingWriteOptions {
	chunk_size?: number // Default: 64KB
	encoding?: BufferEncoding // Default: 'utf8'
	append?: boolean // Append instead of overwrite
	progress_callback?: (bytesWritten: number, totalBytes: number) => void
}

export interface BatchProcessingOptions {
	concurrency?: number // Default: 3
	continue_on_error?: boolean // Default: true
	progress_callback?: (completed: number, total: number, current: string) => void
}

export interface StreamingReadResult {
	success: boolean
	path: string
	total_bytes: number
	chunks_processed: number
	duration_ms: number
	encoding: string
	content?: string // For smaller files or when requested
	error?: string
}

export interface StreamingWriteResult {
	success: boolean
	path: string
	bytes_written: number
	duration_ms: number
	error?: string
}

export interface BatchOperationResult {
	success: boolean
	total_operations: number
	successful_operations: number
	failed_operations: number
	results: Array<StreamingReadResult | StreamingWriteResult>
	total_duration_ms: number
	total_bytes_processed: number
	errors?: string[]
}

const DEFAULT_CHUNK_SIZE = 64 * 1024 // 64KB
const LARGE_FILE_THRESHOLD = 512 * 1024 // 512KB (reduced for test streaming)

export async function streamingReadFile(
	filePath: string,
	options: StreamingReadOptions = {},
): Promise<StreamingReadResult> {
	const startTime = Date.now()
	const {
		chunk_size = DEFAULT_CHUNK_SIZE,
		encoding = "utf8",
		start,
		end,
		line_mode = false,
		progress_callback,
	} = options

	try {
		// Get file stats
		const stats = await fs.stat(filePath)
		const totalBytes = end !== undefined ? Math.min(end, stats.size) - (start || 0) : stats.size

		let bytesRead = 0
		let chunksProcessed = 0
		const chunks: string[] = []

		if (stats.size < LARGE_FILE_THRESHOLD && !start && !end) {
			// For smaller files, use regular fs.readFile for better performance
			const content = await fs.readFile(filePath, encoding)
			return {
				success: true,
				path: filePath,
				total_bytes: stats.size,
				chunks_processed: 1,
				duration_ms: Date.now() - startTime,
				encoding,
				content,
			}
		}

		// For large files or range requests, use streaming
		const stream = createReadStream(filePath, {
			encoding,
			start,
			end,
			highWaterMark: chunk_size,
		})

		if (line_mode) {
			// Line-by-line processing
			let buffer = ""
			for await (const chunk of stream) {
				buffer += chunk
				const lines = buffer.split("\n")
				buffer = lines.pop() || "" // Keep incomplete line in buffer

				for (const line of lines) {
					chunks.push(line + "\n")
					bytesRead += Buffer.byteLength(line + "\n", encoding)
					chunksProcessed++

					if (progress_callback) {
						progress_callback(bytesRead, totalBytes)
					}
				}
			}

			// Handle remaining buffer
			if (buffer) {
				chunks.push(buffer)
				bytesRead += Buffer.byteLength(buffer, encoding)
				chunksProcessed++
			}
		} else {
			// Chunk-by-chunk processing
			for await (const chunk of stream) {
				chunks.push(chunk)
				bytesRead += Buffer.byteLength(chunk, encoding)
				chunksProcessed++

				if (progress_callback) {
					progress_callback(bytesRead, totalBytes)
				}
			}
		}

		const content = chunks.join("")

		return {
			success: true,
			path: filePath,
			total_bytes: bytesRead,
			chunks_processed: chunksProcessed,
			duration_ms: Date.now() - startTime,
			encoding,
			content,
		}
	} catch (error: any) {
		return {
			success: false,
			path: filePath,
			total_bytes: 0,
			chunks_processed: 0,
			duration_ms: Date.now() - startTime,
			encoding,
			error: error?.message || String(error),
		}
	}
}

export async function streamingWriteFile(
	filePath: string,
	content: string,
	options: StreamingWriteOptions = {},
): Promise<StreamingWriteResult> {
	const startTime = Date.now()
	const { chunk_size = DEFAULT_CHUNK_SIZE, encoding = "utf8", append = false, progress_callback } = options

	try {
		const totalBytes = Buffer.byteLength(content, encoding)
		let bytesWritten = 0

		// Ensure directory exists
		const dir = path.dirname(filePath)
		await fs.mkdir(dir, { recursive: true })

		if (totalBytes < LARGE_FILE_THRESHOLD) {
			// For smaller content, use regular fs.writeFile
			if (append) {
				await fs.appendFile(filePath, content, encoding)
			} else {
				await fs.writeFile(filePath, content, encoding)
			}

			return {
				success: true,
				path: filePath,
				bytes_written: totalBytes,
				duration_ms: Date.now() - startTime,
			}
		}

		// For large content, use streaming
		const writeStream = createWriteStream(filePath, {
			encoding,
			flags: append ? "a" : "w",
			highWaterMark: chunk_size,
		})

		// Create transform stream to track progress
		const progressTransform = new Transform({
			transform(chunk, _encoding, callback) {
				bytesWritten += chunk.length
				if (progress_callback) {
					progress_callback(bytesWritten, totalBytes)
				}
				callback(null, chunk)
			},
		})

		// Stream the content in chunks
		const contentStream = new Transform({
			transform(chunk, _encoding, callback) {
				callback(null, chunk)
			},
		})

		// Write content to stream
		contentStream.end(content)

		// Pipeline: content -> progress tracking -> file
		await pipeline(contentStream, progressTransform, writeStream)

		return {
			success: true,
			path: filePath,
			bytes_written: bytesWritten,
			duration_ms: Date.now() - startTime,
		}
	} catch (error: any) {
		return {
			success: false,
			path: filePath,
			bytes_written: 0,
			duration_ms: Date.now() - startTime,
			error: error?.message || String(error),
		}
	}
}

export async function batchFileOperations<T extends StreamingReadResult | StreamingWriteResult>(
	operations: Array<() => Promise<T>>,
	options: BatchProcessingOptions = {},
): Promise<BatchOperationResult> {
	const startTime = Date.now()
	const { concurrency = 3, continue_on_error = true, progress_callback } = options

	const results: T[] = []
	const errors: string[] = []
	let completed = 0

	// Process operations in batches with limited concurrency
	for (let i = 0; i < operations.length; i += concurrency) {
		const batch = operations.slice(i, i + concurrency)
		const batchPromises = batch.map(async (op, index) => {
			try {
				const result = await op()
				completed++
				if (progress_callback) {
					progress_callback(completed, operations.length, `Operation ${i + index + 1}`)
				}
				return result
			} catch (error: any) {
				const errorMsg = `Operation ${i + index + 1}: ${error?.message || String(error)}`
				errors.push(errorMsg)
				completed++

				if (progress_callback) {
					progress_callback(completed, operations.length, `Failed: Operation ${i + index + 1}`)
				}

				if (!continue_on_error) {
					throw new Error(errorMsg)
				}

				// Return a failed result
				return {
					success: false,
					path: `operation-${i + index + 1}`,
					total_bytes: 0,
					duration_ms: 0,
					encoding: "utf8",
					error: errorMsg,
				} as T
			}
		})

		const batchResults = await Promise.allSettled(batchPromises)

		for (const result of batchResults) {
			if (result.status === "fulfilled") {
				results.push(result.value)
			} else if (!continue_on_error) {
				throw new Error(`Batch operation failed: ${result.reason}`)
			}
		}
	}

	const successfulOperations = results.filter((r) => r.success).length
	const failedOperations = results.filter((r) => !r.success).length
	const totalBytesProcessed = results.reduce((sum, r) => {
		if ("total_bytes" in r) {
			return sum + r.total_bytes
		} else if ("bytes_written" in r) {
			return sum + r.bytes_written
		}
		return sum
	}, 0)

	return {
		success: failedOperations === 0 || (continue_on_error && successfulOperations > 0),
		total_operations: operations.length,
		successful_operations: successfulOperations,
		failed_operations: failedOperations,
		results,
		total_duration_ms: Date.now() - startTime,
		total_bytes_processed: totalBytesProcessed,
		errors: errors.length > 0 ? errors : undefined,
	}
}
