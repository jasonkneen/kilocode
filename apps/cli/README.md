# @kilocode/cli

> Unofficial Kilo Code CLI - A powerful, standalone command-line interface for AI-assisted development

**Production-ready CLI tool with full feature parity to the VS Code extension.**

## Installation

### Global Installation (Recommended)

```bash
npm install -g @kilocode/cli
```

### Build from Source

```bash
cd apps/cli
npm run build
npm link
```

## Quick Start

```bash
# Interactive mode
kilocode

# Short alias
kilo

# Set your API provider
export ANTHROPIC_API_KEY="sk-ant-..."
# or
export OPENAI_API_KEY="sk-..."
# or login to Kilocode
kilocode
/login kilocode
```

## ✨ Key Features

### 🤖 **Multiple AI Providers**

- **Anthropic**: Claude 4 Sonnet, Claude 3.5 Sonnet, etc.
- **OpenAI**: GPT-4o, GPT-4, GPT-3.5 Turbo
- **Kilocode**: Access to 400+ models with free credits
- **Groq**: Lightning-fast inference
- **Google**: Gemini Pro, Gemini Flash
- **Local**: Ollama, LM Studio
- **Cloud**: OpenRouter, Fireworks, Featherless

### 💬 **Intelligent Conversation Flow**

- **Natural responses** for greetings and simple questions
- **Smart tool usage** only when tasks require action
- **Real-time streaming** with clean output formatting
- **Context-aware** responses that understand your project

### 🔧 **Comprehensive Development Toolset**

- **File Operations**: Read, write, edit, search across your codebase
- **Command Execution**: Run shell commands with full output capture
- **Codebase Intelligence**: Semantic search and code analysis
- **Project Management**: Todo lists, session management
- **Browser Automation**: Web interaction capabilities

### 🎨 **Professional User Interface**

- **Enhanced ASCII banner** with gradient colors and configuration display
- **Smart thinking display**: Shows meaningful previews, expandable with Ctrl+R
- **Session persistence**: All conversations saved and restorable
- **Clean alignment**: Professional formatting with consistent spacing
- **Theme support**: Default and mono themes

### ⚙️ **Advanced Features**

- **MCP Integration**: Model Context Protocol server support
- **Mode System**: Architect, Code, Debug, and custom modes
- **State Persistence**: Mode, model, theme settings persist between launches
- **VS Code Compatibility**: Automatic settings detection and import
- **Token Accuracy**: Context calculations match VS Code exactly

## 🎮 Interactive Commands

### Session Management

- `/clear` - Clear current conversation
- `/resume [id]` - List or load previous sessions
- `/status` - Show current configuration and stats

### Configuration

- `/provider <name>` - Switch AI provider
- `/model <id>` - Switch model
- `/mode <slug>` - Switch mode (architect, code, debug, etc.)
- `/login kilocode [token]` - Login to Kilocode platform
- `/setup` - Configuration wizard and environment check

### Utilities

- `/help` - Show all available commands
- `/models` - List available models for current provider
- `/usage` - Show detailed token usage graph
- `/test connection` - Test provider connectivity
- `/theme default|mono` - Switch color themes
- `!<command>` - Execute shell commands directly

## 🔌 Supported Providers

| Provider        | Environment Variable  | Models Available                      |
| --------------- | --------------------- | ------------------------------------- |
| **Anthropic**   | `ANTHROPIC_API_KEY`   | Claude 4 Sonnet, Claude 3.5 Sonnet    |
| **OpenAI**      | `OPENAI_API_KEY`      | GPT-4o, GPT-4, GPT-3.5 Turbo          |
| **Kilocode**    | `KILOCODE_TOKEN`      | 400+ models with free credits         |
| **Groq**        | `GROQ_API_KEY`        | Llama 3.1, Mixtral (ultra-fast)       |
| **Google**      | `GEMINI_API_KEY`      | Gemini Pro, Gemini Flash              |
| **OpenRouter**  | `OPENROUTER_API_KEY`  | 200+ models from various providers    |
| **Ollama**      | `OLLAMA_BASE_URL`     | Local models (Llama, CodeLlama, etc.) |
| **LM Studio**   | `LMSTUDIO_BASE_URL`   | Local models with GUI                 |
| **Fireworks**   | `FIREWORKS_API_KEY`   | Fast inference cloud                  |
| **Featherless** | `FEATHERLESS_API_KEY` | High-performance models               |

## 🏗️ Architecture

### Standalone Design

The CLI is completely self-contained:

- **📦 Bundled Executable**: 23MB bundle includes all dependencies
- **🔧 VS Code Shims**: Compatible interface without requiring VS Code extension
- **💾 Independent Storage**: File-based session and configuration persistence
- **🌐 MCP Support**: Built-in Model Context Protocol integration
- **🎨 Professional UI**: Enhanced banner, streaming, and interactive features

### Key Technical Features

- **Perfect Context Calculation**: Matches VS Code token accounting exactly
- **Smart Thinking Display**: Background accumulation with meaningful previews
- **State Persistence**: Mode, model, theme, and session data persist between launches
- **Horizontal-only UI**: Clean terminal layout without complex cursor management
- **Natural Conversation Flow**: Direct responses for simple queries, tools when needed

