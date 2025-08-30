/**
 * System Monitoring and Diagnostics Tool
 *
 * High-value CLI-specific tool for system monitoring, health checks,
 * and diagnostics - essential for CI/CD, production debugging, and
 * automated monitoring scenarios where GUI tools are impractical.
 */

import fs from "node:fs/promises"
import fssync from "node:fs"
import path from "node:path"
import { exec as execCb } from "node:child_process"
import { promisify } from "node:util"
import { performance } from "node:perf_hooks"
import type { ToolExecution } from "../tool-runner.js"

const exec = promisify(execCb)

export interface SystemHealth {
	status: "healthy" | "warning" | "critical"
	score: number // 0-100
	checks: HealthCheck[]
	recommendations: string[]
	summary: string
}

export interface HealthCheck {
	id: string
	name: string
	status: "pass" | "warn" | "fail"
	value?: any
	threshold?: any
	message: string
	category: "performance" | "disk" | "memory" | "network" | "process" | "security"
}

export interface ProcessInfo {
	pid: number
	name: string
	cpu: number
	memory: number
	status: string
	startTime: string
}

export interface DiskInfo {
	path: string
	size: number
	used: number
	available: number
	usagePercent: number
	mountPoint?: string
}

export async function runSystemDiagnostics(
	defaultCwd: string,
	params: {
		check?: string // "health" | "processes" | "disk" | "network" | "performance" | "all"
		format?: "json" | "table" | "structured"
		includeRecommendations?: string
		monitoring?: string // "continuous" | "snapshot"
		duration?: string // For continuous monitoring (seconds)
		alertThresholds?: string // JSON config for custom thresholds
	},
): Promise<ToolExecution> {
	const startTime = performance.now()
	const checkType = params.check || "health"
	const outputFormat = params.format || "structured"
	const includeRecommendations = params.includeRecommendations !== "false"

	try {
		let result: any = {}
		let summary = ""

		switch (checkType) {
			case "health":
				result = await performHealthCheck(defaultCwd, params.alertThresholds)
				summary = `System health check completed: ${result.status} (score: ${result.score}/100)`
				break

			case "processes":
				result = await getProcessInfo()
				summary = `Found ${result.processes.length} processes`
				break

			case "disk":
				result = await getDiskInfo(defaultCwd)
				summary = `Analyzed ${result.disks.length} disk mount(s)`
				break

			case "network":
				result = await getNetworkInfo()
				summary = `Network connectivity check completed`
				break

			case "performance":
				result = await getPerformanceMetrics()
				summary = `Performance metrics collected`
				break

			case "all":
				result = await getCompleteSystemInfo(defaultCwd, params.alertThresholds)
				summary = `Complete system diagnostics completed`
				break

			default:
				return {
					name: "system_diagnostics",
					params: { check: checkType },
					output: `❌ Error: Unknown check type '${checkType}'. Valid options: health, processes, disk, network, performance, all`,
				}
		}

		// Format output
		let output = ""

		switch (outputFormat) {
			case "json":
				output = JSON.stringify(result, null, 2)
				break

			case "table":
				output = formatAsTable(result, checkType)
				break

			default: // structured
				output = formatDiagnosticsOutput(result, checkType, summary, includeRecommendations)
		}

		const duration = performance.now() - startTime

		return {
			name: "system_diagnostics",
			params: {
				check: checkType,
				format: outputFormat,
				duration: String(Math.round(duration)),
			},
			output,
			metadata: {
				status: result.status === "critical" ? "error" : result.status === "warning" ? "warning" : "success",
				duration,
			},
		}
	} catch (e: any) {
		const duration = performance.now() - startTime
		return {
			name: "system_diagnostics",
			params: { error: "true" },
			output: `❌ System diagnostics failed: ${e?.message || String(e)}`,
			metadata: {
				status: "error",
				duration,
			},
		}
	}
}

