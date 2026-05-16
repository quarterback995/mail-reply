#!/bin/bash

# 安全加固部署脚本
# 服务器: 8.166.143.118

set -e

echo "=== 邮件代理系统安全加固部署 ==="
echo ""

# 检查是否在项目目录
if [ ! -f "docker-compose.yml" ]; then
    echo "错误: 请在项目根目录执行此脚本"
    exit 1
fi

# 停止现有容器
echo "1. 停止现有容器..."
docker-compose down

# 重新构建并启动
echo "2. 重新构建并启动容器..."
docker-compose up -d --build

# 等待服务启动
echo "3. 等待服务启动..."
sleep 10

# 检查容器状态
echo "4. 检查容器状态..."
docker-compose ps

echo ""
echo "=== 部署完成 ==="
echo ""
echo "访问地址: http://8.166.143.118"
echo ""
echo "安全措施已启用:"
echo "  - 登录限流: 每IP每分钟5次"
echo "  - API限流: 每IP每秒10个请求"
echo "  - 屏蔽无用路径: /mcp, /jsonrpc, /security.txt"
echo "  - 屏蔽隐藏文件"
echo "  - CORS限制: 仅允许指定域名"
echo ""
echo "如需查看日志:"
echo "  docker-compose logs -f nginx"
echo "  docker-compose logs -f backend"
