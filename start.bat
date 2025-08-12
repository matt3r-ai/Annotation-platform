@echo off
echo Starting Annotation Platform

REM Check if Docker is installed
docker --version >nul 2>&1
if errorlevel 1 (
    echo Error: Docker is not installed
    pause
    exit /b 1
)

REM Create environment variables file
if not exist .env (
    echo Creating environment variables file...
    copy env.example .env
    echo Please edit .env file and configure AWS credentials
)

REM Start services
echo Starting Docker services...
docker-compose up -d

echo Waiting for services to start...
timeout /t 10 /nobreak >nul

echo Services started!
echo Frontend: http://localhost
echo Backend: http://localhost:8000

pause 