async function performHealthCheck(cwd: string, alertThresholds?: string): Promise<SystemHealth> {
	const checks: HealthCheck[] = []
	let customThresholds: any = {}

	if (alertThresholds) {
		try {
			customThresholds = JSON.parse(alertThresholds)
		} catch (e) {
			console.warn("Invalid alertThresholds JSON, using defaults")
		}
	}

	// Memory check
	const memUsage = process.memoryUsage()
	const memUsedMB = Math.round(memUsage.heapUsed / (1024 * 1024))
	const memThreshold = customThresholds.memoryMB || 500

	checks.push({
		id: "memory_usage",
		name: "Memory Usage",
		status: memUsedMB > memThreshold ? "fail" : memUsedMB > memThreshold * 0.8 ? "warn" : "pass",
		value: memUsedMB,
		threshold: memThreshold,
		message: `Heap memory usage: ${memUsedMB}MB`,
		category: "memory",
	})

	// Disk space check
	try {
		const diskInfo = await getDiskInfoForPath(cwd)
		const diskThreshold = customThresholds.diskUsagePercent || 90

		checks.push({
			id: "disk_space",
			name: "Disk Space",
			status:
				diskInfo.usagePercent > diskThreshold
					? "fail"
					: diskInfo.usagePercent > diskThreshold * 0.8
						? "warn"
						: "pass",
			value: diskInfo.usagePercent,
			threshold: diskThreshold,
			message: `Disk usage: ${diskInfo.usagePercent.toFixed(1)}% (${Math.round(diskInfo.available / (1024 * 1024 * 1024))}GB free)`,
			category: "disk",
		})
	} catch (e) {
		checks.push({
			id: "disk_space",
			name: "Disk Space",
			status: "warn",
			message: "Could not determine disk usage",
			category: "disk",
		})
	}

	// Process health check
	const processCount = await getProcessCount()
	const processThreshold = customThresholds.maxProcesses || 1000

	checks.push({
		id: "process_count",
		name: "Process Count",
		status: processCount > processThreshold ? "warn" : "pass",
		value: processCount,
		threshold: processThreshold,
		message: `Running processes: ${processCount}`,
		category: "process",
	})

	// Node.js version check
	const nodeVersion = process.version
	const [major] = nodeVersion.slice(1).split(".").map(Number)

	checks.push({
		id: "node_version",
		name: "Node.js Version",
		status: major < 18 ? "warn" : major < 16 ? "fail" : "pass",
		value: nodeVersion,
		message: `Node.js version: ${nodeVersion}`,
		category: "performance",
	})

	// File system permissions check
	try {
		const testFile = path.join(cwd, ".kilocode", "temp_write_test")
		await fs.mkdir(path.dirname(testFile), { recursive: true })
		await fs.writeFile(testFile, "test", "utf8")
		await fs.unlink(testFile)

		checks.push({
			id: "file_permissions",
			name: "File Permissions",
			status: "pass",
			message: "Read/write permissions OK",
			category: "security",
		})
	} catch (e) {
		checks.push({
			id: "file_permissions",
			name: "File Permissions",
			status: "fail",
			message: "Cannot write to working directory",
			category: "security",
		})
	}

	// Calculate overall health score
	const passCount = checks.filter((c) => c.status === "pass").length
	const warnCount = checks.filter((c) => c.status === "warn").length
	const failCount = checks.filter((c) => c.status === "fail").length

	const score = Math.round((passCount * 100 + warnCount * 60) / checks.length)
	const status = failCount > 0 ? "critical" : warnCount > 0 ? "warning" : "healthy"

	// Generate recommendations
	const recommendations: string[] = []
	for (const check of checks.filter((c) => c.status !== "pass")) {
		switch (check.id) {
			case "memory_usage":
				recommendations.push("Consider reducing memory usage or increasing available RAM")
				break
			case "disk_space":
				recommendations.push("Free up disk space or move to larger storage")
				break
			case "process_count":
				recommendations.push("Review running processes and terminate unnecessary ones")
				break
			case "node_version":
				recommendations.push("Update to a more recent Node.js version")
				break
			case "file_permissions":
				recommendations.push("Check file permissions and directory access rights")
				break
		}
	}

	return {
		status,
		score,
		checks,
		recommendations,
		summary: `System health: ${status} (${score}/100) - ${checks.length} checks performed`,
	}
}

