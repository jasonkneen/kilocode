import { build } from 'esbuild'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const projectRoot = path.resolve(__dirname, '..')
const repoRoot = path.resolve(projectRoot, '../..')

const result = await build({
  entryPoints: [path.join(projectRoot, 'src/index.ts')],
  outfile: path.join(projectRoot, 'dist/cli.cjs'),
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  sourcemap: true,
  metafile: true,
  banner: {},
  external: [],
  plugins: [
    {
      name: 'alias-vscode',
      setup(build) {
        build.onResolve({ filter: /^vscode$/ }, args => {
          return { path: path.join(projectRoot, 'src/shims/vscode.ts') }
        })
      },
    },
    {
      name: 'alias-workspace-pkgs',
      setup(build) {
        build.onResolve({ filter: /^@roo-code\/types$/ }, () => ({
          path: path.join(repoRoot, 'packages/types/src/index.ts')
        }))
        build.onResolve({ filter: /^@roo-code\/telemetry$/ }, () => ({
          path: path.join(projectRoot, 'src/shims/telemetry.ts')
        }))
      }
    },
    {
      name: 'mcp-externals',
      setup(build) {
        // Make MCP SDK modules external to avoid bundling issues
        build.onResolve({ filter: /^@modelcontextprotocol\/sdk\/client\/.*\.js$/ }, () => ({ external: true }))
        build.onResolve({ filter: /^@modelcontextprotocol\/sdk\/types\.js$/ }, () => ({ external: true }))
        build.onResolve({ filter: /^ignore$/ }, () => ({ external: true }))
        // Externalize tiktoken to avoid WASM bundling issues
        build.onResolve({ filter: /^tiktoken$/ }, () => ({ external: true }))
      }
    },
    {
      name: 'alias-third-party-shims',
      setup(build) {
        build.onResolve({ filter: /^sanitize-filename$/ }, () => ({
          path: path.join(projectRoot, 'src/shims/sanitize-filename.ts')
        }))
        build.onResolve({ filter: /^ollama$/ }, () => ({
          path: path.join(projectRoot, 'src/shims/ollama.ts')
        }))
        // Redirect countTokens to CLI shim  
        build.onResolve({ filter: /.*\/utils\/countTokens$/ }, () => ({
          path: path.join(projectRoot, 'src/shims/countTokens.ts')
        }))
        build.onResolve({ filter: /^countTokens$/ }, () => ({
          path: path.join(projectRoot, 'src/shims/countTokens.ts')
        }))
        // Redirect internal safeWriteJson to a simplified version
        build.onResolve({ filter: /.*/ }, args => {
          // Map relative imports to safeWriteJson from fetchers
          if ((args.path === '../../../utils/safeWriteJson' || args.path === '../../../../utils/safeWriteJson') &&
              /src\/(api\/providers\/fetchers\/|core\/)/.test(args.importer)) {
            return { path: path.join(projectRoot, 'src/shims/safeWriteJson.ts') }
          }
          // Map relative imports to countTokens
          if ((args.path === '../../utils/countTokens' || args.path === '../../../utils/countTokens') &&
              /src\/api\/providers\//.test(args.importer)) {
            return { path: path.join(projectRoot, 'src/shims/countTokens.ts') }
          }
          // Map fetchers/lmstudio to a shim
          if (
            args.path.endsWith('/fetchers/lmstudio') ||
            args.path.endsWith('/fetchers/lmstudio.ts') ||
            (args.path === './lmstudio' && /src\/api\/providers\/fetchers\/modelCache\.ts$/.test(args.importer))
          ) {
            return { path: path.join(projectRoot, 'src/shims/lmstudio-fetcher.ts') }
          }
          // Do not externalize exceljs; a dedicated alias maps it to a shim
          return null
        })
      }
    },
    {
      name: 'alias-root',
      setup(build) {
        // Allow imports from repo src via alias 'repo-src/*'
        build.onResolve({ filter: /^repo-src\/(.*)$/ }, args => {
          return { path: path.join(repoRoot, 'src', args.path.replace(/^repo-src\//, '')) }
        })
      },
    },
    {
      name: 'alias-i18n-exceljs',
      setup(build) {
        // Redirect src/i18n/index.ts -> './setup' import to shim
        build.onResolve({ filter: /^\.\/setup$/ }, args => {
          if (args.importer.endsWith(path.join('src','i18n','index.ts'))) {
            return { path: path.join(projectRoot, 'src/shims/i18n-setup.ts') }
          }
          return null
        })
        build.onResolve({ filter: /^exceljs$/ }, () => ({ path: path.join(projectRoot, 'src/shims/exceljs.ts') }))
      }
    },
  ],
})

console.log('Built apps/cli -> dist/cli.cjs')

// Write metafile for debugging
import { writeFileSync } from 'node:fs'
writeFileSync(path.join(projectRoot, 'dist/meta.json'), JSON.stringify(result.metafile, null, 2))

// Ensure bin files are executable
import { chmodSync } from 'node:fs'
try { chmodSync(path.join(projectRoot, 'bin/kilo'), 0o755) } catch {}
try { chmodSync(path.join(projectRoot, 'bin/kilocode'), 0o755) } catch {}
