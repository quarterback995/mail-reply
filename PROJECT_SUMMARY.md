# Mail-Reply-Agent 项目总结

## 一、项目概述

AI 邮件回复助手，基于 RAG（检索增强生成）技术，帮助用户根据历史回复模板和知识库文档，生成符合个人写作风格的邮件回复。部署在阿里云 ECS（8.166.143.118），使用 Docker 容器化部署。

---

## 二、功能清单与实现方式

### 2.1 草稿工作台

**功能**：粘贴客户邮件，一键生成回复草稿。

**实现**：
- 前端 `DraftingWorkspace.jsx`：左右分栏布局，左侧输入邮件，右侧显示生成结果
- 后端 `draft.py` → `llm_service.py`：接收邮件内容，调用 LLM API 生成回复
- RAG 流程：邮件内容 → 向量检索 style（k=3）+ knowledge（k=10）→ 注入 prompt → LLM 生成
- 支持附加说明（如"更正式"），注入到 prompt 的 `additional_context` 字段
- 模型三档选择：快速/均衡/高质量，前端根据 provider + tier 选择对应模型
- localStorage 持久化：邮件内容、草稿、设置在页面切换后不丢失
- 历史记录：生成结果保存到 SQLite，支持回溯

### 2.2 多 API 支持

**功能**：后端配置多个 AI API，前端可切换。

**实现**：
- `.env` 文件按编号配置（API_1_NAME, API_1_PROVIDER, API_1_KEY...）
- `api_config.py` 读取 .env 解析为 API 列表
- 前端 `ApiSettings.jsx` 显示 API 卡片选择器
- 请求拦截器（`api.js`）自动注入当前选中的 API 配置到 Header
- 支持 OpenAI / DeepSeek / Anthropic / Moonshot / Zhipu / Xiaomi 等

### 2.3 回复模板

**功能**：保存历史对话记录，帮助 AI 学习回复风格。

**实现**：
- `DataLibrary.jsx` 模板管理界面：新建/编辑/搜索/预览/下载/删除
- 多轮对话结构：customer + user 消息对，支持附件
- 向量化存储：ChromaDB 按用户隔离，doc_type="style"
- 生成时检索最相关的 3 个 style chunks 作为 few-shot 示例

### 2.4 知识库

**功能**：上传参考文档，RAG 自动检索。

**实现**：
- 支持格式：TXT、PDF（文字型+扫描型 OCR）、Word、Markdown、图片 OCR
- `extract_text()` 函数（`data.py`）：根据文件类型选择提取方式
- 扫描 PDF：pypdf 提取失败时自动用 Tesseract OCR（中英文）
- 文档增强（`doc_enhancer.py`）：自动标注价格、时间限制、最低订单等
- 向量化存储：ChromaDB 按用户隔离，doc_type="knowledge"

### 2.5 RAG 检索优化

**功能**：提高知识库召回质量，解决"漏看"问题。

**实现**（`vector_store.py` 的 `search` 方法）：

1. **查询分段**（`_split_query`）：长邮件自动分成重叠片段，每段 400 字，分别检索后合并
2. **向量搜索**：每个片段用 text2vec 编码，ChromaDB cosine 检索
3. **关键词加权**（`_extract_keywords`）：提取 top 10 关键词，匹配的 chunk 加分
4. **分数阈值**：`MIN_SCORE = 0.35` 过滤低相关结果
5. **文档交错**：不同文档的 chunk 交替排列，避免单一文档占据所有结果
6. **布局感知分块**（`_split_text`）：菜单项+价格+注释保持在同一 chunk（150% 容差）

### 2.6 网页抓取

**功能**：输入 URL 抓取网页内容，作为回复参考或保存到知识库。

**实现**：

**单页抓取**（`web_fetch.py`）：
- httpx 异步请求，_clean_html 提取文本
- doc_enhancer 结构增强
- 返回 {url, title, content, char_count}

