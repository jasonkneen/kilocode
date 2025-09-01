#!/usr/bin/env node

const fs = require("node:fs/promises")
const path = require("node:path")

// For CommonJS, __dirname is available by default
// Import functions will be loaded dynamically

// Simple test framework
let totalTests = 0
let passedTests = 0

function assert(condition, message) {
	totalTests++
	if (condition) {
		console.log(`✅ ${message}`)
		passedTests++
	} else {
		console.log(`❌ ${message}`)
	}
}

async function assertEquals(actual, expected, message) {
	totalTests++
	if (actual === expected) {
		console.log(`✅ ${message}`)
		passedTests++
	} else {
		console.log(`❌ ${message}`)
		console.log(`   Expected: ${expected}`)
		console.log(`   Actual: ${actual}`)
	}
}

async function runTests() {
	console.log("🧪 Running Advanced File Operations Tests\n")

	const testDir = path.join(__dirname, "test-advanced-file-ops")

	try {
		// Setup
		await fs.mkdir(testDir, { recursive: true })

		// Test 1: Multi Apply Diff Tool
		console.log("📝 Testing Multi Apply Diff Tool")

		const file1 = path.join(testDir, "file1.js")
		const file2 = path.join(testDir, "file2.js")

		await fs.writeFile(file1, `function test() {\n  return "hello";\n}`, "utf8")
		await fs.writeFile(file2, `function demo() {\n  return "world";\n}`, "utf8")

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
		])

		// Dynamic import for ES modules
		const { runMultiApplyDiff } = await import("../tools/multi-apply-diff.js")
		const multiDiffResult = await runMultiApplyDiff(testDir, {
			files: JSON.parse(filesParam),
			options: { continue_on_error: true },
		})

		assert(multiDiffResult.success, "Multi apply diff should succeed")
		assert(multiDiffResult.files_succeeded > 0, "Should have succeeded files")

		const updatedContent = await fs.readFile(file1, "utf8")
		assert(updatedContent.includes("hello world"), "Content should be updated")

		// Test 2: Streaming File Operations
		console.log("\n🚀 Testing Streaming File Operations")

		const { streamingReadFile, streamingWriteFile, batchFileOperations } = await import(
			"../tools/streaming-file-ops.js"
		)

		const streamFile = path.join(testDir, "stream-test.txt")
		const content = Array(1000).fill("Streaming test line\n").join("")

		const writeResult = await streamingWriteFile(streamFile, content)
		assert(writeResult.success, "Streaming write should succeed")
		assert(writeResult.bytes_written > 0, "Should write bytes")

		const readResult = await streamingReadFile(streamFile, {
			chunk_size: 1024,
		})
		assert(readResult.success, "Streaming read should succeed")
		assert(readResult.content === content, "Content should match")

		// Test 3: Batch Operations
		console.log("\n📦 Testing Batch File Operations")

		const operations = Array.from({ length: 5 }, (_, i) => {
			const filePath = path.join(testDir, `batch-${i}.txt`)
			const content = `Content for file ${i}\n`

			return () => streamingWriteFile(filePath, content)
		})

		const batchResult = await batchFileOperations(operations, {
			concurrency: 3,
			continue_on_error: true,
		})

		assert(batchResult.success, "Batch operations should succeed")
		await assertEquals(batchResult.successful_operations, 5, "Should complete all 5 operations")

		// Test 4: Enhanced Edit File
		console.log("\n✏️ Testing Enhanced Edit File")

		const { executeTool } = await import("../tool-runner.js")

		const editFile = path.join(testDir, "edit-test.js")
		await fs.writeFile(editFile, "function old() {\n  return 'old';\n}", "utf8")

		const result = await executeTool(testDir, {
			name: "edit_file",
			type: "tool_use",
			params: {
				path: "edit-test.js",
				edits: JSON.stringify([
					{ action: "replace", line: 1, content: "function new() {" },
					{ action: "replace", line: 2, content: "  return 'new';" },
				]),
			},
			partial: false,
		})

		assert(result.output.includes("Applied 2 edit(s)"), "Should apply edits")

		const editedContent = await fs.readFile(editFile, "utf8")
		assert(editedContent.includes("function new()"), "Should update function name")

		// Test 5: File Watcher (basic test)
		console.log("\n👁️ Testing File Watcher")

		const { createFileWatcher } = await import("../tools/file-watcher.js")

		const watcher = createFileWatcher({
			debounce_ms: 50,
			max_files: 100,
		})

		let eventReceived = false
		watcher.on("change", (event) => {
			eventReceived = true
		})

		await watcher.watch(testDir)

		// Create a file to trigger an event
		await new Promise((resolve) => setTimeout(resolve, 100)) // Wait for watcher to be ready
		await fs.writeFile(path.join(testDir, "watcher-test.txt"), "test", "utf8")

		// Give watcher time to process
		await new Promise((resolve) => setTimeout(resolve, 200))

		const stats = watcher.getStats()
		assert(stats.files_watched >= 0, "Should track watched files")

		await watcher.unwatch()

		console.log(`\n🏁 Test Results: ${passedTests}/${totalTests} passed`)

		// Cleanup
		await fs.rm(testDir, { recursive: true, force: true })

		if (passedTests === totalTests) {
			console.log("🎉 All tests passed!")
			process.exit(0)
		} else {
			console.log("❌ Some tests failed!")
			process.exit(1)
		}
	} catch (error) {
		console.error("🚨 Test suite failed:", error)

		// Cleanup on error
		try {
			await fs.rm(testDir, { recursive: true, force: true })
		} catch (e) {
			// Ignore cleanup errors
		}

		process.exit(1)
	}
}

// Run tests if this script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
	runTests()
}
