@echo off
chcp 65001 >nul
echo ========================================
echo    上传项目到云服务器
echo ========================================
echo.

REM 请输入服务器信息
set /p SERVER_IP=请输入服务器公网IP:
set /p SERVER_USER=请输入用户名(默认root):

if "%SERVER_USER%"=="" set SERVER_USER=root

echo.
echo 正在上传项目文件...
echo 目标: %SERVER_USER%@%SERVER_IP%:/opt/mail-reply-agent
echo.

REM 使用 scp 上传（需要 Windows 10+ 或安装 WinSCP）
scp -r D:\mail\backend D:\mail\frontend D:\mail\docker-compose.yml D:\mail\deploy.sh %SERVER_USER%@%SERVER_IP%:/opt/mail-reply-agent/

if errorlevel 1 (
    echo.
    echo [错误] 上传失败！
    echo 请确保：
    echo 1. 已安装 OpenSSH 客户端
    echo 2. 服务器IP和密码正确
    echo 3. 服务器已开放22端口
    echo.
    echo 备选方案：使用 WinSCP 或 Xftp 工具手动上传
) else (
    echo.
    echo ========================================
    echo    上传成功！
    echo ========================================
    echo.
    echo 接下来在服务器上执行：
    echo ssh %SERVER_USER%@%SERVER_IP%
    echo cd /opt/mail-reply-agent
    echo chmod +x deploy.sh
    echo ./deploy.sh
    echo.
)

pause
