@echo off
echo 启动 Annotation Platform

REM 检查Docker是否安装
docker --version >nul 2>&1
if errorlevel 1 (
    echo 错误: Docker未安装
    pause
    exit /b 1
)

REM 创建环境变量文件
if not exist .env (
    echo 创建环境变量文件...
    copy env.example .env
    echo 请编辑 .env 文件并配置AWS凭证
)

REM 启动服务
echo 启动Docker服务...
docker-compose up -d

echo 等待服务启动...
timeout /t 10 /nobreak >nul

echo 服务已启动！
echo 前端: http://localhost:3000
echo 后端: http://localhost:8000

pause 