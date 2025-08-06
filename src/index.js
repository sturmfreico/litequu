/**
 * LiteQuu - A lightweight, persistent queue library for Node.js
 *
 * @module litequu
 * @author Your Name
 * @version 1.0.0
 */

import Queue from './queue.js';
import Database from './db.js';

/**
 * Default export - The main Queue class for task queue management.
 * @type {Queue}
 */
export default Queue;

/**
 * Named exports for Queue and Database classes.
 * @type {Object}
 * @property {Queue} Queue - The main queue class for task management
 * @property {Database} Database - The database class for direct database operations
 */
export { Queue, Database };
