@echo off
chcp 65001 >nul
echo 🔍 测试 MATT3R Annotation Platform 环境
echo ========================================
echo.

echo 📋 系统信息:
echo   操作系统: Windows 11
echo   架构: x64
echo   当前目录: %CD%
echo.

echo 🐳 检查Docker环境...
docker --version >nul 2>&1
if %errorlevel% equ 0 (
    echo ✅ Docker已安装
    for /f "tokens=*" %%i in ('docker --version') do echo   版本: %%i
) else (
    echo ❌ Docker未安装
    echo   请先安装Docker Desktop: https://www.docker.com/products/docker-desktop/
    echo   选择 "Download for Windows - AMD64" 版本
    goto :end
)

echo.
echo 🔧 检查Docker Compose...
docker-compose --version >nul 2>&1
if %errorlevel% equ 0 (
    echo ✅ Docker Compose已安装
    for /f "tokens=*" %%i in ('docker-compose --version') do echo   版本: %%i
) else (
    echo ❌ Docker Compose未安装
    echo   请确保Docker Desktop已正确安装
    goto :end
)

echo.
echo 📁 检查项目文件...
if exist docker-compose.yml (
    echo ✅ docker-compose.yml 存在
) else (
    echo ❌ docker-compose.yml 不存在
    goto :end
)

if exist .env (
    echo ✅ .env 配置文件存在
) else (
    echo ⚠️  .env 配置文件不存在
    echo   正在从模板创建...
    if exist env.example (
        copy env.example .env >nul
        echo ✅ 已创建 .env 文件
        echo ⚠️  请编辑 .env 文件配置AWS凭证
    ) else (
        echo ❌ env.example 模板文件不存在
        goto :end
    )
)

if exist backend\Dockerfile (
    echo ✅ 后端Dockerfile存在
) else (
    echo ❌ 后端Dockerfile不存在
    goto :end
)

if exist frontend\Dockerfile (
    echo ✅ 前端Dockerfile存在
) else (
    echo ❌ 前端Dockerfile不存在
    goto :end
)

echo.
echo 🌐 检查端口占用...
netstat -ano | findstr :80 >nul
if %errorlevel% equ 0 (
    echo ⚠️  端口80被占用
    echo   请检查是否有其他Web服务在运行
) else (
    echo ✅ 端口80可用
)

netstat -ano | findstr :8000 >nul
if %errorlevel% equ 0 (
    echo ⚠️  端口8000被占用
    echo   请检查是否有其他API服务在运行
) else (
    echo ✅ 端口8000可用
)

echo.
echo 📊 检查Docker状态...
docker info >nul 2>&1
if %errorlevel% equ 0 (
    echo ✅ Docker服务正在运行
) else (
    echo ❌ Docker服务未运行
    echo   请启动Docker Desktop
    goto :end
)

echo.
echo 🎯 环境检查完成！
echo.
echo 💡 下一步操作:
echo   1. 编辑 .env 文件配置AWS凭证
echo   2. 运行 start-docker-windows.bat 启动应用
echo   3. 或手动运行: docker-compose up -d
echo.
echo 📖 详细说明请查看: Windows-部署指南.md
echo.

:end
pause
