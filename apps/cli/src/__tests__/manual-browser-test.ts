#!/usr/bin/env tsx

/**
 * Manual test script for CLI Browser Action
 * Run with: npx tsx src/__tests__/manual-browser-test.ts
 */

import { createCliBrowserAction } from "../browser-action-cli.js"

interface TestResult {
	name: string
	success: boolean
	error?: string
	duration?: number
}

class BrowserActionTester {
	private results: TestResult[] = []

	async runAllTests(): Promise<void> {
		console.log("🚀 Starting CLI Browser Action Manual Tests\n")

		// Test 1: Valid HTTP URL
		await this.runTest("Valid HTTP URL", async () => {
			const browser = createCliBrowserAction()
			const result = await browser.execute({
				action: "launch",
				url: "http://httpbin.org/html",
			})

			if (!result.success) throw new Error(result.error || "Request failed")
			if (!result.content?.includes("Herman Melville")) {
				throw new Error("Expected content not found")
			}

			console.log(`  ✓ Title: ${result.title}`)
			console.log(`  ✓ URL: ${result.url}`)
			console.log(`  ✓ Status: ${result.metadata?.statusCode}`)
		})

		// Test 2: Valid HTTPS URL
		await this.runTest("Valid HTTPS URL", async () => {
			const browser = createCliBrowserAction()
			const result = await browser.execute({
				action: "launch",
				url: "https://httpbin.org/json",
			})

			if (!result.success) throw new Error(result.error || "Request failed")

			console.log(`  ✓ Content type: ${result.metadata?.contentType}`)
			console.log(`  ✓ Size: ${result.metadata?.size} bytes`)
		})

		// Test 3: Invalid URL format
		await this.runTest("Invalid URL format", async () => {
			const browser = createCliBrowserAction()
			const result = await browser.execute({
				action: "launch",
				url: "not-a-valid-url",
			})

			if (result.success) throw new Error("Should have failed for invalid URL")
			if (!result.error?.includes("Invalid URL format")) {
				throw new Error(`Unexpected error: ${result.error}`)
			}

			console.log(`  ✓ Correctly rejected: ${result.error}`)
		})

		// Test 4: Unsupported protocol
		await this.runTest("Unsupported protocol", async () => {
			const browser = createCliBrowserAction()
			const result = await browser.execute({
				action: "launch",
				url: "ftp://example.com",
			})

			if (result.success) throw new Error("Should have failed for unsupported protocol")
			if (!result.error?.includes("Unsupported protocol")) {
				throw new Error(`Unexpected error: ${result.error}`)
			}

			console.log(`  ✓ Correctly rejected: ${result.error}`)
		})

		// Test 5: Private IP address blocking
		await this.runTest("Private IP blocking", async () => {
			const browser = createCliBrowserAction()
			const result = await browser.execute({
				action: "launch",
				url: "http://192.168.1.1",
			})

			if (result.success) throw new Error("Should have failed for private IP")
			if (!result.error?.includes("private/local IP addresses is not allowed")) {
				throw new Error(`Unexpected error: ${result.error}`)
			}

			console.log(`  ✓ Correctly blocked: ${result.error}`)
		})

		// Test 6: HTTP error handling (404)
		await this.runTest("HTTP 404 error handling", async () => {
			const browser = createCliBrowserAction()
			const result = await browser.execute({
				action: "launch",
				url: "https://httpbin.org/status/404",
			})

			if (result.success) throw new Error("Should have failed for 404")
			if (!result.error?.includes("HTTP 404")) {
				throw new Error(`Unexpected error: ${result.error}`)
			}

			console.log(`  ✓ Correctly handled 404: ${result.error}`)
		})

		// Test 7: Navigate action
		await this.runTest("Navigate action", async () => {
			const browser = createCliBrowserAction()

			// First launch
			await browser.execute({
				action: "launch",
				url: "https://httpbin.org/html",
			})

			// Then navigate
			const result = await browser.execute({
				action: "navigate",
				url: "https://httpbin.org/json",
			})

			if (!result.success) throw new Error(result.error || "Navigate failed")

			const sessionInfo = browser.getSessionInfo()
			if (sessionInfo.currentUrl !== "https://httpbin.org/json") {
				throw new Error("Current URL not updated after navigate")
			}

			console.log(`  ✓ Navigated to: ${sessionInfo.currentUrl}`)
		})

		// Test 8: Close action
		await this.runTest("Close action", async () => {
			const browser = createCliBrowserAction()
			const result = await browser.execute({
				action: "close",
			})

			if (!result.success) throw new Error(result.error || "Close failed")
			if (!result.content?.includes("Browser session closed successfully")) {
				throw new Error("Unexpected close response")
			}

			console.log(`  ✓ Session closed successfully`)
		})

		// Test 9: Unsupported action
		await this.runTest("Unsupported action handling", async () => {
			const browser = createCliBrowserAction()
			const result = await browser.execute({
				action: "click",
				coordinate: "100,200",
			})

			if (result.success) throw new Error("Should have failed for unsupported action")
			if (!result.error?.includes("not supported in CLI mode")) {
				throw new Error(`Unexpected error: ${result.error}`)
			}

			console.log(`  ✓ Correctly rejected: ${result.error}`)
		})

		// Test 10: Missing URL parameter
		await this.runTest("Missing URL parameter", async () => {
			const browser = createCliBrowserAction()
			const result = await browser.execute({
				action: "launch",
			})

			if (result.success) throw new Error("Should have failed for missing URL")
			if (!result.error?.includes("URL parameter is required")) {
				throw new Error(`Unexpected error: ${result.error}`)
			}

			console.log(`  ✓ Correctly required URL: ${result.error}`)
		})

		// Test 11: Localhost in development mode
		await this.runTest("Localhost in development mode", async () => {
			const originalEnv = process.env.NODE_ENV
			process.env.NODE_ENV = "development"

			try {
				const browser = createCliBrowserAction()
				const result = await browser.execute({
					action: "launch",
					url: "http://localhost:8080",
				})

				// This should either succeed (if localhost:8080 is available) or fail with a network error
				// but NOT fail with a security restriction
				if (!result.success && result.error?.includes("Access to localhost is not allowed")) {
					throw new Error("Should allow localhost in development mode")
				}

				if (result.success) {
					console.log(`  ✓ Localhost allowed in development mode`)
				} else {
					console.log(`  ✓ Localhost allowed but connection failed (expected): ${result.error}`)
				}
			} finally {
				// Restore environment
				if (originalEnv) {
					process.env.NODE_ENV = originalEnv
				} else {
					delete process.env.NODE_ENV
				}
			}
		})

		// Print summary
		this.printSummary()
	}

