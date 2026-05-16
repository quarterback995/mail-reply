#!/bin/bash
# Mail-Reply-Agent 部署脚本（低内存优化版）

set -e

echo "=========================================="
echo "   Mail-Reply-Agent 服务器部署"
echo "=========================================="

# 1. 配置国内镜像加速 apt
echo "[1/8] 配置 apt 镜像源..."
sed -i 's/deb.debian.org/mirrors.aliyun.com/g' /etc/apt/sources.list.d/debian.sources 2>/dev/null || \
sed -i 's/deb.debian.org/mirrors.aliyun.com/g' /etc/apt/sources.list 2>/dev/null || true

# 2. 更新系统
echo "[2/8] 更新系统..."
apt-get update && apt-get upgrade -y

# 3. 配置 Swap（防止 OOM）
echo "[3/8] 配置 Swap..."
if [ ! -f /swapfile ]; then
    fallocate -l 2G /swapfile
    chmod 600 /swapfile
    mkswap /swapfile
    swapon /swapfile
    echo '/swapfile none swap sw 0 0' >> /etc/fstab
    sysctl vm.swappiness=10
    echo "Swap 配置完成（2GB）"
else
    echo "Swap 已存在，跳过"
fi

# 4. 安装 Docker
echo "[4/8] 安装 Docker..."
if ! command -v docker &> /dev/null; then
    curl -fsSL https://get.docker.com | sh
    systemctl start docker
    systemctl enable docker
    echo "Docker 安装完成"
else
    echo "Docker 已安装，跳过"
fi

# 5. 安装 Docker Compose
echo "[5/8] 安装 Docker Compose..."
if ! command -v docker-compose &> /dev/null; then
    apt-get install -y docker-compose
    echo "Docker Compose 安装完成"
else
    echo "Docker Compose 已安装，跳过"
fi

# 6. 创建项目目录
echo "[6/8] 准备项目目录..."
mkdir -p /opt/mail-reply-agent
cd /opt/mail-reply-agent

# 7. 检查项目文件
echo "[7/8] 检查项目文件..."
if [ ! -f "docker-compose.yml" ]; then
    echo "错误: 未找到 docker-compose.yml"
    echo "请先上传项目文件到 /opt/mail-reply-agent 目录"
    exit 1
fi

# 8. 启动服务
echo "[8/8] 启动服务..."
docker-compose down 2>/dev/null || true
docker-compose up -d --build

echo ""
echo "=========================================="
echo "   部署完成！"
echo "=========================================="
echo ""
echo "服务状态："
docker-compose ps

echo ""
echo "访问地址："
echo "  前端: http://$(curl -s ifconfig.me)"
echo "  后端: http://$(curl -s ifconfig.me):8001"
echo ""
echo "常用命令："
echo "  查看日志: docker-compose logs -f"
echo "  重启服务: docker-compose restart"
echo "  停止服务: docker-compose down"
echo "  查看状态: docker-compose ps"
echo "=========================================="
