# Mail-Reply-Agent 服务器部署指南

## 待部署变更记录（2026-05-09）

### 本次变更内容

#### 1. 网页抓取 + 知识库爬虫（全新功能）
- **新增** `backend/app/services/web_fetch.py` — 单页 URL 抓取
- **新增** `backend/app/services/web_crawler.py` — 多页网站爬虫，后台任务 + 进度追踪
- **新增** `backend/app/routers/data.py` 中的 API 端点：
  - `POST /data/fetch-url` — 单页抓取（带 doc_enhancer）
  - `POST /data/crawl-url` — 启动后台爬取任务
  - `GET /data/crawl-status/{task_id}` — 轮询爬取进度
  - `POST /data/search/knowledge` — 语义搜索测试
  - `POST /data/rename/{doc_type}/{doc_id}` — 重命名文档
  - `POST /data/batch-delete/{doc_type}` — 批量删除文档

#### 2. RAG 检索质量优化
- **修改** `backend/app/services/vector_store.py`：
  - 混合检索（向量搜索 + 关键词加权）
  - 长查询分段（overlapping segments）
  - 文档交错（diversity）
  - 布局感知分块（structured items 保留在一起）
  - 分数阈值过滤（MIN_SCORE = 0.35）

#### 3. LLM 服务增强
- **修改** `backend/app/services/llm_service.py`：支持 `web_content` 参数注入

#### 4. 草稿路由增强
- **修改** `backend/app/routers/draft.py`：knowledge k 从 8 增加到 10

#### 5. 前端功能
- **修改** `frontend/src/pages/DraftingWorkspace.jsx`：
  - URL 输入栏 + 抓取按钮 + 爬取按钮
  - 爬取进度轮询（localStorage 持久化）
  - web_content 注入生成请求
- **修改** `frontend/src/pages/DataLibrary.jsx`：
  - 知识库语义搜索测试
  - 内联内容编辑器
  - 内联重命名
  - 批量删除（复选框 + 全选）

#### 6. API 前端服务
- **修改** `frontend/src/services/api.js`：
  - `webFetchService`（fetchUrl, startCrawl, getCrawlStatus）
  - `dataService` 新增（searchKnowledge, renameDocument, batchDelete）

#### 7. 爬虫关键 Bug 修复（2026-05-09）
- **修改** `backend/app/services/web_fetch.py`：从 REMOVE_TAGS 移除 `'footer'` 和 `'aside'`
- **修改** `backend/app/services/web_crawler.py`：从 BOILERPLATE_TAGS 移除 `'footer'` 和 `'aside'`；重写 `_clean_html` 为更简洁可靠的实现
- **原因**：`<footer>` 和 `<aside>` 标签包含营业时间、限时政策、联系方式等关键信息，之前被错误地当作样板内容移除

#### 8. 爬取进度追踪优化
- **修改** `backend/app/services/web_crawler.py`：
  - `CrawlTask` 新增 `pages_visited` 和 `created_at` 字段
  - `run_crawl_task` 增加完整日志，`pages_saved` 逐步递增
  - `on_progress` 回调实时更新 `pages_visited`
- **修改** `backend/app/routers/data.py`：爬取状态端点增加 10 分钟超时检测
- **修改** `frontend/src/pages/DraftingWorkspace.jsx`：按钮实时显示 `已访问 X 链接` → `已保存 X/Y 页`；轮询增加重试上限（10 次）

#### 9. 知识库时间标签
- **修改** `backend/app/services/vector_store.py`：元数据新增 `created_at` 时间戳；`list_documents` 返回 `created_at` 和 `source_url`
- **修改** `frontend/src/pages/DataLibrary.jsx`：新增 `formatTimestamp` 函数，每个文档显示创建时间

#### 10. 知识库排序功能
- **修改** `frontend/src/pages/DataLibrary.jsx`：新增排序栏（名称/时间/大小），支持升序/降序切换
- **修改** `backend/app/services/vector_store.py`：元数据新增 `content_size` 字段；`list_documents` 返回 `content_size`

