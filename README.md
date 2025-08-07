# LiteQuu

A simple, persistent task queue for Node.js using SQLite as storage. Tasks are processed in the main thread with configurable concurrency, automatic retries with exponential backoff, and comprehensive event handling.

## Features

- ✅ **Persistent Storage**: Uses SQLite for reliable task persistence
- ⚡ **Same-Thread Processing**: Runs in the main Node.js thread (perfect for I/O-bound tasks)
- 🔄 **Automatic Retries**: Exponential backoff with configurable retry limits
- 🚦 **Concurrency Control**: Configurable maximum concurrent task processing
- 📊 **Event-Driven**: Comprehensive event system for monitoring
- 🔍 **Task Management**: Query task status, statistics, and cleanup utilities
- 🕐 **Auto-Processing**: Optional automatic task processing with polling
- 📦 **Zero Config**: Works out of the box with sensible defaults

## Installation

```bash
npm i @sturmfrei/litequu
```

## Quick Start

```javascript
import Queue from '@sturmfrei/litequu';

// Create a queue
const queue = new Queue({
  dbPath: './my-queue.db',
  maxConcurrent: 5,
  maxRetries: 3,
  baseRetryDelay: 1000,
});

// Add tasks
await queue.add({
  type: 'send_email',
  to: 'user@example.com',
  subject: 'Welcome!',
});

// Process tasks
queue.process(async (taskData) => {
  console.log('Processing:', taskData);

  if (taskData.type === 'send_email') {
    // Simulate email sending
    await sendEmail(taskData.to, taskData.subject);
    return `Email sent to ${taskData.to}`;
  }

  throw new Error(`Unknown task type: ${taskData.type}`);
});

// Listen to events
queue.on('completed', (info) => {
  console.log(`Task ${info.taskId} completed:`, info.result);
});

queue.on('failed', (info) => {
  console.log(`Task ${info.taskId} failed:`, info.error);
});
```

## Configuration Options

```javascript
const queue = new Queue({
  // Database file path (default: './queue.db')
  dbPath: './my-app-queue.db',

  // Maximum concurrent tasks (default: 5)
  maxConcurrent: 3,

  // Maximum retry attempts (default: 3)
  maxRetries: 5,

  // Base retry delay in milliseconds (default: 1000)
  baseRetryDelay: 2000,

  // Polling interval for auto-processing (default: 1000ms)
  pollingInterval: 500,

  // Enable automatic processing (default: true)
  autoProcess: true,

  // Add jitter to retry delays (default: true)
  jitter: true,
});
```

## API Reference

### Queue Methods

#### `add(taskData)`

Add a task to the queue.

```javascript
const taskId = await queue.add({
  action: 'process_image',
  imageUrl: 'https://example.com/image.jpg',
  userId: 123,
});
```

#### `process(handler)`

Start processing tasks with auto-polling enabled.

```javascript
queue.process(async (taskData) => {
  // Your task processing logic
  return result;
});
```

#### `processOnce(handler)`

Process available tasks once without auto-polling.

```javascript
await queue.processOnce(async (taskData) => {
  // Process single batch of tasks
  return result;
});
```

#### `getStats()`

Get queue statistics.

```javascript
const stats = await queue.getStats();
// Returns: [{ status: 'pending', count: 5 }, { status: 'completed', count: 10 }]
```

#### `getTask(id)`

Get a specific task by ID.

```javascript
const task = await queue.getTask(123);
console.log(task.status, task.retry_count);
```

#### `cleanup(olderThanHours)`

Remove completed tasks older than specified hours.

```javascript
await queue.cleanup(24); // Remove completed tasks older than 24 hours
```

#### `close()`

Close the queue and database connection.

```javascript
await queue.close();
```

### Properties

#### `status`

Get current queue status.

```javascript
const status = queue.status;
console.log(status.currentRunning); // Currently processing tasks
console.log(status.maxConcurrent); // Maximum concurrent tasks
console.log(status.isProcessing); // Whether queue is actively processing
```

### Events

The queue emits the following events:

#### `added`

Emitted when a task is added to the queue.

```javascript
queue.on('added', (info) => {
  console.log(`Task ${info.taskId} added:`, info.taskData);
});
```

#### `completed`

Emitted when a task completes successfully.

```javascript
queue.on('completed', (info) => {
  console.log(`Task ${info.taskId} completed:`, info.result);
});
```

#### `retried`

Emitted when a task fails and is scheduled for retry.

```javascript
queue.on('retried', (info) => {
  console.log(
    `Task ${info.taskId} retry ${info.retryCount} in ${info.delay}ms`
  );
  console.log(`Error: ${info.error}`);
});
```

