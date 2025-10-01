# Kilo Code - Tauri App

Tauri desktop application wrapper for Kilo Code.

## Prerequisites

- Rust toolchain (install from https://rustup.rs/)
- System dependencies for Tauri:
    - **macOS**: Xcode Command Line Tools
    - **Linux**: `webkit2gtk`, `libgtk-3-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev`
    - **Windows**: WebView2 (usually pre-installed on Windows 10/11)

## Development

```bash
# Install dependencies
pnpm install

# Run in development mode
pnpm dev
```

## Building

```bash
# Build production app
pnpm build
```

The built application will be in `src-tauri/target/release/bundle/`.

## Features

- Lighter weight than Electron (~600KB vs ~150MB runtime)
- Better performance and lower memory usage
- Native system integration using Rust
- Shares the same webview-ui as the Electron and VS Code extension versions
- Uses webview's built-in **web backend mode** (no Rust backend needed)

## Provider Support

Tauri runs in web mode and supports these providers via direct API calls:

- ✅ **OpenAI** - Configure with API key
- ✅ **Anthropic** - Configure with API key
- ✅ **OpenRouter** - Configure with API key
- ✅ **Google Gemini** - Configure with API key
- ✅ Other API-based providers

**Note**: The `claude-code` provider (Claude CLI) is not supported in Tauri - use the Electron app or VS Code extension for that.

## Architecture

- **Frontend**: Shares `../../webview-ui` with Electron app
- **Backend**: Uses webview-ui's built-in web/browser mode with mock responses
- **No IPC needed**: Webview runs standalone with localStorage for state
- **Rust**: Minimal - just the Tauri window wrapper, no backend logic required
