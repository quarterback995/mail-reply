# Mail-Reply-Agent

AI 邮件回复助手 —— 基于 RAG 的全栈邮件回复生成系统，帮助用户根据历史回复模板和知识库文档，生成符合个人写作风格的邮件回复。

## 功能特性

### 核心功能
- **草稿工作台**：粘贴客户邮件，一键生成回复草稿，支持附加说明（如"更正式""用中文回复"）
- **网页参考**：输入 URL 抓取网页内容作为回复参考，支持单页抓取和整站爬取到知识库
- **多 API 支持**：后端可配置多个 AI API，前端可快速切换
- **模型档位选择**：快速 / 均衡 / 高质量三档，适配不同场景
- **附件支持**：工作台和模板均支持上传客户附件，自动提取文本内容（PDF、Word、图片 OCR）

### 数据管理
- **回复模板**：保存历史对话记录（含附件），帮助 AI 学习您的回复风格
- **知识库**：上传参考文档（菜单、政策、FAQ 等），生成回复时自动 RAG 检索
- **网站爬取**：输入起始 URL，自动爬取子页面保存到知识库（后台运行，实时进度）
- **语义搜索**：知识库支持语义检索测试，验证 RAG 召回效果
- **知识库编辑**：内联编辑文档内容、重命名、批量删除
- **排序功能**：知识库支持按名称、时间、大小排序

### 智能特性
- **混合检索**：向量语义搜索 + 关键词加权 + 查询分段 + 文档交错
- **布局感知分块**：菜单项+价格+注释保持在同一 chunk
- **文档增强**：自动标注价格、时间限制、最低订单等关键信息
- **多语言翻译**：百度 / Google / AI 三种翻译引擎

### 界面特性
- **可调整面板**：侧边栏、工作台左右面板、底部面板均可拖拽调整
- **布局记忆**：窗口大小自动保存，切换页面后恢复
- **暗色模式**：支持亮色/暗色主题切换
- **用户系统**：注册登录、配额管理、多用户数据隔离

## 技术栈

### 后端
- Python 3.10 + FastAPI
- ChromaDB 向量数据库 + text2vec-base-chinese embedding
- 多 API 适配（OpenAI / DeepSeek / Anthropic / 其他兼容接口）
- OCR 支持（Tesseract，中英文）

### 前端
- React + Vite
- Tailwind CSS（暗色模式）
- Axios + React Router

### 部署
- Docker + Docker Compose
- Nginx 反向代理（超时 300s）+ 安全加固
- 限流保护：登录限流 5次/分钟，API 限流 10次/秒
- 路径屏蔽：自动拦截恶意扫描请求

## 快速开始（Docker 部署）

### 1. 上传项目

```bash
scp -r D:\mail root@服务器IP:/opt/
```

### 2. 配置 API

编辑 `backend/.env`，添加 API 配置：

```env
# API 1
API_1_NAME=我的API
API_1_PROVIDER=openai
API_1_KEY=sk-your-key
API_1_BASE_URL=https://api.openai.com/v1
API_1_MODEL_FAST=gpt-4o-mini
API_1_MODEL_BALANCED=gpt-4o
API_1_MODEL_QUALITY=gpt-4-turbo
```

### 3. 构建并启动

```bash
cd /opt/mail
sudo docker-compose up -d --build
```

### 4. 访问

浏览器打开 `http://服务器IP`

> 只需放行 80 端口，前端和后端都通过 Nginx 统一入口访问。

详细部署文档见 [DEPLOY.md](DEPLOY.md)。

## 本地开发

### 后端

```bash
cd backend
pip install -r requirements.txt
# 编辑 .env 配置 API
uvicorn app.main:app --reload --host 0.0.0.0 --port 8001
```

### 前端

```bash
cd frontend
npm install
npm run dev
```

访问 `http://localhost:5173`

## 项目结构

```
mail/
├── backend/
│   ├── app/
│   │   ├── main.py              # FastAPI 入口
│   │   ├── routers/
│   │   │   ├── auth.py          # 用户注册/登录
│   │   │   ├── data.py          # 数据中心 + 网页抓取 + 爬虫 API
│   │   │   ├── draft.py         # 草稿生成 API
│   │   │   └── api_config.py    # API 配置管理
│   │   ├── services/
│   │   │   ├── auth.py          # 认证与配额服务
│   │   │   ├── vector_store.py  # 向量数据库（混合检索）
│   │   │   ├── llm_service.py   # LLM 调用服务
│   │   │   ├── web_fetch.py     # 单页 URL 抓取
│   │   │   └── web_crawler.py   # 多页网站爬虫
│   │   └── utils/
│   │       └── doc_enhancer.py  # 文档结构增强
│   ├── .env                     # API 配置（不提交到 git）
│   ├── Dockerfile
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── pages/
│   │   │   ├── DraftingWorkspace.jsx  # 草稿工作台（含网页抓取）
│   │   │   ├── DataLibrary.jsx        # 数据中心（编辑/搜索/排序/批量删除）
│   │   │   ├── ApiSettings.jsx        # API 设置
│   │   │   └── History.jsx            # 使用记录
│   │   ├── components/
│   │   │   └── Layout.jsx             # 布局组件
│   │   └── services/
│   │       └── api.js                 # API 请求封装
│   ├── nginx.conf                # Nginx 配置（超时 300s）
│   ├── Dockerfile
│   └── package.json
├── nginx/
│   └── nginx.conf                # Nginx 反向代理 + 限流配置
├── docker-compose.yml
├── DEPLOY.md                     # 部署指南
└── USER_GUIDE.md                 # 用户使用指南
```

## API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/auth/register` | 用户注册 |
| POST | `/api/auth/login` | 用户登录 |
| GET | `/api/auth/me` | 获取当前用户信息 |
| GET | `/api/auth/quota` | 获取配额信息 |
| POST | `/api/data/upload/style` | 上传回复模板 |
| POST | `/api/data/upload/knowledge` | 上传知识库文档 |
| GET | `/api/data/list/style` | 获取回复模板列表 |
| GET | `/api/data/list/knowledge` | 获取知识库列表 |
| GET | `/api/data/preview/{doc_type}/{doc_id}` | 预览文档 |
| GET | `/api/data/download/{doc_type}/{doc_id}` | 下载文档 |
| PUT | `/api/data/{doc_type}/{doc_id}` | 更新文档内容 |
| DELETE | `/api/data/{doc_type}/{doc_id}` | 删除文档 |
| POST | `/api/data/rename/{doc_type}/{doc_id}` | 重命名文档 |
| POST | `/api/data/batch-delete/{doc_type}` | 批量删除文档 |
| POST | `/api/data/search/knowledge` | 语义检索测试 |
| POST | `/api/data/fetch-url` | 单页 URL 抓取 |
| POST | `/api/data/crawl-url` | 启动网站爬取任务 |
| GET | `/api/data/crawl-status/{task_id}` | 查询爬取进度 |
| POST | `/api/data/translate` | 文本翻译 |
| POST | `/api/draft/generate` | 生成回复草稿 |
| GET | `/api/settings/apis` | 获取已配置的 API 列表 |

## 文档

- [部署指南](DEPLOY.md) — 服务器部署、日常运维、数据备份
- [用户使用指南](USER_GUIDE.md) — 前端功能使用说明
