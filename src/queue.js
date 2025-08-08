import { EventEmitter } from 'events';
import Database from './db.js';

/**
 * Queue class for managing and processing background tasks.
 * Extends EventEmitter to provide event-based notifications for task lifecycle events.
 *
 * @extends EventEmitter
 * @fires Queue#added - When a task is added to the queue
 * @fires Queue#completed - When a task completes successfully
 * @fires Queue#failed - When a task fails after all retries
 * @fires Queue#retried - When a task is scheduled for retry
 * @fires Queue#error - When an error occurs during queue operations
 */
class Queue extends EventEmitter {
  /**
   * Creates a new Queue instance.
   * @param {Object} [options={}] - Configuration options for the queue
   * @param {string} [options.dbPath='./queue.db'] - Path to the SQLite database file
   * @param {number} [options.maxConcurrent=5] - Maximum number of tasks to process concurrently
   * @param {number} [options.maxRetries=15] - Maximum number of retry attempts for failed tasks
   * @param {number} [options.baseRetryDelay=15_000] - Base delay in milliseconds between retries (exponential backoff)
   * @param {number} [options.pollingInterval=1000] - Interval in milliseconds for polling new tasks
   * @param {boolean} [options.autoProcess=true] - Whether to automatically process tasks when added
   * @param {boolean} [options.jitter=true] - Whether to add randomness to retry delays
   */
  constructor(options = {}) {
    super();
    this.dbPath = options.dbPath || './queue.db';
    this.maxConcurrent = options.maxConcurrent || 5;
    this.maxRetries = options.maxRetries || 15;
    this.baseRetryDelay = options.baseRetryDelay || 15_000; // 15 seconds
    this.pollingInterval = options.pollingInterval || 1000; // 1 second
    this.autoProcess = options.autoProcess !== false; // defaults to true
    this.jitter = options.jitter !== false; // adds randomness to retry delays

    this.db = new Database(this.dbPath);
    this.currentRunning = 0;
    this.isProcessing = false;
    this.handler = null;
    this.pollingTimer = null;
  }

  /**
   * Adds a new task to the queue.
   * @param {*} taskData - The data for the task (will be JSON serialized)
   * @returns {number} The ID of the newly added task
   * @throws {Error} When task insertion fails
   * @fires Queue#added
   * @fires Queue#error
   */
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

  /**
   * Sets up continuous task processing with the provided handler function.
   * Starts polling for new tasks if autoProcess is enabled.
   * @param {Function} handler - Function to process each task, receives task data as parameter
   * @returns {Promise<void>} Promise that resolves after initial batch processing
   * @throws {Error} When handler is not a function
   */
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

  /**
   * Processes a single batch of tasks without setting up continuous processing.
   * @param {Function} handler - Function to process each task, receives task data as parameter
   * @returns {Promise<void>} Promise that resolves after batch processing completes
   * @throws {Error} When handler is not a function
   */
  async processOnce(handler) {
    if (typeof handler !== 'function') {
      throw new Error('Handler must be a function');
    }

    return this._processNextBatch(handler);
  }

  /**
   * Processes the next batch of available tasks.
   * @private
   * @param {Function|null} [oneTimeHandler=null] - Optional one-time handler, otherwise uses instance handler
   * @returns {Promise<void>} Promise that resolves after batch processing
   * @throws {Error} When no handler is provided
   * @fires Queue#error
   */
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

  /**
   * Processes a single task with the provided handler.
   * @private
   * @param {Object} task - The task object from the database
   * @param {Function} handler - The handler function to process the task
   * @returns {Promise<void>} Promise that resolves after task processing
   * @fires Queue#completed
   */
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

  /**
   * Handles task failure by implementing retry logic with exponential backoff.
   * @private
   * @param {Object} task - The failed task object
   * @param {Error} error - The error that caused the task to fail
   * @returns {Promise<void>} Promise that resolves after handling the failure
   * @fires Queue#retried
   * @fires Queue#failed
   */
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

  /**
   * Starts polling for new tasks at regular intervals.
   * @private
   * @returns {void}
   */
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

  /**
   * Stops the polling timer for new tasks.
   * @returns {void}
   */
  stopPolling() {
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
    }
  }

  /**
   * Retrieves statistics about tasks grouped by their status.
   * @returns {Array<Object>} Array of objects with status and count properties
   */
  getStats() {
    return this.db.getTaskStats();
  }

  /**
   * Retrieves a specific task by its ID.
   * @param {number} id - The ID of the task to retrieve
   * @returns {Object|undefined} The task object if found, undefined otherwise
   */
  getTask(id) {
    return this.db.getTaskById(id);
  }

  /**
   * Deletes completed tasks older than the specified time period.
   * @param {number} [olderThanHours=24] - Tasks older than this many hours will be deleted
   * @returns {Object} Result object with changes count indicating how many tasks were deleted
   */
  cleanup(olderThanHours = 24) {
    return this.db.cleanupCompletedTasks(olderThanHours);
  }

  /**
   * Gracefully closes the queue by stopping polling and waiting for running tasks to complete.
   * @returns {Promise<void>} Promise that resolves when the queue is fully closed
   */
  async close() {
    this.stopPolling();

    // Wait for current tasks to finish
    while (this.currentRunning > 0) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    return this.db.close();
  }

  /**
   * Gets the current status of the queue.
   * @returns {Object} Status object with currentRunning, maxConcurrent, isProcessing, autoProcess, and hasHandler properties
   */
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
