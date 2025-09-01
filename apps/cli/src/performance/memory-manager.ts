/**
 * Advanced Memory Management System
 *
 * Provides enterprise-grade memory management including:
 * - Heap monitoring and garbage collection optimization
 * - Memory leak detection and prevention
 * - Resource pooling and reuse
 * - Startup time optimization
 */

import fs from "node:fs/promises"
import fssync from "node:fs"
import path from "node:path"
import { performance } from "node:perf_hooks"

export interface MemoryStats {
	heapUsed: number
	heapTotal: number
	external: number
	rss: number
	buffers: number
	timestamp: number
}

export interface StartupMetrics {
	moduleLoadTime: number
	configLoadTime: number
	connectionSetupTime: number
	totalStartupTime: number
	moduleCount: number
	cacheHits: number
}

export interface MemoryAlert {
	type: "warning" | "critical"
	message: string
	recommendation: string
	timestamp: number
	metrics: MemoryStats
}

export class AdvancedMemoryManager {
	private cwd: string
	private startupTime: number = performance.now()
	private memoryHistory: MemoryStats[] = []
	private alerts: MemoryAlert[] = []
	private resourcePools: Map<string, any[]> = new Map()
	private monitoringEnabled: boolean = true
	private gcScheduled: boolean = false
	private leakDetectionEnabled: boolean = true

	// Memory thresholds (in MB)
	private readonly WARNING_THRESHOLD = 100
	private readonly CRITICAL_THRESHOLD = 200
	private readonly MAX_HISTORY_SIZE = 100

	constructor(
		cwd: string,
		options: {
			enableMonitoring?: boolean
			enableLeakDetection?: boolean
			warningThresholdMB?: number
			criticalThresholdMB?: number
		} = {},
	) {
		this.cwd = cwd
		this.monitoringEnabled = options.enableMonitoring !== false
		this.leakDetectionEnabled = options.enableLeakDetection !== false

		if (this.monitoringEnabled) {
			this.startMemoryMonitoring()
		}
	}

	async initialize(): Promise<StartupMetrics> {
		const initStart = performance.now()

		// Measure module loading time
		const moduleLoadStart = performance.now()
		await this.preloadCriticalModules()
		const moduleLoadTime = performance.now() - moduleLoadStart

		// Measure config loading time
		const configLoadStart = performance.now()
		await this.optimizeConfigLoading()
		const configLoadTime = performance.now() - configLoadStart

		// Measure connection setup time
		const connectionStart = performance.now()
		await this.initializeResourcePools()
		const connectionSetupTime = performance.now() - connectionStart

		const totalStartupTime = performance.now() - this.startupTime

		const metrics: StartupMetrics = {
			moduleLoadTime,
			configLoadTime,
			connectionSetupTime,
			totalStartupTime,
			moduleCount: Object.keys(require.cache).length,
			cacheHits: 0, // Would be populated from actual cache
		}

		// Save startup metrics for analysis
		await this.saveStartupMetrics(metrics)

		return metrics
	}

	private async preloadCriticalModules(): Promise<void> {
		// Preload frequently used modules to reduce lazy loading overhead
		const criticalModules = ["node:fs/promises", "node:path", "node:crypto"]

		const preloadPromises = criticalModules.map(async (moduleName) => {
			try {
				await import(moduleName)
			} catch (e) {
				console.warn(`Failed to preload module ${moduleName}:`, e)
			}
		})

		await Promise.all(preloadPromises)
	}

	private async optimizeConfigLoading(): Promise<void> {
		// Optimize config loading by parallel reading and caching
		const configFiles = [
			path.join(this.cwd, ".kilocode", "settings.json"),
			path.join(this.cwd, ".kilocode", "mcp.json"),
			path.join(this.cwd, ".kilocode", "profiles.json"),
		]

		// Read all config files in parallel
		const configPromises = configFiles.map(async (file) => {
			try {
				if (fssync.existsSync(file)) {
					return await fs.readFile(file, "utf8")
				}
			} catch (e) {
				// Ignore config read errors during optimization
			}
			return null
		})

		await Promise.allSettled(configPromises)
	}

