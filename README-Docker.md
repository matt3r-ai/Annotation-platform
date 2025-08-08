# 🐳 MATT3R Annotation Platform - Docker Setup

This document explains how to containerize and run the MATT3R Annotation Platform using Docker.

## 📋 Prerequisites

- Docker (version 20.10 or higher)
- Docker Compose (version 2.0 or higher)
- AWS credentials (for S3 access)

## 🚀 Quick Start

### 1. **Clone and Setup**
```bash
git clone <your-repo-url>
cd annotation-platform
```

### 2. **Configure Environment**
```bash
# Copy environment template
cp env.example .env

# Edit .env file with your AWS credentials
nano .env
```

Required environment variables:
```env
AWS_ACCESS_KEY_ID=your_aws_access_key_id
AWS_SECRET_ACCESS_KEY=your_aws_secret_access_key
AWS_DEFAULT_REGION=us-west-2
AWS_S3_BUCKET=your-s3-bucket-name
```

### 3. **Start the Application**
```bash
# Make scripts executable
chmod +x start-docker.sh stop-docker.sh

# Start the application
./start-docker.sh
```

### 4. **Access the Application**
- **Frontend**: http://localhost
- **Backend API**: http://localhost:8000
- **Health Check**: http://localhost:8000/api/health

## 🛠️ Manual Commands

### Build and Start
```bash
# Build all services
docker-compose build

# Start services in background
docker-compose up -d

# View logs
docker-compose logs -f

# View specific service logs
docker-compose logs -f backend
docker-compose logs -f frontend
```

### Stop and Cleanup
```bash
# Stop services
docker-compose down

# Stop and remove volumes
docker-compose down -v

# Stop and remove everything
docker-compose down -v --remove-orphans
```

## 📁 Project Structure

```
annotation-platform/
├── backend/
│   ├── Dockerfile          # Backend container config
│   ├── requirements.txt    # Python dependencies
│   └── main.py            # FastAPI application
├── frontend/
│   ├── Dockerfile         # Frontend container config
│   ├── nginx.conf         # Nginx configuration
│   └── package.json       # Node.js dependencies
├── docker-compose.yml     # Multi-service orchestration
├── .dockerignore          # Docker ignore rules
├── env.example           # Environment template
├── start-docker.sh       # Startup script
└── stop-docker.sh        # Shutdown script
```

## 🔧 Container Architecture

```
┌─────────────────────────────────────┐
│           Frontend (Nginx)          │
│           Port: 80                  │
│  ┌─────────────────────────────────┐ │
│  │      React App (Built)         │ │
│  └─────────────────────────────────┘ │
└─────────────────────────────────────┘
                │
                ▼ (API Proxy)
┌─────────────────────────────────────┐
│           Backend (FastAPI)         │
│           Port: 8000                │
│  ┌─────────────────────────────────┐ │
│  │      Python Application        │ │
│  │      (uvicorn server)         │ │
│  └─────────────────────────────────┘ │
└─────────────────────────────────────┘
```

## 🔍 Troubleshooting

### Common Issues

1. **Port Already in Use**
   ```bash
   # Check what's using the port
   lsof -i :80
   lsof -i :8000
   
   # Stop conflicting services
   sudo systemctl stop nginx  # if nginx is running
   ```

2. **AWS Credentials Error**
   ```bash
   # Check if credentials are set
   docker-compose logs backend | grep AWS
   
   # Verify .env file
   cat .env
   ```

3. **Build Failures**
   ```bash
   # Clean build cache
   docker-compose build --no-cache
   
   # Remove all containers and images
   docker system prune -a
   ```

4. **Permission Issues**
   ```bash
   # Fix script permissions
   chmod +x start-docker.sh stop-docker.sh
   
   # Run with sudo if needed
   sudo ./start-docker.sh
   ```

### Debug Commands

```bash
# Check container status
docker-compose ps

# View real-time logs
docker-compose logs -f

# Access container shell
docker-compose exec backend bash
docker-compose exec frontend sh

# Check container resources
docker stats

# View container details
docker-compose exec backend env
```

## 🔄 Development Workflow

### Making Changes

1. **Frontend Changes**
   ```bash
   # Rebuild frontend only
   docker-compose build frontend
   docker-compose up -d frontend
   ```

2. **Backend Changes**
   ```bash
   # Rebuild backend only
   docker-compose build backend
   docker-compose up -d backend
   ```

3. **Hot Reload (Development)**
   ```bash
   # For development, you can mount source code
   # Edit docker-compose.yml to add volumes
   ```

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `AWS_ACCESS_KEY_ID` | AWS Access Key | Yes |
| `AWS_SECRET_ACCESS_KEY` | AWS Secret Key | Yes |
| `AWS_DEFAULT_REGION` | AWS Region | Yes |
| `AWS_S3_BUCKET` | S3 Bucket Name | Yes |

## 📊 Monitoring

### Health Checks
- Backend: `http://localhost:8000/api/health`
- Frontend: `http://localhost` (should return 200)

### Logs
```bash
# All services
docker-compose logs

# Specific service
docker-compose logs backend
docker-compose logs frontend

# Follow logs
docker-compose logs -f
```

## 🚀 Production Deployment

### Security Considerations
1. Use `.env` file for sensitive data
2. Never commit `.env` to version control
3. Use AWS IAM roles instead of access keys when possible
4. Enable HTTPS in production

### Performance Optimization
1. Use multi-stage builds (already implemented)
2. Enable gzip compression (configured in nginx)
3. Use Docker volumes for persistent data
4. Monitor resource usage

### Scaling
```bash
# Scale backend services
docker-compose up -d --scale backend=3

# Use load balancer for multiple instances
```

## 📝 Notes

- The frontend is served by Nginx for better performance
- API calls are proxied from frontend to backend
- Static files are cached for better performance
- Health checks ensure service availability
- Volumes persist data between container restarts