**整站爬取**（`web_crawler.py`）：
- BFS 广度优先，最多 50 页，深度 2 层
- 同域名链接过滤，排除登录/购物车/资源文件等
- 后台线程执行（`threading.Thread`），不阻塞前端
- CrawlTask 类跟踪进度：pages_visited / pages_found / pages_saved
- 前端轮询 GET /crawl-status/{task_id}，实时显示进度
- localStorage 保存 pending_crawl，页面切换后恢复轮询
- 同一网站重复爬取自动替换旧数据（filename 匹配删除）

### 2.7 知识库管理

**功能**：编辑、重命名、排序、批量删除、语义搜索测试。

**实现**：
- **内联编辑**：点击编辑图标 → textarea 显示全文 → PUT /data/{doc_type}/{doc_id} 更新
- **重命名**：点击重命名图标 → input 输入新名称 → POST /data/rename/{doc_type}/{doc_id}
- **排序**：前端排序（名称 localeCompare / 时间 created_at / 大小 content_size），支持升降序
- **批量删除**：复选框选择 → POST /data/batch-delete/{doc_type} 批量删除
- **语义搜索**：POST /data/search/knowledge 测试 RAG 召回效果
- **时间标签**：元数据 created_at（毫秒时间戳），前端格式化显示

### 2.8 翻译功能

**功能**：将邮件或草稿翻译为多种语言。

**实现**：
- 三种引擎：百度翻译 API（免费 5 万次/月）、Google Translate、AI（用已配置的 LLM）
- 按段落翻译，保持段落结构
- 百度翻译：MD5 签名鉴权，httpx 异步调用
- 前端每侧独立选择语言和引擎

### 2.9 用户系统

**功能**：注册登录、配额管理、数据隔离。

**实现**：
- 注册：SHA256 盐值哈希密码，存入 SQLite
- 登录：生成 64 位 session token，存入 SQLite
- 鉴权：请求 Header 携带 X-Session-Token，中间件校验
- 配额：每日限额（free=20, pro=200, unlimited=不限）
- 数据隔离：ChromaDB collection 按 `{doc_type}_{user_id}` 命名
- 审计日志：记录所有生成/上传/下载操作

### 2.10 OCR 支持

**功能**：扫描型 PDF 和图片文字识别。

**实现**：
- Tesseract OCR，支持中文简体+英文（`chi_sim+eng`）
- 扫描 PDF：pypdf 提取失败时，逐页转图片 → OCR
- 图片：直接 OCR（JPG/PNG/BMP/TIFF/WebP）

### 2.11 界面特性

**实现**：
- **可调整面板**：mousedown/mousemove/mouseup 实现拖拽，保存到 localStorage
- **暗色模式**：Tailwind dark: 类名，localStorage 记忆
- **布局记忆**：窗口尺寸、面板比例、选中 API 等均持久化到 localStorage
- **导航守卫**：编辑未保存时切换页面弹窗提醒

---

## 三、技术架构

```
                    ┌─────────────────────────────────────────┐
                    │              Nginx 反向代理              │
                    │           (port 80, 安全加固)            │
                    │  - 登录限流: 5次/分钟                    │
                    │  - API限流: 10次/秒                      │
                    │  - 屏蔽恶意扫描路径                      │
                    └────────────────┬────────────────────────┘
                                     │
              ┌──────────────────────┼──────────────────────┐
              ▼                      ▼                      ▼
    ┌─────────────┐          ┌─────────────┐          ┌─────────────┐
    │  React 前端  │          │ FastAPI 后端 │          │   静态资源    │
    │  (port 80)  │          │ (port 8001) │          │  (内部网络)  │
    └─────────────┘          └──────┬──────┘          └─────────────┘
                                    │
                  ┌─────────────────┼─────────────────┐
                  ▼                 ▼                 ▼
            ┌──────────┐      ┌──────────┐      ┌──────────┐
            │ ChromaDB │      │  SQLite  │      │ LLM API  │
            │ 向量数据库 │      │ 用户/记录 │      │ 外部服务  │
            └──────────┘      └──────────┘      └──────────┘
```

