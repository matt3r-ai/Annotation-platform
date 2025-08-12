# MATT3R Annotation Platform

A web-based GPS data visualization and video clipping platform for annotation and analysis.

## 🚀 Quick Start

### Option 1: Docker Compose (Recommended for existing Docker users)

**Prerequisites**: Docker Desktop 4.0+ and Docker Compose 2.0+ must be installed

```bash
# Clone the repository
git clone https://github.com/matt3r-ai/Annotation-platform.git
cd Annotation-platform

# Start all services
./start.bat                    # Windows
./start-docker.sh             # Linux/macOS

# Or manually with Docker Compose
docker-compose up -d
```

**Access URLs:**
- Frontend: http://localhost
- Backend API: http://localhost:8000
- Health Check: http://localhost:8000/api/health

### Option 2: From Zero Deployment (Recommended for new users)

**Includes**: Automatic Docker installation and environment setup

```bash
# Clone the repository
git clone https://github.com/matt3r-ai/Annotation-platform.git
cd Annotation-platform

# Windows - Complete setup including Docker installation
./deploy-from-zero-windows.bat

# Linux/macOS - Complete setup including Docker installation
./deploy-from-zero.sh
```

### Option 3: Manual Setup (For developers)

**Prerequisites**: Python 3.8+, Node.js 16+, FFmpeg

```bash
# Clone the repository
git clone https://github.com/matt3r-ai/Annotation-platform.git
cd Annotation-platform

# Backend
cd backend
pip install -r requirements.txt
python main.py

# Frontend (in another terminal)
cd frontend
npm install
npm start
```

## 🐳 Deployment Options

### Docker Compose Deployment
- **Best for**: Development, testing, single-server production
- **Requirements**: Docker Desktop 4.0+, Docker Compose 2.0+ (must be pre-installed)
- **Scripts**: `start.bat`, `start-docker.sh`
- **Configuration**: `docker-compose.yml`
- **Environment Setup**: ❌ Not included (assumes Docker is already installed)
- **Python/Node.js**: ❌ Not needed (runs in Docker containers)

### From Zero Deployment (Recommended for new users)
- **Best for**: New users, fresh installations, automated setup
- **Requirements**: Windows/Linux/macOS with internet connection
- **Scripts**: `deploy-from-zero-windows.bat`, `deploy-from-zero.sh`
- **Configuration**: Automatic Docker installation + application setup
- **Environment Setup**: ✅ Fully automated (installs Docker, builds images, starts services)
- **Python/Node.js**: ❌ Not needed (runs in Docker containers)

### Manual Deployment
- **Best for**: Development, custom environments, advanced users
- **Requirements**: Python 3.8+, Node.js 16+, FFmpeg (must be pre-installed)
- **Configuration**: Manual environment setup
- **Environment Setup**: ❌ Not included (assumes all dependencies are installed)
- **Python/Node.js**: ✅ Must be manually installed

## 🎯 Quick Selection Guide

| Your Situation | Recommended Option | Why? |
|----------------|-------------------|------|
| **New to Docker** | Option 2: From Zero Deployment | Automatically installs everything you need |
| **Already have Docker** | Option 1: Docker Compose | Fastest way to get started |
| **Developer/Contributor** | Option 3: Manual Setup | Full control over dependencies |
| **Production deployment** | Option 1 + Custom config | Stable and reliable |
| **Testing/Evaluation** | Option 2: From Zero Deployment | Ensures consistent environment |

## 🔧 Environment Installation Requirements

### What Each Option Installs

| Option | Python | Node.js/npm | Docker | FFmpeg | Notes |
|--------|--------|-------------|--------|--------|-------|
| **Option 1: Docker Compose** | ❌ | ❌ | ❌ | ❌ | Assumes all environments are pre-installed |
| **Option 2: From Zero** | ❌ | ❌ | ✅ | ❌ | Only installs Docker, uses Docker images |
| **Option 3: Manual** | ❌ | ❌ | ❌ | ❌ | Assumes all environments are pre-installed |

### Manual Environment Installation

If you need to install Python, Node.js, or other dependencies manually:

