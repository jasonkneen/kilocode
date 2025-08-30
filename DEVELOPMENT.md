# Kilo Code Development Guide

Welcome to the Kilo Code development guide! This document will help you set up your development environment and understand how to work with the codebase. Whether you're fixing bugs, adding features, or just exploring the code, this guide will get you started.

## Prerequisites

Before you begin, make sure you have the following installed:

1. **Git** - For version control
2. **Node.js** (version [v20.19.2](https://github.com/Kilo-Org/kilocode/blob/main/.nvmrc) recommended)
3. **pnpm** - Package manager (https://pnpm.io/)
4. **Visual Studio Code** - Our recommended IDE for development

## Getting Started

### Installation

1. **Fork and Clone the Repository**:

    - **Fork the Repository**:
        - Visit the [Kilo Code GitHub repository](https://github.com/Kilo-Org/kilocode)
        - Click the "Fork" button in the top-right corner to create your own copy.
    - **Clone Your Fork**:
        ```bash
        git clone https://github.com/[YOUR-USERNAME]/kilocode.git
        cd kilocode
        ```
        Replace `[YOUR-USERNAME]` with your actual GitHub username.

2. **Install dependencies**:

    ```bash
    pnpm install
    ```

    This command will install dependencies for the main extension, webview UI, and e2e tests.

3. **Install VSCode Extensions**:
    - **Required**: [ESBuild Problem Matchers](https://marketplace.visualstudio.com/items?itemName=connor4312.esbuild-problem-matchers) - Helps display build errors correctly.

While not strictly necessary for running the extension, these extensions are recommended for development:

- [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint) - Integrates ESLint into VS Code.
- [Prettier - Code formatter](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode) - Integrates Prettier into VS Code.

The full list of recommended extensions is [here](https://github.com/Kilo-Org/kilocode/blob/main/.vscode/extensions.json)

### Project Structure

The project is organized into several key directories:

- **`src/`** - Core extension code
    - **`core/`** - Core functionality and tools
    - **`services/`** - Service implementations
- **`apps/`** - Applications and tooling
    - **`cli/`** - Complete CLI tool implementation
    - **`web-roo-code/`** - Next.js web interface
    - **`storybook/`** - Component library
    - **`vscode-e2e/`**, **`playwright-e2e/`** - End-to-end tests
- **`packages/`** - Shared packages
    - **`types/`** - Shared TypeScript types
    - **`config-*/`** - Build configurations
- **`webview-ui/`** - Frontend UI code
- **`scripts/`** - Utility scripts
- **`assets/`** - Static assets like images and icons

## Development Workflow

### Running the Extension

To run the extension in development mode:

1. Press `F5` (or select **Run** → **Start Debugging**) in VSCode
2. This will open a new VSCode window with Kilo Code loaded

### Hot Reloading

- **Webview UI changes**: Changes to the webview UI will appear immediately without restarting
- **Core extension changes**: Changes to the core extension code will automatically reload the ext host

In development mode (NODE_ENV="development"), changing the core code will trigger a `workbench.action.reloadWindow` command, so it is no longer necessary to manually start/stop the debugger and tasks.

> **Important**: In production builds, when making changes to the core extension, you need to:
>
> 1. Stop the debugging process
> 2. Kill any npm tasks running in the background (see screenshot below)
> 3. Start debugging again

<img width="600" alt="Stopping background tasks" src="https://github.com/user-attachments/assets/466fb76e-664d-4066-a3f2-0df4d57dd9a4" />

### Building the Extension

To build a production-ready `.vsix` file:

```bash
pnpm build
```

This will:

1. Build the webview UI
2. Compile TypeScript
3. Bundle the extension
4. Create a `.vsix` file in the `bin/` directory

### Installing the Built Extension

To install your built extension:

```bash
code --install-extension "$(ls -1v bin/kilo-code-*.vsix | tail -n1)"
```

Replace `[version]` with the current version number.

## Testing

Kilo Code uses several types of tests to ensure quality:

### Unit Tests

Run unit tests with:

```bash
pnpm test
```

This runs both extension and webview tests.

### End-to-End Tests

For more details on E2E tests, see [apps/vscode-e2e](apps/vscode-e2e/).

## CLI Tool Development

### **Complete CLI Implementation**

The repository includes a **production-ready CLI tool** at `apps/cli/` that provides full feature parity with the VS Code extension for headless environments.

### **Building the CLI**

```bash
# Navigate to CLI directory
cd apps/cli

# Install dependencies (if not already done from root)
pnpm install

# Development mode
npm run dev          # Run with tsx for live reloading

# Production build
npm run build        # Creates dist/cli.cjs

# Build and run
npm run start        # Build then execute

# Global installation
npm link            # Makes 'kilocode' and 'kilo' available globally
```

### **CLI Architecture**

The CLI reuses **85% of the main codebase** through carefully designed imports:

**Shared Components:**

- **API Providers** (`src/api/providers/*`) - All 10+ provider implementations
- **Tool Definitions** (`src/core/prompts/tools/*`) - All tool descriptions and logic
- **Core Logic** (`src/core/task/*`, `src/core/diff/*`) - Task execution engine
- **Types System** (`packages/types/*`) - Full type definitions

**CLI-Specific Files:**

- `src/index.ts` - Main CLI application with terminal UI
- `src/api.ts` - API handler factory for providers
- `src/tool-runner.ts` - Tool execution implementations
- `src/mcp.ts` - MCP server integration
- `src/collapser.ts` - Terminal output management
- `src/shims/*` - VS Code API compatibility layer

### **CLI Features**

**Provider Support (10 providers):**

- OpenRouter, Kilocode, Anthropic, OpenAI, Groq, Gemini
- Ollama, LM Studio, Google Vertex AI, AWS Bedrock, Fireworks, Featherless

**Tool Coverage (16 tools):**

- File operations: read, write, insert, list, search
- Code analysis: codebase search, definition listing
- Interactive: questions, completion, task management
- Advanced: MCP integration, mode switching

**Configuration Management:**

- **VS Code Integration**: Auto-detects and uses VS Code global storage
- **Environment Variables**: Scans for all provider API keys
- **Interactive Setup**: `/setup` wizard for configuration overview
- **MCP Settings**: Shares MCP servers with VS Code extension

**Terminal Features:**

- **Real-time Streaming**: Character-by-character response display
- **Rich UI**: ASCII banner, collapsible sections, themes
- **Command System**: 23 slash commands with tab completion
- **Session Management**: Save/restore conversations with metadata

### **Testing the CLI**

```bash
# Test basic functionality
node dist/cli.cjs --provider openai

# Test configuration
/setup               # Run setup wizard
/env                # Check environment variables
/test connection    # Test provider connectivity

# Test tools
> list files in this directory
> search for "function" in all TypeScript files
> what functions are defined in src/index.ts?

# Test advanced features
/provider anthropic  # Switch providers
/mode architect     # Switch modes
/fold off          # Disable output folding
/theme mono        # Switch to monochrome theme
```

### **CLI vs Extension Benefits**

| Feature            | VS Code Extension   | CLI Tool                |
| ------------------ | ------------------- | ----------------------- |
| **Environment**    | GUI required        | Headless capable        |
| **Server Usage**   | Not suitable        | Perfect for servers     |
| **Automation**     | Limited             | Full script integration |
| **Resource Usage** | High (GUI overhead) | Low (terminal only)     |
| **Startup Time**   | ~5-10 seconds       | <2 seconds              |
| **Remote Usage**   | Requires display    | SSH/terminal friendly   |

The CLI provides the **full Kilocode experience** optimized for command-line environments!

## Linting and Type Checking

Ensure your code meets our quality standards:

```bash
pnpm lint          # Run ESLint
pnpm check-types   # Run TypeScript type checking
```

## Git Hooks

This project uses [Husky](https://typicode.github.io/husky/) to manage Git hooks, which automate certain checks before commits and pushes. The hooks are located in the `.husky/` directory.

### Pre-commit Hook

Before a commit is finalized, the `.husky/pre-commit` hook runs:

1.  **Branch Check**: Prevents committing directly to the `main` branch.
2.  **Type Generation**: Runs `pnpm --filter kilo-code generate-types`.
3.  **Type File Check**: Ensures that any changes made to `src/exports/roo-code.d.ts` by the type generation are staged.
4.  **Linting**: Runs `lint-staged` to lint and format staged files.

### Pre-push Hook

Before changes are pushed to the remote repository, the `.husky/pre-push` hook runs:

1.  **Branch Check**: Prevents pushing directly to the `main` branch.
2.  **Compilation**: Runs `pnpm run check-types` to ensure typing is correct.
3.  **Changeset Check**: Checks if a changeset file exists in `.changeset/` and reminds you to create one using `npm run changeset` if necessary.

These hooks help maintain code quality and consistency. If you encounter issues with commits or pushes, check the output from these hooks for error messages.

## Troubleshooting

### Common Issues

1. **Extension not loading**: Check the VSCode Developer Tools (Help > Toggle Developer Tools) for errors
2. **Webview not updating**: Try reloading the window (Developer: Reload Window)
3. **Build errors**: Make sure all dependencies are installed with `pnpm install`

### Debugging Tips

- Use `console.log()` statements in your code for debugging
- Check the Output panel in VSCode (View > Output) and select "Kilo Code" from the dropdown
- For webview issues, use the browser developer tools in the webview (right-click > "Inspect Element")

## Contributing

We welcome contributions to Kilo Code! Here's how you can help:

1. **Report an issue** using [GitHub Issues](https://github.com/Kilo-Org/kilocode/issues)
2. **Find an issue** and submit a Pull Request with your fix
3. **Write tests** to improve Code Coverage
4. **Improve Documentation** at [kilocode.ai/docs](https://kilocode.ai/docs)
5. **Suggest a new feature** using [GitHub Discussions](https://github.com/Kilo-Org/kilocode/discussions/categories/ideas)!
6. Want to **implement something new**? Awesome! We'd be glad to support you on [Discord](https://discord.gg/Ja6BkfyTzJ)!

## Community

Your contributions are welcome! For questions or ideas, please join our Discord server: https://discord.gg/Ja6BkfyTzJ

We look forward to your contributions and feedback!
