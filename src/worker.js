const { Worker } = require('bullmq');
const db = require('./config/database');
const { connection } = require('./config/queue');
require('dotenv').config();

async function processTask(taskId, payload) {
  console.log(`Processing task ${taskId}:`, payload);

  // For testing failures
//   if (payload.action === 'fail_test') {
//     throw new Error('Simulated failure for testing');
//   }
  
  switch (payload.action) {
    case 'send_email':
      await new Promise(resolve => setTimeout(resolve, 2000));
      return {
        sent: true,
        to: payload.to,
        timestamp: new Date().toISOString()
      };
      
    case 'process_data':
      await new Promise(resolve => setTimeout(resolve, 1500));
      return {
        processed: true,
        value: payload.value * 2,
        timestamp: new Date().toISOString()
      };
      
    case 'generate_report':
      await new Promise(resolve => setTimeout(resolve, 3000));
      return {
        report: 'Generated',
        pages: 10,
        timestamp: new Date().toISOString()
      };
      
    default:
      await new Promise(resolve => setTimeout(resolve, 1000));
      return {
        processed: true,
        data: payload,
        timestamp: new Date().toISOString()
      };
  }
}

const worker = new Worker(
  'tasks',
  async (job) => {
    const { taskId, payload } = job.data;
    
    console.log(`[Worker] Starting job ${job.id} for task ${taskId}`);
    
    try {
      await db.query(
        'UPDATE tasks SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
        ['PROCESSING', taskId]
      );
      
      await db.query(
        'INSERT INTO task_logs (task_id, status, message) VALUES ($1, $2, $3)',
        [taskId, 'PROCESSING', `Worker started processing (attempt ${job.attemptsMade + 1})`]
      );
      
      const result = await processTask(taskId, payload);
      
      await db.query(
        'UPDATE tasks SET status = $1, result = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3',
        ['COMPLETED', JSON.stringify(result), taskId]
      );
      
      await db.query(
        'INSERT INTO task_logs (task_id, status, message) VALUES ($1, $2, $3)',
        [taskId, 'COMPLETED', 'Task completed successfully']
      );
      
      console.log(`[Worker] Completed job ${job.id} for task ${taskId}`);
      
      return result;
    } catch (error) {
      console.error(`[Worker] Error processing task ${taskId}:`, error);
      
      await db.query(
        'INSERT INTO task_logs (task_id, status, message) VALUES ($1, $2, $3)',
        [taskId, 'FAILED', `Error: ${error.message}`]
      );
      
      throw error;
    }
  },
  {
    connection,
    concurrency: 5,
    limiter: {
      max: 10,
      duration: 1000,
    },
  }
);

worker.on('completed', (job) => {
  console.log(`[Worker] Job ${job.id} completed successfully`);
});

worker.on('failed', async (job, err) => {
  console.error(`[Worker] Job ${job.id} failed:`, err.message);
  
  if (job.attemptsMade >= job.opts.attempts) {
    const { taskId } = job.data;
    
    await db.query(
      'UPDATE tasks SET status = $1, error = $2, retry_count = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $4',
      ['FAILED', err.message, job.attemptsMade, taskId]
    );
    
    await db.query(
      'INSERT INTO task_logs (task_id, status, message) VALUES ($1, $2, $3)',
      [taskId, 'FAILED', `Task failed after ${job.attemptsMade} attempts: ${err.message}`]
    );
  } else {
    const { taskId } = job.data;
    await db.query(
      'UPDATE tasks SET retry_count = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [job.attemptsMade, taskId]
    );
  }
});

worker.on('error', (err) => {
  console.error('[Worker] Worker error:', err);
});

console.log('Worker started. Waiting for jobs...');

process.on('SIGTERM', async () => {
  console.log('SIGTERM received, closing worker...');
  await worker.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, closing worker...');
  await worker.close();
  process.exit(0);
});