#### Python Environment
```bash
# Windows - Download from python.org
# macOS - Use Homebrew
brew install python

# Linux - Use package manager
sudo apt update
sudo apt install python3 python3-pip  # Ubuntu/Debian
sudo yum install python3 python3-pip  # CentOS/RHEL
```

#### Node.js and npm
```bash
# Windows - Download from nodejs.org
# macOS - Use Homebrew
brew install node

# Linux - Use package manager
sudo apt install nodejs npm  # Ubuntu/Debian
sudo yum install nodejs npm  # CentOS/RHEL

# Or use Node Version Manager (nvm)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
nvm install 16
nvm use 16
```

#### FFmpeg
```bash
# Windows - Download from ffmpeg.org
# macOS - Use Homebrew
brew install ffmpeg

# Linux - Use package manager
sudo apt install ffmpeg  # Ubuntu/Debian
sudo yum install ffmpeg  # CentOS/RHEL
```

## 🔧 Prerequisites

### Docker Compose
- Docker Desktop 4.0+
- Docker Compose 2.0+
- 4GB+ RAM
- 10GB+ disk space

### Nomad
- Nomad 1.4+
- Consul 1.15+ (recommended)
- Vault 1.12+ (for secrets management)
- 8GB+ RAM per node
- 20GB+ disk space per node

### Manual
- Python 3.8+
- Node.js 16+
- FFmpeg
- 2GB+ RAM

## 📁 Project Structure

```
Annotation-platform/
├── backend/                 # Python FastAPI backend
│   ├── Dockerfile
│   ├── main.py
│   ├── requirements.txt
│   └── s3_utils.py
├── frontend/               # React frontend
│   ├── Dockerfile
│   ├── package.json
│   └── src/
├── docker-compose.yml      # Docker Compose configuration
├── start.bat              # Windows startup script
├── start-docker.sh        # Linux/macOS startup script
├── deploy-from-zero-*.bat # Zero-to-deployment scripts
└── env.example            # Environment variables template
```

## ⚙️ Configuration

### Environment Variables
Create a `.env` file from `env.example`:

```bash
# AWS Configuration
AWS_ACCESS_KEY_ID=your_access_key
AWS_SECRET_ACCESS_KEY=your_secret_key
AWS_DEFAULT_REGION=us-west-2
AWS_S3_BUCKET=your-bucket-name

# Application Configuration
NODE_ENV=production
REACT_APP_API_URL=http://localhost:8000

# Mapbox Configuration
MAPBOX_TOKEN=your_mapbox_token
```

### Port Configuration
- **Frontend**: Port 80 (configurable in docker-compose.yml)
- **Backend**: Port 8000 (configurable in docker-compose.yml)

## 🚀 Deployment Scripts

### Windows Scripts
- `start.bat` - Start services
- `deploy-from-zero-windows.bat` - Complete deployment from scratch
- `test-environment.bat` - Environment validation
- `check-aws-credentials.bat` - AWS credentials verification

### Linux/macOS Scripts
- `start-docker.sh` - Start services
- `deploy-from-zero.sh` - Complete deployment from scratch
- `stop-docker.sh` - Stop services

## 🔍 Troubleshooting

### Common Issues
1. **Port conflicts**: Check if ports 80/8000 are available
2. **Docker not running**: Start Docker Desktop
3. **AWS credentials**: Verify `.env` file configuration
4. **Build failures**: Check Docker logs with `docker-compose logs`

### Useful Commands
```bash
# View service status
docker-compose ps

# View logs
docker-compose logs -f

# Restart services
docker-compose restart

# Stop all services
docker-compose down
```

## 📚 Documentation

- [Docker Deployment Guide](README-Docker.md)
- [Nomad Deployment Guide](docs/nomad-deployment.md) - Coming soon
- [API Documentation](http://localhost:8000/docs) - When running

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## 📄 License

This project is licensed under the MIT License.

## 🆘 Support

For deployment issues:
- Check the troubleshooting section
- Review Docker logs
- Verify environment configuration
- Open an issue with detailed error information
