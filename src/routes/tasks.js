const express = require('express');
const { createTask, getTaskStatus, getUserTasks } = require('../controllers/taskController');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

router.use(authenticateToken);

router.post('/', createTask);
router.get('/', getUserTasks);
router.get('/:taskId', getTaskStatus);

module.exports = router;