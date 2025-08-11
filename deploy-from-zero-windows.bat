@echo off
chcp 65001 >nul
echo 🚀 MATT3R Annotation Platform - Windows从0开始部署
echo ====================================================
echo.

echo 📋 系统信息:
echo   操作系统: Windows 11
echo   架构: x64
echo   当前目录: %CD%
echo.

echo 🔍 检查Docker环境...
docker --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ Docker未安装
    echo.
    echo 📥 请按以下步骤安装Docker Desktop:
    echo   1. 访问: https://www.docker.com/products/docker-desktop/
    echo   2. 下载 "Download for Windows - AMD64" 版本
    echo   3. 运行安装程序
    echo   4. 安装完成后重启电脑
    echo   5. 重启后确保Docker Desktop正在运行
    echo.
    echo 安装完成后，请重新运行此脚本
    pause
    exit /b 1
)

echo ✅ Docker已安装
for /f "tokens=*" %%i in ('docker --version') do echo   版本: %%i

echo.
echo 🔧 检查Docker Compose...
docker-compose --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ Docker Compose未安装
    echo   请确保Docker Desktop已正确安装
    pause
    exit /b 1
)

echo ✅ Docker Compose已安装
for /f "tokens=*" %%i in ('docker-compose --version') do echo   版本: %%i

echo.
echo 📊 检查Docker状态...
docker info >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ Docker服务未运行
    echo   请启动Docker Desktop
    echo   检查任务栏是否有Docker图标，确保它是绿色的
    pause
    exit /b 1
)

echo ✅ Docker服务运行正常

echo.
echo 📁 检查项目文件完整性...
if exist docker-compose.yml (
    echo ✅ docker-compose.yml
) else (
    echo ❌ docker-compose.yml (缺失)
    pause
    exit /b 1
)

if exist backend\Dockerfile (
    echo ✅ backend\Dockerfile
) else (
    echo ❌ backend\Dockerfile (缺失)
    pause
    exit /b 1
)

if exist frontend\Dockerfile (
    echo ✅ frontend\Dockerfile
) else (
    echo ❌ frontend\Dockerfile (缺失)
    pause
    exit /b 1
)

if exist backend\requirements.txt (
    echo ✅ backend\requirements.txt
) else (
    echo ❌ backend\requirements.txt (缺失)
    pause
    exit /b 1
)

if exist frontend\package.json (
    echo ✅ frontend\package.json
) else (
    echo ❌ frontend\package.json (缺失)
    pause
    exit /b 1
)

if exist env.example (
    echo ✅ env.example
) else (
    echo ❌ env.example (缺失)
    pause
    exit /b 1
)

echo ✅ 所有必需文件都存在

echo.
echo 🌐 检查端口占用...
netstat -ano | findstr :80 >nul
if %errorlevel% equ 0 (
    echo ⚠️  端口80被占用
    echo   请检查是否有其他Web服务在运行
    echo   可以停止占用端口的进程或修改docker-compose.yml中的端口映射
) else (
    echo ✅ 端口80可用
)

netstat -ano | findstr :8000 >nul
if %errorlevel% equ 0 (
    echo ⚠️  端口8000被占用
    echo   请检查是否有其他API服务在运行
    echo   可以停止占用端口的进程或修改docker-compose.yml中的端口映射
) else (
    echo ✅ 端口8000可用
)

echo.
echo ⚙️  配置环境变量...
if not exist .env (
    echo 📝 创建.env文件...
    copy env.example .env >nul
    
    echo ⚠️  请配置以下AWS凭证信息:
    echo   - AWS_ACCESS_KEY_ID
    echo   - AWS_SECRET_ACCESS_KEY
    echo   - AWS_DEFAULT_REGION
    echo   - AWS_S3_BUCKET
    echo.
    echo 按Enter键编辑.env文件...
    pause
    
    notepad .env
    
    echo.
    echo 配置完成后，请确认.env文件已保存
    echo 按Enter键继续...
    pause
) else (
    echo ✅ .env文件已存在
)

echo.
echo 🔨 开始构建Docker镜像...
echo 注意: 首次构建可能需要10-20分钟，请耐心等待
echo.
docker-compose build

if %errorlevel% neq 0 (
    echo ❌ 构建失败
    echo 请检查错误信息并修复问题
    pause
    exit /b 1
)

echo ✅ 镜像构建成功

echo.
echo 🚀 启动服务...
docker-compose up -d

if %errorlevel% neq 0 (
    echo ❌ 启动失败
    echo 请检查错误信息并修复问题
    pause
    exit /b 1
)

echo ✅ 服务启动成功

echo.
echo ⏳ 等待服务启动...
timeout /t 20 /nobreak >nul

echo.
echo 📊 检查服务状态...
docker-compose ps

echo.
echo 🔍 验证服务健康状态...
echo 检查后端健康状态...
curl -f http://localhost:8000/api/health >nul 2>&1
if %errorlevel% equ 0 (
    echo ✅ 后端服务健康
) else (
    echo ❌ 后端服务异常
)

echo 检查前端服务状态...
curl -f http://localhost >nul 2>&1
if %errorlevel% equ 0 (
    echo ✅ 前端服务正常
) else (
    echo ❌ 前端服务异常
)

echo.
echo 🎉 部署完成！
echo ====================================================
echo 🌐 访问地址:
echo   前端界面: http://localhost
echo   后端API:  http://localhost:8000
echo   健康检查: http://localhost:8000/api/health
echo.
echo 🛠️  常用命令:
echo   查看状态: docker-compose ps
echo   查看日志: docker-compose logs -f
echo   停止服务: docker-compose down
echo   重启服务: docker-compose restart
echo.
echo 📖 更多信息请查看: README-Docker.md
echo.

pause
