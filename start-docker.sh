#!/bin/bash

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}🐳 Starting MATT3R Annotation Platform with Docker...${NC}"

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo -e "${RED}❌ Docker is not installed. Please install Docker first.${NC}"
    exit 1
fi

# Check if Docker Compose is installed
if ! command -v docker-compose &> /dev/null; then
    echo -e "${RED}❌ Docker Compose is not installed. Please install Docker Compose first.${NC}"
    exit 1
fi

# Check if .env file exists
if [ ! -f .env ]; then
    echo -e "${YELLOW}⚠️  .env file not found. Creating from template...${NC}"
    cp env.example .env
    echo -e "${YELLOW}⚠️  Please edit .env file with your AWS credentials before starting.${NC}"
    echo -e "${YELLOW}⚠️  Press Enter to continue or Ctrl+C to cancel...${NC}"
    read
fi

# Create necessary directories for the unified volume
echo -e "${GREEN}📁 Creating directory structure for unified volume...${NC}"
mkdir -p ./data/saved_video
mkdir -p ./data/downloads

# Build and start containers
echo -e "${GREEN}🔨 Building containers...${NC}"
docker-compose build

echo -e "${GREEN}🚀 Starting services...${NC}"
docker-compose up -d

# Wait for services to be ready
echo -e "${GREEN}⏳ Waiting for services to be ready...${NC}"
sleep 10

# Check if services are running
if docker-compose ps | grep -q "Up"; then
    echo -e "${GREEN}✅ Services are running!${NC}"
    echo -e "${GREEN}🌐 Frontend: http://localhost:9999${NC}"
    echo -e "${GREEN}🔧 Backend API: http://localhost:8000${NC}"
    echo -e "${GREEN}📊 Health Check: http://localhost:8000/api/health${NC}"
    echo -e "${GREEN}💾 Data Volume: annotation-platform-backend-volume:/app/data${NC}"
    echo -e "${GREEN}📁 Subdirectories: /app/data/saved_video, /app/data/downloads${NC}"
else
    echo -e "${RED}❌ Services failed to start. Check logs with: docker-compose logs${NC}"
    exit 1
fi

echo -e "${GREEN}🎉 MATT3R Annotation Platform is ready!${NC}"
