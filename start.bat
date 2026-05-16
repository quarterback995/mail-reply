@echo off
chcp 65001 >nul
echo ========================================
echo    Mail-Reply-Agent 启动脚本
echo ========================================
echo.

REM 检查 Python
python --version >nul 2>&1
if errorlevel 1 (
    echo [错误] 未找到 Python，请先安装 Python 3.8+
    pause
    exit /b 1
)

REM 检查 Node.js
node --version >nul 2>&1
if errorlevel 1 (
    echo [错误] 未找到 Node.js，请先安装 Node.js 16+
    pause
    exit /b 1
)

echo [1/4] 安装后端依赖...
cd backend
pip install -r requirements.txt -q

echo [2/4] 启动后端服务...
start "Mail-Reply-Agent Backend" cmd /c "python -m uvicorn app.main:app --host 0.0.0.0 --port 8001"

cd ..

echo [3/4] 安装前端依赖...
cd frontend
call npm install --silent

echo [4/4] 启动前端服务...
echo.
echo ========================================
echo    服务启动完成！
echo ========================================
echo.
echo 本机访问: http://localhost:5173
echo 局域网访问: http://10.68.89.52:5173
echo.
echo 按 Ctrl+C 停止服务
echo ========================================
echo.
call npm run dev
