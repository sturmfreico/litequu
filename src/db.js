import BetterSqlite3 from 'better-sqlite3';

/**
 * Database class for managing SQLite operations for the queue system.
 * Provides a wrapper around better-sqlite3 with connection management and queue-specific operations.
 */
class Database {
  /**
   * Creates a new Database instance.
   * @param {string} [dbPath='./queue.db'] - Path to the SQLite database file
   */
  constructor(dbPath = './queue.db') {
    this.dbPath = dbPath;
    this.db = null;
    this.initialized = false;
  }

  /**
   * Creates and returns a database connection.
   * Implements lazy connection initialization and sets WAL mode for better concurrency.
   * @private
   * @returns {BetterSqlite3.Database} The database connection instance
   * @throws {Error} When database connection fails
   */
  _createConnection() {
    if (!this.db) {
      try {
        this.db = new BetterSqlite3(this.dbPath);
        this.db.pragma('journal_mode = WAL');
      } catch (err) {
        console.error('Database connection error:', err);
        this.db = null;
        throw err;
      }
    }
    return this.db;
  }

  /**
   * Executes a SQL statement that modifies the database (INSERT, UPDATE, DELETE).
   * @param {string} sql - The SQL statement to execute
   * @param {Array} [params=[]] - Parameters to bind to the SQL statement
   * @returns {Object} Result object with lastID (last inserted row ID) and changes (number of rows affected)
   * @throws {Error} When database connection is not available
   */
  run(sql, params = []) {
    const db = this._createConnection();
    if (!db) {
      throw new Error('Database connection not available');
    }
    const stmt = db.prepare(sql);
    const result = stmt.run(params);
    return { lastID: result.lastInsertRowid, changes: result.changes };
  }

  /**
   * Executes a SQL SELECT statement and returns the first matching row.
   * @param {string} sql - The SQL SELECT statement to execute
   * @param {Array} [params=[]] - Parameters to bind to the SQL statement
   * @returns {Object|undefined} The first row that matches the query, or undefined if no matches
   * @throws {Error} When database connection is not available
   */
  get(sql, params = []) {
    const db = this._createConnection();
    if (!db) {
      throw new Error('Database connection not available');
    }
    const stmt = db.prepare(sql);
    const result = stmt.get(params);
    return result;
  }

  /**
   * Executes a SQL SELECT statement and returns all matching rows.
   * @param {string} sql - The SQL SELECT statement to execute
   * @param {Array} [params=[]] - Parameters to bind to the SQL statement
   * @returns {Array<Object>} Array of all rows that match the query
   * @throws {Error} When database connection is not available
   */
  all(sql, params = []) {
    const db = this._createConnection();
    if (!db) {
      throw new Error('Database connection not available');
    }
    const stmt = db.prepare(sql);
    const result = stmt.all(params);
    return result;
  }

  /**
   * Initializes the database by creating the queue table and indexes if they don't exist.
   * This method is idempotent - it can be called multiple times safely.
   * @returns {void}
   */
  initialize() {
    if (this.initialized) return;

    // Ensure database connection is established
    this._createConnection();

    this.run(`
      CREATE TABLE IF NOT EXISTS queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_data TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        retry_count INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        next_retry_at DATETIME DEFAULT NULL
      )
    `);

    this.run('CREATE INDEX IF NOT EXISTS idx_status ON queue (status)');
    this.run(
      'CREATE INDEX IF NOT EXISTS idx_next_retry ON queue (next_retry_at)'
    );

    this.initialized = true;
  }

  /**
   * Inserts a new task into the queue.
   * @param {string} taskData - JSON string representation of the task data
   * @returns {number} The ID of the newly inserted task
   */
  insertTask(taskData) {
    this.initialize();
    const result = this.run('INSERT INTO queue (task_data) VALUES (?)', [
      taskData,
    ]);
    return result.lastID;
  }

  /**
   * Retrieves pending tasks from the queue, including failed tasks ready for retry.
   * @param {number} [limit=5] - Maximum number of tasks to retrieve
   * @param {string} [currentTime=new Date().toISOString()] - Current time in ISO format for retry comparison
   * @returns {Array<Object>} Array of task objects ready for processing
   */
  getPendingTasks(limit = 5, currentTime = new Date().toISOString()) {
    this.initialize();
    return this.all(
      `
      SELECT * FROM queue 
      WHERE (status = 'pending' OR (status = 'failed' AND next_retry_at <= ?))
      ORDER BY created_at ASC 
      LIMIT ?
    `,
      [currentTime, limit]
    );
  }

  /**
   * Updates the status and retry information for a specific task.
   * @param {number} id - The task ID to update
   * @param {string} status - New status ('pending', 'processing', 'completed', 'failed')
   * @param {number} [retryCount=0] - Current retry count for the task
   * @param {string|null} [nextRetryAt=null] - ISO timestamp for next retry attempt, or null if no retry scheduled
   * @returns {Object} Result object with changes count
   */
  updateTaskStatus(id, status, retryCount = 0, nextRetryAt = null) {
    this.initialize();
    return this.run(
      `
      UPDATE queue 
      SET status = ?, retry_count = ?, next_retry_at = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
      [status, retryCount, nextRetryAt, id]
    );
  }

  /**
   * Deletes a task from the queue by its ID.
   * @param {number} id - The ID of the task to delete
   * @returns {Object} Result object with changes count
   */
  deleteTask(id) {
    this.initialize();
    return this.run('DELETE FROM queue WHERE id = ?', [id]);
  }

  /**
   * Retrieves a specific task by its ID.
   * @param {number} id - The ID of the task to retrieve
   * @returns {Object|undefined} The task object if found, undefined otherwise
   */
  getTaskById(id) {
    this.initialize();
    return this.get('SELECT * FROM queue WHERE id = ?', [id]);
  }

  /**
   * Retrieves statistics about tasks grouped by their status.
   * @returns {Array<Object>} Array of objects with status and count properties
   * @example
   * // Returns: [{ status: 'pending', count: 5 }, { status: 'completed', count: 10 }]
   */
  getTaskStats() {
    this.initialize();
    return this.all(`
      SELECT status, COUNT(*) as count 
      FROM queue 
      GROUP BY status
    `);
  }

  /**
   * Deletes completed tasks older than the specified time period.
   * @param {number} [olderThanHours=24] - Tasks older than this many hours will be deleted
   * @returns {Object} Result object with changes count indicating how many tasks were deleted
   */
  cleanupCompletedTasks(olderThanHours = 24) {
    this.initialize();
    const cutoffTime = new Date(
      Date.now() - olderThanHours * 60 * 60 * 1000
    ).toISOString();
    return this.run(
      `
      DELETE FROM queue 
      WHERE status = 'completed' AND updated_at < ?
    `,
      [cutoffTime]
    );
  }

  /**
   * Closes the database connection gracefully.
   * @returns {Promise<void>} Promise that resolves when the database is closed
   */
  close() {
    return new Promise((resolve) => {
      if (this.db) {
        const dbToClose = this.db;
        this.db = null; // Immediately set to null to prevent race conditions
        this.initialized = false;

        try {
          dbToClose.close();
          resolve();
        } catch (err) {
          console.error('Error closing database:', err);
          resolve();
        }
      } else {
        resolve();
      }
    });
  }
}

export default Database;
