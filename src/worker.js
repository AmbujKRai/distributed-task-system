const { Worker } = require('bullmq');
const db = require('./config/database');
const { connection } = require('./config/queue');
const logger = require('./config/logger');
require('dotenv').config();

async function processTask(taskId, payload) {
  logger.info('Processing task', { taskId, action: payload.action });
  
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
    
    logger.info('Job started', { 
      jobId: job.id, 
      taskId, 
      attempt: job.attemptsMade + 1,
    });
    
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
      
      logger.info('Job completed', { jobId: job.id, taskId });
      
      return result;
    } catch (error) {
      logger.error('Job processing failed', { 
        jobId: job.id, 
        taskId, 
        error: error.message,
        stack: error.stack,
      });
      
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
  logger.info('Worker event: completed', { jobId: job.id });
});

worker.on('failed', async (job, err) => {
  logger.error('Worker event: failed', { 
    jobId: job.id, 
    error: err.message,
    attempts: job.attemptsMade,
  });
  
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
  logger.error('Worker error', { error: err.message, stack: err.stack });
});

logger.info('Worker started', { 
  concurrency: 5,
  environment: process.env.NODE_ENV,
});

process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, closing worker');
  await worker.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, closing worker');
  await worker.close();
  process.exit(0);
});