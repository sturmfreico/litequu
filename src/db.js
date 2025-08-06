import BetterSqlite3 from 'better-sqlite3';

class Database {
  constructor(dbPath = './queue.db') {
    this.dbPath = dbPath;
    this.db = null;
    this.initialized = false;
  }

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

  run(sql, params = []) {
    const db = this._createConnection();
    if (!db) {
      throw new Error('Database connection not available');
    }
    const stmt = db.prepare(sql);
    const result = stmt.run(params);
    return { lastID: result.lastInsertRowid, changes: result.changes };
  }

  get(sql, params = []) {
    const db = this._createConnection();
    if (!db) {
      throw new Error('Database connection not available');
    }
    const stmt = db.prepare(sql);
    const result = stmt.get(params);
    return result;
  }

  all(sql, params = []) {
    const db = this._createConnection();
    if (!db) {
      throw new Error('Database connection not available');
    }
    const stmt = db.prepare(sql);
    const result = stmt.all(params);
    return result;
  }

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

  insertTask(taskData) {
    this.initialize();
    const result = this.run('INSERT INTO queue (task_data) VALUES (?)', [
      taskData,
    ]);
    return result.lastID;
  }

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

  deleteTask(id) {
    this.initialize();
    return this.run('DELETE FROM queue WHERE id = ?', [id]);
  }

  getTaskById(id) {
    this.initialize();
    return this.get('SELECT * FROM queue WHERE id = ?', [id]);
  }

  getTaskStats() {
    this.initialize();
    return this.all(`
      SELECT status, COUNT(*) as count 
      FROM queue 
      GROUP BY status
    `);
  }

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