#### 11. 超时配置优化
- **修改** `frontend/nginx.conf`：`proxy_read_timeout` 从 120s 增加到 300s
- **修改** `backend/app/services/llm_service.py`：LLM 客户端默认超时从 60s 增加到 120s

### 部署步骤

```bash
# 上传所有修改的文件
scp -r D:\mail\backend root@8.166.143.118:/opt/mail/
scp -r D:\mail\frontend root@8.166.143.118:/opt/mail/

# 重建并启动
ssh root@8.166.143.118 "cd /opt/mail && sudo docker-compose down && sudo docker-compose up -d --build"
```

或只上传修改的文件：

```bash
# 后端
scp D:\mail\backend\app\services\web_fetch.py D:\mail\backend\app\services\web_crawler.py D:\mail\backend\app\services\vector_store.py D:\mail\backend\app\services\llm_service.py root@8.166.143.118:/opt/mail/backend/app/services/
scp D:\mail\backend\app\routers\data.py root@8.166.143.118:/opt/mail/backend/app/routers/

# 前端
scp D:\mail\frontend\src\pages\DraftingWorkspace.jsx D:\mail\frontend\src\pages\DataLibrary.jsx root@8.166.143.118:/opt/mail/frontend/src/pages/
scp D:\mail\frontend\src\services\api.js root@8.166.143.118:/opt/mail/frontend/src/services/
scp D:\mail\frontend\nginx.conf root@8.166.143.118:/opt/mail/frontend/

# 重建
ssh root@8.166.143.118 "cd /opt/mail && sudo docker-compose down && sudo docker-compose up -d --build"
```

### 部署后操作

1. 清除旧的向量数据库（分块策略已变更，旧数据不兼容）：
```bash
ssh root@8.166.143.118 "cd /opt/mail && sudo rm -rf backend/chroma_db && sudo docker-compose restart"
```
2. 重新上传回复模板和知识库文档
3. 重新爬取需要的网站（新爬虫会保留 footer 内容）

---

## 安全加固部署（2026-05-12）

### 变更内容

#### 1. Nginx 反向代理
- 新增 `nginx/nginx.conf` 配置文件
- 前端和后端都通过 Nginx 的 80 端口统一访问
- 不再暴露 3000 和 8001 端口到公网

#### 2. 限流保护
- **登录接口**：每 IP 每分钟 5 次请求（防止暴力破解）
- **API 接口**：每 IP 每秒 10 个请求，突发 20 个（防止 DDoS）

#### 3. 路径屏蔽
- 屏蔽恶意扫描路径：`/mcp`、`/jsonrpc`、`/security.txt`、`/favicon.ico`
- 屏蔽隐藏文件：`/.` 开头的路径
- 返回 444 状态码直接断开连接

#### 4. CORS 配置收紧
- 之前：`allow_origins=["*"]`（允许所有来源）
- 现在：只允许指定的域名（`http://8.166.143.118`）

### 部署步骤

```bash
# 上传更新的文件
scp -r D:\mail\nginx root@8.166.143.118:/opt/mail/
scp D:\mail\docker-compose.yml root@8.166.143.118:/opt/mail/
scp D:\mail\backend\app\main.py root@8.166.143.118:/opt/mail/backend/app/

# 重建并启动
ssh root@8.166.143.118 "cd /opt/mail && sudo docker-compose down && sudo docker-compose up -d --build"
```

### 验证安全措施

```bash
# 检查 Nginx 日志
ssh root@8.166.143.118 "sudo docker logs mail-nginx --tail 50 -f"

# 测试限流（快速连续请求）
for i in {1..10}; do curl -s http://8.166.143.118/api/health; done

# 测试屏蔽路径
curl -I http://8.166.143.118/mcp
curl -I http://8.166.143.118/security.txt
```

---



## 环境要求

- 服务器：Linux（Ubuntu/CentOS）
- 已安装：Docker、Docker Compose
- 端口放行：80（Nginx 统一入口）
- 建议内存：2GB+
- 建议磁盘：10GB+（含模型缓存）

> **注意**：请使用 `docker-compose`（带连字符）命令，部分系统 `docker compose`（空格）不可用。

---

## 一、首次部署

