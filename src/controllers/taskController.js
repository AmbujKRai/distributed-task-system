const db = require('../config/database');
const { taskQueue } = require('../config/queue');

const createTask = async (req, res) => {
  try {
    const { type, payload } = req.body;
    const userId = req.user.userId;

    if (!type || !payload) {
      return res.status(400).json({ error: 'Type and payload required' });
    }

    if (!['SYNC', 'ASYNC'].includes(type)) {
      return res.status(400).json({ error: 'Type must be SYNC or ASYNC' });
    }

    const result = await db.query(
      `INSERT INTO tasks (user_id, type, payload, status) 
       VALUES ($1, $2, $3, $4) 
       RETURNING *`,
      [userId, type, JSON.stringify(payload), type === 'SYNC' ? 'PROCESSING' : 'PENDING']
    );

    const task = result.rows[0];

    await db.query(
      'INSERT INTO task_logs (task_id, status, message) VALUES ($1, $2, $3)',
      [task.id, task.status, 'Task created']
    );

    if (type === 'SYNC') {
      const processedResult = { processed: true, data: payload };
      
      await db.query(
        'UPDATE tasks SET status = $1, result = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3',
        ['COMPLETED', JSON.stringify(processedResult), task.id]
      );

      await db.query(
        'INSERT INTO task_logs (task_id, status, message) VALUES ($1, $2, $3)',
        [task.id, 'COMPLETED', 'Task completed synchronously']
      );

      return res.status(200).json({
        message: 'Task completed',
        task: { ...task, status: 'COMPLETED', result: processedResult }
      });
    }

    await taskQueue.add(
      'process-task',
      {
        taskId: task.id,
        userId: userId,
        payload: payload,
      },
      {
        jobId: task.id,
        removeOnComplete: true,
        removeOnFail: false,
      }
    );

    res.status(202).json({
      message: 'Task accepted for processing',
      task
    });
  } catch (error) {
    console.error('Create task error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const getTaskStatus = async (req, res) => {
  try {
    const { taskId } = req.params;
    const userId = req.user.userId;

    const result = await db.query(
      'SELECT * FROM tasks WHERE id = $1 AND user_id = $2',
      [taskId, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }

    res.json({ task: result.rows[0] });
  } catch (error) {
    console.error('Get task status error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const getUserTasks = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { status, limit = 50, offset = 0 } = req.query;

    let query = 'SELECT * FROM tasks WHERE user_id = $1';
    const params = [userId];

    if (status) {
      query += ' AND status = $2';
      params.push(status);
    }

    query += ' ORDER BY created_at DESC LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2);
    params.push(limit, offset);

    const result = await db.query(query, params);

    res.json({ tasks: result.rows, count: result.rows.length });
  } catch (error) {
    console.error('Get user tasks error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

module.exports = { createTask, getTaskStatus, getUserTasks };