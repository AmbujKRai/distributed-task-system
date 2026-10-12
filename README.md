# Distributed Task Processing System

A backend that accepts tasks over a REST API, runs long jobs in the background on separate worker processes, and retries failed jobs automatically. I built it to learn how job queues, retries and horizontal scaling work in practice.

Stack: Node.js, Express, PostgreSQL, Redis, BullMQ, Nginx, Docker Compose, GitHub Actions.

## Architecture

```
Client
  |
Nginx  (least-connections load balancing, 10 req/s per IP rate limit)
  |
API x2  (Express, JWT auth)
  |            \
PostgreSQL     Redis (BullMQ queue "tasks")
(tasks,          |
 task_logs)    Worker x2  (concurrency 5 each)
     ^           |
     +-----------+  workers write status and results back to Postgres
```

## How a task flows

1. `POST /api/tasks` inserts a row into `tasks` and a "created" entry into `task_logs`.
2. **SYNC** tasks complete inside the request and return `200`.
3. **ASYNC** tasks are pushed onto the BullMQ queue with the task's UUID as the job ID, and the API returns `202 Accepted`. Using the task ID as the job ID means the same task cannot be queued twice.
4. A worker picks up the job, marks the task `PROCESSING`, runs the handler, then marks it `COMPLETED` with the result.
5. If the handler throws, BullMQ retries it up to **3 attempts** with exponential backoff (2 s, then 4 s). Each retry updates `retry_count`. After the last attempt the task is marked `FAILED` with the error.
6. Every state change is written to `task_logs`, so each task has a full audit trail.

Task states: `PENDING -> PROCESSING -> COMPLETED` or `FAILED`.

## Running it

Requires Docker Desktop.

```bash
git clone https://github.com/AmbujKRai/distributed-task-system.git
cd distributed-task-system
cp .env.example .env        # set DB_PASSWORD and JWT_SECRET
docker compose up --build
```

This starts Postgres, Redis, 2 API replicas, 2 workers and Nginx. The API is reachable through Nginx on `http://localhost`. The schema in `src/models/schema.sql` is applied automatically on first start.

Scale workers:

```bash
docker compose up -d --scale worker=4
```

If you scale the API, restart Nginx afterwards (`docker compose restart nginx`), because Nginx resolves the `api` service's addresses only at startup.

## API

All `/api/tasks` routes need `Authorization: Bearer <token>`.

| Method | Route | Description |
|---|---|---|
| POST | `/api/auth/register` | Create a user (`email`, `password`). Passwords are hashed with bcrypt. |
| POST | `/api/auth/login` | Returns a JWT valid for 24 hours. |
| POST | `/api/tasks` | Create a task: `{ "type": "SYNC" or "ASYNC", "payload": { "action": "..." } }` |
| GET | `/api/tasks/:taskId` | Status and result of one task (only your own tasks). |
| GET | `/api/tasks?status=COMPLETED&limit=50&offset=0` | Your tasks, newest first. |
| GET | `/health` | Liveness check, exposed through Nginx. |
| GET | `/ready` | Checks Postgres and Redis connectivity. Available on the API container only, not through Nginx. |

Example:

```bash
curl -X POST http://localhost/api/tasks \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"type":"ASYNC","payload":{"action":"send_email","to":"a@example.com"}}'
```

### Job handlers

The handlers are **simulated** with fixed delays so the queue behaviour can be observed without external services:

| `action` | Simulated duration |
|---|---|
| `send_email` | 2 s |
| `process_data` | 1.5 s (returns `value * 2`) |
| `generate_report` | 3 s |
| anything else | 1 s |

## Worker settings

- Concurrency: 5 jobs at a time per worker process.
- Rate limit: BullMQ's limiter (`max: 10` per 1000 ms) is shared by every worker on the queue, so total throughput is capped at 10 jobs/s however many workers run.
- Completed jobs are removed from Redis; failed jobs are kept for inspection. Postgres remains the source of truth for task state.
- On `SIGTERM` the worker calls `worker.close()`, which lets active jobs finish before the process exits.

## CI

`.github/workflows/deploy.yml` runs on every push to `main`:

1. Starts Postgres and Redis service containers, applies the schema and runs `npm test`.
2. Builds the API and worker Docker images and pushes them to GitHub Container Registry.

Deployment from there is manual (`docker compose pull && docker compose up -d` on the server). A second workflow deploys the API as a Node app to Azure App Service.

## Tests

`tests/auth.test.js` contains placeholder test cases only. Integration tests for auth, task creation and worker retries are still to be written.

## Known limitations

These are deliberate notes on what the current design does not handle yet:

- **Dual write on task creation.** The API inserts into Postgres and then adds the job to Redis as two separate steps. If Redis is down, the request returns `500` but the task row stays `PENDING` forever. A transactional outbox, or a sweeper that re-queues stale `PENDING` tasks, would fix this.
- **At-least-once execution.** If a worker crashes mid-job, BullMQ marks the job as stalled once its lock expires (30 s by default) and another worker runs it again. Handlers with real side effects, like sending an email, would need an idempotency check (for example, skip if the task is already `COMPLETED`).
- **API shutdown is not graceful.** The API process exits immediately on `SIGTERM` instead of draining in-flight requests.
- **No real handlers or load tests yet.** Throughput figures have not been measured.

## Project structure

```
src/
  config/        database.js (pg pool), queue.js (BullMQ queue + retry policy), logger.js (Winston)
  controllers/   authController.js, taskController.js
  middleware/    auth.js (JWT verification)
  routes/        auth.js, tasks.js
  models/        schema.sql (users, tasks, task_logs + indexes)
  server.js      Express app, /health and /ready
  worker.js      BullMQ worker and job handlers
docker-compose.yml, Dockerfile.api, Dockerfile.worker, Dockerfile.nginx, nginx.conf
```

## License

MIT