### 1. 上传项目到服务器

```bash
scp -r D:\mail root@服务器IP:/opt/
```

### 2. SSH 登录服务器

```bash
ssh root@服务器IP
```

### 3. 构建并启动

```bash
cd /opt/mail
sudo docker-compose up -d --build
```

如果 `docker-compose` 命令不存在：

```bash
sudo apt install -y docker-compose
```

> **首次启动注意**：
> - text2vec 模型（约 400MB）会在首次使用时从 hf-mirror.com 自动下载
> - 模型缓存在 `hf_cache` volume 中，后续重建不会重复下载
> - 查看下载进度：`sudo docker logs mail-backend -f`

### 4. 放行端口

在云服务器控制台（阿里云/腾讯云）的**安全组**中添加入方向规则：
- 端口 **80**：HTTP 访问（TCP）

> **说明**：前端和后端都通过 Nginx 的 80 端口统一访问，无需放行 3000 和 8001 端口。
> **常见问题**：后端日志正常但浏览器 502，通常是安全组未放行端口 80。

### 5. 验证

```bash
sudo docker ps
sudo docker logs mail-nginx --tail 50 -f
curl http://localhost/api/health
curl -I http://localhost
```

浏览器访问：`http://服务器IP`

---

## 二、日常操作

### 查看日志

```bash
sudo docker logs mail-nginx --tail 50 -f
sudo docker logs mail-backend --tail 50 -f
```

### 重启服务

```bash
cd /opt/mail
sudo docker-compose restart
```

### 停止服务

```bash
cd /opt/mail
sudo docker-compose down
```

### 重新构建（代码更新后）

```bash
cd /opt/mail
sudo docker-compose up -d --build
```

### 完全重新构建（清除缓存）

当普通构建不生效时（例如依赖未更新），使用 `--no-cache`：

```bash
cd /opt/mail
sudo docker-compose down
sudo docker-compose build --no-cache
sudo docker-compose up -d
```

> **提示**：不加 `--no-cache` 时，Docker 会使用构建缓存，已下载的依赖（如 torch）不会重复下载。

---

## 三、代码更新流程

### 方式一：更新整个后端

```bash
# 本地：上传后端代码
scp -r D:\mail\backend root@服务器IP:/opt/mail/

# 服务器：重建
ssh root@服务器IP "cd /opt/mail && sudo docker-compose down && sudo docker-compose up -d --build"
```

### 方式二：只更新部分 Python 文件

```bash
# 本地：上传修改的文件
scp D:\mail\backend\app\services\llm_service.py root@服务器IP:/opt/mail/backend/app/services/

# 服务器：必须 down + up（restart 不会重新构建）
ssh root@服务器IP "cd /opt/mail && sudo docker-compose down && sudo docker-compose up -d --build"
```

> **重要**：Python 代码更新后必须 `down + up --build`，`restart` 只会重启旧镜像。

### 方式三：只更新前端（如 nginx.conf）

```bash
# 上传修改的文件
scp D:\mail\frontend\nginx.conf root@服务器IP:/opt/mail/frontend/

# 只重建前端（后端用缓存，不重新下载依赖）
ssh root@服务器IP "cd /opt/mail && sudo docker-compose down && sudo docker-compose build frontend && sudo docker-compose up -d"
```

### 方式四：更新 Nginx 配置

```bash
# 上传修改的 Nginx 配置
scp D:\mail\nginx\nginx.conf root@服务器IP:/opt/mail/nginx/

# 重启 Nginx 容器（无需重建）
ssh root@服务器IP "cd /opt/mail && sudo docker-compose restart nginx"
```

### 方式五：只更新前端 React 组件

```bash
# 上传修改的组件文件
scp D:\mail\frontend\src\pages\DraftingWorkspace.jsx root@服务器IP:/opt/mail/frontend/src/pages/
scp D:\mail\frontend\src\pages\DataLibrary.jsx root@服务器IP:/opt/mail/frontend/src/pages/
scp D:\mail\frontend\src\components\Layout.jsx root@服务器IP:/opt/mail/frontend/src/components/

# 重建前端容器（会重新编译 React）
ssh root@服务器IP "cd /opt/mail && sudo docker-compose up -d --build frontend"
```

