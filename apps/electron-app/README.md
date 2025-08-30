# Kilo Code Electron App

This is an Electron wrapper for the Kilo Code webview-ui, allowing the VS Code extension interface to run as a standalone desktop application.

## Quick Start

From the repository root:

```bash
# Install dependencies for the electron app
pnpm electron:install

# Build and run the Electron app
pnpm electron:start
```

## Development

```bash
# Build the webview UI for Electron
cd webview-ui
pnpm build:electron

# Build the Electron main process
cd apps/electron-app
pnpm build

# Run the app
pnpm dev
```

## Build Distribution

```bash
# Create distributable packages
pnpm electron:dist
```

This will create platform-specific distributables in `apps/electron-app/build/`.

## Architecture

- **Main Process** (`src/main.ts`): Electron main process that creates the browser window and handles native OS integration
- **Preload Script** (`src/preload.ts`): Secure bridge between main process and renderer, exposes limited Electron APIs
- **Webview UI**: The same React application used in the VS Code extension, built with Electron-specific configuration

## Key Differences from VS Code Extension

1. **File Paths**: Uses relative paths instead of VS Code's webview protocol
2. **API Bridge**: Custom Electron API instead of VS Code webview messaging
3. **Security**: Content Security Policy configured for Electron environment
4. **Build Output**: Separate build process outputs to `webview-ui/` directory

## Available Commands

- `pnpm dev` - Run in development mode
- `pnpm build` - Build both main process and webview UI
- `pnpm start` - Build and start the application
- `pnpm pack` - Create unpacked application
- `pnpm dist` - Create distributable packages
- `pnpm clean` - Clean build artifacts

## Configuration

The app can be configured via:

- `package.json` build configuration for electron-builder
- `src/main.ts` for window and application settings
- `webview-ui/vite.config.electron.ts` for UI build configuration