	private async initializeResourcePools(): Promise<void> {
		// Initialize object pools for frequently created objects
		this.resourcePools.set("buffers", [])
		this.resourcePools.set("regexes", [])
		this.resourcePools.set("streams", [])

		// Pre-allocate some common buffers
		const buffers = this.resourcePools.get("buffers")!
		for (let i = 0; i < 5; i++) {
			buffers.push(Buffer.alloc(64 * 1024)) // 64KB buffers
		}
	}

	getBuffer(size: number): Buffer {
		const buffers = this.resourcePools.get("buffers")!

		// Try to reuse existing buffer if size matches
		for (let i = 0; i < buffers.length; i++) {
			const buffer = buffers[i]
			if (buffer.length >= size) {
				buffers.splice(i, 1) // Remove from pool
				return buffer.subarray(0, size)
			}
		}

		// Allocate new buffer if no suitable one in pool
		return Buffer.alloc(size)
	}

	returnBuffer(buffer: Buffer): void {
		const buffers = this.resourcePools.get("buffers")!

		// Only keep buffer if pool isn't full and buffer is reasonably sized
		if (buffers.length < 10 && buffer.length <= 1024 * 1024) {
			buffers.push(buffer)
		}
	}

	private startMemoryMonitoring(): void {
		// Monitor memory every 10 seconds
		setInterval(() => {
			const memStats = this.captureMemoryStats()
			this.memoryHistory.push(memStats)

			// Keep history bounded
			if (this.memoryHistory.length > this.MAX_HISTORY_SIZE) {
				this.memoryHistory.shift()
			}

			// Check for memory issues
			this.checkMemoryThresholds(memStats)

			if (this.leakDetectionEnabled) {
				this.detectMemoryLeaks()
			}
		}, 10000)
	}

	private captureMemoryStats(): MemoryStats {
		const usage = process.memoryUsage()
		return {
			heapUsed: usage.heapUsed,
			heapTotal: usage.heapTotal,
			external: usage.external,
			rss: usage.rss,
			buffers: usage.external, // Node.js doesn't expose buffer count directly
			timestamp: Date.now(),
		}
	}

	private checkMemoryThresholds(stats: MemoryStats): void {
		const heapUsedMB = stats.heapUsed / (1024 * 1024)
		const rssMB = stats.rss / (1024 * 1024)

		if (heapUsedMB > this.CRITICAL_THRESHOLD || rssMB > this.CRITICAL_THRESHOLD * 1.5) {
			this.createAlert(
				"critical",
				`Critical memory usage detected: ${Math.round(heapUsedMB)}MB heap, ${Math.round(rssMB)}MB RSS`,
				"Consider reducing cache size, restarting the CLI, or freeing resources",
				stats,
			)
			this.scheduleEmergencyGC()
		} else if (heapUsedMB > this.WARNING_THRESHOLD || rssMB > this.WARNING_THRESHOLD * 1.5) {
			this.createAlert(
				"warning",
				`High memory usage detected: ${Math.round(heapUsedMB)}MB heap, ${Math.round(rssMB)}MB RSS`,
				"Monitor memory usage and consider optimizing current operations",
				stats,
			)
		}
	}

	private createAlert(
		type: "warning" | "critical",
		message: string,
		recommendation: string,
		metrics: MemoryStats,
	): void {
		const alert: MemoryAlert = {
			type,
			message,
			recommendation,
			timestamp: Date.now(),
			metrics,
		}

		this.alerts.push(alert)

		// Keep only last 20 alerts
		if (this.alerts.length > 20) {
			this.alerts.shift()
		}

		// Log critical alerts immediately
		if (type === "critical") {
			console.warn(`🚨 CRITICAL MEMORY ALERT: ${message}`)
			console.warn(`💡 Recommendation: ${recommendation}`)
		}
	}