---

## 四、.env 配置更新

### ⚠️ 关键注意事项：Docker bind mount 的 inode 问题

`.env` 文件通过 Docker bind mount 挂载到容器内。但 `scp` 和 `sed -i` 会创建新文件（inode 改变），导致 bind mount 失效，容器内仍是旧内容。

**正确做法**：修改 `.env` 后必须 `down + up` 重建容器（不是 restart）。

### 本地修改 .env 后同步到服务器

```bash
# 1. 本地编辑
notepad D:\mail\backend\.env

# 2. 上传
scp D:\mail\backend\.env root@服务器IP:/opt/mail/backend/.env

# 3. 重建容器（必须 down + up）
ssh root@服务器IP "cd /opt/mail && sudo docker-compose down && sudo docker-compose up -d"

# 4. 验证
ssh root@服务器IP "docker exec mail-backend env | grep API"
```

### 在服务器上直接修改 .env

```bash
# 编辑（用 nano/vi，不要用 sed -i）
nano /opt/mail/backend/.env

# 重建容器
cd /opt/mail && sudo docker-compose down && sudo docker-compose up -d
```

> **不要用 `sed -i` 修改 .env**：会创建新文件替换旧文件（inode 改变），破坏 Docker bind mount。

### .env 完整配置说明

```env
# ============================================================
# 多 API 配置（前端可直接选择）
# ============================================================
# 编号从 1 开始，支持配置任意多个 API
# 每个 API 包含: NAME, PROVIDER, KEY, BASE_URL
# 可选: MODEL_FAST, MODEL_BALANCED, MODEL_QUALITY
# 注释掉（行首加 #）即可隐藏该条目

API_1_NAME=显示名称
API_1_PROVIDER=openai
API_1_KEY=sk-your-key
API_1_BASE_URL=https://api.openai.com/v1
API_1_MODEL_FAST=gpt-4o-mini
API_1_MODEL_BALANCED=gpt-4o
API_1_MODEL_QUALITY=gpt-4-turbo

# ============================================================
# 全局默认参数
# ============================================================
DEFAULT_TEMPERATURE=0.7
DEFAULT_MAX_TOKENS=20000

# ============================================================
# 翻译服务配置
# ============================================================
# 百度翻译（免费 5万次/月）：https://fanyi-api.baidu.com/product/113
BAIDU_TRANS_APP_ID=your_app_id
BAIDU_TRANS_SECRET=your_secret_key
```

### 翻译服务配置

翻译支持 3 个引擎，前端可切换：

| 引擎 | 说明 | 需要配置 | 国内可用 |
|------|------|---------|---------|
| **百度** | 默认，免费 5 万次/月 | `BAIDU_TRANS_APP_ID` + `BAIDU_TRANS_SECRET` | 是 |
| **Google** | 原有 | 无需 | 否 |
| **AI** | 用已配置的 LLM API | 无需额外配置 | 是 |

申请百度翻译：https://fanyi-api.baidu.com/product/113 → 创建应用 → 获取 APP_ID 和 SECRET_KEY

---

## 五、数据管理

### 数据存储位置

| 数据 | 服务器路径 | 容器内路径 |
|------|-----------|-----------|
| 用户数据库 | `/opt/mail/backend/data/` | `/app/data/` |
| 向量数据库 | `/opt/mail/backend/chroma_db/` | `/app/chroma_db/` |
| 上传文件 | `/opt/mail/backend/uploads/` | `/app/uploads/` |
| API 配置 | `/opt/mail/backend/.env` | `/app/.env` |
| 模型缓存 | Docker volume `hf_cache` | `/root/.cache/huggingface` |

以上目录通过 Docker volume 挂载，容器重启不丢失。

### 备份数据

```bash
cd /opt/mail
tar -czf backup_$(date +%Y%m%d).tar.gz backend/data backend/chroma_db backend/uploads

# 下载到本地
scp root@服务器IP:/opt/mail/backup_*.tar.gz D:\mail\
```

### 恢复数据

