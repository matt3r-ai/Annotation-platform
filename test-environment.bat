@echo off
chcp 65001 >nul
echo 🔍 Testing MATT3R Annotation Platform Environment
echo ========================================
echo.

echo 📋 System Information:
echo   Operating System: Windows 11
echo   Architecture: x64
echo   Current Directory: %CD%
echo.

echo 🐳 Checking Docker Environment...
docker --version >nul 2>&1
if %errorlevel% equ 0 (
    echo ✅ Docker is installed
    for /f "tokens=*" %%i in ('docker --version') do echo   Version: %%i
) else (
    echo ❌ Docker is not installed
    echo   Please install Docker Desktop first: https://www.docker.com/products/docker-desktop/
    echo   Choose "Download for Windows - AMD64" version
    goto :end
)

echo.
echo 🔧 Checking Docker Compose...
docker-compose --version >nul 2>&1
if %errorlevel% equ 0 (
    echo ✅ Docker Compose is installed
    for /f "tokens=*" %%i in ('docker-compose --version') do echo   Version: %%i
) else (
    echo ❌ Docker Compose is not installed
    echo   Please ensure Docker Desktop is properly installed
    goto :end
)

echo.
echo 📁 Checking Project Files...
if exist docker-compose.yml (
    echo ✅ docker-compose.yml exists
) else (
    echo ❌ docker-compose.yml does not exist
    goto :end
)

if exist .env (
    echo ✅ .env configuration file exists
) else (
    echo ⚠️  .env configuration file does not exist
    echo   Creating from template...
    if exist env.example (
        copy env.example .env >nul
        echo ✅ .env file created
        echo ⚠️   Please edit .env file to configure AWS credentials
    ) else (
        echo ❌ env.example template file does not exist
        goto :end
    )
)

if exist backend\Dockerfile (
    echo ✅ Backend Dockerfile exists
) else (
    echo ❌ Backend Dockerfile does not exist
    goto :end
)

if exist frontend\Dockerfile (
    echo ✅ Frontend Dockerfile exists
) else (
    echo ❌ Frontend Dockerfile does not exist
    goto :end
)

echo.
echo 🌐 Checking Port Occupancy...
netstat -ano | findstr :80 >nul
if %errorlevel% equ 0 (
    echo ⚠️   Port 80 is occupied
    echo   Please check if there are other web services running
) else (
    echo ✅ Port 80 is available
)

netstat -ano | findstr :8000 >nul
if %errorlevel% equ 0 (
    echo ⚠️   Port 8000 is occupied
    echo   Please check if there are other API services running
) else (
    echo ✅ Port 8000 is available
)

echo.
echo 📊 Checking Docker Status...
docker info >nul 2>&1
if %errorlevel% equ 0 (
    echo ✅ Docker service is running
) else (
    echo ❌ Docker service is not running
    echo   Please start Docker Desktop
    goto :end
)

echo.
echo 🎯 Environment Check Complete!
echo.
echo 💡 Next Steps:
echo   1. Edit .env file to configure AWS credentials
echo   2. Run start-docker-windows.bat to start the application
echo   3. Or manually run: docker-compose up -d
echo.
echo 📖 Detailed instructions can be found in: Windows-Deployment-Guide.md
echo.

:end
pause
