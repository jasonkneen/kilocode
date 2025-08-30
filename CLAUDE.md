# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build Commands

- **Build VSIX**: `pnpm build` - Creates production .vsix file for VS Code extension
- **Development Build**: `pnpm bundle` - Development build without packaging
- **Nightly Build**: `pnpm bundle:nightly` - Nightly version build
- **Install Built Extension**: `pnpm install:vsix` - Build and install extension locally
- **Test**: `pnpm test` - Run unit tests across all packages
- **Lint**: `pnpm lint` - Run ESLint across monorepo
- **Type Check**: `pnpm check-types` - Run TypeScript type checking
- **Format**: `pnpm format` - Check code formatting with Prettier
- **Clean**: `pnpm clean` - Clean all build artifacts
- **Run Single Test**: Use vitest CLI in specific package directory

## Project Architecture

### Monorepo Structure

This is a pnpm monorepo with Turbo build orchestration:

- **`src/`** - Core VS Code extension code (TypeScript)
- **`apps/`** - Applications (web interfaces, E2E tests, CLI)
    - `web-roo-code/` - Next.js web interface
    - `web-evals/` - Evaluation dashboard
    - `storybook/` - Component library
    - `playwright-e2e/`, `vscode-e2e/` - End-to-end tests
    - `kilocode-docs/` - Docusaurus documentation
- **`packages/`** - Shared packages
    - `types/` - Shared TypeScript types
    - `config-typescript/`, `config-eslint/` - Shared configs
    - `telemetry/` - Telemetry service
    - `ipc/` - Inter-process communication

### Core Extension Architecture

The extension follows a modular architecture centered around:

- **`src/core/kilocode.ts`** - Main task execution engine
- **`src/core/task/Task.ts`** - Task lifecycle management
- **`src/core/prompts/`** - System prompt construction and tool definitions
- **`src/core/tools/`** - AI tool implementations (file operations, commands, etc.)
- **`src/api/`** - LLM provider integrations (Anthropic, OpenAI, etc.)
- **`src/services/`** - Extension services (MCP, telemetry, etc.)

### Key Systems

**AI Model Integration**:

- Supports multiple providers (Anthropic Claude, OpenAI, Vertex AI, etc.)
- Configurable via provider settings with API key management
- Streaming responses with token usage tracking

**Tool System**:

- Modular tool definitions in `src/core/prompts/tools/`
- Tools include file operations, command execution, browser automation
- MCP (Model Context Protocol) server integration for extensibility

**Mode System**:

- Different operational modes (Architect, Coder, Debugger, etc.)
- Custom mode creation via YAML configuration
- Mode-specific tool availability and prompting

**Ignore System**:

- `.rooignore` file support for excluding files/directories
- Security controls to prevent access to sensitive files
- Configurable via `src/core/ignore/RooIgnoreController.ts`

## Development Workflow

### Code Style Requirements

- **TypeScript**: Strict mode enabled, explicit return types required
- **ESLint**: Uses custom config from `@roo-code/config-eslint`
- **Prettier**: 2-space indentation, trailing commas, no semicolons
- **Testing**: Vitest for unit tests, Playwright for E2E

### Kilocode Change Marking

This is a fork of Roo Code. All Kilocode-specific changes must be marked with comments:

```typescript
// Single line changes
let i = 2 // kilocode_change

// Multi-line changes
// kilocode_change start
let i = 2
let j = 3
// kilocode_change end

// New files
// kilocode_change - new file
```

### Git Hooks

- **Pre-commit**: Branch protection, type generation, linting
- **Pre-push**: Type checking, changeset validation
- Uses Husky for hook management

## Key Dependencies

- **VS Code Extension API**: Primary platform
- **pnpm + Turbo**: Package management and build orchestration
- **TypeScript**: Primary language with strict configuration
- **Vitest**: Unit testing framework
- **ESBuild**: Fast bundling for extension
- **Anthropic SDK**: Claude API integration
- **OpenAI SDK**: GPT model integration

## Testing Strategy

- **Unit Tests**: Located alongside source files (`__tests__/` directories)
- **E2E Tests**: VS Code extension testing in `apps/vscode-e2e/`
- **Web E2E**: Playwright tests in `apps/playwright-e2e/`
- **Coverage**: Test coverage tracking enabled

## CLI Tool Architecture

### **Complete CLI Implementation Available**

The repository includes a **complete CLI tool** at `apps/cli/` that provides full feature parity with the VS Code extension for headless environments.

### **CLI vs Extension Comparison**

| Feature                  | VS Code Extension | CLI Tool                  | Status      |
| ------------------------ | ----------------- | ------------------------- | ----------- |
| **Providers**            | 15+ providers     | 10 major providers        | ✅ Complete |
| **Core Tools**           | 43 total tools    | 16 essential tools        | ✅ Complete |
| **Project Intelligence** | Full indexing     | Smart search + .rooignore | ✅ Complete |
| **MCP Integration**      | Full support      | Full support              | ✅ Complete |
| **Configuration**        | GUI settings      | CLI commands + env vars   | ✅ Complete |
| **Streaming**            | Real-time         | Real-time streaming       | ✅ Complete |

### **CLI Architecture Details**

- **Shared Codebase**: 85% shared with VS Code extension via relative imports
- **Provider System**: All major API providers (OpenAI, Anthropic, Groq, Gemini, etc.)
- **Tool System**: Complete tool implementation with semantic search and code analysis
- **Settings Integration**: Auto-detects VS Code settings and environment variables
- **Monorepo Benefits**: Instant updates when core features are added to extension

### **CLI Build Commands**

```bash
# Navigate to CLI
cd apps/cli

# Development
npm run dev          # Run with tsx for development
npm run build        # Build production CLI
npm run start        # Build and run
npm link            # Install globally as 'kilocode' and 'kilo'

# Usage
kilocode --provider openai --model gpt-4o
kilocode --provider anthropic --model claude-3-5-sonnet-20241022
kilocode --provider lmstudio --model local-model
```

### **CLI Configuration**

- **Environment Variables**: Auto-detects all provider API keys
- **VS Code Integration**: Reads global storage for provider profiles and MCP servers
- **Interactive Setup**: `/setup` wizard for configuration overview
- **Real-time Streaming**: Character-by-character response streaming
- **Rich Terminal UI**: Collapsible sections, themes, auto-features

## Extension Development Notes

- **Development**: Use F5 in VS Code to launch extension host
- **Hot Reload**: Webview changes reload automatically; core changes trigger window reload
- **Debugging**: Use VS Code Developer Tools and output panel
- **VSIX Creation**: `pnpm build` creates installable package in `bin/`

## Package Manager Requirements

- **Node.js**: Version 20.19.2 (see .nvmrc)
- **pnpm**: Required package manager (version 10.8.1)
- **VS Code**: Required for extension development and testing

## CLI Tool Requirements

- **Node.js**: Version 20.19.2+
- **Environment Variables**: API keys for desired providers
- **Optional**: VS Code installation for settings sync
