FROM python:3.10-slim

WORKDIR /app
ENV PYTHONPATH=/app

# 使用国内镜像加速 apt（兼容不同 Debian 版本）
RUN if [ -f /etc/apt/sources.list.d/debian.sources ]; then \
      sed -i 's/deb.debian.org/mirrors.aliyun.com/g' /etc/apt/sources.list.d/debian.sources; \
    elif [ -f /etc/apt/sources.list ]; then \
      sed -i 's/deb.debian.org/mirrors.aliyun.com/g' /etc/apt/sources.list; \
    fi

# 安装系统依赖（含 Tesseract OCR + 中文语言包）
RUN apt-get update && apt-get install -y \
    build-essential \
    tesseract-ocr \
    tesseract-ocr-chi-sim \
    tesseract-ocr-chi-tra \
    libgl1 \
    && rm -rf /var/lib/apt/lists/*

# 安装 PyTorch CPU 版本（约 200MB，不含 CUDA）
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu

# 使用阿里云镜像安装其他依赖
COPY requirements.txt .
RUN pip install --no-cache-dir -i https://mirrors.aliyun.com/pypi/simple/ -r requirements.txt

# 复制项目代码
COPY . .

# 创建数据目录
RUN mkdir -p /app/chroma_db /app/uploads/style /app/uploads/knowledge /app/data

EXPOSE 8001

CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001"]
