@echo off
chcp 936 >nul

echo ========================================
echo    一键部署到云服务器
echo ========================================
echo.

set SERVER_IP=8.166.143.118
set SERVER_USER=root

echo 服务器: %SERVER_USER%@%SERVER_IP%
echo.

echo [1/3] 上传项目文件...
scp -r D:\mail\backend D:\mail\frontend D:\mail\docker-compose.yml D:\mail\deploy.sh %SERVER_USER%@%SERVER_IP%:/opt/mail-reply-agent/
if errorlevel 1 (
    echo [错误] 上传失败
    pause
    exit /b 1
)
echo 上传完成!

echo.
echo [2/3] 执行部署脚本...
ssh %SERVER_USER%@%SERVER_IP% "cd /opt/mail-reply-agent && chmod +x deploy.sh && bash deploy.sh"
if errorlevel 1 (
    echo [错误] 部署失败
    pause
    exit /b 1
)

echo.
echo ========================================
echo    部署成功!
echo ========================================
echo.
echo 访问地址: http://%SERVER_IP%
echo.
pause
