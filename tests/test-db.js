import { describe, beforeEach, afterEach, it, expect } from 'vitest';
import Database from '../src/db.js';

describe('Database', () => {
  let db;
  const testDbPath = ':memory:'; // Use in-memory database for tests

  beforeEach(async () => {
    db = new Database(testDbPath);
  });

  afterEach(async () => {
    await db.close();
  });

  describe('initialization', () => {
    it('should create database tables on first use', () => {
      const taskId = db.insertTask('{"test": "data"}');
      expect(taskId).toBeTypeOf('number');
    });

    it('should not recreate tables on subsequent initializations', () => {
      db.initialize();
      db.initialize(); // Should not throw
    });
  });

  describe('insertTask', () => {
    it('should insert a task and return an ID', async () => {
      const taskData = '{"type": "test", "data": 123}';
      const taskId = db.insertTask(taskData);

      expect(taskId).toBeTypeOf('number');
      expect(taskId).toBeGreaterThan(0);
    });

    it('should insert multiple tasks with incrementing IDs', async () => {
      const taskId1 = db.insertTask('{"task": 1}');
      const taskId2 = db.insertTask('{"task": 2}');

      expect(taskId2).to.equal(taskId1 + 1);
    });
  });

  describe('getPendingTasks', () => {
    it('should return empty array when no tasks exist', async () => {
      const tasks = db.getPendingTasks();
      expect(tasks).toBeInstanceOf(Array);
      expect(tasks).toHaveLength(0);
    });

    it('should return pending tasks', async () => {
      db.insertTask('{"test": "data1"}');
      db.insertTask('{"test": "data2"}');

      const tasks = db.getPendingTasks();
      expect(tasks).toHaveLength(2);
      expect(tasks[0].status).toBe('pending');
      expect(tasks[1].status).toBe('pending');
    });

    it('should respect limit parameter', async () => {
      db.insertTask('{"test": "data1"}');
      db.insertTask('{"test": "data2"}');
      db.insertTask('{"test": "data3"}');

      const tasks = db.getPendingTasks(2);
      expect(tasks).toHaveLength(2);
    });

    it('should return failed tasks ready for retry', async () => {
      const taskId = db.insertTask('{"test": "data"}');
      const pastTime = new Date(Date.now() - 1000).toISOString();

      db.updateTaskStatus(taskId, 'failed', 1, pastTime);

      const tasks = db.getPendingTasks();
      expect(tasks).toHaveLength(1);
      expect(tasks[0].status).toBe('failed');
    });

    it('should not return failed tasks not ready for retry', async () => {
      const taskId = db.insertTask('{"test": "data"}');
      const futureTime = new Date(Date.now() + 10000).toISOString();

      db.updateTaskStatus(taskId, 'failed', 1, futureTime);

      const tasks = db.getPendingTasks();
      expect(tasks).toHaveLength(0);
    });
  });

  describe('updateTaskStatus', () => {
    it('should update task status', async () => {
      const taskId = db.insertTask('{"test": "data"}');
      db.updateTaskStatus(taskId, 'processing', 0, null);

      const task = db.getTaskById(taskId);
      expect(task.status).toBe('processing');
    });

    it('should update retry count and next retry time', async () => {
      const taskId = db.insertTask('{"test": "data"}');
      const nextRetryAt = new Date().toISOString();

      db.updateTaskStatus(taskId, 'failed', 2, nextRetryAt);

      const task = db.getTaskById(taskId);
      expect(task.status).toBe('failed');
      expect(task.retry_count).toBe(2);
      expect(task.next_retry_at).toBe(nextRetryAt);
    });
  });

  describe('getTaskById', () => {
    it('should return task by ID', async () => {
      const taskData = '{"test": "specific_data"}';
      const taskId = db.insertTask(taskData);

      const task = db.getTaskById(taskId);
      expect(task.id).toBe(taskId);
      expect(task.task_data).toBe(taskData);
      expect(task.status).toBe('pending');
    });

    it('should return undefined for non-existent task', async () => {
      const task = db.getTaskById(999);
      expect(task).toBeUndefined();
    });
  });

  describe('deleteTask', () => {
    it('should delete a task', async () => {
      const taskId = db.insertTask('{"test": "data"}');
      db.deleteTask(taskId);

      const task = db.getTaskById(taskId);
      expect(task).toBeUndefined();
    });
  });

  describe('getTaskStats', () => {
    it('should return task statistics', async () => {
      db.insertTask('{"test": "data1"}');
      db.insertTask('{"test": "data2"}');
      const taskId = db.insertTask('{"test": "data3"}');
      db.updateTaskStatus(taskId, 'completed', 0, null);

      const stats = db.getTaskStats();
      expect(stats).toBeInstanceOf(Array);

      const pendingStats = stats.find((s) => s.status === 'pending');
      const completedStats = stats.find((s) => s.status === 'completed');

      expect(pendingStats.count).toBe(2);
      expect(completedStats.count).toBe(1);
    });
  });

  describe('cleanupCompletedTasks', () => {
    it('should remove old completed tasks', async () => {
      const taskId1 = db.insertTask('{"test": "data1"}');
      const taskId2 = db.insertTask('{"test": "data2"}');

      db.updateTaskStatus(taskId1, 'completed', 0, null);
      db.updateTaskStatus(taskId2, 'completed', 0, null);

      // Manually update one task to be old
      db.run(
        `
        UPDATE queue 
        SET updated_at = datetime('now', '-25 hours') 
        WHERE id = ?
      `,
        [taskId1]
      );

      const deletedCount = db.cleanupCompletedTasks(24);
      expect(deletedCount.changes).toBe(1);

      const task1 = db.getTaskById(taskId1);
      const task2 = db.getTaskById(taskId2);

      expect(task1).toBeUndefined();
      expect(task2).toBeDefined();
    });
  });
});