	private async runTest(name: string, testFn: () => Promise<void>): Promise<void> {
		const startTime = Date.now()

		try {
			console.log(`🧪 Running: ${name}`)
			await testFn()
			const duration = Date.now() - startTime

			this.results.push({ name, success: true, duration })
			console.log(`  ✅ PASS (${duration}ms)\n`)
		} catch (error) {
			const duration = Date.now() - startTime
			const errorMessage = error instanceof Error ? error.message : String(error)

			this.results.push({ name, success: false, error: errorMessage, duration })
			console.log(`  ❌ FAIL (${duration}ms): ${errorMessage}\n`)
		}
	}

	private printSummary(): void {
		const passed = this.results.filter((r) => r.success).length
		const failed = this.results.filter((r) => !r.success).length
		const totalTime = this.results.reduce((sum, r) => sum + (r.duration || 0), 0)

		console.log("=".repeat(60))
		console.log("📊 TEST SUMMARY")
		console.log("=".repeat(60))
		console.log(`Total Tests: ${this.results.length}`)
		console.log(`✅ Passed: ${passed}`)
		console.log(`❌ Failed: ${failed}`)
		console.log(`⏱️  Total Time: ${totalTime}ms`)
		console.log(`📈 Success Rate: ${Math.round((passed / this.results.length) * 100)}%`)

		if (failed > 0) {
			console.log("\n🔍 FAILED TESTS:")
			this.results.filter((r) => !r.success).forEach((r) => console.log(`  • ${r.name}: ${r.error}`))
		}

		console.log("\n" + (failed === 0 ? "🎉 All tests passed!" : `⚠️  ${failed} test(s) failed`))
	}
}

// Run tests if this file is executed directly
if (require.main === module) {
	const tester = new BrowserActionTester()
	tester.runAllTests().catch((error) => {
		console.error("❌ Test runner failed:", error)
		process.exit(1)
	})
}

export { BrowserActionTester }
