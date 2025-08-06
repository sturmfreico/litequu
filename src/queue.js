import { EventEmitter } from 'events';
import Database from './db.js';

class Queue extends EventEmitter {
  constructor(options = {}) {
    super();
    this.dbPath = options.dbPath || './queue.db';
    this.maxConcurrent = options.maxConcurrent || 5;
    this.maxRetries = options.maxRetries || 3;
    this.baseRetryDelay = options.baseRetryDelay || 1000; // 1 second
    this.pollingInterval = options.pollingInterval || 1000; // 1 second
    this.autoProcess = options.autoProcess !== false; // defaults to true
    this.jitter = options.jitter !== false; // adds randomness to retry delays

    this.db = new Database(this.dbPath);
    this.currentRunning = 0;
    this.isProcessing = false;
    this.handler = null;
    this.pollingTimer = null;
  }

  add(taskData) {
    try {
      const taskId = this.db.insertTask(JSON.stringify(taskData));
      this.emit('added', { taskId, taskData });

      // If auto-processing is enabled and we have a handler, trigger processing
      if (this.autoProcess && this.handler && !this.isProcessing) {
        setImmediate(() => this._processNextBatch());
      }

      return taskId;
    } catch (error) {
      this.emit('error', { error, operation: 'add' });
      throw error;
    }
  }

  async process(handler) {
    if (typeof handler !== 'function') {
      throw new Error('Handler must be a function');
    }

    this.handler = handler;

    if (this.autoProcess) {
      this._startPolling();
    }

    return this._processNextBatch();
  }

  async processOnce(handler) {
    if (typeof handler !== 'function') {
      throw new Error('Handler must be a function');
    }

    return this._processNextBatch(handler);
  }

  async _processNextBatch(oneTimeHandler = null) {
    if (this.isProcessing && !oneTimeHandler) {
      return; // Already processing
    }

    const handlerToUse = oneTimeHandler || this.handler;
    if (!handlerToUse) {
      throw new Error('No handler provided');
    }

    this.isProcessing = true;

    try {
      const availableSlots = this.maxConcurrent - this.currentRunning;
      if (availableSlots <= 0) {
        return;
      }

      const now = new Date().toISOString();
      const tasks = this.db.getPendingTasks(availableSlots, now);

      const processingPromises = tasks.map((task) =>
        this._processTask(task, handlerToUse)
      );
      await Promise.all(processingPromises);

      // If there might be more tasks, process them
      if (
        tasks.length === availableSlots &&
        this.currentRunning < this.maxConcurrent
      ) {
        setImmediate(() => this._processNextBatch(oneTimeHandler));
      }
    } catch (error) {
      this.emit('error', { error, operation: 'process' });
    } finally {
      if (!oneTimeHandler) {
        this.isProcessing = false;
      }
    }
  }

  async _processTask(task, handler) {
    this.currentRunning++;

    try {
      this.db.updateTaskStatus(task.id, 'processing', task.retry_count, null);

      let taskData;
      try {
        taskData = JSON.parse(task.task_data);
      } catch (parseError) {
        throw new Error(`Invalid task data JSON: ${parseError.message}`);
      }

      const result = await handler(taskData);
      this.db.updateTaskStatus(task.id, 'completed', task.retry_count, null);
      this.emit('completed', { taskId: task.id, result, taskData });
    } catch (error) {
      await this._handleTaskFailure(task, error);
    } finally {
      this.currentRunning--;
    }
  }

  async _handleTaskFailure(task, error) {
    const retryCount = task.retry_count + 1;

    if (retryCount <= this.maxRetries) {
      const baseDelay = this.baseRetryDelay * Math.pow(2, retryCount - 1);
      const jitterDelay = this.jitter
        ? baseDelay * (0.5 + Math.random() * 0.5)
        : baseDelay;
      const delay = Math.floor(jitterDelay);
      const nextRetryAt = new Date(Date.now() + delay).toISOString();

      this.db.updateTaskStatus(task.id, 'failed', retryCount, nextRetryAt);

      let taskData;
      try {
        taskData = JSON.parse(task.task_data);
      } catch (parseError) {
        console.error('Error parsing task data:', parseError);
        taskData = { raw: task.task_data };
      }

      this.emit('retried', {
        taskId: task.id,
        taskData,
        retryCount,
        nextRetryAt,
        delay,
        error: error.message,
      });
    } else {
      this.db.updateTaskStatus(task.id, 'failed', retryCount, null);

      let taskData;
      try {
        taskData = JSON.parse(task.task_data);
      } catch (parseError) {
        console.error('Error parsing task data:', parseError);
        taskData = { raw: task.task_data };
      }

      this.emit('failed', {
        taskId: task.id,
        taskData,
        error: error.message,
        retryCount,
      });
    }
  }

  _startPolling() {
    if (this.pollingTimer) {
      return; // Already polling
    }

    this.pollingTimer = setInterval(() => {
      if (!this.isProcessing && this.handler) {
        this._processNextBatch();
      }
    }, this.pollingInterval);
  }

  stopPolling() {
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
    }
  }

  getStats() {
    return this.db.getTaskStats();
  }

  getTask(id) {
    return this.db.getTaskById(id);
  }

  cleanup(olderThanHours = 24) {
    return this.db.cleanupCompletedTasks(olderThanHours);
  }

  async close() {
    this.stopPolling();

    // Wait for current tasks to finish
    while (this.currentRunning > 0) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    return this.db.close();
  }

  // Getter for current queue status
  get status() {
    return {
      currentRunning: this.currentRunning,
      maxConcurrent: this.maxConcurrent,
      isProcessing: this.isProcessing,
      autoProcess: this.autoProcess,
      hasHandler: !!this.handler,
    };
  }
}

export default Queue;
