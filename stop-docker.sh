#!/bin/bash

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}🛑 Stopping MATT3R Annotation Platform...${NC}"

# Stop containers
docker-compose down

echo -e "${GREEN}✅ Services stopped successfully!${NC}"

# Optional: Remove containers and volumes
read -p "Do you want to remove containers and volumes? (y/N): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo -e "${YELLOW}🗑️  Removing containers and volumes...${NC}"
    docker-compose down -v --remove-orphans
    echo -e "${GREEN}✅ Containers and volumes removed!${NC}"
fi

echo -e "${GREEN}👋 Goodbye!${NC}"