```bash
scp D:\mail\backup_20260507.tar.gz root@服务器IP:/opt/mail/
ssh root@服务器IP "cd /opt/mail && tar -xzf backup_20260507.tar.gz && sudo docker-compose down && sudo docker-compose up -d"
```

### 清除所有数据重新开始

```bash
cd /opt/mail
sudo docker-compose down
sudo rm -rf backend/chroma_db backend/data backend/uploads
sudo docker-compose up -d
```

### 清除向量数据库（切换 embedding 模型后）

如果更换了 embedding 模型，旧数据不兼容，需要清除：

```bash
cd /opt/mail
sudo rm -rf backend/chroma_db
sudo docker-compose restart
```

> 清除后需要重新上传回复模板和知识库文档。

---

## 六、用户管理

### 查看所有用户

```bash
docker exec mail-backend python3 -c "import sqlite3;conn=sqlite3.connect('data/users.db');[print(r) for r in conn.execute('SELECT user_id,username,tier,created_at FROM users')];conn.close()"
```

### 修改用户等级

```bash
docker exec mail-backend python3 -c "import sqlite3;conn=sqlite3.connect('data/users.db');conn.execute(\"UPDATE users SET tier='pro' WHERE username='用户名'\");conn.commit();print('done');conn.close()"
```

### 设置用户不限次数

```bash
docker exec mail-backend python3 -c "import sqlite3;conn=sqlite3.connect('data/users.db');conn.execute(\"UPDATE users SET tier='unlimited' WHERE username='shao'\");conn.commit();print('done');conn.close()"
```

### 等级说明

| 等级 | 每日配额 | 说明 |
|------|---------|------|
| `free` | 20 次 | 默认注册等级 |
| `pro` | 200 次 | 专业用户 |
| `unlimited` | 不限 | 管理员/内部用户 |

### 查看用户配额使用情况

```bash
docker exec mail-backend python3 -c "import sqlite3;conn=sqlite3.connect('data/users.db');[print(r) for r in conn.execute('SELECT u.username,q.draft_count_today,q.last_reset_date FROM users u JOIN usage_quota q ON u.user_id=q.user_id')];conn.close()"
```

### 查看操作记录（审计日志）

```bash
docker exec mail-backend python3 -c "import sqlite3;conn=sqlite3.connect('data/users.db');[print(r) for r in conn.execute('SELECT * FROM audit_log ORDER BY rowid DESC LIMIT 20')];conn.close()"
```

### 查看生成记录

```bash
docker exec mail-backend python3 -c "import sqlite3;conn=sqlite3.connect('data/users.db');[print(r) for r in conn.execute('SELECT * FROM user_records ORDER BY rowid DESC LIMIT 10')];conn.close()"
```

---

## 七、配置 API

### 多 API 配置格式

编辑 `backend/.env`，每个 API 用编号区分：

```env
# API 1
API_1_NAME=显示名称
API_1_PROVIDER=openai
API_1_KEY=sk-your-key
API_1_BASE_URL=https://api.openai.com/v1
API_1_MODEL_FAST=gpt-4o-mini
API_1_MODEL_BALANCED=gpt-4o
API_1_MODEL_QUALITY=gpt-4-turbo

# API 2（可添加任意多个）
API_2_NAME=DeepSeek
API_2_PROVIDER=deepseek
API_2_KEY=sk-your-key
API_2_BASE_URL=https://api.deepseek.com
API_2_MODEL_FAST=deepseek-chat
API_2_MODEL_BALANCED=deepseek-chat
API_2_MODEL_QUALITY=deepseek-reasoner
```

注释掉某个 API（在行首加 `#`）即可隐藏：

```env
#API_2_NAME=已禁用的API
```

修改后重建容器生效：

```bash
cd /opt/mail
sudo docker-compose down && sudo docker-compose up -d
```

### 推理模型适配

部分模型（如 Qwen3.5）是推理模型，返回格式特殊：`content` 为空，实际内容在 `reasoning` 字段。项目已内置自动处理（`llm_service.py` 中的 `_fetch_reasoning_fallback`），无需额外配置。

---

## 八、修改限额配置

