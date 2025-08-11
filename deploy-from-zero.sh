#!/bin/bash

# 🚀 MATT3R Annotation Platform - 从0开始部署脚本
# 适用于Linux/macOS系统

set -e  # 遇到错误立即退出

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🚀 MATT3R Annotation Platform - 从0开始部署${NC}"
echo "=================================================="
echo

# 检查操作系统
OS=$(uname -s)
echo -e "${BLUE}📋 检测到操作系统: ${OS}${NC}"

# 函数：安装Docker
install_docker() {
    echo -e "${YELLOW}🐳 正在安装Docker...${NC}"
    
    if command -v docker &> /dev/null; then
        echo -e "${GREEN}✅ Docker已安装${NC}"
        return 0
    fi
    
    case $OS in
        "Linux")
            echo -e "${BLUE}📥 下载并安装Docker...${NC}"
            curl -fsSL https://get.docker.com | sh
            sudo usermod -aG docker $USER
            echo -e "${GREEN}✅ Docker安装完成${NC}"
            echo -e "${YELLOW}⚠️  请重新登录或运行: newgrp docker${NC}"
            ;;
        "Darwin")
            echo -e "${RED}❌ 请手动安装Docker Desktop for Mac${NC}"
            echo "下载地址: https://www.docker.com/products/docker-desktop/"
            exit 1
            ;;
        *)
            echo -e "${RED}❌ 不支持的操作系统: ${OS}${NC}"
            exit 1
            ;;
    esac
}

# 函数：安装Docker Compose
install_docker_compose() {
    echo -e "${YELLOW}🔧 正在安装Docker Compose...${NC}"
    
    if command -v docker-compose &> /dev/null; then
        echo -e "${GREEN}✅ Docker Compose已安装${NC}"
        return 0
    fi
    
    echo -e "${BLUE}📥 下载Docker Compose...${NC}"
    sudo curl -L "https://github.com/docker/compose/releases/download/v2.20.0/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
    sudo chmod +x /usr/local/bin/docker-compose
    
    echo -e "${GREEN}✅ Docker Compose安装完成${NC}"
}

# 函数：检查Docker服务
check_docker_service() {
    echo -e "${YELLOW}🔍 检查Docker服务状态...${NC}"
    
    if ! docker info &> /dev/null; then
        echo -e "${RED}❌ Docker服务未运行${NC}"
        echo -e "${BLUE}🔄 启动Docker服务...${NC}"
        
        case $OS in
            "Linux")
                sudo systemctl start docker
                sudo systemctl enable docker
                ;;
            "Darwin")
                open -a Docker
                echo -e "${YELLOW}⏳ 等待Docker Desktop启动...${NC}"
                sleep 30
                ;;
        esac
    fi
    
    echo -e "${GREEN}✅ Docker服务运行正常${NC}"
}

# 函数：检查项目文件
check_project_files() {
    echo -e "${YELLOW}📁 检查项目文件完整性...${NC}"
    
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
            echo -e "  ❌ $file (缺失)"
            return 1
        fi
    done
    
    echo -e "${GREEN}✅ 所有必需文件都存在${NC}"
}

# 函数：配置环境变量
setup_environment() {
    echo -e "${YELLOW}⚙️  配置环境变量...${NC}"
    
    if [[ ! -f ".env" ]]; then
        echo -e "${BLUE}📝 创建.env文件...${NC}"
        cp env.example .env
        
        echo -e "${YELLOW}⚠️  请编辑.env文件配置以下信息:${NC}"
        echo -e "  - AWS_ACCESS_KEY_ID"
        echo -e "  - AWS_SECRET_ACCESS_KEY"
        echo -e "  - AWS_DEFAULT_REGION"
        echo -e "  - AWS_S3_BUCKET"
        echo
        echo -e "${BLUE}按Enter键编辑.env文件，或按Ctrl+C取消...${NC}"
        read
        
        if command -v nano &> /dev/null; then
            nano .env
        elif command -v vim &> /dev/null; then
            vim .env
        else
            echo -e "${YELLOW}请手动编辑.env文件${NC}"
        fi
    else
        echo -e "${GREEN}✅ .env文件已存在${NC}"
    fi
}

# 函数：构建和启动服务
start_services() {
    echo -e "${YELLOW}🔨 构建Docker镜像...${NC}"
    docker-compose build
    
    if [[ $? -ne 0 ]]; then
        echo -e "${RED}❌ 构建失败${NC}"
        exit 1
    fi
    
    echo -e "${YELLOW}🚀 启动服务...${NC}"
    docker-compose up -d
    
    if [[ $? -ne 0 ]]; then
        echo -e "${RED}❌ 启动失败${NC}"
        exit 1
    fi
    
    echo -e "${GREEN}✅ 服务启动成功${NC}"
}

# 函数：验证部署
verify_deployment() {
    echo -e "${YELLOW}🔍 验证部署状态...${NC}"
    
    # 等待服务启动
    echo -e "${BLUE}⏳ 等待服务启动...${NC}"
    sleep 20
    
    # 检查容器状态
    echo -e "${BLUE}📊 检查容器状态:${NC}"
    docker-compose ps
    
    # 检查健康状态
    echo -e "${BLUE}🏥 检查服务健康状态:${NC}"
    
    # 检查后端健康
    if curl -f http://localhost:8000/api/health &> /dev/null; then
        echo -e "  ✅ 后端服务健康"
    else
        echo -e "  ❌ 后端服务异常"
    fi
    
    # 检查前端访问
    if curl -f http://localhost &> /dev/null; then
        echo -e "  ✅ 前端服务正常"
    else
        echo -e "  ❌ 前端服务异常"
    fi
}

# 函数：显示访问信息
show_access_info() {
    echo
    echo -e "${GREEN}🎉 部署完成！${NC}"
    echo "=================================================="
    echo -e "${BLUE}🌐 访问地址:${NC}"
    echo -e "  前端界面: http://localhost"
    echo -e "  后端API:  http://localhost:8000"
    echo -e "  健康检查: http://localhost:8000/api/health"
    echo
    echo -e "${BLUE}🛠️  常用命令:${NC}"
    echo -e "  查看状态: docker-compose ps"
    echo -e "  查看日志: docker-compose logs -f"
    echo -e "  停止服务: docker-compose down"
    echo -e "  重启服务: docker-compose restart"
    echo
    echo -e "${BLUE}📖 更多信息请查看: README-Docker.md${NC}"
}

# 主函数
main() {
    echo -e "${BLUE}🔍 开始环境检查...${NC}"
    
    # 安装Docker
    install_docker
    
    # 安装Docker Compose
    install_docker_compose
    
    # 检查Docker服务
    check_docker_service
    
    # 检查项目文件
    if ! check_project_files; then
        echo -e "${RED}❌ 项目文件不完整，请检查${NC}"
        exit 1
    fi
    
    # 配置环境变量
    setup_environment
    
    # 构建和启动服务
    start_services
    
    # 验证部署
    verify_deployment
    
    # 显示访问信息
    show_access_info
}

# 错误处理
trap 'echo -e "\n${RED}❌ 部署过程中出现错误${NC}"; exit 1' ERR

# 运行主函数
main "$@"
