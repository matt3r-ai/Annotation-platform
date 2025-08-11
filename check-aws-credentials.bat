@echo off
chcp 65001 >nul
echo 🔍 AWS凭证检查工具
echo ====================
echo.

echo 📋 检查系统环境变量...
echo.
echo AWS_ACCESS_KEY_ID: %AWS_ACCESS_KEY_ID%
echo AWS_SECRET_ACCESS_KEY: %AWS_SECRET_ACCESS_KEY%
echo AWS_DEFAULT_REGION: %AWS_DEFAULT_REGION%
echo.

echo 📁 检查AWS CLI配置文件...
if exist "%USERPROFILE%\.aws\credentials" (
    echo ✅ 找到AWS凭证文件: %USERPROFILE%\.aws\credentials
    echo.
    echo 📝 凭证文件内容:
    echo ----------------------------------------
    type "%USERPROFILE%\.aws\credentials"
    echo ----------------------------------------
) else (
    echo ❌ 未找到AWS凭证文件
)
echo.

if exist "%USERPROFILE%\.aws\config" (
    echo ✅ 找到AWS配置文件: %USERPROFILE%\.aws\config
    echo.
    echo 📝 配置文件内容:
    echo ----------------------------------------
    type "%USERPROFILE%\.aws\config"
    echo ----------------------------------------
) else (
    echo ❌ 未找到AWS配置文件
)
echo.

echo 🔧 检查AWS CLI是否安装...
aws --version >nul 2>&1
if %errorlevel% equ 0 (
    echo ✅ AWS CLI已安装
    echo.
    echo 📊 当前AWS配置:
    echo ----------------------------------------
    aws configure list
    echo ----------------------------------------
    echo.
    echo 📋 所有配置文件:
    echo ----------------------------------------
    aws configure list-profiles
    echo ----------------------------------------
) else (
    echo ❌ AWS CLI未安装
    echo.
    echo 💡 建议安装AWS CLI来管理凭证:
    echo   下载地址: https://aws.amazon.com/cli/
)
echo.

echo 🌐 检查其他可能的凭证位置...
echo.
echo 检查PowerShell配置文件...
if exist "%USERPROFILE%\Documents\WindowsPowerShell\Microsoft.PowerShell_profile.ps1" (
    echo ✅ 找到PowerShell配置文件
    echo 检查是否包含AWS相关配置...
    findstr /i "aws" "%USERPROFILE%\Documents\WindowsPowerShell\Microsoft.PowerShell_profile.ps1" >nul 2>&1
    if %errorlevel% equ 0 (
        echo 发现AWS相关配置:
        findstr /i "aws" "%USERPROFILE%\Documents\WindowsPowerShell\Microsoft.PowerShell_profile.ps1"
    ) else (
        echo 未发现AWS相关配置
    )
) else (
    echo ❌ 未找到PowerShell配置文件
)
echo.

echo 📝 总结建议:
echo ====================
echo.
if exist "%USERPROFILE%\.aws\credentials" (
    echo ✅ 建议使用AWS CLI配置文件中的凭证
    echo   位置: %USERPROFILE%\.aws\credentials
    echo.
    echo 💡 复制凭证到.env文件:
    echo   1. 打开 %USERPROFILE%\.aws\credentials
    echo   2. 复制access_key_id和secret_access_key
    echo   3. 粘贴到项目根目录的.env文件中
) else (
    echo ❌ 未找到AWS凭证
    echo.
    echo 💡 获取AWS凭证的步骤:
    echo   1. 登录AWS控制台: https://console.aws.amazon.com/
    echo   2. 进入IAM服务
    echo   3. 选择用户或创建新用户
    echo   4. 创建访问密钥
    echo   5. 下载或复制凭证信息
)
echo.
echo 按任意键退出...
pause >nul
