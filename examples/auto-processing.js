import Queue from '../src/index.js';

async function autoProcessingExample() {
  console.log('🤖 Auto-Processing SQLite Queue Example');
  console.log('=======================================\n');

  // Create a queue with auto-processing enabled
  const queue = new Queue({
    dbPath: './auto-queue.db',
    maxConcurrent: 2,
    maxRetries: 2,
    baseRetryDelay: 2000, // 2 seconds
    pollingInterval: 1000, // Check for new tasks every second
    autoProcess: true, // Enable automatic processing
  });

  // Event listeners
  queue.on('added', (info) => {
    console.log(
      `➕ Task ${info.taskId} added and will be processed automatically`
    );
  });

  queue.on('completed', (info) => {
    console.log(`✅ Task ${info.taskId} completed:`, info.result);
  });

  queue.on('retried', (info) => {
    console.log(`🔄 Task ${info.taskId} retry ${info.retryCount} scheduled`);
  });

  queue.on('failed', (info) => {
    console.log(`❌ Task ${info.taskId} permanently failed:`, info.error);
  });

  queue.on('error', (info) => {
    console.error('Queue error:', info.error);
  });

  // Define the task handler
  const emailHandler = async (taskData) => {
    console.log(`📧 Processing email task: ${taskData.type}`);

    switch (taskData.type) {
      case 'welcome_email':
        console.log(`  Sending welcome email to ${taskData.email}`);
        await simulateWork(1000);

        // Simulate occasional email service failures
        if (Math.random() < 0.3) {
          throw new Error('Email service temporarily unavailable');
        }

        return `Welcome email sent to ${taskData.email}`;

      case 'newsletter':
        console.log(`  Sending newsletter to ${taskData.email}`);
        await simulateWork(800);

        // Simulate rate limiting
        if (Math.random() < 0.2) {
          throw new Error('Rate limit exceeded');
        }

        return `Newsletter sent to ${taskData.email}`;

      case 'password_reset':
        console.log(`  Sending password reset to ${taskData.email}`);
        await simulateWork(600);

        // This type rarely fails
        if (Math.random() < 0.1) {
          throw new Error('Invalid email address');
        }

        return `Password reset sent to ${taskData.email}`;

      default:
        throw new Error(`Unknown email type: ${taskData.type}`);
    }
  };

  try {
    // Start the auto-processing
    console.log('Starting auto-processing...\n');
    queue.process(emailHandler);

    // Add some initial tasks
    console.log('Adding initial email tasks...\n');

    queue.add({
      type: 'welcome_email',
      email: 'john@example.com',
      userId: 1,
    });

    queue.add({
      type: 'newsletter',
      email: 'jane@example.com',
      subject: 'Weekly Updates',
    });

    queue.add({
      type: 'password_reset',
      email: 'admin@example.com',
      token: 'abc123',
    });

    // Add more tasks periodically to demonstrate continuous processing
    let taskCounter = 4;
    const addTasksInterval = setInterval(async () => {
      const emails = ['user1@test.com', 'user2@test.com', 'user3@test.com'];
      const types = ['welcome_email', 'newsletter', 'password_reset'];

      const randomEmail = emails[Math.floor(Math.random() * emails.length)];
      const randomType = types[Math.floor(Math.random() * types.length)];

      queue.add({
        type: randomType,
        email: randomEmail,
        userId: taskCounter++,
      });

      console.log(`📬 Added random ${randomType} task for ${randomEmail}`);
    }, 3000); // Add a new task every 3 seconds

    // Show queue status periodically
    const statusInterval = setInterval(async () => {
      const stats = queue.getStats();
      const status = queue.status;

      console.log('\n📊 Queue Status:');
      console.log(
        `  Currently running: ${status.currentRunning}/${status.maxConcurrent}`
      );
      console.log(
        `  Stats:`,
        stats.map((s) => `${s.status}:${s.count}`).join(', ')
      );
      console.log('');
    }, 5000);

    // Run for 30 seconds then cleanup
    setTimeout(async () => {
      console.log('\n🛑 Stopping auto-processing example...');

      clearInterval(addTasksInterval);
      clearInterval(statusInterval);

      // Process any remaining tasks
      console.log('Processing remaining tasks...');
      await new Promise((resolve) => setTimeout(resolve, 5000));

      // Show final stats
      const finalStats = queue.getStats();
      console.log('\n📈 Final Statistics:');
      finalStats.forEach((stat) => {
        console.log(`  ${stat.status}: ${stat.count} tasks`);
      });

      await queue.close();
      console.log('\n🏁 Auto-processing example completed');
      process.exit(0);
    }, 30000); // Run for 30 seconds
  } catch (error) {
    console.error('Error in auto-processing example:', error);
    await queue.close();
    process.exit(1);
  }
}

function simulateWork(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Run the example
if (import.meta.url === `file://${process.argv[1]}`) {
  autoProcessingExample().catch(console.error);
}

export default autoProcessingExample;