**数据流**：
1. 用户输入邮件 → 前端发送到 `/api/draft/generate`
2. 后端用邮件内容向量检索 style + knowledge chunks
3. 将 chunks + 邮件 + 附加说明 组装 prompt
4. 调用 LLM API 生成回复
5. 返回结果 + token 用量

---

## 四、遇到的问题与解决方案

### 4.1 知识库"漏看"问题

**问题**：Agent 没看到第一页的"福袋"信息。

**原因**：纯向量搜索对关键词匹配不够敏感，且固定 k=8 可能遗漏。

**解决**：
- 实现混合检索：向量搜索 + 关键词加权（提取 top 10 关键词，匹配 chunk 加分）
- 长查询分段：overlapping segments 分别检索
- 文档交错：不同文档的 chunk 交替排列
- 分数阈值过滤：MIN_SCORE = 0.35
- knowledge k 从 8 增加到 10

### 4.2 菜单项+价格被拆分到不同 chunk

**问题**：菜单项和对应价格被分到不同 chunk，导致检索时丢失关联。

**原因**：固定大小分块（500 字）不考虑内容结构。

**解决**：实现布局感知分块（`_split_text`）：
- 检测结构化内容（价格、注释块、section header）
- 结构化内容允许 150% chunk_size 容差
- 保证菜单项+价格+注释在同一 chunk

### 4.3 网页爬取抓不到 footer 内容

**问题**：爬取 olindateahouse.com.au 时，footer 中的营业时间、限时政策、联系方式全部丢失。

**原因**：`web_crawler.py` 的 `BOILERPLATE_TAGS` 包含 `'footer'` 和 `'aside'`，`_clean_html` 会将整个 `<footer>` 和 `<aside>` 标签及其内容删除。而关键信息（"High Tea and dinner sessions are for 2 hours, lunch is for 1.5 hours"）恰好在 `<footer>` 和 `<aside>` 标签内。

**解决**：
- 从 `BOILERPLATE_TAGS` 移除 `'footer'` 和 `'aside'`
- 从 `web_fetch.py` 的 `REMOVE_TAGS` 也移除这两个标签
- 重写 `web_crawler.py` 的 `_clean_html` 为更简洁可靠的实现（对齐 web_fetch.py 的版本）

### 4.4 网页爬取进度不显示

**问题**：点击"保存到知识库"后，按钮一直显示"爬取中..."，没有具体进度。

**原因**：
1. `pages_saved` 只在所有页面保存完成后才更新（不是逐步递增）
2. `pages_visited` 字段不存在，前端无法显示爬取阶段的进度
3. 旧后端进程（PID 9700）未被杀掉，新代码未生效

**解决**：
- `CrawlTask` 新增 `pages_visited` 字段
- `on_progress` 回调实时递增 `pages_visited`
- `pages_saved` 在保存循环中逐步递增
- 前端按钮显示：`已访问 X 个链接` → `已保存 X/Y 页`
- 轮询增加重试上限（10 次失败后停止，避免无限轮询）

### 4.5 爬取任务卡死不动

**问题**：爬取任务永远停在"运行中"，前端无限轮询。

**原因**：后台线程可能崩溃（网络异常、模型加载失败等），但 `task.status` 没有被更新为 "failed"。

**解决**：
- `run_crawl_task` 增加完整 try/except，任何异常都设置 `task.status = "failed"`
- 爬取状态端点增加超时检测：运行超过 10 分钟自动标记为 failed
- 前端轮询增加 retryCount，连续 10 次失败后停止并提示用户

### 4.6 后端进程无法杀死

**问题**：`taskkill /F` 无法杀死旧的 Python 进程，端口 8001 一直被占用。

**原因**：Windows 上某些进程需要更强的终止信号。

**解决**：使用 PowerShell 的 `Stop-Process -Id PID -Force` 强制终止。