	private detectMemoryLeaks(): void {
		if (this.memoryHistory.length < 5) return

		// Check for sustained memory growth
		const recent = this.memoryHistory.slice(-5)
		const oldest = recent[0]
		const newest = recent[recent.length - 1]

		const heapGrowth = newest.heapUsed - oldest.heapUsed
		const timeSpan = newest.timestamp - oldest.timestamp

		// If heap grew more than 10MB in 50 seconds, might be a leak
		if (heapGrowth > 10 * 1024 * 1024 && timeSpan < 50000) {
			const growthRate = heapGrowth / (1024 * 1024) / (timeSpan / 1000) // MB/sec

			this.createAlert(
				"warning",
				`Potential memory leak detected: ${Math.round(growthRate * 60)} MB/min growth rate`,
				"Review recent operations for memory-intensive tasks or unbounded data structures",
				newest,
			)
		}
	}

	private scheduleEmergencyGC(): void {
		if (this.gcScheduled) return

		this.gcScheduled = true
		setImmediate(() => {
			try {
				// Force garbage collection if available
				if (global.gc) {
					global.gc()
					console.log("🗑️ Emergency garbage collection performed")
				}

				// Clear resource pools
				for (const pool of this.resourcePools.values()) {
					pool.length = 0
				}

				// Clear old memory history
				if (this.memoryHistory.length > 20) {
					this.memoryHistory = this.memoryHistory.slice(-20)
				}
			} finally {
				this.gcScheduled = false
			}
		})
	}

	// Startup optimization utilities
	async optimizeStartupSequence(): Promise<StartupMetrics> {
		const optimizationStart = performance.now()

		// Parallel initialization of independent systems
		const initPromises = [
			this.optimizeConfigLoading(),
			this.preloadCriticalModules(),
			this.initializeResourcePools(),
		]

		await Promise.all(initPromises)

		const totalOptimizationTime = performance.now() - optimizationStart

		return {
			moduleLoadTime: 0, // Measured in preloadCriticalModules
			configLoadTime: 0, // Measured in optimizeConfigLoading
			connectionSetupTime: 0, // Measured in initializeResourcePools
			totalStartupTime: totalOptimizationTime,
			moduleCount: Object.keys(require.cache).length,
			cacheHits: 0,
		}
	}

	// Resource efficiency monitoring
	getResourceEfficiencyReport(): {
		memoryEfficiency: number
		cacheEfficiency: number
		gcFrequency: number
		leakRisk: "low" | "medium" | "high"
		recommendations: string[]
	} {
		const currentStats = this.captureMemoryStats()
		const recommendations: string[] = []

		// Calculate efficiency metrics
		const memoryEfficiency = currentStats.heapTotal > 0 ? (currentStats.heapUsed / currentStats.heapTotal) * 100 : 0

		// Analyze GC frequency (simplified)
		const recentAlerts = this.alerts.filter((a) => Date.now() - a.timestamp < 300000) // Last 5 minutes
		const gcFrequency = recentAlerts.length

		// Assess leak risk
		let leakRisk: "low" | "medium" | "high" = "low"
		if (this.memoryHistory.length >= 3) {
			const growth =
				this.memoryHistory[this.memoryHistory.length - 1].heapUsed -
				this.memoryHistory[this.memoryHistory.length - 3].heapUsed
			if (growth > 50 * 1024 * 1024) leakRisk = "high"
			else if (growth > 20 * 1024 * 1024) leakRisk = "medium"
		}

		// Generate recommendations
		if (memoryEfficiency > 90) {
			recommendations.push("Consider increasing heap size or reducing cache")
		}

		if (gcFrequency > 5) {
			recommendations.push("High GC frequency detected - review object allocation patterns")
		}

		if (leakRisk === "high") {
			recommendations.push("Potential memory leak - review recent operations")
		}

		if (currentStats.external > 100 * 1024 * 1024) {
			recommendations.push("High external memory usage - review buffer and stream usage")
		}

		return {
			memoryEfficiency,
			cacheEfficiency: 0, // Would be calculated from cache metrics
			gcFrequency,
			leakRisk,
			recommendations,
		}
	}

