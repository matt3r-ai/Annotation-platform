#!/bin/bash

# 🚀 MATT3R Annotation Platform - Deployment from Zero Script
# For Linux/macOS systems

set -e  # Exit immediately on error

# Color definitions
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🚀 MATT3R Annotation Platform - Deployment from Zero${NC}"
echo "=================================================="
echo

# Check operating system
OS=$(uname -s)
echo -e "${BLUE}📋 Detected Operating System: ${OS}${NC}"

# Function: Install Docker
install_docker() {
    echo -e "${YELLOW}🐳 Installing Docker...${NC}"
    
    if command -v docker &> /dev/null; then
        echo -e "${GREEN}✅ Docker is already installed${NC}"
        return 0
    fi
    
    case $OS in
        "Linux")
            echo -e "${BLUE}📥 Downloading and installing Docker...${NC}"
            curl -fsSL https://get.docker.com | sh
            sudo usermod -aG docker $USER
            echo -e "${GREEN}✅ Docker installation complete${NC}"
            echo -e "${YELLOW}⚠️  Please log out and log back in or run: newgrp docker${NC}"
            ;;
        "Darwin")
            echo -e "${RED}❌ Please manually install Docker Desktop for Mac${NC}"
            echo "Download URL: https://www.docker.com/products/docker-desktop/"
            exit 1
            ;;
        *)
            echo -e "${RED}❌ Unsupported operating system: ${OS}${NC}"
            exit 1
            ;;
    esac
}

# Function: Install Docker Compose
install_docker_compose() {
    echo -e "${YELLOW}🔧 Installing Docker Compose...${NC}"
    
    if command -v docker-compose &> /dev/null; then
        echo -e "${GREEN}✅ Docker Compose is already installed${NC}"
        return 0
    fi
    
    echo -e "${BLUE}📥 Downloading Docker Compose...${NC}"
    sudo curl -L "https://github.com/docker/compose/releases/download/v2.20.0/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
    sudo chmod +x /usr/local/bin/docker-compose
    
    echo -e "${GREEN}✅ Docker Compose installation complete${NC}"
}

# Function: Check Docker service
check_docker_service() {
    echo -e "${YELLOW}🔍 Checking Docker service status...${NC}"
    
    if ! docker info &> /dev/null; then
        echo -e "${RED}❌ Docker service is not running${NC}"
        echo -e "${BLUE}🔄 Starting Docker service...${NC}"
        
        case $OS in
            "Linux")
                sudo systemctl start docker
                sudo systemctl enable docker
                ;;
            "Darwin")
                open -a Docker
                echo -e "${YELLOW}⏳ Waiting for Docker Desktop to start...${NC}"
                sleep 30
                ;;
        esac
    fi
    
    echo -e "${GREEN}✅ Docker service is running normally${NC}"
}

# Function: Check project files
check_project_files() {
    echo -e "${YELLOW}📁 Checking project file integrity...${NC}"
    
    local required_files=(
        "docker-compose.yml"
        "backend/Dockerfile"
        "frontend/Dockerfile"
        "backend/requirements.txt"
        "frontend/package.json"
        "env.example"
    )
    
    for file in "${required_files[@]}"; do
        if [[ -f "$file" ]]; then
            echo -e "  ✅ $file"
        else
            echo -e "  ❌ $file (missing)"
            return 1
        fi
    done
    
    echo -e "${GREEN}✅ All required files exist${NC}"
}

# Function: Configure environment variables
setup_environment() {
    echo -e "${YELLOW}⚙️  Configuring environment variables...${NC}"
    
    if [[ ! -f ".env" ]]; then
        echo -e "${BLUE}📝 Creating .env file...${NC}"
        cp env.example .env
        
        echo -e "${YELLOW}⚠️  Please edit the .env file to configure the following information:${NC}"
        echo -e "  - AWS_ACCESS_KEY_ID"
        echo -e "  - AWS_SECRET_ACCESS_KEY"
        echo -e "  - AWS_DEFAULT_REGION"
        echo -e "  - AWS_S3_BUCKET"
        echo
        echo -e "${BLUE}Press Enter to edit the .env file, or Ctrl+C to cancel...${NC}"
        read
        
        if command -v nano &> /dev/null; then
            nano .env
        elif command -v vim &> /dev/null; then
            vim .env
        else
            echo -e "${YELLOW}Please manually edit the .env file${NC}"
        fi
    else
        echo -e "${GREEN}✅ .env file already exists${NC}"
    fi
}

# Function: Build and start services
start_services() {
    echo -e "${YELLOW}🔨 Building Docker images...${NC}"
    docker-compose build
    
    if [[ $? -ne 0 ]]; then
        echo -e "${RED}❌ Build failed${NC}"
        exit 1
    fi
    
    echo -e "${YELLOW}🚀 Starting services...${NC}"
    docker-compose up -d
    
    if [[ $? -ne 0 ]]; then
        echo -e "${RED}❌ Start failed${NC}"
        exit 1
    fi
    
    echo -e "${GREEN}✅ Services started successfully${NC}"
}

# Function: Verify deployment
verify_deployment() {
    echo -e "${YELLOW}🔍 Verifying deployment status...${NC}"
    
    # Wait for services to start
    echo -e "${BLUE}⏳ Waiting for services to start...${NC}"
    sleep 20
    
    # Check container status
    echo -e "${BLUE}📊 Checking container status:${NC}"
    docker-compose ps
    
    # Check health status
    echo -e "${BLUE}🏥 Checking service health status:${NC}"
    
    # Check backend health
    if curl -f http://localhost:8000/api/health &> /dev/null; then
        echo -e "  ✅ Backend service healthy"
    else
        echo -e "  ❌ Backend service unhealthy"
    fi
    
    # Check frontend access
    if curl -f http://localhost &> /dev/null; then
        echo -e "  ✅ Frontend service normal"
    else
        echo -e "  ❌ Frontend service unhealthy"
    fi
}

# Function: Display access information
show_access_info() {
    echo
    echo -e "${GREEN}🎉 Deployment complete!${NC}"
    echo "=================================================="
    echo -e "${BLUE}🌐 Access addresses:${NC}"
    echo -e "  Frontend interface: http://localhost"
    echo -e "  Backend API: http://localhost:8000"
    echo -e "  Health check: http://localhost:8000/api/health"
    echo
    echo -e "${BLUE}🛠️  Common commands:${NC}"
    echo -e "  View status: docker-compose ps"
    echo -e "  View logs: docker-compose logs -f"
    echo -e "  Stop services: docker-compose down"
    echo -e "  Restart services: docker-compose restart"
    echo
    echo -e "${BLUE}📖 For more information, please check: README-Docker.md${NC}"
}

# Main function
main() {
    echo -e "${BLUE}🔍 Starting environment check...${NC}"
    
    # Install Docker
    install_docker
    
    # Install Docker Compose
    install_docker_compose
    
    # Check Docker service
    check_docker_service
    
    # Check project files
    if ! check_project_files; then
        echo -e "${RED}❌ Project files are incomplete, please check${NC}"
        exit 1
    fi
    
    # Configure environment variables
    setup_environment
    
    # Build and start services
    start_services
    
    # Verify deployment
    verify_deployment
    
    # Display access information
    show_access_info
}

# Error handling
trap 'echo -e "\n${RED}❌ Error during deployment${NC}"; exit 1' ERR

# Run main function
main "$@"
