import Queue from '../src/index.js';

async function basicExample() {
  console.log('🚀 Basic SQLite Queue Example');
  console.log('================================\n');

  // Create a queue with custom configuration
  const queue = new Queue({
    dbPath: './example-queue.db',
    maxConcurrent: 3,
    maxRetries: 3,
    baseRetryDelay: 1000, // 1 second
    autoProcess: false, // We'll process manually for this example
  });

  // Set up event listeners
  queue.on('added', (info) => {
    console.log(`✅ Task ${info.taskId} added:`, info.taskData);
  });

  queue.on('completed', (info) => {
    console.log(`🎉 Task ${info.taskId} completed with result:`, info.result);
  });

  queue.on('retried', (info) => {
    console.log(
      `🔄 Task ${info.taskId} failed, retry ${info.retryCount} scheduled in ${info.delay}ms`
    );
  });

  queue.on('failed', (info) => {
    console.log(
      `❌ Task ${info.taskId} permanently failed after ${info.retryCount} attempts:`,
      info.error
    );
  });

  try {
    // Add various types of tasks
    console.log('Adding tasks to queue...\n');

    queue.add({
      type: 'calculate',
      operation: 'multiply',
      values: [6, 7],
    });

    queue.add({
      type: 'api_call',
      url: 'https://jsonplaceholder.typicode.com/posts/1',
      method: 'GET',
    });

    queue.add({
      type: 'file_process',
      filename: 'data.txt',
      action: 'count_lines',
    });

    queue.add({
      type: 'simulate_failure',
      fail_chance: 0.7, // 70% chance to fail
    });

    // Define task handler
    const taskHandler = async (taskData) => {
      console.log(`🔄 Processing task of type: ${taskData.type}`);

      switch (taskData.type) {
        case 'calculate':
          if (taskData.operation === 'multiply') {
            const result = taskData.values.reduce((a, b) => a * b, 1);
            await simulateWork(500); // Simulate some processing time
            return result;
          }
          throw new Error(`Unknown operation: ${taskData.operation}`);

        case 'api_call':
          // Simulate API call
          await simulateWork(800);
          if (Math.random() < 0.3) {
            // 30% chance of failure
            throw new Error('API call failed - network timeout');
          }
          return {
            status: 200,
            data: { title: 'Sample Post', body: 'This is a sample response' },
          };

        case 'file_process':
          await simulateWork(300);
          if (taskData.filename === 'data.txt') {
            return { lines: 42, size: 1024 };
          }
          throw new Error(`File not found: ${taskData.filename}`);

        case 'simulate_failure':
          await simulateWork(200);
          if (Math.random() < taskData.fail_chance) {
            throw new Error('Simulated random failure');
          }
          return 'Task completed successfully!';

        default:
          throw new Error(`Unknown task type: ${taskData.type}`);
      }
    };

    // Process tasks
    console.log('\nStarting task processing...\n');

    // Process tasks multiple times to handle retries
    for (let round = 1; round <= 5; round++) {
      console.log(`--- Processing Round ${round} ---`);
      await queue.processOnce(taskHandler);

      // Wait a bit between rounds to see retry delays in action
      await new Promise((resolve) => setTimeout(resolve, 1500));

      const stats = queue.getStats();
      console.log('Queue stats:', stats);
      console.log('');
    }

    // Show final statistics
    console.log('Final Queue Statistics:');
    const finalStats = queue.getStats();
    finalStats.forEach((stat) => {
      console.log(`  ${stat.status}: ${stat.count} tasks`);
    });
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await queue.close();
    console.log('\n🏁 Queue closed');
  }
}

// Helper function to simulate work
function simulateWork(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Run the example
if (import.meta.url === `file://${process.argv[1]}`) {
  basicExample().catch(console.error);
}

export default basicExample;