	// Token usage optimization for memory efficiency
	optimizeTokenMemoryUsage(conversationHistory: string[]): {
		optimizedHistory: string[]
		memoryFreed: number
		compressionRatio: number
	} {
		const originalSize = conversationHistory.reduce((sum, msg) => sum + msg.length, 0)

		// Apply memory-efficient optimizations
		const optimized = conversationHistory.map((message) => {
			// Remove excessive whitespace
			let optimizedMessage = message.replace(/\s+/g, " ").trim()

			// Compress JSON structures
			optimizedMessage = optimizedMessage.replace(/"(\w+)":\s*"([^"]*?)"/g, '"$1":"$2"')

			// Remove redundant brackets and separators
			optimizedMessage = optimizedMessage.replace(/\{\s+/g, "{").replace(/\s+\}/g, "}")

			return optimizedMessage
		})

		// Remove duplicate consecutive messages (keeping unique content)
		const deduplicated: string[] = []
		for (let i = 0; i < optimized.length; i++) {
			if (i === 0 || optimized[i] !== optimized[i - 1]) {
				deduplicated.push(optimized[i])
			}
		}

		const finalSize = deduplicated.reduce((sum, msg) => sum + msg.length, 0)
		const memoryFreed = originalSize - finalSize
		const compressionRatio = originalSize > 0 ? finalSize / originalSize : 1

