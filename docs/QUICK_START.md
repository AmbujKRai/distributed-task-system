# Quick Start Guide

## Run Locally

1. **Clone and setup**
```bash
git clone https://github.com/AmbujKRai/distributed-task-system.git
cd distributed-task-system
cp .env.example .env
```

2. **Start everything**
```bash
docker-compose up
```

3. **Test it works**
```bash
# Register
curl -X POST http://localhost/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password123"}'

# Login
curl -X POST http://localhost/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password123"}'
```

4. **View logs**
```bash
docker-compose logs -f
```