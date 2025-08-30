# Task Persistence Architecture

## Overview

The task persistence layer provides durable storage for tasks and workflows across CLI sessions. It's built around a pluggable storage interface with a JSON file-based default implementation.

## Architecture

```
┌─────────────────────────────────────────┐
│              TaskManager                │
├─────────────────────────────────────────┤
│ • Create/Update/Delete Tasks            │
│ • Status Transitions                    │
│ • Progress Updates                      │
│ • Automatic Persistence Hooks          │
└─────────────────┬───────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────┐
│           TaskRepository                │
├─────────────────────────────────────────┤
│ • Pluggable Storage Interface           │
│ • JSON File Backend                     │
│ • Schema Validation                     │
│ • Backup & Recovery                     │
└─────────────────┬───────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────┐
│           Storage Driver                │
├─────────────────────────────────────────┤
│ • JSONFileStorageDriver (default)       │
│ • File Locking                          │
│ • Atomic Operations                     │
│ • User Config Directory                 │
└─────────────────────────────────────────┘
```

## Core Components

### 1. TaskRepository

The main persistence interface that provides:

- **Storage abstraction**: Pluggable storage drivers
- **Data validation**: Schema validation for stored tasks
- **Error handling**: Graceful degradation on storage failures
- **Migration support**: Legacy data format migration

**Key Methods:**

```typescript
loadAll(): Promise<StoredTask[]>
loadById(id: string): Promise<StoredTask | null>
save(task: StoredTask): Promise<void>
saveMany(tasks: StoredTask[]): Promise<void>
remove(id: string): Promise<void>
migrateFromLegacy(): Promise<void>
```

### 2. StorageDriver Interface

Defines the contract for storage backends:

```typescript
interface StorageDriver {
	initialize(): Promise<void>
	loadData(): Promise<StorageData>
	saveData(data: StorageData): Promise<void>
	backup(): Promise<void>
	acquireLock(): Promise<void>
	releaseLock(): Promise<void>
}
```

### 3. JSONFileStorageDriver

Default file-based implementation:

- **Location**: `~/.config/kilocode/tasks.json`
- **File locking**: Prevents concurrent access corruption
- **Atomic writes**: Ensures data consistency
- **Automatic backups**: Creates backups on errors

## Data Model

### StoredTask Format

```typescript
interface StoredTask {
	id: string
	title: string
	description?: string
	status: TaskStatus
	parentId?: string
	assignedTo?: string
	progress: TaskProgress
	metadata: Record<string, unknown>
	createdAt: number
	updatedAt: number
	children: string[]
	logs: Array<{
		timestamp: number
		output: string
		type: "stdout" | "stderr" | "log" | "error" | "info" | "debug"
		source?: string
	}>
}
```

### Storage Schema

```typescript
interface StorageData {
	version: string
	tasks: StoredTask[]
	metadata: {
		lastUpdated: number
		totalTasks: number
	}
}
```

## Persistence Hooks

The TaskManager integrates automatic persistence at every operation:

### Task Lifecycle Operations

- ✅ **create()** → persist immediately
- ✅ **update()** → persist on changes
- ✅ **delete()** → remove from storage

### Status Transitions

- ✅ **start/pause/resume/complete/fail/cancel** → persist status changes

### Progress & Output

- ✅ **setProgress()** → persist progress updates
- ✅ **appendOutput()** → persist log entries

### Relationships

- ✅ **linkParentChild()** → persist relationship changes
- ✅ **assignAgent()** → persist assignments

## File System Layout

```
~/.config/kilocode/
├── tasks.json          # Main task storage
├── tasks.backup.json   # Automatic backup
└── .tasks.lock         # Lock file for concurrency
```

## Error Handling

The persistence layer implements robust error handling:

### Graceful Degradation

- Persistence failures don't break TaskManager operations
- Errors are logged but operations continue
- Backup files created on corruption

### Recovery Strategies

1. **Lock timeout**: 30-second timeout for lock acquisition
2. **Backup restoration**: Automatic fallback to backup files
3. **Schema validation**: Reject invalid data with detailed errors

## Performance Characteristics

### Write Operations

- **Individual persistence**: Each operation persists immediately
- **Atomic writes**: Temporary file + rename for consistency
- **File locking**: Prevents corruption from concurrent access

### Read Operations

- **Startup loading**: All tasks loaded on TaskManager initialization
- **In-memory operations**: No disk I/O during runtime operations
- **Lazy validation**: Schema validation only on load/save

## Configuration

### Storage Location

Default: `~/.config/kilocode/tasks.json`

Can be customized via:

```typescript
const repository = new TaskRepository({
	driver: new JSONFileStorageDriver("/custom/path/tasks.json"),
})
```

### Schema Versioning

- **Current version**: `1.0.0`
- **Migration support**: Automatic upgrade from legacy formats
- **Forward compatibility**: Graceful handling of newer versions

## Migration Support

### Legacy Format Detection

```typescript
// Detects and migrates from simple todo lists:
;[
	{ text: "Old todo item", completed: false },
	// ... converted to full StoredTask format
]
```

### Migration Process

1. Detect legacy format
2. Convert to current schema
3. Create backup of original
4. Save in new format

## Security Considerations

### File Permissions

- Task files created with restrictive permissions (600)
- Only readable/writable by file owner
- Lock files prevent concurrent modification

### Data Sanitization

- All user input validated before persistence
- No executable code stored in task data
- Metadata fields properly escaped

## Testing Strategy

### Unit Tests

- Storage driver functionality
- Schema validation
- Error handling paths
- Migration logic

### Integration Tests

- TaskManager + Repository integration
- Concurrent access scenarios
- File system failure simulation
- Backup and recovery flows

## Future Extensions

### Additional Storage Drivers

```typescript
// Planned storage backends:
;-SQLiteStorageDriver - RedisStorageDriver - S3StorageDriver - DatabaseStorageDriver
```

### Advanced Features

- **Incremental backups**: Only store changes
- **Compression**: Reduce storage size for large task trees
- **Encryption**: Encrypt sensitive task data
- **Sync**: Multi-device task synchronization

## Usage Examples

### Basic Usage

```typescript
const eventBus = new EventBus()
const repository = new TaskRepository()
const taskManager = new TaskManager(eventBus, repository)

// Load existing tasks
await taskManager.loadFromRepository()

// Create a task (automatically persisted)
const taskId = await taskManager.create({
	title: "Build feature",
	description: "Add new persistence layer",
})

// Update task (automatically persisted)
await taskManager.update(taskId, {
	title: "Build awesome feature",
})
```

### Custom Storage Driver

```typescript
class CustomStorageDriver implements StorageDriver {
	async initialize(): Promise<void> {
		/* custom init */
	}
	async loadData(): Promise<StorageData> {
		/* load from custom source */
	}
	async saveData(data: StorageData): Promise<void> {
		/* save to custom destination */
	}
	// ... implement other methods
}

const repository = new TaskRepository({
	driver: new CustomStorageDriver(),
})
```

## Monitoring & Diagnostics

### Persistence Metrics

- Task creation/update/deletion rates
- Storage operation latency
- Error rates and types
- File size growth over time

### Debug Information

```bash
# Future CLI diagnostic command
kilocode task diagnose --persistence
# Shows:
# - Storage location and size
# - Last backup timestamp
# - Schema version
# - Recent errors
```

---

This persistence architecture ensures that task data is durably stored while maintaining high performance and reliability for CLI operations.
