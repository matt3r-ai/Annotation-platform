@echo off
chcp 65001 >nul
echo 🚀 MATT3R Annotation Platform - Windows Deployment from Zero
echo ====================================================
echo.

echo 📋 System Information:
echo   Operating System: Windows 11
echo   Architecture: x64
echo   Current Directory: %CD%
echo.

echo 🔍 Checking Docker Environment...
docker --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ Docker is not installed
    echo.
    echo 📥 Please follow these steps to install Docker Desktop:
    echo   1. Visit: https://www.docker.com/products/docker-desktop/
    echo   2. Download "Download for Windows - AMD64" version
    echo   3. Run the installer
    echo   4. Restart computer after installation
    echo   5. After restart, ensure Docker Desktop is running
    echo.
    echo After installation, please run this script again
    pause
    exit /b 1
)

echo ✅ Docker is installed
for /f "tokens=*" %%i in ('docker --version') do echo   Version: %%i

echo.
echo 🔧 Checking Docker Compose...
docker-compose --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ Docker Compose is not installed
    echo   Please ensure Docker Desktop is properly installed
    pause
    exit /b 1
)

echo ✅ Docker Compose is installed
for /f "tokens=*" %%i in ('docker-compose --version') do echo   Version: %%i

echo.
echo 📊 Checking Docker Status...
docker info >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ Docker service is not running
    echo   Please start Docker Desktop
    echo   Check if there's a Docker icon in the taskbar, ensure it's green
    pause
    exit /b 1
)

echo ✅ Docker service is running normally

echo.
echo 📁 Checking Project File Integrity...
if exist docker-compose.yml (
    echo ✅ docker-compose.yml
) else (
    echo ❌ docker-compose.yml (missing)
    pause
    exit /b 1
)

if exist backend\Dockerfile (
    echo ✅ backend\Dockerfile
) else (
    echo ❌ backend\Dockerfile (missing)
    pause
    exit /b 1
)

if exist frontend\Dockerfile (
    echo ✅ frontend\Dockerfile
) else (
    echo ❌ frontend\Dockerfile (missing)
    pause
    exit /b 1
)

if exist backend\requirements.txt (
    echo ✅ backend\requirements.txt
) else (
    echo ❌ backend\requirements.txt (missing)
    pause
    exit /b 1
)

if exist frontend\package.json (
    echo ✅ frontend\package.json
) else (
    echo ❌ frontend\package.json (missing)
    pause
    exit /b 1
)

if exist env.example (
    echo ✅ env.example
) else (
    echo ❌ env.example (missing)
    pause
    exit /b 1
)

echo ✅ All required files exist

echo.
echo 🌐 Checking Port Occupancy...
netstat -ano | findstr :80 >nul
if %errorlevel% equ 0 (
    echo ⚠️   Port 80 is occupied
    echo   Please check if there are other web services running
    echo   You can stop the process occupying the port or modify the port mapping in docker-compose.yml
) else (
    echo ✅ Port 80 is available
)

netstat -ano | findstr :8000 >nul
if %errorlevel% equ 0 (
    echo ⚠️   Port 8000 is occupied
    echo   Please check if there are other API services running
    echo   You can stop the process occupying the port or modify the port mapping in docker-compose.yml
) else (
    echo ✅ Port 8000 is available
)

echo.
echo ⚙️   Configuring Environment Variables...
if not exist .env (
    echo 📝 Creating .env file...
    copy env.example .env >nul
    
    echo ⚠️   Please configure the following AWS credentials:
    echo   - AWS_ACCESS_KEY_ID
    echo   - AWS_SECRET_ACCESS_KEY
    echo   - AWS_DEFAULT_REGION
    echo   - AWS_S3_BUCKET
    echo.
    echo Press Enter to edit the .env file...
    pause
    
    notepad .env
    
    echo.
    echo After configuration, please confirm the .env file is saved
    echo Press Enter to continue...
    pause
) else (
    echo ✅ .env file already exists
)

echo.
echo 🔨 Starting Docker Image Build...
echo Note: First build may take 10-20 minutes, please be patient
echo.
docker-compose build

if %errorlevel% neq 0 (
    echo ❌ Build failed
    echo Please check the error message and fix the issue
    pause
    exit /b 1
)

echo ✅ Image build successful

echo.
echo 🚀 Starting Services...
docker-compose up -d

if %errorlevel% neq 0 (
    echo ❌ Start failed
    echo Please check the error message and fix the issue
    pause
    exit /b 1
)

echo ✅ Services started successfully

echo.
echo ⏳ Waiting for services to start...
timeout /t 20 /nobreak >nul

echo.
echo 📊 Checking Service Status...
docker-compose ps

echo.
echo 🔍 Verifying Service Health Status...
echo Checking backend health status...
curl -f http://localhost:8000/api/health >nul 2>&1
if %errorlevel% equ 0 (
    echo ✅ Backend service healthy
) else (
    echo ❌ Backend service abnormal
)

echo Checking frontend service status...
curl -f http://localhost >nul 2>&1
if %errorlevel% equ 0 (
    echo ✅ Frontend service normal
) else (
    echo ❌ Frontend service abnormal
)

echo.
echo 🎉 Deployment complete!
echo ====================================================
echo 🌐 Access Address:
echo   Frontend Interface: http://localhost
echo   Backend API:  http://localhost:8000
echo   Health Check: http://localhost:8000/api/health
echo.
echo 🛠️   Common Commands:
echo   View Status: docker-compose ps
echo   View Logs: docker-compose logs -f
echo   Stop Services: docker-compose down
echo   Restart Services: docker-compose restart
echo.
echo 📖 For more information, please refer to: README-Docker.md
echo.

pause