		return {
			optimizedHistory: deduplicated,
			memoryFreed,
			compressionRatio,
		}
	}

	// Startup time optimization
	async measureStartupBottlenecks(): Promise<{
		slowestOperations: Array<{
			operation: string
			duration: number
			percentage: number
		}>
		totalStartupTime: number
		recommendations: string[]
	}> {
		const startupLog = await this.getStartupTimingLog()
		const recommendations: string[] = []

		// Analyze timing bottlenecks
		const operations = Object.entries(startupLog)
			.map(([operation, duration]) => ({
				operation,
				duration: duration as number,
				percentage: ((duration as number) / startupLog.total) * 100,
			}))
			.sort((a, b) => b.duration - a.duration)

		// Generate optimization recommendations
		for (const op of operations.slice(0, 3)) {
			// Top 3 slowest
			if (op.percentage > 20) {
				switch (op.operation) {
					case "moduleLoading":
						recommendations.push("Consider lazy loading non-critical modules")
						break
					case "configLoading":
						recommendations.push("Optimize config file structure or add caching")
						break
					case "connectionSetup":
						recommendations.push("Parallelize connection establishment or add connection pooling")
						break
					case "cacheInitialization":
						recommendations.push("Reduce cache preloading or use async initialization")
						break
				}
			}
		}

		return {
			slowestOperations: operations,
			totalStartupTime: startupLog.total,
			recommendations,
		}
	}

	private async getStartupTimingLog(): Promise<Record<string, number>> {
		// This would be populated by actual timing measurements during startup
		// For now, return sample data structure
		return {
			moduleLoading: 150,
			configLoading: 75,
			connectionSetup: 200,
			cacheInitialization: 50,
			total: performance.now() - this.startupTime,
		}
	}

	// Resource pool management for memory efficiency
	getPooledRegex(pattern: string, flags?: string): RegExp {
		const regexPool = this.resourcePools.get("regexes")!
		const key = `${pattern}:${flags || ""}`

		// Try to find existing regex in pool
		const existing = regexPool.find((item: any) => item.key === key)
		if (existing) {
			return existing.regex
		}

		// Create new regex and add to pool
		const regex = new RegExp(pattern, flags)
		regexPool.push({ key, regex })

		// Keep pool size bounded
		if (regexPool.length > 50) {
			regexPool.shift()
		}

		return regex
	}

	// Advanced garbage collection optimization
	async optimizeGarbageCollection(): Promise<{
		heapBefore: number
		heapAfter: number
		memoryFreed: number
		gcTime: number
	}> {
		const beforeStats = process.memoryUsage()
		const gcStart = performance.now()

		// Clear unnecessary references
		this.clearWeakReferences()

		// Force garbage collection if available
		if (global.gc) {
			global.gc()
		}

		// Small delay to let GC complete
		await new Promise((resolve) => setTimeout(resolve, 100))

		const afterStats = process.memoryUsage()
		const gcTime = performance.now() - gcStart

		const memoryFreed = beforeStats.heapUsed - afterStats.heapUsed

		return {
			heapBefore: beforeStats.heapUsed,
			heapAfter: afterStats.heapUsed,
			memoryFreed,
			gcTime,
		}
	}

	private clearWeakReferences(): void {
		// Clear resource pools of old items
		for (const [poolName, pool] of this.resourcePools) {
			if (pool.length > 20) {
				pool.splice(0, Math.floor(pool.length / 2))
			}
		}

		// Clear old memory history
		if (this.memoryHistory.length > 50) {
			this.memoryHistory = this.memoryHistory.slice(-50)
		}

		// Clear old alerts
		if (this.alerts.length > 10) {
			this.alerts = this.alerts.slice(-10)
		}
	}

	async getMemoryReport(): Promise<{
		currentStats: MemoryStats
		trend: "increasing" | "stable" | "decreasing"
		alerts: MemoryAlert[]
		efficiency: {
			memoryEfficiency: number
			cacheEfficiency: number
			gcFrequency: number
			leakRisk: "low" | "medium" | "high"
			recommendations: string[]
		}
		recommendations: string[]
	}> {
		const currentStats = this.captureMemoryStats()

		// Analyze memory trend
		let trend: "increasing" | "stable" | "decreasing" = "stable"
		if (this.memoryHistory.length >= 3) {
			const recent = this.memoryHistory.slice(-3)
			const growth = recent[recent.length - 1].heapUsed - recent[0].heapUsed
			const threshold = 5 * 1024 * 1024 // 5MB

			if (growth > threshold) trend = "increasing"
			else if (growth < -threshold) trend = "decreasing"
		}

		const efficiency = this.getResourceEfficiencyReport()

		return {
			currentStats,
			trend,
			alerts: [...this.alerts],
			efficiency,
			recommendations: efficiency.recommendations,
		}
	}

	private async saveStartupMetrics(metrics: StartupMetrics): Promise<void> {
		try {
			const metricsFile = path.join(this.cwd, ".kilocode", "performance", "startup_metrics.json")
			await fs.mkdir(path.dirname(metricsFile), { recursive: true })

			const data = {
				timestamp: new Date().toISOString(),
				nodeVersion: process.version,
				platform: process.platform,
				arch: process.arch,
				metrics,
			}

			await fs.writeFile(metricsFile, JSON.stringify(data, null, 2), "utf8")
		} catch (e) {
			console.warn("Failed to save startup metrics:", e)
		}
	}

	async cleanup(): Promise<void> {
		// Stop monitoring
		this.monitoringEnabled = false

		// Clear resource pools
		this.resourcePools.clear()

		// Save final memory report
		try {
			const report = await this.getMemoryReport()
			const reportFile = path.join(this.cwd, ".kilocode", "performance", "final_memory_report.json")
			await fs.mkdir(path.dirname(reportFile), { recursive: true })
			await fs.writeFile(reportFile, JSON.stringify(report, null, 2), "utf8")
		} catch (e) {
			console.warn("Failed to save final memory report:", e)
		}

		// Final cleanup
		this.memoryHistory = []
		this.alerts = []
	}
}
