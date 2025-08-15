#!/bin/bash

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}🧪 Testing Volume Structure Configuration...${NC}"

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo -e "${RED}❌ Docker is not running. Please start Docker first.${NC}"
    exit 1
fi

# Check if volume exists
echo -e "${YELLOW}📁 Checking volume existence...${NC}"
if docker volume ls | grep -q "annotation-platform-backend-volume"; then
    echo -e "${GREEN}✅ Volume 'annotation-platform-backend-volume' exists${NC}"
else
    echo -e "${YELLOW}⚠️  Volume 'annotation-platform-backend-volume' not found, will be created automatically${NC}"
fi

# Check local data directory structure
echo -e "${YELLOW}📁 Checking local data directory structure...${NC}"
if [ -d "./data" ]; then
    echo -e "${GREEN}✅ Local ./data directory exists${NC}"
    
    if [ -d "./data/saved_video" ]; then
        echo -e "${GREEN}✅ Local ./data/saved_video directory exists${NC}"
    else
        echo -e "${YELLOW}⚠️  Local ./data/saved_video directory missing${NC}"
    fi
    
    if [ -d "./data/downloads" ]; then
        echo -e "${GREEN}✅ Local ./data/downloads directory exists${NC}"
    else
        echo -e "${YELLOW}⚠️  Local ./data/downloads directory missing${NC}"
    fi
else
    echo -e "${YELLOW}⚠️  Local ./data directory missing${NC}"
fi

# Check docker-compose.yml configuration
echo -e "${YELLOW}📋 Checking docker-compose.yml configuration...${NC}"
if grep -q "annotation-platform-backend-volume:/app/data" docker-compose.yml; then
    echo -e "${GREEN}✅ Volume mount configured correctly in docker-compose.yml${NC}"
else
    echo -e "${RED}❌ Volume mount not found in docker-compose.yml${NC}"
fi

# Check backend code paths
echo -e "${YELLOW}🔍 Checking backend code paths...${NC}"
if grep -q "/app/data/saved_video" backend/main.py; then
    echo -e "${GREEN}✅ Backend main.py uses correct saved_video path${NC}"
else
    echo -e "${RED}❌ Backend main.py path not updated${NC}"
fi

if grep -q "/app/data/downloads" backend/scenario_analysis.py; then
    echo -e "${GREEN}✅ Backend scenario_analysis.py uses correct downloads path${NC}"
else
    echo -e "${RED}❌ Backend scenario_analysis.py path not updated${NC}"
fi

# Check Dockerfile
echo -e "${YELLOW}🐳 Checking Dockerfile configuration...${NC}"
if grep -q "/app/data/saved_video /app/data/downloads" backend/Dockerfile; then
    echo -e "${GREEN}✅ Dockerfile creates correct directory structure${NC}"
else
    echo -e "${RED}❌ Dockerfile directory structure not updated${NC}"
fi

# Check startup script
echo -e "${YELLOW}🚀 Checking startup script...${NC}"
if grep -q "annotation-platform-backend-volume:/app/data" start-docker.sh; then
    echo -e "${GREEN}✅ Startup script references correct volume structure${NC}"
else
    echo -e "${YELLOW}⚠️  Startup script doesn't reference volume structure (this is normal)${NC}"
fi

echo -e "${GREEN}🎉 Volume structure test completed!${NC}"
echo -e "${YELLOW}💡 To test with actual containers, run: ./start-docker.sh${NC}"