#### `failed`

Emitted when a task permanently fails (exceeds max retries).

```javascript
queue.on('failed', (info) => {
  console.log(`Task ${info.taskId} permanently failed:`, info.error);
  console.log(`Total attempts: ${info.retryCount}`);
});
```

#### `error`

Emitted when queue operations encounter errors.

```javascript
queue.on('error', (info) => {
  console.error(`Queue error in ${info.operation}:`, info.error);
});
```

## Retry Mechanism

Tasks that fail are automatically retried with exponential backoff:

- **Retry 1**: `baseRetryDelay` (default: 1 second)
- **Retry 2**: `baseRetryDelay * 2` (2 seconds)
- **Retry 3**: `baseRetryDelay * 4` (4 seconds)
- etc.

With jitter enabled (default), actual delays will vary by ±50% to prevent thundering herd effects.

## Examples

### Basic Usage

```javascript
import Queue from '@sturmfrei/litequu';

const queue = new Queue();

// Add some tasks
await queue.add({ type: 'backup', table: 'users' });
await queue.add({ type: 'backup', table: 'orders' });

// Process tasks
await queue.processOnce(async (task) => {
  console.log(`Backing up ${task.table}...`);
  // Simulate backup work
  await new Promise((resolve) => setTimeout(resolve, 1000));
  return `${task.table} backed up successfully`;
});
```

### Auto-Processing with Polling

```javascript
const queue = new Queue({
  autoProcess: true,
  pollingInterval: 2000, // Check every 2 seconds
});

// Start processing (runs continuously)
queue.process(async (task) => {
  return await handleTask(task);
});

// Tasks will be processed automatically as they're added
await queue.add({ work: 'to_do' });
```

### Error Handling and Retries

```javascript
const queue = new Queue({
  maxRetries: 3,
  baseRetryDelay: 1000,
});

queue.on('retried', (info) => {
  console.log(`Retry ${info.retryCount} for task ${info.taskId}`);
});

queue.on('failed', (info) => {
  console.log(`Task ${info.taskId} gave up after ${info.retryCount} attempts`);
  // Handle permanent failures (e.g., dead letter queue, alerting)
});

queue.process(async (task) => {
  // This might fail and trigger retries
  if (Math.random() < 0.5) {
    throw new Error('Simulated failure');
  }
  return 'success';
});
```

## Best Practices

### 1. Keep Tasks Lightweight

Since tasks run in the main thread, avoid CPU-intensive operations:

```javascript
// ✅ Good - I/O bound tasks
queue.process(async (task) => {
  await sendEmail(task.email);
  await uploadFile(task.filePath);
  await callWebhook(task.url);
});

// ❌ Avoid - CPU intensive tasks
queue.process(async (task) => {
  // This will block the event loop
  return heavyComputation(task.data);
});
```

### 2. Handle Errors Gracefully

```javascript
queue.process(async (task) => {
  try {
    return await processTask(task);
  } catch (error) {
    // Add context to errors for better debugging
    throw new Error(`Failed to process ${task.type}: ${error.message}`);
  }
});
```

### 3. Use Task Types for Organization

```javascript
queue.process(async (task) => {
  switch (task.type) {
    case 'email':
      return await sendEmail(task);
    case 'webhook':
      return await callWebhook(task);
    case 'file_upload':
      return await uploadFile(task);
    default:
      throw new Error(`Unknown task type: ${task.type}`);
  }
});
```

### 4. Monitor Queue Health

```javascript
// Set up monitoring
setInterval(async () => {
  const stats = await queue.getStats();
  const pending = stats.find((s) => s.status === 'pending')?.count || 0;
  const failed = stats.find((s) => s.status === 'failed')?.count || 0;

  if (pending > 1000) {
    console.warn('Queue backlog is growing:', pending);
  }

  if (failed > 100) {
    console.error('High failure rate detected:', failed);
  }
}, 60000); // Check every minute
```

### 5. Graceful Shutdown

```javascript
process.on('SIGTERM', async () => {
  console.log('Shutting down gracefully...');
  await queue.close(); // Wait for current tasks to finish
  process.exit(0);
});
```

## Limitations

- **Single Process**: Designed for single-process applications
- **Main Thread**: Not suitable for CPU-intensive tasks
- **SQLite Concurrency**: Write operations are serialized by SQLite
- **Memory Usage**: Large task payloads are stored in the database

## Contributing

Contributions are welcome! Please read our contributing guidelines and submit pull requests for any improvements.

## License

MIT License - see LICENSE file for details.
