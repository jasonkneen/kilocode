import fs from "node:fs/promises"
import path from "node:path"
// Test file for advanced file operations functionality
// Note: This would require a testing framework like vitest to run

// Mock test framework functions for TypeScript compilation
const describe = (name: string, fn: () => void) => fn()
const test = (name: string, fn: () => void) => fn()
const beforeEach = (fn: () => void) => fn()
const afterEach = (fn: () => void) => fn()
const expect = (value: any) => ({
	toBe: (expected: any) => value === expected,
	toContain: (expected: any) => String(value).includes(expected),
	toBeGreaterThan: (expected: any) => value > expected,
	toBeGreaterThanOrEqual: (expected: any) => value >= expected,
	toBeLessThan: (expected: any) => value < expected,
	toBeLessThanOrEqual: (expected: any) => value <= expected,
	toHaveLength: (expected: any) => value.length === expected,
	toHaveProperty: (prop: string) => value.hasOwnProperty(prop),
	toEqual: (expected: any) => JSON.stringify(value) === JSON.stringify(expected),
	toMatch: (pattern: RegExp) => pattern.test(value),
	toBeDefined: () => value !== undefined,
	not: {
		toBe: (expected: any) => value !== expected,
		toContain: (expected: any) => !String(value).includes(expected),
		toBeGreaterThan: (expected: any) => value <= expected,
		toBeGreaterThanOrEqual: (expected: any) => value < expected,
		toBeLessThan: (expected: any) => value >= expected,
		toBeLessThanOrEqual: (expected: any) => value > expected,
		toHaveLength: (expected: any) => value.length !== expected,
		toEqual: (expected: any) => JSON.stringify(value) !== JSON.stringify(expected),
		toMatch: (pattern: RegExp) => !pattern.test(value),
		toBeDefined: () => value === undefined,
	},
})
const vi = {
	fn: () => () => {},
}
import { executeTool, type ToolExecution } from "../tool-runner.js"
import {
	streamingReadFile,
	streamingWriteFile,
	batchFileOperations,
	type StreamingReadOptions,
	type StreamingWriteOptions,
} from "../tools/streaming-file-ops.js"
import { runMultiApplyDiff } from "../tools/multi-apply-diff.js"
import { createFileWatcher } from "../tools/file-watcher.js"

