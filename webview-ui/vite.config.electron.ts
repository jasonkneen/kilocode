import path, { resolve } from "path"
import fs from "fs"
import { execSync } from "child_process"

import { defineConfig, type PluginOption, type Plugin } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { sourcemapPlugin } from "./src/vite-plugins/sourcemapPlugin"

function getGitSha() {
	let gitSha: string | undefined = undefined

	try {
		gitSha = execSync("git rev-parse HEAD").toString().trim()
	} catch (_error) {
		// Do nothing.
	}

	return gitSha
}

const wasmPlugin = (): Plugin => ({
	name: "wasm",
	async load(id) {
		if (id.endsWith(".wasm")) {
			const wasmBinary = await import(id)

			return `
          			const wasmModule = new WebAssembly.Module(${wasmBinary.default});
          			export default wasmModule;
        		`
		}
	},
})

// Electron-specific configuration
export default defineConfig(({ mode }) => {
	// For Electron, we build to a different directory
	const outDir = "../apps/electron-app/webview-ui"

	// kilocode_change start - read package.json fresh every time to avoid caching issues
	const getPkg = () => {
		try {
			return JSON.parse(fs.readFileSync(path.join(__dirname, "..", "src", "package.json"), "utf8"))
		} catch (error) {
			throw new Error(`Could not read package.json: ${error}`)
		}
	}

	const pkg = getPkg()
	// kilocode_change end
	const gitSha = getGitSha()

	const define: Record<string, any> = {
		"process.platform": JSON.stringify(process.platform),
		"process.env.VSCODE_TEXTMATE_DEBUG": JSON.stringify(process.env.VSCODE_TEXTMATE_DEBUG),
		"process.env.PKG_NAME": JSON.stringify(pkg.name),
		"process.env.PKG_VERSION": JSON.stringify(pkg.version),
		"process.env.PKG_OUTPUT_CHANNEL": JSON.stringify("Kilo-Code"),
		// Electron-specific defines
		"process.env.IS_ELECTRON": JSON.stringify(true),
		...(gitSha ? { "process.env.PKG_SHA": JSON.stringify(gitSha) } : {}),
	}

	const plugins: PluginOption[] = [react(), tailwindcss(), wasmPlugin(), sourcemapPlugin()]

	return {
		plugins,
		base: "./", // Important for Electron - use relative paths
		resolve: {
			alias: {
				"@": resolve(__dirname, "./src"),
				"@src": resolve(__dirname, "./src"),
				"@roo": resolve(__dirname, "../src/shared"),
			},
		},
		build: {
			outDir,
			emptyOutDir: true,
			reportCompressedSize: false,
			// Generate source maps for debugging
			sourcemap: true,
			minify: mode === "production" ? "esbuild" : false,
			rollupOptions: {
				// Remove VS Code specific externals for Electron
				output: {
					entryFileNames: `assets/[name].js`,
					chunkFileNames: (chunkInfo) => {
						if (chunkInfo.name === "mermaid-bundle") {
							return `assets/mermaid-bundle.js`
						}
						return `assets/chunk-[hash].js`
					},
					assetFileNames: (assetInfo) => {
						if (
							assetInfo.name &&
							(assetInfo.name.endsWith(".woff2") ||
								assetInfo.name.endsWith(".woff") ||
								assetInfo.name.endsWith(".ttf"))
						) {
							return "assets/fonts/[name][extname]"
						}
						if (assetInfo.name && assetInfo.name.endsWith(".map")) {
							return "assets/[name]"
						}
						return "assets/[name][extname]"
					},
					manualChunks: (id, { getModuleInfo }) => {
						if (
							id.includes("node_modules/mermaid") ||
							id.includes("node_modules/dagre") ||
							id.includes("node_modules/cytoscape")
						) {
							return "mermaid-bundle"
						}

						const moduleInfo = getModuleInfo(id)
						if (moduleInfo?.importers.some((importer) => importer.includes("node_modules/mermaid"))) {
							return "mermaid-bundle"
						}
						if (
							moduleInfo?.dynamicImporters.some((importer) => importer.includes("node_modules/mermaid"))
						) {
							return "mermaid-bundle"
						}
					},
				},
			},
		},
		define,
		optimizeDeps: {
			include: ["mermaid", "dagre"],
			exclude: ["@vscode/codicons", "vscode-oniguruma", "shiki"],
		},
		assetsInclude: ["**/*.wasm", "**/*.wav"],
	}
})
