<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=kilocode.Kilo-Code"><img src="https://img.shields.io/visual-studio-marketplace/v/kilocode.Kilo-Code.svg?label=VS%20Code%20Marketplace" alt="VS Code Marketplace"></a>
  <a href="https://x.com/kilo_code"><img src="https://img.shields.io/twitter/follow/kilo_code?style=flat&logo=x&color=555" alt="X (Twitter)"></a>
  <a href="https://blog.kilocode.ai"><img src="https://img.shields.io/badge/Blog-555?style=flat&logo=substack&logoColor=white" alt="Substack Blog"></a>
  <a href="https://kilocode.ai/discord"><img src="https://img.shields.io/discord/1349288496988160052?style=flat&logo=discord&logoColor=white" alt="Discord"></a>
  <a href="https://www.reddit.com/r/kilocode/"><img src="https://img.shields.io/reddit/subreddit-subscribers/kilocode?style=flat&logo=reddit&logoColor=white" alt="Reddit"></a>
</p>

# 🚀 Kilo Code UNOFFICIAL CLI BRANCH 

> Open-source VS Code AI agent. We frequently merge features from open-source projects, such as [Roo Code](https://github.com/RooVetGit/Roo-Code) and [Cline](https://github.com/cline/cline), while building our own vision.

- ✨ Generate code from natural language
- ✅ Checks its own work
- 🧪 Run terminal commands
- 🌐 Automate the browser
- 🤖 Latest AI models
- 🎁 API keys optional
- 💡 **Get $25 in free credits: $5 when you sign up, $20 when you top-up for the first time** Credits can be used with 400+ models like Gemini 2.5 Pro, Claude 4 Sonnet & Opus, and GPT-5

<p align="center">
  <img src="https://raw.githubusercontent.com/Kilo-Org/kilocode/refs/heads/main/kilo.gif" width="100%" />
</p>

- [VS Code Marketplace](https://kilocode.ai/vscode-marketplace?utm_source=Readme) (download)
- [Official KiloCode.ai Home page](https://kilocode.ai) (learn more)

## Key Features

- **Code Generation:** Generate code using natural language.
- **Task Automation:** Automate repetitive coding tasks.
- **Automated Refactoring:** Refactor and improve existing code.
- **MCP Server Marketplace**: Easily find, and use MCP servers to extend the agent capabilities.
- **Multi Mode**: Plan with Architect, Code with Coder, and Debug with Debugger, and make your own custom modes.

## How to get started with Kilo Code

1.  Install the Kilo Code extension from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=kilocode.Kilo-Code).
2.  Sign up to get $5 in free credits which can be used with 400+ models like Gemini 2.5 Pro, Claude 4 Sonnet & Opus, and GPT-5
3.  Start using the extension. Here's a video to help you get started (just click on the image below and you'll be redirected to YouTube):

[![Watch the video](https://img.youtube.com/vi/pqGfYXgrhig/maxresdefault.jpg)](https://youtu.be/pqGfYXgrhig)

## Difference between Kilo Code, Roo Code and Cline

Kilo Code started as a fork of Roo Code, which itself is a fork of Cline. We frequently merge features from these open-source projects and contribute improvements back. Built on these foundations, Kilo Code is independently developed with our own vision for AI coding agents.

- No need to fiddle with API keys, Kilo Code ships with the latest AI models plugged in, including Gemini 2.5 Pro, Claude 4 Sonnet & Opus, and GPT-5
- MCP Server Marketplace: Easily find, and use MCP servers to extend the agent capabilities.
- Inline Assist (experimental)

Kilo Code is a direct fork from Roo Code, and also includes the following features from Cline (and our own features):

- System notifications: Get notified when the agent is done with a task.
- Easy model connection: with bigger free tier.
- Editing previous messages
- Assisted commit messages: we write git commit messages for you based on what changed

## CLI Tool

**🚀 Standalone CLI Package Available!**

Kilocode now includes a **production-ready CLI tool** that can be installed independently via npm:

```bash
# Install globally from npm (coming soon)
npm install -g @kilocode/cli

# Or build from source
cd apps/cli
npm run build
npm link

# Use anywhere
kilocode  # Interactive mode
kilo --provider openai --model gpt-4o
```

**CLI Features:**

- 🤖 **Multiple AI Providers**: Anthropic, OpenAI, Kilocode, Groq, Gemini, Ollama, LM Studio, and more
- 💬 **Natural Conversations**: Direct responses for simple queries, tools when needed
- 🔧 **Comprehensive Toolset**: File operations, command execution, codebase search
- 💾 **Session Management**: Persistent conversation history with restore functionality
- 🎨 **Professional UI**: Enhanced banner, real-time streaming, collapsed thinking blocks
- ⚙️ **MCP Integration**: Model Context Protocol server support
- 🎯 **Mode System**: Specialized modes for different development tasks
- 🔄 **State Persistence**: All settings (mode, model, theme) persist between launches
- 📦 **Standalone Package**: No VS Code dependency required

Perfect for **servers, automation, SSH environments, and power users** who prefer command-line interfaces!

For complete CLI documentation, see [apps/cli/README.md](apps/cli/README.md).

## Extension Development

For details on building and developing the extension, see [DEVELOPMENT.md](/DEVELOPMENT.md)
