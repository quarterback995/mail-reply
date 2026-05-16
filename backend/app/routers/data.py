from fastapi import APIRouter, UploadFile, File, HTTPException, Header
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel
from typing import Optional, List
import httpx
import urllib.parse
import logging
import traceback
from ..services.vector_store import VectorStoreService
from ..services.auth import get_user_from_token, log_audit

logger = logging.getLogger(__name__)

router = APIRouter()
vector_store = VectorStoreService()


def _ocr_image(image_bytes: bytes) -> str:
    """OCR an image using Tesseract."""
    import pytesseract
    from PIL import Image
    import io
    img = Image.open(io.BytesIO(image_bytes))
    text = pytesseract.image_to_string(img, lang="chi_sim+eng")
    return text.strip()


async def extract_text(file: UploadFile) -> str:
    content = await file.read()
    filename = file.filename.lower()
    if filename.endswith('.pdf'):
        from pypdf import PdfReader
        import io
        reader = PdfReader(io.BytesIO(content))
        text = "\n\n".join(page.extract_text() or "" for page in reader.pages)
        if not text.strip():
            # Scanned PDF — try OCR on each page as image
            from PIL import Image
            import pytesseract
            import io as _io
            ocr_texts = []
            for page in reader.pages:
                try:
                    img = page.to_image(resolution=300)
                    buf = _io.BytesIO()
                    img.save(buf, format="PNG")
                    buf.seek(0)
                    ocr_text = pytesseract.image_to_string(Image.open(buf), lang="chi_sim+eng")
                    if ocr_text.strip():
                        ocr_texts.append(ocr_text.strip())
                except Exception:
                    continue
            if ocr_texts:
                return "\n\n".join(ocr_texts)
            raise ValueError("PDF 文件无法提取文本（包括 OCR）")
        return text
    elif filename.endswith('.docx'):
        from docx import Document
        import io
        doc = Document(io.BytesIO(content))
        text = "\n\n".join(para.text for para in doc.paragraphs if para.text.strip())
        if not text.strip():
            raise ValueError("Word 文件无法提取文本")
        return text
    elif filename.endswith(('.jpg', '.jpeg', '.png', '.bmp', '.tiff', '.tif', '.webp')):
        return _ocr_image(content)
    else:
        try:
            return content.decode("utf-8")
        except UnicodeDecodeError:
            try:
                return content.decode("gbk")
            except UnicodeDecodeError:
                return content.decode("latin-1")


def _get_user(x_session_token: Optional[str]):
    user = get_user_from_token(x_session_token)
    if not user:
        raise HTTPException(status_code=401, detail="未登录或会话已过期")
    return user