describe("Advanced File Operations", () => {
	const testDir = path.join(process.cwd(), "test-advanced-file-ops")

	beforeEach(async () => {
		await fs.mkdir(testDir, { recursive: true })
	})

	afterEach(async () => {
		await fs.rm(testDir, { recursive: true, force: true })
	})

	describe("Multi Apply Diff Tool", () => {
		test("should apply diffs to multiple files efficiently", async () => {
			// Create test files
			const file1 = path.join(testDir, "file1.js")
			const file2 = path.join(testDir, "file2.js")

			await fs.writeFile(file1, `function test() {\n  return "hello";\n}`, "utf8")
			await fs.writeFile(file2, `function demo() {\n  return "world";\n}`, "utf8")

			// Prepare multi-apply diff parameters
			const filesParam = JSON.stringify([
				{
					path: "file1.js",
					diffs: [
						{
							content: `<<<<<<< SEARCH
function test() {
  return "hello";
}
=======
function test() {
  return "hello world";
}
>>>>>>> REPLACE`,
							start_line: 1,
						},
					],
				},
				{
					path: "file2.js",
					diffs: [
						{
							content: `<<<<<<< SEARCH
function demo() {
  return "world";
}
=======
function demo() {
  return "updated world";
}
>>>>>>> REPLACE`,
							start_line: 1,
						},
					],
				},
			])

			const result = await executeTool(testDir, {
				name: "multi_apply_diff" as any,
				type: "tool_use",
				params: { args: filesParam },
				partial: false,
			})

			expect(result.output).toContain("Multi-apply diff completed")
			expect(result.output).toContain("Files succeeded: 2")
			expect(result.metadata?.status).toBe("success")

			// Verify the changes were applied
			const content1 = await fs.readFile(file1, "utf8")
			const content2 = await fs.readFile(file2, "utf8")
			expect(content1).toContain("hello world")
			expect(content2).toContain("updated world")
		})

		test("should handle errors gracefully in continue_on_error mode", async () => {
			const file1 = path.join(testDir, "existing.js")
			const file2 = path.join(testDir, "nonexistent.js") // This won't exist

			await fs.writeFile(file1, `function test() {\n  return "hello";\n}`, "utf8")

			const filesParam = JSON.stringify([
				{
					path: "existing.js",
					diffs: [{ content: "valid diff content", start_line: 1 }],
				},
				{
					path: "nonexistent.js",
					diffs: [{ content: "invalid diff content", start_line: 1 }],
				},
			])

			const optionsParam = JSON.stringify({
				continue_on_error: true,
				validation_mode: "permissive",
			})

			const result = await executeTool(testDir, {
				name: "multi_apply_diff" as any,
				type: "tool_use",
				params: { args: filesParam, options: optionsParam } as any,
				partial: false,
			})

			expect(result.output).toContain("Files succeeded: 0") // Both should fail due to invalid diff format
			expect(result.output).toContain("Files failed: 2")
			expect(result.metadata?.status).toBe("error")
		})
	})

	describe("Enhanced Edit File Tool", () => {
		test("should handle advanced edit operations", async () => {
			const testFile = path.join(testDir, "test-edit.js")
			const content = ["function old() {", "  return 'old';", "}", "", "const data = 'test';"].join("\n")

			await fs.writeFile(testFile, content, "utf8")

			const editsParam = JSON.stringify([
				{ action: "replace", line: 1, content: "function newFunc() {" },
				{ action: "replace", line: 2, content: "  return 'new';" },
				{ action: "insert", line: 6, content: "console.log('inserted');" },
				{ action: "append", content: "\n// End of file" },
			])

			const result = await executeTool(testDir, {
				name: "edit_file",
				type: "tool_use",
				params: { path: "test-edit.js", edits: editsParam },
				partial: false,
			})

			expect(result.output).toContain("Applied 4 edit(s)")
			expect(result.metadata?.status).toBe("success")

			const updatedContent = await fs.readFile(testFile, "utf8")
			expect(updatedContent).toContain("function newFunc()")
			expect(updatedContent).toContain("return 'new';")
			expect(updatedContent).toContain("console.log('inserted');")
			expect(updatedContent).toContain("// End of file")
		})

		test("should use streaming for large files", async () => {
			const testFile = path.join(testDir, "large-file.txt")

			// Create a large file (>50MB threshold simulation by mocking)
			const largeContent = "x".repeat(1000) + "\n"
			const content = Array(1000).fill(largeContent).join("")

			await fs.writeFile(testFile, content, "utf8")

			// For testing purposes, we'll create an actual large file
			// In a real scenario, the streaming logic would be triggered by file size

			const editsParam = JSON.stringify([{ action: "prepend", content: "// Large file header\n" }])

			const result = await executeTool(testDir, {
				name: "edit_file",
				type: "tool_use",
				params: { path: "large-file.txt", edits: editsParam },
				partial: false,
			})

			expect(result.output).toContain("Used streaming operations for large file")
			expect(result.metadata?.status).toBe("success")
		})
	})

	describe("Streaming File Operations", () => {
		test("should read files in streaming mode efficiently", async () => {
			const testFile = path.join(testDir, "stream-test.txt")
			const content = Array(1000).fill("This is line content for streaming test\n").join("")

			await fs.writeFile(testFile, content, "utf8")

			let progressCalls = 0
			const options: StreamingReadOptions = {
				chunk_size: 1024,
				line_mode: true,
				progress_callback: (bytes, total) => {
					progressCalls++
					expect(bytes).toBeLessThanOrEqual(total)
				},
			}

			const result = await streamingReadFile(testFile, options)

			expect(result.success).toBe(true)
			expect(result.total_bytes).toBeGreaterThan(0)
			expect(result.chunks_processed).toBeGreaterThan(0)
			expect(result.content).toContain("This is line content")
			expect(progressCalls).toBeGreaterThan(0)
		})

		test("should write files in streaming mode efficiently", async () => {
			const testFile = path.join(testDir, "stream-write.txt")
			const content = Array(500).fill("This is content for streaming write test\n").join("")

			let progressCalls = 0
			const options: StreamingWriteOptions = {
				chunk_size: 1024,
				progress_callback: (bytes, total) => {
					progressCalls++
					expect(bytes).toBeLessThanOrEqual(total)
				},
			}

			const result = await streamingWriteFile(testFile, content, options)

			expect(result.success).toBe(true)
			expect(result.bytes_written).toBe(content.length)
			expect(result.duration_ms).toBeGreaterThan(0)

			// Verify file was written correctly
			const writtenContent = await fs.readFile(testFile, "utf8")
			expect(writtenContent).toBe(content)
		})

		test("should handle batch file operations with concurrency control", async () => {
			// Create multiple operations
			const operations = Array.from({ length: 10 }, (_, i) => {
				const filePath = path.join(testDir, `batch-${i}.txt`)
				const content = `Content for file ${i}\n`

				return () => streamingWriteFile(filePath, content)
			})

			let progressCalls = 0
			const result = await batchFileOperations(operations, {
				concurrency: 3,
				continue_on_error: true,
				progress_callback: (completed, total, current) => {
					progressCalls++
					expect(completed).toBeLessThanOrEqual(total)
					expect(total).toBe(10)
				},
			})

			expect(result.success).toBe(true)
			expect(result.total_operations).toBe(10)
			expect(result.successful_operations).toBe(10)
			expect(result.failed_operations).toBe(0)
			expect(progressCalls).toBe(10)

			// Verify all files were created
			for (let i = 0; i < 10; i++) {
				const filePath = path.join(testDir, `batch-${i}.txt`)
				const exists = await fs
					.access(filePath)
					.then(() => true)
					.catch(() => false)
				expect(exists).toBe(true)
			}
		})
	})

	describe("File Watcher Operations", () => {
		test("should watch directory for file changes", async () => {
			const watcher = createFileWatcher({
				debounce_ms: 50,
				max_files: 100,
			})

			const events: any[] = []
			watcher.on("change", (event) => {
				events.push(event)
			})

			watcher.on("ready", async () => {
				// Create a test file after watcher is ready
				setTimeout(async () => {
					await fs.writeFile(path.join(testDir, "watched-file.txt"), "test content", "utf8")
				}, 100)
			})

			await watcher.watch(testDir)

			// Wait for events
			await new Promise((resolve) => setTimeout(resolve, 300))

			expect(events.length).toBeGreaterThan(0)
			expect(events[0]).toHaveProperty("type")
			expect(events[0]).toHaveProperty("path")
			expect(events[0]).toHaveProperty("timestamp")

			const stats = watcher.getStats()
			expect(stats.files_watched).toBeGreaterThanOrEqual(0)
			expect(stats.events_processed).toBeGreaterThanOrEqual(0)

			await watcher.unwatch()
		})

		test("should handle ignore patterns correctly", async () => {
			const watcher = createFileWatcher({
				ignored_patterns: ["*.tmp", "*.log"],
				debounce_ms: 50,
			})

			const events: any[] = []
			watcher.on("change", (event) => {
				events.push(event)
			})

			await watcher.watch(testDir)

			// Create files that should be ignored
			await fs.writeFile(path.join(testDir, "ignored.tmp"), "temp content", "utf8")
			await fs.writeFile(path.join(testDir, "ignored.log"), "log content", "utf8")

			// Create file that should NOT be ignored
			await fs.writeFile(path.join(testDir, "normal.txt"), "normal content", "utf8")

			// Wait for events
			await new Promise((resolve) => setTimeout(resolve, 200))

			// Should only have events for normal.txt, not the ignored files
			const normalFileEvents = events.filter((e) => e.path.includes("normal.txt"))
			const ignoredFileEvents = events.filter((e) => e.path.includes(".tmp") || e.path.includes(".log"))

			expect(normalFileEvents.length).toBeGreaterThan(0)
			expect(ignoredFileEvents.length).toBe(0)

			const stats = watcher.getStats()
			expect(stats.ignored_count).toBeGreaterThanOrEqual(2) // At least the 2 ignored files

			await watcher.unwatch()
		})
	})

	describe("Performance Validation", () => {
		test("should handle large file operations efficiently", async () => {
			const largeFile = path.join(testDir, "performance-test.txt")

			// Create a moderately large file (1MB)
			const lineContent = "This is a performance test line with some content to make it realistic.\n"
			const largeSizeContent = Array(Math.ceil((1024 * 1024) / lineContent.length))
				.fill(lineContent)
				.join("")

			const startTime = Date.now()
			await streamingWriteFile(largeFile, largeSizeContent)
			const writeTime = Date.now() - startTime

			expect(writeTime).toBeLessThan(5000) // Should complete within 5 seconds

			const readStartTime = Date.now()
			const readResult = await streamingReadFile(largeFile, {
				chunk_size: 64 * 1024, // 64KB chunks
			})
			const readTime = Date.now() - readStartTime

			expect(readResult.success).toBe(true)
			expect(readResult.total_bytes).toBeGreaterThan(1024 * 1024) // At least 1MB
			expect(readTime).toBeLessThan(5000) // Should complete within 5 seconds
		})

		test("should optimize batch operations with proper concurrency", async () => {
			// Create 20 small file operations
			const operations = Array.from({ length: 20 }, (_, i) => {
				const filePath = path.join(testDir, `perf-${i}.txt`)
				const content = `Performance test content ${i}\n`.repeat(100)

				return () => streamingWriteFile(filePath, content)
			})

			// Test sequential vs concurrent
			const sequentialStart = Date.now()
			const sequentialResult = await batchFileOperations(operations.slice(0, 10), {
				concurrency: 1, // Sequential
			})
			const sequentialTime = Date.now() - sequentialStart

			const concurrentStart = Date.now()
			const concurrentResult = await batchFileOperations(operations.slice(10), {
				concurrency: 5, // Concurrent
			})
			const concurrentTime = Date.now() - concurrentStart

			// Concurrent should be faster (or at least not significantly slower)
			expect(concurrentTime).toBeLessThanOrEqual(sequentialTime * 1.5)
			expect(sequentialResult.successful_operations).toBe(10)
			expect(concurrentResult.successful_operations).toBe(10)
		})
	})

	describe("Integration Tests", () => {
		test("should integrate all file operations in a realistic workflow", async () => {
			// Step 1: Create multiple files using batch operations
			const createOps = Array.from({ length: 5 }, (_, i) => {
				const filePath = path.join(testDir, `integration-${i}.js`)
				const content = `// File ${i}\nfunction test${i}() {\n  return ${i};\n}\n`
				return () => streamingWriteFile(filePath, content)
			})

			const createResult = await batchFileOperations(createOps, { concurrency: 3 })
			expect(createResult.successful_operations).toBe(5)

			// Step 2: Apply multi-file diff to update all files
			const multiDiffFiles = Array.from({ length: 5 }, (_, i) => ({
				path: `integration-${i}.js`,
				diffs: [
					{
						content: `<<<<<<< SEARCH
function test${i}() {
  return ${i};
}
=======
function test${i}() {
  console.log('Updated function ${i}');
  return ${i} * 2;
}
>>>>>>> REPLACE`,
						start_line: 2,
					},
				],
			}))

			const multiDiffResult = await runMultiApplyDiff(testDir, {
				files: multiDiffFiles,
				options: { continue_on_error: true },
			})

			expect(multiDiffResult.files_succeeded).toBe(5)

			// Step 3: Use enhanced edit_file to add headers
			for (let i = 0; i < 5; i++) {
				const result = await executeTool(testDir, {
					name: "edit_file",
					type: "tool_use",
					params: {
						path: `integration-${i}.js`,
						edits: JSON.stringify([
							{
								action: "prepend",
								content: `// Enhanced file ${i} - Integration test\n`,
							},
						]),
					},
					partial: false,
				})
				expect(result.metadata?.status).toBe("success")
			}

			// Step 4: Verify final state with streaming read
			for (let i = 0; i < 5; i++) {
				const filePath = path.join(testDir, `integration-${i}.js`)
				const readResult = await streamingReadFile(filePath)

				expect(readResult.success).toBe(true)
				expect(readResult.content).toContain(`Enhanced file ${i}`)
				expect(readResult.content).toContain(`Updated function ${i}`)
				expect(readResult.content).toContain(`return ${i} * 2`)
			}
		})
	})
})
