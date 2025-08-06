import Queue from '../src/index.js';

async function apiWorkerExample() {
  console.log('🌐 API Worker Queue Example');
  console.log('===========================\n');

  const queue = new Queue({
    dbPath: './api-worker-queue.db',
    maxConcurrent: 4, // Process 4 API calls concurrently
    maxRetries: 3,
    baseRetryDelay: 2000,
    jitter: true, // Add randomness to retry delays
    autoProcess: true,
  });

  // Track API call statistics
  const stats = {
    total: 0,
    successful: 0,
    failed: 0,
    retried: 0,
  };

  queue.on('added', (info) => {
    stats.total++;
    console.log(
      `📤 API task ${info.taskId} queued: ${info.taskData.method} ${info.taskData.url}`
    );
  });

  queue.on('completed', (info) => {
    stats.successful++;
    console.log(`✅ API call ${info.taskId} succeeded (${info.result.status})`);
  });

  queue.on('retried', (info) => {
    stats.retried++;
    console.log(
      `🔄 API call ${info.taskId} retry ${info.retryCount} - ${info.error}`
    );
  });

  queue.on('failed', (info) => {
    stats.failed++;
    console.log(`❌ API call ${info.taskId} permanently failed: ${info.error}`);
  });

  // Simulate HTTP client
  async function makeHttpRequest(method, url) {
    const delay = 200 + Math.random() * 800; // 200-1000ms response time
    await new Promise((resolve) => setTimeout(resolve, delay));

    // Simulate various HTTP responses
    const rand = Math.random();

    if (rand < 0.7) {
      // Success
      return {
        status: 200,
        data: { message: 'Success', timestamp: Date.now(), url },
        headers: { 'content-type': 'application/json' },
      };
    } else if (rand < 0.85) {
      // Server error (retryable)
      throw new Error(`HTTP 500: Internal Server Error from ${url}`);
    } else if (rand < 0.95) {
      // Network timeout (retryable)
      throw new Error(`Network timeout for ${url}`);
    } else {
      // Client error (not retryable, but we'll retry anyway for demo)
      throw new Error(`HTTP 404: Not Found - ${url}`);
    }
  }

  // API task handler
  const apiHandler = async (taskData) => {
    const { method, url, headers, body, timeout } = taskData;

    console.log(`🔄 Making ${method} request to ${url}`);

    try {
      const response = await makeHttpRequest(method, url, {
        headers,
        body,
        timeout,
      });

      return {
        status: response.status,
        success: true,
        url: url,
        responseTime: `${Math.floor(Math.random() * 800 + 200)}ms`,
      };
    } catch (error) {
      // Add context to the error
      throw new Error(`API call failed: ${error.message}`);
    }
  };

  try {
    console.log('Starting API worker...\n');
    queue.process(apiHandler);

    // Add various API tasks
    const apiTasks = [
      {
        method: 'GET',
        url: 'https://api.example.com/users',
        headers: { Authorization: 'Bearer token123' },
      },
      {
        method: 'POST',
        url: 'https://api.example.com/users',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'John Doe', email: 'john@example.com' }),
      },
      {
        method: 'GET',
        url: 'https://api.example.com/orders/12345',
      },
      {
        method: 'PUT',
        url: 'https://api.example.com/profile/user123',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'active' }),
      },
      {
        method: 'DELETE',
        url: 'https://api.example.com/cache/temp-data',
      },
      {
        method: 'GET',
        url: 'https://api.unreliable-service.com/data',
        timeout: 5000,
      },
    ];

    console.log('Adding API tasks to queue...\n');
    for (const task of apiTasks) {
      await queue.add(task);
      await new Promise((resolve) => setTimeout(resolve, 500)); // Stagger task addition
    }

    // Add more tasks periodically
    let taskId = 7;
    const addMoreTasks = setInterval(async () => {
      const endpoints = [
        '/api/health',
        '/api/metrics',
        '/api/status',
        '/api/config',
        '/api/logs',
      ];

      const randomEndpoint =
        endpoints[Math.floor(Math.random() * endpoints.length)];

      await queue.add({
        method: 'GET',
        url: `https://service-${taskId}.example.com${randomEndpoint}`,
        headers: { 'X-Request-ID': `req-${taskId}` },
      });

      taskId++;
    }, 2000);

    // Show statistics periodically
    const showStats = setInterval(() => {
      console.log('\n📊 API Worker Statistics:');
      console.log(`  Total tasks: ${stats.total}`);
      console.log(`  Successful: ${stats.successful}`);
      console.log(`  Failed: ${stats.failed}`);
      console.log(`  Retried: ${stats.retried}`);
      console.log(
        `  Success rate: ${
          stats.total > 0
            ? ((stats.successful / stats.total) * 100).toFixed(1)
            : 0
        }%`
      );

      const queueStatus = queue.status;
      console.log(
        `  Currently processing: ${queueStatus.currentRunning}/${queueStatus.maxConcurrent}`
      );
      console.log('');
    }, 5000);

    // Run for 25 seconds
    setTimeout(async () => {
      console.log('\n🛑 Stopping API worker...');

      clearInterval(addMoreTasks);
      clearInterval(showStats);

      // Wait for remaining tasks
      console.log('Waiting for remaining tasks to complete...');
      await new Promise((resolve) => setTimeout(resolve, 5000));

      // Final statistics
      console.log('\n📈 Final API Worker Statistics:');
      console.log(`  Total API calls: ${stats.total}`);
      console.log(
        `  Successful: ${stats.successful} (${(
          (stats.successful / stats.total) *
          100
        ).toFixed(1)}%)`
      );
      console.log(
        `  Failed: ${stats.failed} (${(
          (stats.failed / stats.total) *
          100
        ).toFixed(1)}%)`
      );
      console.log(`  Total retries: ${stats.retried}`);

      const dbStats = await queue.getStats();
      console.log('\n📋 Database Statistics:');
      dbStats.forEach((stat) => {
        console.log(`  ${stat.status}: ${stat.count} tasks`);
      });

      await queue.close();
      console.log('\n🏁 API worker example completed');
      process.exit(0);
    }, 25000);
  } catch (error) {
    console.error('Error in API worker example:', error);
    await queue.close();
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  apiWorkerExample().catch(console.error);
}

export default apiWorkerExample;