@router.post("/upload/style")
async def upload_style_data(
    file: UploadFile = File(...),
    x_session_token: Optional[str] = Header(None),
):
    user = _get_user(x_session_token)
    try:
        text = await extract_text(file)
        doc_id = vector_store.add_document(user["user_id"], "style", text, file.filename)
        log_audit(user["user_id"], "upload_style", file.filename)
        return {"message": "Style data uploaded successfully", "doc_id": doc_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/upload/knowledge")
async def upload_knowledge_data(
    file: UploadFile = File(...),
    x_session_token: Optional[str] = Header(None),
):
    user = _get_user(x_session_token)
    try:
        text = await extract_text(file)
        # Enhance knowledge documents with structural annotations
        from ..utils.doc_enhancer import enhance_document_text
        text = enhance_document_text(text, file.filename)
        doc_id = vector_store.add_document(user["user_id"], "knowledge", text, file.filename)
        log_audit(user["user_id"], "upload_knowledge", file.filename)
        return {"message": "Knowledge data uploaded successfully", "doc_id": doc_id}
    except Exception as e:
        logger.error(f"upload_knowledge error: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/list/style")
async def list_style_data(x_session_token: Optional[str] = Header(None)):
    user = _get_user(x_session_token)
    try:
        documents = vector_store.list_documents(user["user_id"], "style")
        return {"documents": documents}
    except Exception as e:
        logger.error(f"list_style error: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/list/knowledge")
async def list_knowledge_data(x_session_token: Optional[str] = Header(None)):
    user = _get_user(x_session_token)
    try:
        documents = vector_store.list_documents(user["user_id"], "knowledge")
        return {"documents": documents}
    except Exception as e:
        logger.error(f"list_knowledge error: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))


class KnowledgeSearchRequest(BaseModel):
    query: str
    k: int = 5

@router.post("/search/knowledge")
async def search_knowledge(request: KnowledgeSearchRequest, x_session_token: Optional[str] = Header(None)):
    """Semantic search across knowledge base — shows what RAG would retrieve."""
    user = _get_user(x_session_token)
    try:
        results = vector_store.search(user["user_id"], "knowledge", request.query, k=request.k)
        return {"results": results, "query": request.query}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/preview/{doc_type}/{doc_id}")
async def preview_document(
    doc_type: str,
    doc_id: str,
    x_session_token: Optional[str] = Header(None),
):
    user = _get_user(x_session_token)
    content = vector_store.get_document_content(user["user_id"], doc_type, doc_id)
    if not content:
        raise HTTPException(status_code=404, detail="文档不存在")
    log_audit(user["user_id"], f"preview_{doc_type}", doc_id)
    return PlainTextResponse(content)


@router.get("/download/{doc_type}/{doc_id}")
async def download_document(
    doc_type: str,
    doc_id: str,
    x_session_token: Optional[str] = Header(None),
):
    user = _get_user(x_session_token)
    content = vector_store.get_document_content(user["user_id"], doc_type, doc_id)
    if not content:
        raise HTTPException(status_code=404, detail="文档不存在")
    # Get filename from list
    docs = vector_store.list_documents(user["user_id"], doc_type)
    filename = "document.txt"
    for d in docs:
        if d["doc_id"] == doc_id:
            filename = d["filename"]
            break
    log_audit(user["user_id"], f"download_{doc_type}", doc_id)
    return PlainTextResponse(
        content,
        headers={"Content-Disposition": f'attachment; filename="{urllib.parse.quote(filename)}"'},
    )


@router.delete("/{doc_type}/{doc_id}")
async def delete_document(
    doc_type: str,
    doc_id: str,
    x_session_token: Optional[str] = Header(None),
):
    user = _get_user(x_session_token)
    try:
        vector_store.delete_document(user["user_id"], doc_type, doc_id)
        log_audit(user["user_id"], f"delete_{doc_type}", doc_id)
        return {"message": "Document deleted successfully"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class RenameRequest(BaseModel):
    new_filename: str

@router.post("/rename/{doc_type}/{doc_id}")
async def rename_document(
    doc_type: str,
    doc_id: str,
    request: RenameRequest,
    x_session_token: Optional[str] = Header(None),
):
    user = _get_user(x_session_token)
    try:
        ok = vector_store.rename_document(user["user_id"], doc_type, doc_id, request.new_filename)
        if not ok:
            raise HTTPException(status_code=404, detail="文档不存在")
        log_audit(user["user_id"], f"rename_{doc_type}", f"{doc_id} -> {request.new_filename}")
        return {"message": "Renamed successfully"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class BatchDeleteRequest(BaseModel):
    doc_ids: List[str]

@router.post("/batch-delete/{doc_type}")
async def batch_delete_documents(
    doc_type: str,
    request: BatchDeleteRequest,
    x_session_token: Optional[str] = Header(None),
):
    user = _get_user(x_session_token)
    deleted = 0
    for doc_id in request.doc_ids:
        try:
            vector_store.delete_document(user["user_id"], doc_type, doc_id)
            deleted += 1
        except Exception:
            continue
    log_audit(user["user_id"], f"batch_delete_{doc_type}", f"count={deleted}")
    return {"message": f"Deleted {deleted} documents", "deleted": deleted}


@router.put("/{doc_type}/{doc_id}")
async def update_document(
    doc_type: str,
    doc_id: str,
    file: UploadFile = File(...),
    x_session_token: Optional[str] = Header(None),
):
    """Update a document: delete old chunks and re-add with new content."""
    user = _get_user(x_session_token)
    try:
        text = await extract_text(file)
        vector_store.delete_document(user["user_id"], doc_type, doc_id)
        new_doc_id = vector_store.add_document(user["user_id"], doc_type, text, file.filename)
        log_audit(user["user_id"], f"update_{doc_type}", f"{doc_id} -> {new_doc_id}")
        return {"message": "Document updated successfully", "doc_id": new_doc_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# --- URL Content Fetch ---
class FetchUrlRequest(BaseModel):
    url: str

@router.post("/fetch-url")
async def fetch_url_content(request: FetchUrlRequest, x_session_token: Optional[str] = Header(None)):
    """Fetch and extract text content from a URL (with doc enhancement)."""
    _get_user(x_session_token)
    from ..services.web_fetch import fetch_url_content as _fetch
    from ..utils.doc_enhancer import enhance_document_text
    result = await _fetch(request.url)
    if result["error"]:
        raise HTTPException(status_code=400, detail=result["error"])
    # Apply doc_enhancer for better RAG quality
    if result.get("content"):
        result["content"] = enhance_document_text(result["content"], result.get("title", ""))
    return result


class CrawlUrlRequest(BaseModel):
    url: str
    max_depth: int = 2

import uuid as _uuid
import threading

@router.post("/crawl-url")
async def start_crawl(request: CrawlUrlRequest, x_session_token: Optional[str] = Header(None)):
    """Start a background crawl task. Returns task_id for polling."""
    user = _get_user(x_session_token)
    from ..services.web_crawler import CrawlTask, _tasks, run_crawl_task

    # Check if a crawl is already running for this user
    for t in _tasks.values():
        if t.status == "running":
            raise HTTPException(status_code=409, detail=f"已有爬取任务进行中（{t.pages_found} 页已发现），请等待完成或刷新页面后重试")

    logger.info(f"Starting crawl for user {user['user_id']}: {request.url} (depth={request.max_depth})")

    task_id = str(_uuid.uuid4())[:8]
    task = CrawlTask(task_id, request.url)
    _tasks[task_id] = task

    # Run in background thread
    thread = threading.Thread(
        target=run_crawl_task,
        args=(task_id, user["user_id"], request.url, request.max_depth),
        daemon=True,
    )
    thread.start()

    log_audit(user["user_id"], "start_crawl", request.url)
    return {"task_id": task_id, "message": "爬取任务已启动"}


@router.get("/crawl-status/{task_id}")
async def crawl_status(task_id: str, x_session_token: Optional[str] = Header(None)):
    """Poll crawl task status."""
    _get_user(x_session_token)
    from ..services.web_crawler import get_task
    import time as _time
    task = get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    # Detect stale tasks: running for > 10 minutes with no progress
    if task.status == "running" and (_time.time() - task.started_at) > 600:
        task.status = "failed"
        task.errors.append("任务超时（超过 10 分钟无响应）")
        task.completed_at = _time.time()
        logger.warning(f"Crawl task {task_id} timed out after 10 minutes")
    return task.to_dict()


# --- Translation (multi-service) ---
import os
import hashlib
import random

class TranslateRequest(BaseModel):
    text: str
    target_lang: str = "en"
    engine: str = "baidu"  # baidu / google / llm

LANG_MAP = {
    "en": "English", "zh-CN": "Chinese", "ja": "Japanese", "ko": "Korean",
    "fr": "French", "de": "German", "es": "Spanish", "ru": "Russian",
    "pt": "Portuguese", "ar": "Arabic",
}


async def _translate_baidu(text: str, target_lang: str) -> str:
    """Baidu Translate API (free tier: 5万次/月)."""
    app_id = os.getenv("BAIDU_TRANS_APP_ID", "")
    secret_key = os.getenv("BAIDU_TRANS_SECRET", "")
    if not app_id or not secret_key:
        raise ValueError("未配置百度翻译 API，请在 .env 中设置 BAIDU_TRANS_APP_ID 和 BAIDU_TRANS_SECRET")

    lang_map = {"en": "en", "zh-CN": "zh", "ja": "ja", "ko": "ko", "fr": "fr", "de": "de", "es": "es", "ru": "ru", "pt": "pt", "ar": "ar"}
    to_lang = lang_map.get(target_lang, target_lang)

    salt = str(random.randint(10000, 99999))
    sign = hashlib.md5((app_id + text + salt + secret_key).encode()).hexdigest()

    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(
            "https://fanyi-api.baidu.com/api/trans/vip/translate",
            data={"q": text, "from": "auto", "to": to_lang, "appid": app_id, "salt": salt, "sign": sign},
        )
        data = resp.json()
        if "error_code" in data:
            raise ValueError(f"百度翻译错误: {data.get('error_msg', data['error_code'])}")
        return "".join(item["dst"] for item in data.get("trans_result", []))


async def _translate_google(text: str, target_lang: str) -> str:
    """Google Translate free API (需要能访问 Google)."""
    encoded = urllib.parse.quote(text)
    url = f"https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl={target_lang}&dt=t&q={encoded}"
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(url)
        if resp.status_code != 200:
            raise ValueError("Google 翻译请求失败")
        data = resp.json()
        return "".join(part[0] for part in data[0] if part[0])


async def _translate_llm(text: str, target_lang: str) -> str:
    """Use configured LLM API for translation."""
    from ..services.llm_service import LLMService, get_backend_config
    cfg = get_backend_config()
    lang_name = LANG_MAP.get(target_lang, target_lang)
    prompt = f"Translate the following text to {lang_name}. Output ONLY the translated text, nothing else.\n\n{text}"
    svc = LLMService(
        api_key=cfg["api_key"], provider=cfg["provider"],
        base_url=cfg["base_url"], model=cfg.get("model_fast", ""),
        temperature=0.3, max_tokens=4000,
    )
    from langchain_core.messages import HumanMessage
    resp = await svc.llm.ainvoke([HumanMessage(content=prompt)])
    content = resp.content
    if isinstance(content, list):
        content = "".join(b.get("text", "") if isinstance(b, dict) else str(b) for b in content)
    if not content or not content.strip():
        content = await svc._fetch_reasoning_fallback([HumanMessage(content=prompt)])
    return content.strip()


@router.post("/translate")
async def translate_text(request: TranslateRequest, x_session_token: Optional[str] = Header(None)):
    engine = request.engine.lower()
    try:
        # Preserve paragraph structure by translating paragraph by paragraph
        paragraphs = request.text.split("\n\n")
        translated_parts = []
        for para in paragraphs:
            stripped = para.strip()
            if not stripped:
                translated_parts.append("")
                continue
            if engine == "baidu":
                t = await _translate_baidu(stripped, request.target_lang)
            elif engine == "google":
                t = await _translate_google(stripped, request.target_lang)
            elif engine == "llm":
                t = await _translate_llm(stripped, request.target_lang)
            else:
                raise HTTPException(status_code=400, detail=f"不支持的翻译引擎: {engine}")
            translated_parts.append(t)
        translated = "\n\n".join(translated_parts)
        return {"translated": translated, "source_lang": "auto", "target_lang": request.target_lang, "engine": engine}
    except ValueError as e:
        raise HTTPException(status_code=502, detail=str(e))
    except httpx.TimeoutException:
        raise HTTPException(status_code=508, detail="翻译服务超时")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"翻译失败: {str(e)}")