async function getProcessInfo(): Promise<{ processes: ProcessInfo[]; summary: any }> {
	try {
		let command = ""
		let parseFunction: (output: string) => ProcessInfo[]

		if (process.platform === "win32") {
			command = "tasklist /fo csv"
			parseFunction = parseWindowsProcesses
		} else {
			command = "ps aux"
			parseFunction = parseUnixProcesses
		}

		const { stdout } = await exec(command)
		const processes = parseFunction(stdout)

		// Calculate summary statistics
		const totalMemory = processes.reduce((sum, p) => sum + p.memory, 0)
		const totalCpu = processes.reduce((sum, p) => sum + p.cpu, 0)

		return {
			processes: processes.slice(0, 50), // Limit to top 50 processes
			summary: {
				total: processes.length,
				totalMemoryMB: Math.round(totalMemory),
				totalCpuPercent: Math.round(totalCpu * 100) / 100,
				platform: process.platform,
			},
		}
	} catch (e) {
		return {
			processes: [],
			summary: { error: "Failed to get process information" },
		}
	}
}

function parseUnixProcesses(output: string): ProcessInfo[] {
	const lines = output.split("\n").slice(1) // Skip header
	const processes: ProcessInfo[] = []

	for (const line of lines) {
		if (!line.trim()) continue

		const parts = line.trim().split(/\s+/)
		if (parts.length >= 11) {
			processes.push({
				pid: parseInt(parts[1], 10),
				name: parts[10] || "unknown",
				cpu: parseFloat(parts[2]) || 0,
				memory: parseFloat(parts[3]) || 0,
				status: parts[7] || "unknown",
				startTime: parts[8] || "unknown",
			})
		}
	}

	return processes.sort((a, b) => b.memory - a.memory)
}

