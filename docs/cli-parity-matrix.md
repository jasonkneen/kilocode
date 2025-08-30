# CLI VSCode Parity Matrix

## Overview

This document maps the current VSCode extension capabilities to CLI equivalents and identifies implementation gaps for achieving feature parity.

## Current State Analysis

### VSCode Extension Capabilities (from Task.ts & ClineProvider.ts)

#### Task Management

- **Task Creation**: `new Task()` with full lifecycle support
- **Task Stack**: Hierarchical task management via `clineStack[]`
- **Task Events**: Rich event system via EventEmitter
- **Task Persistence**: Automatic saving of task state and history
- **Task Resume**: Resume from historical task states
- **Sub-tasks**: Parent-child relationships with pause/resume

#### Event System

- **TaskEvents**: Comprehensive typed events (Started, Completed, Aborted, etc.)
- **Event Propagation**: Provider-level event forwarding
- **State Synchronization**: Real-time webview updates

#### Workflow Orchestration

- **Mode Management**: Dynamic mode switching per task
- **Context Tracking**: File changes, workspace state
- **Tool Integration**: MCP tools, terminal, browser
- **Progress Tracking**: Real-time progress updates via webview

#### Multi-Agent Features

- **Task Delegation**: `newTaskTool()` creates child tasks
- **Agent Assignment**: Mode-based agent selection
- **Task Spawning**: `TaskSpawned` events for subtask creation

### CLI Current State (from index.ts)

#### Basic Features

- **Simple Conversation**: Message-based interaction
- **Tool Execution**: Basic tool running with output collapse
- **Session Management**: Save/restore conversation history
- **Mode Support**: Basic mode switching
- **Todo Management**: Simple todo list commands

#### Completed Features

- ✅ **Task Class Usage**: Full core Task class integration
- ✅ **Event System**: Complete EventBus implementation
- ✅ **Task Persistence**: Full task state with JSON storage
- ✅ **Sub-tasks**: Complete hierarchical task support
- ✅ **Progress Tracking**: Real-time progress updates with persistence
- ✅ **Status Management**: Rich TaskStatus model with validation

#### Remaining Missing Features

- ❌ **CLI Integration**: Core services not wired to entry point
- ❌ **CLI Commands**: No task lifecycle command handlers
- ❌ **Live Rendering**: No real-time terminal updates
- ❌ **Multi-agent**: No task delegation system
- ❌ **Workflow Orchestration**: No state machine workflows

## Feature Parity Matrix

| VSCode Feature             | CLI Current               | CLI Target                 | Implementation Status |
| -------------------------- | ------------------------- | -------------------------- | --------------------- |
| **Task Lifecycle**         |
| Task Creation              | ✅ Full Task class        | ✅ Full Task class         | ✅ **COMPLETE**       |
| Task Persistence           | ✅ Full task state        | ✅ Full task state         | ✅ **COMPLETE**       |
| Task Resume                | ✅ Task-specific resume   | ✅ Task-specific resume    | ✅ **COMPLETE**       |
| Task Events                | ✅ Full event system      | ✅ Full event system       | ✅ **COMPLETE**       |
| **Hierarchy & Delegation** |
| Sub-tasks                  | ✅ Parent-child trees     | ✅ Parent-child trees      | ✅ **COMPLETE**       |
| Task Spawning              | ✅ Dynamic task creation  | ✅ Dynamic task creation   | ✅ **COMPLETE**       |
| Multi-agent                | ❌ Single agent           | ✅ Agent delegation        | 🔄 Planned            |
| **Progress & State**       |
| Progress Tracking          | ✅ Real-time progress     | ✅ Real-time progress      | ✅ **COMPLETE**       |
| Status Management          | ✅ Rich status model      | ✅ Rich status model       | ✅ **COMPLETE**       |
| State Persistence          | ✅ Full state persistence | ✅ Full state persistence  | ✅ **COMPLETE**       |
| **Workflow**               |
| Mode Management            | ✅ Basic                  | ✅ Enhanced                | 🔄 Improve            |
| Workflow States            | ❌ None                   | ✅ State machine           | 🔄 Planned            |
| Context Tracking           | ❌ None                   | ✅ File/workspace tracking | 🔄 Planned            |
| **Integration**            |
| Tool System                | ✅ Basic                  | ✅ Enhanced                | 🔄 Improve            |
| Terminal                   | ✅ Basic                  | ✅ Enhanced                | 🔄 Improve            |
| MCP Integration            | ✅ Basic                  | ✅ Enhanced                | 🔄 Improve            |

