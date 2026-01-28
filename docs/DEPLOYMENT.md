# Deployment Guide

## Local Development
```bash
# Start all services
docker-compose up

# Start in detached mode
docker-compose up -d

# View logs
docker-compose logs -f

# Stop all services
docker-compose down
```

## Production Deployment to AWS

### Prerequisites

1. **AWS Account** with EC2, RDS, ElastiCache access
2. **EC2 Instance** (t3.medium or larger)
3. **RDS PostgreSQL** database
4. **ElastiCache Redis** cluster
5. **Security Groups** configured

### Step 1: Launch EC2 Instance
```bash
# Amazon Linux 2023 or Ubuntu 22.04
# Instance type: t3.medium (2 vCPU, 4GB RAM)
# Storage: 20GB EBS
# Security Group: Allow ports 22 (SSH), 80 (HTTP), 443 (HTTPS)
```

### Step 2: Install Docker on EC2
```bash
# SSH into EC2
ssh -i your-key.pem ec2-user@your-ec2-ip

# Install Docker
sudo yum update -y
sudo yum install docker -y
sudo service docker start
sudo usermod -a -G docker ec2-user

# Install Docker Compose
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

# Verify
docker --version
docker-compose --version
```

### Step 3: Setup RDS Database

1. Create PostgreSQL RDS instance (db.t3.micro for testing)
2. Security Group: Allow port 5432 from EC2 security group
3. Note the endpoint: `your-db.xxxx.us-east-1.rds.amazonaws.com`
4. Initialize schema:
```bash
psql -h your-rds-endpoint -U postgres -d task_system -f src/models/schema.sql
```

### Step 4: Setup ElastiCache Redis

1. Create Redis cluster (cache.t3.micro for testing)
2. Security Group: Allow port 6379 from EC2 security group
3. Note the endpoint: `your-redis.xxxxx.cache.amazonaws.com`

### Step 5: Deploy Application
```bash
# On EC2 instance
git clone https://github.com/yourusername/distributed-task-system.git
cd distributed-task-system

# Create production env file
cp .env.production.example .env
nano .env  # Edit with your RDS and Redis endpoints

# Pull images from GitHub Container Registry
docker login ghcr.io
docker-compose pull

# Start services
docker-compose up -d

# Check status
docker-compose ps
docker-compose logs -f
```

### Step 6: Verify Deployment
```bash
# Health check
curl http://your-ec2-ip/health

# Readiness check
curl http://your-ec2-ip/ready
```

## Scaling

### Scale API Servers
```bash
docker-compose up -d --scale api=5
```

### Scale Workers
```bash
docker-compose up -d --scale worker=10
```

## Monitoring

### View Logs
```bash
# All services
docker-compose logs -f

# Specific service
docker-compose logs -f api
docker-compose logs -f worker
docker-compose logs -f nginx
```

### Resource Usage
```bash
docker stats
```

## Backup & Recovery

### Database Backup
```bash
# Manual backup
pg_dump -h your-rds-endpoint -U postgres task_system > backup.sql

# Automated (add to cron)
0 2 * * * pg_dump -h your-rds-endpoint -U postgres task_system > /backups/task_system_$(date +\%Y\%m\%d).sql
```

### Redis Backup

ElastiCache handles automated backups. Configure snapshot retention in AWS console.

## Troubleshooting

### Container won't start
```bash
docker-compose logs <service_name>
docker-compose restart <service_name>
```

### Database connection issues
```bash
# Test from EC2
psql -h your-rds-endpoint -U postgres -d task_system -c "SELECT 1"
```

### Redis connection issues
```bash
# Test from EC2
redis-cli -h your-redis-endpoint ping
```

## CI/CD Pipeline

GitHub Actions automatically:
1. Runs tests on every push
2. Builds Docker images on main branch
3. Pushes images to GitHub Container Registry

To deploy latest version:
```bash
cd /path/to/app
git pull
docker-compose pull
docker-compose up -d
```

## SSL/HTTPS Setup (Optional)

1. Get domain name
2. Point A record to EC2 elastic IP
3. Install Certbot
```bash
sudo yum install certbot python3-certbot-nginx -y
sudo certbot --nginx -d yourdomain.com
```

4. Update nginx.conf for HTTPS
5. Auto-renewal: `sudo certbot renew --dry-run`