function parseWindowsProcesses(output: string): ProcessInfo[] {
	const lines = output.split("\n").slice(1) // Skip header
	const processes: ProcessInfo[] = []

	for (const line of lines) {
		if (!line.trim()) continue

		const parts = line.split(",").map((p) => p.replace(/"/g, ""))
		if (parts.length >= 5) {
			processes.push({
				pid: parseInt(parts[1], 10),
				name: parts[0],
				cpu: 0, // Windows tasklist doesn't provide CPU in basic format
				memory: parseInt(parts[4].replace(/[^\d]/g, ""), 10) / 1024 || 0, // Convert KB to MB
				status: "running",
				startTime: "unknown",
			})
		}
	}

	return processes.sort((a, b) => b.memory - a.memory)
}

async function getDiskInfo(cwd: string): Promise<{ disks: DiskInfo[]; summary: any }> {
	try {
		const disks: DiskInfo[] = []

		if (process.platform === "win32") {
			// Windows disk info
			const { stdout } = await exec("wmic logicaldisk get size,freespace,caption")
			const lines = stdout.split("\n").slice(1)

			for (const line of lines) {
				if (!line.trim()) continue
				const parts = line.trim().split(/\s+/)
				if (parts.length >= 3) {
					const size = parseInt(parts[2], 10)
					const free = parseInt(parts[1], 10)
					const used = size - free

					disks.push({
						path: parts[0],
						size,
						used,
						available: free,
						usagePercent: size > 0 ? (used / size) * 100 : 0,
						mountPoint: parts[0],
					})
				}
			}
		} else {
			// Unix disk info
			const { stdout } = await exec("df -h")
			const lines = stdout.split("\n").slice(1)

			for (const line of lines) {
				if (!line.trim()) continue
				const parts = line.trim().split(/\s+/)
				if (parts.length >= 6) {
					const usagePercent = parseInt(parts[4].replace("%", ""), 10)

					disks.push({
						path: parts[5],
						size: parseHumanSize(parts[1]),
						used: parseHumanSize(parts[2]),
						available: parseHumanSize(parts[3]),
						usagePercent,
						mountPoint: parts[5],
					})
				}
			}
		}

		// Add current working directory disk info
		const cwdDisk = await getDiskInfoForPath(cwd)
		if (!disks.some((d) => d.path === cwdDisk.path)) {
			disks.push(cwdDisk)
		}

		const totalSize = disks.reduce((sum, d) => sum + d.size, 0)
		const totalUsed = disks.reduce((sum, d) => sum + d.used, 0)
		const avgUsage = disks.length > 0 ? disks.reduce((sum, d) => sum + d.usagePercent, 0) / disks.length : 0

		return {
			disks,
			summary: {
				totalDisks: disks.length,
				totalSizeGB: Math.round(totalSize / (1024 * 1024 * 1024)),
				totalUsedGB: Math.round(totalUsed / (1024 * 1024 * 1024)),
				avgUsagePercent: Math.round(avgUsage * 100) / 100,
			},
		}
	} catch (e) {
		return {
			disks: [],
			summary: { error: "Failed to get disk information" },
		}
	}
}

async function getDiskInfoForPath(targetPath: string): Promise<DiskInfo> {
	try {
		const stats = await fs.statfs(targetPath)
		const blockSize = (stats as any).bavail ? (stats as any).bsize || 1024 : 1024
		const total = (stats as any).blocks * blockSize
		const free = (stats as any).bavail * blockSize
		const used = total - free

		return {
			path: targetPath,
			size: total,
			used,
			available: free,
			usagePercent: total > 0 ? (used / total) * 100 : 0,
		}
	} catch (e) {
		// Fallback for systems without statfs
		return {
			path: targetPath,
			size: 0,
			used: 0,
			available: 0,
			usagePercent: 0,
		}
	}
}

function parseHumanSize(sizeStr: string): number {
	const match = sizeStr.match(/^(\d+(?:\.\d+)?)(K|M|G|T)?/)
	if (!match) return 0

	const [, numberStr, unit] = match
	const number = parseFloat(numberStr)

	const multipliers = { K: 1024, M: 1024 ** 2, G: 1024 ** 3, T: 1024 ** 4 }
	const multiplier = multipliers[unit as keyof typeof multipliers] || 1

	return Math.round(number * multiplier)
}

async function getNetworkInfo(): Promise<{ connectivity: any; latency: any; summary: any }> {
	const results = {
		connectivity: {},
		latency: {},
		summary: {},
	}

	try {
		// Test connectivity to common endpoints
		const endpoints = [
			"8.8.8.8", // Google DNS
			"1.1.1.1", // Cloudflare DNS
		]

		const connectivityTests = await Promise.allSettled(
			endpoints.map(async (endpoint) => {
				const startTime = performance.now()
				try {
					await exec(`ping -c 1 -W 1000 ${endpoint}`, { timeout: 5000 })
					const latency = performance.now() - startTime
					return { endpoint, success: true, latency }
				} catch (e) {
					return { endpoint, success: false, error: String(e) }
				}
			}),
		)

		results.connectivity = Object.fromEntries(
			connectivityTests.map((result, index) => [
				endpoints[index],
				result.status === "fulfilled" ? result.value : { success: false, error: "Test failed" },
			]),
		)

		const successfulTests = connectivityTests.filter((r) => r.status === "fulfilled" && r.value.success).length

		results.summary = {
			endpointsTested: endpoints.length,
			successful: successfulTests,
			status: successfulTests === 0 ? "offline" : successfulTests < endpoints.length ? "partial" : "online",
		}
	} catch (e) {
		results.summary = { error: "Network test failed" }
	}

	return results
}

async function getPerformanceMetrics(): Promise<any> {
	const cpuUsage = process.cpuUsage()
	const memUsage = process.memoryUsage()

	return {
		cpu: {
			user: cpuUsage.user,
			system: cpuUsage.system,
		},
		memory: {
			heapUsedMB: Math.round(memUsage.heapUsed / (1024 * 1024)),
			heapTotalMB: Math.round(memUsage.heapTotal / (1024 * 1024)),
			rssMB: Math.round(memUsage.rss / (1024 * 1024)),
			externalMB: Math.round(memUsage.external / (1024 * 1024)),
		},
		uptime: process.uptime(),
		nodeVersion: process.version,
		platform: `${process.platform} ${process.arch}`,
	}
}

async function getProcessCount(): Promise<number> {
	try {
		if (process.platform === "win32") {
			const { stdout } = await exec("tasklist /fo csv")
			return stdout.split("\n").length - 2 // Subtract header and empty line
		} else {
			const { stdout } = await exec("ps aux")
			return stdout.split("\n").length - 2 // Subtract header and empty line
		}
	} catch (e) {
		return 0
	}
}

async function getCompleteSystemInfo(cwd: string, alertThresholds?: string): Promise<any> {
	const [health, processes, disk, network, performance] = await Promise.allSettled([
		performHealthCheck(cwd, alertThresholds),
		getProcessInfo(),
		getDiskInfo(cwd),
		getNetworkInfo(),
		getPerformanceMetrics(),
	])

	return {
		health: health.status === "fulfilled" ? health.value : { error: "Health check failed" },
		processes: processes.status === "fulfilled" ? processes.value : { error: "Process info failed" },
		disk: disk.status === "fulfilled" ? disk.value : { error: "Disk info failed" },
		network: network.status === "fulfilled" ? network.value : { error: "Network info failed" },
		performance: performance.status === "fulfilled" ? performance.value : { error: "Performance info failed" },
		timestamp: new Date().toISOString(),
		platform: process.platform,
		nodeVersion: process.version,
	}
}

function formatDiagnosticsOutput(
	result: any,
	checkType: string,
	summary: string,
	includeRecommendations: boolean,
): string {
	let output = `🔍 System Diagnostics: ${checkType}\n\n`
	output += `📊 ${summary}\n\n`

	switch (checkType) {
		case "health":
			const health = result as SystemHealth
			const statusIcon = health.status === "healthy" ? "✅" : health.status === "warning" ? "⚠️" : "🚨"

			output += `${statusIcon} Overall Status: ${health.status.toUpperCase()} (${health.score}/100)\n\n`

			// Group checks by category
			const categories = [...new Set(health.checks.map((c) => c.category))]
			for (const category of categories) {
				const categoryChecks = health.checks.filter((c) => c.category === category)
				output += `📋 ${category.toUpperCase()}:\n`

				for (const check of categoryChecks) {
					const checkIcon = check.status === "pass" ? "✅" : check.status === "warn" ? "⚠️" : "❌"
					output += `  ${checkIcon} ${check.name}: ${check.message}\n`
				}
				output += "\n"
			}

			if (includeRecommendations && health.recommendations.length > 0) {
				output += `💡 Recommendations:\n`
				health.recommendations.forEach((rec, index) => {
					output += `  ${index + 1}. ${rec}\n`
				})
			}
			break

		case "processes":
			output += `📊 Top Processes by Memory:\n`
			const processes = result.processes.slice(0, 10)
			for (const proc of processes) {
				output += `  • ${proc.name} (PID: ${proc.pid}) - ${Math.round(proc.memory)}MB\n`
			}
			break

		case "disk":
			output += `💾 Disk Usage:\n`
			for (const disk of result.disks) {
				const sizeGB = Math.round(disk.size / (1024 * 1024 * 1024))
				const usedGB = Math.round(disk.used / (1024 * 1024 * 1024))
				const freeGB = Math.round(disk.available / (1024 * 1024 * 1024))

				output += `  • ${disk.path}: ${disk.usagePercent.toFixed(1)}% used (${usedGB}/${sizeGB}GB, ${freeGB}GB free)\n`
			}
			break

		default:
			output += JSON.stringify(result, null, 2)
	}

	return output
}

function formatAsTable(result: any, checkType: string): string {
	// Simple table formatting for structured data
	switch (checkType) {
		case "health":
			const health = result as SystemHealth
			let table = "Category | Check | Status | Value | Message\n"
			table += "---------|-------|--------|-------|--------\n"

			for (const check of health.checks) {
				table += `${check.category} | ${check.name} | ${check.status} | ${check.value || "N/A"} | ${check.message}\n`
			}

			return table

		case "processes":
			let procTable = "PID | Name | CPU% | Memory(MB) | Status\n"
			procTable += "----|------|------|-----------|-------\n"

			for (const proc of result.processes.slice(0, 20)) {
				procTable += `${proc.pid} | ${proc.name} | ${proc.cpu.toFixed(1)} | ${Math.round(proc.memory)} | ${proc.status}\n`
			}

			return procTable

		default:
			return JSON.stringify(result, null, 2)
	}
}
