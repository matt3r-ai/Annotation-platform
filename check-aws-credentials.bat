@echo off
chcp 65001 >nul
echo 🔍 AWS Credentials Check Tool
echo ====================
echo.

echo 📋 Checking System Environment Variables...
echo.
echo AWS_ACCESS_KEY_ID: %AWS_ACCESS_KEY_ID%
echo AWS_SECRET_ACCESS_KEY: %AWS_SECRET_ACCESS_KEY%
echo AWS_DEFAULT_REGION: %AWS_DEFAULT_REGION%
echo.

echo 📁 Checking AWS CLI Configuration Files...
if exist "%USERPROFILE%\.aws\credentials" (
    echo ✅ Found AWS credentials file: %USERPROFILE%\.aws\credentials
    echo.
    echo 📝 Credentials file content:
    echo ----------------------------------------
    type "%USERPROFILE%\.aws\credentials"
    echo ----------------------------------------
) else (
    echo ❌ AWS credentials file not found
)
echo.

if exist "%USERPROFILE%\.aws\config" (
    echo ✅ Found AWS config file: %USERPROFILE%\.aws\config
    echo.
    echo 📝 Config file content:
    echo ----------------------------------------
    type "%USERPROFILE%\.aws\config"
    echo ----------------------------------------
) else (
    echo ❌ AWS config file not found
)
echo.

echo 🔧 Checking if AWS CLI is installed...
aws --version >nul 2>&1
if %errorlevel% equ 0 (
    echo ✅ AWS CLI is installed
    echo.
    echo 📊 Current AWS configuration:
    echo ----------------------------------------
    aws configure list
    echo ----------------------------------------
    echo.
    echo 📋 All configuration profiles:
    echo ----------------------------------------
    aws configure list-profiles
    echo ----------------------------------------
) else (
    echo ❌ AWS CLI is not installed
    echo.
    echo 💡 It's recommended to install AWS CLI to manage credentials:
    echo   Download URL: https://aws.amazon.com/cli/
)
echo.

echo 🌐 Checking other possible credential locations...
echo.
echo Checking PowerShell profile...
if exist "%USERPROFILE%\Documents\WindowsPowerShell\Microsoft.PowerShell_profile.ps1" (
    echo ✅ Found PowerShell profile
    echo Checking if it contains AWS-related configuration...
    findstr /i "aws" "%USERPROFILE%\Documents\WindowsPowerShell\Microsoft.PowerShell_profile.ps1" >nul 2>&1
    if %errorlevel% equ 0 (
        echo Found AWS-related configuration:
        findstr /i "aws" "%USERPROFILE%\Documents\WindowsPowerShell\Microsoft.PowerShell_profile.ps1"
    ) else (
        echo No AWS-related configuration found
    )
) else (
    echo ❌ PowerShell profile not found
)
echo.

echo 📝 Summary Recommendations:
echo ====================
echo.
if exist "%USERPROFILE%\.aws\credentials" (
    echo ✅ It's recommended to use credentials from AWS CLI configuration file
    echo   Location: %USERPROFILE%\.aws\credentials
    echo.
    echo 💡 Copy credentials to .env file:
    echo   1. Open %USERPROFILE%\.aws\credentials
    echo   2. Copy access_key_id and secret_access_key
    echo   3. Paste into .env file in project root directory
) else (
    echo ❌ No AWS credentials found
    echo.
    echo 💡 Steps to obtain AWS credentials:
    echo   1. Login to AWS Console: https://console.aws.amazon.com/
    echo   2. Go to IAM service
    echo   3. Select user or create new user
    echo   4. Create access key
    echo   5. Download or copy credential information
)
echo.