## 📋 Requirements

- **Node.js 18+**
- **API key** for chosen provider (or Kilocode account)
- **Terminal** with color support (recommended)

## 🚀 Getting Started

1. **Install**: `npm install -g @kilocode/cli`
2. **Setup**: Run `kilocode` and use `/setup` for configuration wizard
3. **Configure provider**: Use `/login kilocode` or set environment variables
4. **Start coding**: Ask questions, request file changes, run commands

## 📖 Example Usage

```bash
# Start interactive session
$ kilocode

# The CLI shows a professional banner with your configuration
# Then you can chat naturally:
> hello there
> read the package.json file
> create a simple todo app in HTML/CSS/JS
> /mode architect
> help me plan a new feature
```

## 🔄 Migration from VS Code

The CLI automatically detects VS Code settings and can import configurations:

```bash
/setup                    # Check for VS Code settings
/config import <path>     # Import VS Code configuration
```

## 📄 License

MIT

## ⚠️ Disclaimer

This is an unofficial CLI tool created by Jason Kneen as a passion project. It is not endorsed by or associated with the official Kilo Code.

---

## 🗺️ Development Roadmap

### ✅ Core Implementation (Completed)

- [x] **Runtime Stability**: Fixed initialization timing and memory management
- [x] **TypeScript Compilation**: Resolved all CLI-specific import/type errors
- [x] **VS Code Independence**: Complete standalone operation with shim architecture
- [x] **State Persistence**: Mode, model, theme, session data persist between launches
- [x] **Context Accuracy**: Perfect parity with VS Code token calculations
- [x] **Professional Banner**: Enhanced ASCII design with clean horizontal layout
- [x] **Smart Thinking Display**: Background content accumulation with meaningful previews
- [x] **Session Management**: Conversation history with restore functionality
- [x] **Multi-Provider Support**: 10+ AI providers with full configuration
- [x] **npm Distribution**: Production-ready package with global installation

### 🎨 UI/UX Enhancements (In Progress)

- [x] **Clean Streaming**: Removed post-response animations and timing issues
- [x] **Enhanced Collapser**: Real-time content updates with Ctrl+R expansion
- [x] **Perfect Alignment**: All configuration labels properly spaced
- [ ] **Advanced Animations**: Smooth progress indicators and loading states
- [ ] **Dynamic Layout**: Responsive terminal width adaptation
- [ ] **Enhanced Colors**: More sophisticated color schemes and gradients
- [ ] **Interactive Elements**: Clickable links and enhanced navigation
- [ ] **Status Indicators**: Real-time connection and processing status

### 🔧 Feature Enhancements

- [ ] **Enhanced Code Diffs**: Syntax highlighting for diff previews
- [ ] **Smart Auto-completion**: Context-aware command and file completion
- [ ] **Advanced Search**: Fuzzy file search and intelligent filtering
- [ ] **Plugin System**: Extensible architecture for custom tools
- [ ] **Configuration Profiles**: Multiple saved configurations for different projects
- [ ] **Enhanced MCP**: Advanced Model Context Protocol features and server management
- [ ] **Code Intelligence**: Advanced codebase analysis and suggestions
- [ ] **Performance Metrics**: Detailed timing and performance analytics

### 🧪 Testing & Quality

- [x] **Core Test Coverage**: Basic vitest framework integration
- [ ] **Comprehensive Test Suite**: Full feature coverage with integration tests
- [ ] **Performance Testing**: Load testing and memory profiling
- [ ] **Cross-Platform Testing**: Windows, macOS, Linux compatibility verification
- [ ] **Provider Testing**: Automated testing across all AI providers
- [ ] **E2E Testing**: End-to-end workflow validation
- [ ] **Regression Testing**: Automated testing for VS Code parity
- [ ] **Security Testing**: API key handling and data protection validation

### 🚀 Advanced Features

- [ ] **Multi-Session Management**: Parallel conversation handling
- [ ] **Workspace Intelligence**: Project-aware context and suggestions
- [ ] **Advanced Streaming**: Progressive enhancement and real-time collaboration
- [ ] **Performance Optimization**: Memory usage reduction and startup speed
- [ ] **Enhanced Logging**: Detailed debug logs and troubleshooting tools
- [ ] **API Rate Limiting**: Smart request management and queuing
- [ ] **Backup & Sync**: Cloud backup and cross-device synchronization
- [ ] **Team Features**: Shared sessions and collaborative development

### 📦 Distribution & Deployment

- [x] **npm Package**: Production-ready standalone package
- [ ] **CI/CD Pipeline**: Automated testing and release workflow
- [ ] **Docker Support**: Containerized deployment options
- [ ] **Homebrew Formula**: macOS package manager integration
- [ ] **Chocolatey Package**: Windows package manager support
- [ ] **APT/YUM Packages**: Linux distribution packages
- [ ] **GitHub Actions**: Integration workflow templates
- [ ] **Documentation Site**: Comprehensive online documentation

---

**💡 Tip**: Use `/help` in the CLI to see all available commands and features!

**🤝 Contributing**: This roadmap represents our vision for the CLI's future. Contributions and suggestions are welcome!