## Architecture Mapping

### VSCode → CLI Equivalents

| VSCode Component      | CLI Equivalent        | Notes                   |
| --------------------- | --------------------- | ----------------------- |
| **ClineProvider**     | **CLITaskManager**    | Main orchestration      |
| **Webview messaging** | **EventBus**          | Event-driven updates    |
| **Task stack**        | **TaskRepository**    | Persistent task storage |
| **Panel updates**     | **Console rendering** | Real-time CLI output    |
| **Extension context** | **CLI session**       | Application state       |
| **Global state**      | **Config files**      | User preferences        |

### Event System Mapping

| VSCode Events        | CLI Events             | Implementation   |
| -------------------- | ---------------------- | ---------------- |
| `TaskStarted`        | `task.started`         | EventBus emit    |
| `TaskCompleted`      | `task.completed`       | EventBus emit    |
| `TaskAborted`        | `task.aborted`         | EventBus emit    |
| `TaskSpawned`        | `task.subtask.created` | EventBus emit    |
| `Message` events     | `task.output.appended` | EventBus emit    |
| `postStateToWebview` | Console re-render      | Event subscriber |

## Implementation Priorities

### Phase 1: Core Foundation (Steps 1-5) ✅ **COMPLETE**

1. ✅ **Domain Model**: Shared TaskStatus and TaskEvents
2. ✅ **Event System**: Core EventBus implementation
3. ✅ **Task Integration**: Use core Task class in CLI
4. ✅ **Persistence Layer**: TaskRepository with JSON storage
5. ✅ **TaskManager**: Full lifecycle management with persistence hooks

### Phase 2: CLI Integration (Steps 6-7) 🔄 **IN PROGRESS**

6. 🔄 **CLI Integration**: Wire services into entry point
7. 🔄 **Command System**: Task lifecycle commands

### Phase 3: Advanced Features (Steps 8-11)

8. **Hierarchical Tasks**: Sub-task support
9. **Workflow Engine**: State machine workflows
10. **Multi-Agent**: Delegation system
11. **VSCode Parity**: Mirror orchestration patterns

### Phase 4: Production Ready (Steps 12-17)

12. **Observability**: Logging and diagnostics
13. **Testing**: Comprehensive test coverage
14. **Migration**: Backward compatibility
15. **Documentation**: Complete developer guides
16. **Quality**: Error handling and edge cases
17. **Release**: Staged rollout plan

## Success Criteria

### Functional Parity

- [x] CLI can create, manage, and persist tasks with full lifecycle
- [x] CLI supports hierarchical sub-tasks with aggregated status
- [ ] CLI supports multi-agent task delegation
- [ ] CLI supports workflow orchestration with state machines
- [x] CLI emits same event sequences as VSCode for equivalent operations

### Technical Parity

- [x] Both CLI and VSCode use same Task class and TaskManager
- [x] Both environments emit identical TaskEvents for same operations
- [x] Task persistence format is compatible between environments
- [ ] Agent and workflow definitions are reusable across environments

### User Experience Parity

- [ ] CLI users can perform all task operations available in VSCode
- [ ] CLI provides real-time progress updates during long operations
- [ ] CLI supports resuming interrupted tasks across restarts
- [ ] CLI provides comprehensive help and error messages

## Risk Mitigation

### Backward Compatibility

- Maintain existing CLI command compatibility
- Provide automatic migration of legacy data
- Feature-flag new capabilities during transition

### Performance

- Ensure EventBus doesn't impact CLI startup time
- Implement lazy loading for complex features
- Optimize JSON persistence for large task trees

### Complexity

- Start with core features before advanced workflows
- Provide simple defaults for complex configurations
- Document migration path from simple to advanced usage

## Next Steps

1. Begin with Step 1: Define domain status model and task events
2. Implement EventBus as foundation for all subsequent work
3. Integrate Task class into CLI and remove ad-hoc patterns
4. Build incrementally with testing at each phase

---

_This document will be updated as implementation progresses to reflect actual vs. planned capabilities._