### 4.7 504 网关超时

**问题**：生成草稿时返回 504 Gateway Timeout。

**原因**：nginx `proxy_read_timeout` 为 120s，LLM API 调用（含 RAG 检索 + prompt 组装 + 生成）总时间可能超过 120s。

**解决**：
- nginx `proxy_read_timeout` 从 120s 增加到 300s
- LLM 客户端默认超时从 60s 增加到 120s

### 4.8 WiFi 密码抓取不到

**问题**：olindateahouse.com.au 的 WiFi 密码 "88888888" 在爬取结果中找不到。

**原因**：WiFi 密码通过 JavaScript 动态加载，不在静态 HTML 中。爬虫只能处理静态 HTML，无法执行 JS。

**解决方案**：建议用户手动将 WiFi 信息添加到知识库文档中。

### 4.9 前端构建失败（MISSING_EXPORT）

**问题**：`webFetchService` is not exported by `api.js`。

**原因**：上传前端文件时漏掉了 `api.js`，服务器上的旧版本没有 `webFetchService` 导出。

**解决**：确保 `api.js` 也一起上传。

### 4.10 翻译按段落分割

**问题**：整段翻译时格式混乱。

**原因**：LLM 翻译时会重新排列段落。

**解决**：后端按 `\n\n` 分段，逐段翻译后拼接，保持段落结构。

### 4.11 推理模型返回格式特殊

**问题**：部分模型（如 Qwen3.5）返回 content 为空，实际内容在 reasoning 字段。

**解决**：`llm_service.py` 中实现 `_fetch_reasoning_fallback`，自动检测并提取 reasoning 字段内容。

### 4.12 .env 修改后容器内未更新

**问题**：scp 上传 .env 后容器内仍是旧内容。

**原因**：scp 创建新文件（inode 改变），Docker bind mount 失效。

**解决**：修改 .env 后必须 `docker-compose down && docker-compose up -d` 重建容器。

---

## 五、文件变更记录

### 新增文件
| 文件 | 说明 |
|------|------|
| `nginx/nginx.conf` | Nginx 反向代理 + 限流配置 |
| `backend/app/services/web_fetch.py` | 单页 URL 抓取 |
| `backend/app/services/web_crawler.py` | 多页网站爬虫 |
| `backend/app/utils/doc_enhancer.py` | 文档结构增强 |
| `PROJECT_SUMMARY.md` | 本文档 |

### 主要修改文件
| 文件 | 修改内容 |
|------|---------|
| `backend/app/services/vector_store.py` | 混合检索、布局分块、created_at、content_size |
| `backend/app/services/llm_service.py` | web_content 注入、超时调整 |
| `backend/app/routers/data.py` | 爬取 API、搜索、重命名、批量删除 |
| `backend/app/routers/draft.py` | knowledge k=10 |
| `frontend/src/pages/DraftingWorkspace.jsx` | 网页抓取 UI、爬取进度 |
| `frontend/src/pages/DataLibrary.jsx` | 编辑/重命名/排序/批量删除/时间标签 |
| `frontend/src/services/api.js` | webFetchService、新 dataService 方法 |
| `frontend/nginx.conf` | 超时 120s → 300s |

---

## 六、部署信息

- **服务器**：阿里云 ECS 8.166.143.118
- **部署方式**：Docker Compose（docker-compose up -d --build）
- **访问方式**：http://8.166.143.118（Nginx 80 端口统一入口）
- **安全措施**：
  - Nginx 反向代理 + 限流保护
  - 登录接口限流：每 IP 每分钟 5 次
  - API 接口限流：每 IP 每秒 10 个请求
  - 屏蔽恶意扫描路径（/mcp、/jsonrpc、/security.txt 等）
  - CORS 限制：仅允许指定域名
- **数据持久化**：Docker volume 挂载（data/、chroma_db/、uploads/）
- **模型缓存**：text2vec-base-chinese 通过 hf-mirror.com 国内镜像下载
