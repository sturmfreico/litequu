import sqlite3 from 'sqlite3';
const verbose = sqlite3.verbose();

class Database {
  constructor(dbPath = './queue.db') {
    this.dbPath = dbPath;
    this.db = null;
    this.initialized = false;
    this._initPromise = null;
  }

  _createConnection() {
    if (!this.db) {
      this.db = new verbose.Database(
        this.dbPath,
        sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE,
        (err) => {
          if (err) {
            console.error('Database connection error:', err);
            this.db = null; // Reset on error
          }
        }
      );
    }
    return this.db;
  }

  run(sql, params = []) {
    return new Promise((resolve, reject) => {
      const db = this._createConnection();
      if (!db) {
        reject(new Error('Database connection not available'));
        return;
      }
      db.run(sql, params, function (err) {
        if (err) {
          reject(err);
        } else {
          resolve({ lastID: this.lastID, changes: this.changes });
        }
      });
    });
  }

  get(sql, params = []) {
    return new Promise((resolve, reject) => {
      const db = this._createConnection();
      if (!db) {
        reject(new Error('Database connection not available'));
        return;
      }
      db.get(sql, params, (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row);
        }
      });
    });
  }

  all(sql, params = []) {
    return new Promise((resolve, reject) => {
      const db = this._createConnection();
      if (!db) {
        reject(new Error('Database connection not available'));
        return;
      }
      db.all(sql, params, (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  async initialize() {
    if (this.initialized) return;

    // Ensure only one initialization happens at a time
    if (this._initPromise) return this._initPromise;

    this._initPromise = this._doInitialize();
    return this._initPromise;
  }

  async _doInitialize() {
    if (this.initialized) return;

    // Ensure database connection is established
    this._createConnection();

    await this.run(`
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

    await this.run('CREATE INDEX IF NOT EXISTS idx_status ON queue (status)');
    await this.run(
      'CREATE INDEX IF NOT EXISTS idx_next_retry ON queue (next_retry_at)'
    );

    this.initialized = true;
  }

  async insertTask(taskData) {
    await this.initialize();
    const result = await this.run('INSERT INTO queue (task_data) VALUES (?)', [
      taskData,
    ]);
    return result.lastID;
  }

  async getPendingTasks(limit = 5, currentTime = new Date().toISOString()) {
    await this.initialize();
    return await this.all(
      `
      SELECT * FROM queue 
      WHERE (status = 'pending' OR (status = 'failed' AND next_retry_at <= ?))
      ORDER BY created_at ASC 
      LIMIT ?
    `,
      [currentTime, limit]
    );
  }

  async updateTaskStatus(id, status, retryCount = 0, nextRetryAt = null) {
    await this.initialize();
    return await this.run(
      `
      UPDATE queue 
      SET status = ?, retry_count = ?, next_retry_at = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
      [status, retryCount, nextRetryAt, id]
    );
  }

  async deleteTask(id) {
    await this.initialize();
    return await this.run('DELETE FROM queue WHERE id = ?', [id]);
  }

  async getTaskById(id) {
    await this.initialize();
    return await this.get('SELECT * FROM queue WHERE id = ?', [id]);
  }

  async getTaskStats() {
    await this.initialize();
    return await this.all(`
      SELECT status, COUNT(*) as count 
      FROM queue 
      GROUP BY status
    `);
  }

  async cleanupCompletedTasks(olderThanHours = 24) {
    await this.initialize();
    const cutoffTime = new Date(
      Date.now() - olderThanHours * 60 * 60 * 1000
    ).toISOString();
    return await this.run(
      `
      DELETE FROM queue 
      WHERE status = 'completed' AND updated_at < ?
    `,
      [cutoffTime]
    );
  }

  close() {
    return new Promise((resolve) => {
      if (this.db) {
        const dbToClose = this.db;
        this.db = null; // Immediately set to null to prevent race conditions
        this.initialized = false;
        this._initPromise = null;

        dbToClose.close((err) => {
          if (err) {
            console.error('Error closing database:', err);
          }
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
}

export default Database;