编辑 `backend/app/services/auth.py` 中的 `TIER_QUOTAS`：

```python
TIER_QUOTAS = {
    "free": 20,        # 免费用户每天限额
    "pro": 200,        # 专业用户每天限额
    "unlimited": 999999,  # 不限量
}
```

修改后重新构建：

```bash
cd /opt/mail
sudo docker-compose down && sudo docker-compose up -d --build
```

---

## 九、支持的文件格式

| 格式 | 处理方式 | 说明 |
|------|---------|------|
| `.txt` `.md` | 直接读取 | 纯文本 |
| `.docx` | python-docx 提取 | Word 文档 |
| `.pdf`（文字型） | pypdf 提取 | 文字可选中的 PDF |
| `.pdf`（扫描型） | Tesseract OCR | 自动检测并 OCR |
| `.jpg` `.png` `.bmp` `.tiff` `.webp` | Tesseract OCR | 图片文字识别 |

> OCR 支持中文（简体 + 繁体）和英文。

---

## 十、已知问题与解决方案

### Docker Compose 1.29.2 的 ContainerConfig 错误

**问题**：`KeyError: 'ContainerConfig'`，docker-compose 1.29.2 与新版 Docker 构建的镜像不兼容。

**解决**：必须先 down 再 up：

```bash
cd /opt/mail
sudo docker-compose down && sudo docker-compose up -d --build
```

### .env 修改后容器内未更新

**原因**：`scp` 或 `sed -i` 创建新文件（inode 改变），Docker bind mount 失效。

**解决**：
1. 不要用 `sed -i` 改 .env，用 `nano` 或 `vi` 原地编辑
2. 修改后执行 `docker-compose down && docker-compose up -d` 重建容器

### 向量搜索无结果 / RAG 不生效

**原因**：embedding 模型不匹配或未正确加载。

**解决**：
1. 确认 `vector_store.py` 使用 `Text2VecEmbeddingFunction`
2. 确认 `requirements.txt` 包含 `text2vec`
3. 检查容器日志是否有模型加载错误：`sudo docker logs mail-backend`
4. 如需切换 embedding 模型，清除旧数据：
   ```bash
   cd /opt/mail
   sudo rm -rf backend/chroma_db
   sudo docker-compose restart
   ```
   > 清除后需重新上传回复模板和知识库文档

### 502 错误

1. 检查容器运行状态：`sudo docker ps`
2. 查看后端日志：`sudo docker logs mail-backend`
3. 检查安全组是否放行端口 3000
4. 测试后端：`curl http://localhost:8001/api/health`

### 413 上传文件过大

**原因**：Nginx 默认限制上传大小为 1MB。

**解决**：`nginx.conf` 中已配置 `client_max_body_size 50m`。如果仍不够，修改 `frontend/nginx.conf`：

```nginx
client_max_body_size 100m;  # 改为 100MB
```

然后重建前端：
```bash
sudo docker-compose down && sudo docker-compose build frontend && sudo docker-compose up -d
```

### 翻译失败

1. 检查百度翻译配置：`docker exec mail-backend env | grep BAIDU`
2. 确认 APP_ID 和 SECRET_KEY 正确
3. 国内服务器不要使用 Google 翻译引擎
4. 可切换到 AI 引擎（使用已配置的 LLM API 翻译）

### text2vec 模型下载失败

**原因**：huggingface.co 国内无法访问。

**解决**：已在 `docker-compose.yml` 中配置 `HF_ENDPOINT=https://hf-mirror.com`，使用国内镜像下载。如果仍失败，检查镜像是否正常。

### 代码更新后未生效

```bash
# restart 不会重新编译，必须 down + up --build
sudo docker-compose down
sudo docker-compose build --no-cache
sudo docker-compose up -d
```

### 用户数据丢失

数据通过 volume 挂载在 `/opt/mail/backend/data/` 等目录，只要不手动删除就不会丢。如果删除了，需重新上传本地备份。

### 容器自动重启

已配置 `restart: unless-stopped`，服务器重启后容器会自动恢复。

### Web 搜索功能不工作

