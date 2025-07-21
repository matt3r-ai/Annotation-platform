# Annotation Platform - Simplified Version

A web-based GPS data visualization and video clipping platform.

## Quick Start

### Using Docker (Recommended)

```bash
# 1. Configure AWS credentials
# Edit the .env file and fill in your AWS credentials

# 2. Start the application
Docker-compose up -d

# 3. Access the application
# Frontend: http://localhost:3000
# Backend: http://localhost:8000
```

### Manual Startup

```bash
# Backend
cd backend
pip install -r requirements.txt
python main.py

# Frontend
cd frontend
npm install
npm start
```

## Features

- S3 data connection
- GPS trajectory visualization
- Video timestamp clipping
- Simple user interface
