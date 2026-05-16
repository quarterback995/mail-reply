@echo off
chcp 65001 >nul
echo ========================================
echo    Mail-Reply-Agent Docker 启动
echo ========================================
echo.

REM 检查 Docker
docker --version >nul 2>&1
if errorlevel 1 (
    echo [错误] 未找到 Docker，请先安装 Docker Desktop
    echo 下载地址: https://www.docker.com/products/docker-desktop/
    pause
    exit /b 1
)

echo [1/3] 构建镜像...
docker-compose build --no-cache
if errorlevel 1 (
    echo [错误] 构建失败
    pause
    exit /b 1
)

echo [2/3] 启动服务...
docker-compose up -d
if errorlevel 1 (
    echo [错误] 启动失败
    pause
    exit /b 1
)

echo [3/3] 等待服务就绪...
timeout /t 5 /nobreak >nul

echo.
echo ========================================
echo    服务启动完成！
echo ========================================
echo.
echo 前端访问: http://localhost:3000
echo 后端 API: http://localhost:8001
echo.
echo 查看日志: docker-compose logs -f
echo 停止服务: docker-compose down
echo ========================================
echo.

REM 打开浏览器
start http://localhost:3000

pause