**原因**：`duckduckgo-search` 依赖未安装或网络问题。

**解决**：
1. 确认 `requirements.txt` 包含 `duckduckgo-search`
2. 重建后端容器：`sudo docker-compose up -d --build backend`
3. 检查日志：`sudo docker logs mail-backend | grep search`

> **注意**：DuckDuckGo 在国内可能需要代理。如果搜索失败，系统会自动降级，不影响核心生成功能。

---

## 十一、功能特性

### 核心功能

- **AI 邮件回复生成**：基于 RAG（检索增强生成）技术
- **回复模板管理**：上传邮件对话作为风格参考
- **知识库管理**：上传文档（菜单、政策等）作为参考
- **多 API 支持**：配置多个 LLM API，前端可切换
- **多模型选择**：快速/均衡/高质量三档模型可选

### 智能特性

- **时间推理**：自动识别邮件中的时间引用，联网查询当前日期/节假日
- **时间规则匹配**：支持 "After 6pm" 等时间限制规则的数值比较
- **文档增强**：自动标注价格、时间限制、最低订单等关键信息
- **OCR 支持**：扫描型 PDF 和图片文字识别（中英文）

### 前端特性

- **可调整面板大小**：侧边栏、工作台左右面板、底部面板均可拖拽调整
- **布局记忆**：窗口大小自动保存，切换页面后恢复
- **暗色模式**：支持亮色/暗色主题切换
- **多语言翻译**：百度/Google/AI 三种翻译引擎

### 安全特性

- **用户认证**：JWT Token 会话管理
- **配额控制**：每日生成次数限制
- **审计日志**：记录所有生成操作
- **数据隔离**：每个用户独立的模板和知识库

---

## 十二、更新流程速查表

| 操作 | 命令 | 需要重建 | 需要清除数据 |
|------|------|---------|-------------|
| 改 .env（API/翻译配置） | `down + up` | 否 | 否 |
| 改 Python 代码 | `down + up --build` | 是 | 否 |
| 改前端代码 | `down + build frontend + up` | 是（仅前端） | 否 |
| 改 nginx.conf（Nginx） | `restart nginx` | 否 | 否 |
| 改 requirements.txt | `down + up --build` | 是 | 否 |
| 切换 embedding 模型 | `rm -rf chroma_db` + `restart` | 否 | 是（重新上传数据） |
| 重启服务 | `restart` | 否 | 否 |
| 清除缓存重建 | `down && build --no-cache && up -d` | 是 | 否 |

---

## 十三、快速部署命令（本项目）

### 服务器信息

- IP: `8.166.143.118`
- 用户: `root`

### 首次部署

```bash
# 上传整个项目
scp -r D:\mail root@8.166.143.118:/opt/

# 登录服务器
ssh root@8.166.143.118

# 构建并启动
cd /opt/mail
sudo docker-compose up -d --build
```

### 日常更新

```bash
# 更新后端代码
scp -r D:\mail\backend root@8.166.143.118:/opt/mail/
ssh root@8.166.143.118 "cd /opt/mail && sudo docker-compose up -d --build"

# 更新前端代码
scp -r D:\mail\frontend root@8.166.143.118:/opt/mail/
ssh root@8.166.143.118 "cd /opt/mail && sudo docker-compose up -d --build frontend"

# 更新 Nginx 配置
scp D:\mail\nginx\nginx.conf root@8.166.143.118:/opt/mail/nginx/
ssh root@8.166.143.118 "cd /opt/mail && sudo docker-compose restart nginx"

# 更新单个文件（示例：Layout.jsx）
scp D:\mail\frontend\src\components\Layout.jsx root@8.166.143.118:/opt/mail/frontend/src/components/
ssh root@8.166.143.118 "cd /opt/mail && sudo docker-compose up -d --build frontend"
```

### 重启服务

```bash
ssh root@8.166.143.118 "cd /opt/mail && sudo docker-compose restart"
```

### 查看日志

```bash
ssh root@8.166.143.118 "sudo docker logs mail-nginx --tail 100 -f"
ssh root@8.166.143.118 "sudo docker logs mail-backend --tail 50 -f"
```
