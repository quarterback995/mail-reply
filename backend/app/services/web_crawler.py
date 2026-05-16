"""
Web crawler: fetch a starting URL and its sub-pages (up to 2 levels),
extract text, and return results for knowledge base storage.
Supports background task execution with progress tracking.
"""
import re
import asyncio
import logging
import time
from urllib.parse import urljoin, urlparse
from typing import Optional, Callable
import httpx

logger = logging.getLogger(__name__)

# Tags to remove entirely
REMOVE_TAGS = [
    'script', 'style', 'iframe', 'noscript', 'svg',
    'meta', 'link', 'head',
]

# Tags that usually contain no useful content
BOILERPLATE_TAGS = ['nav', 'form', 'button', 'input', 'select', 'textarea', 'label']


def _clean_html(html: str) -> str:
    """Extract meaningful text from HTML."""
    # Remove comments
    html = re.sub(r'<!--.*?-->', '', html, flags=re.DOTALL)
    # Remove script/style/nav/etc blocks
    for tag in REMOVE_TAGS:
        html = re.sub(rf'<{tag}[\s\S]*?</{tag}>', '', html, flags=re.IGNORECASE)
    # Remove boilerplate sections
    for tag in BOILERPLATE_TAGS:
        html = re.sub(rf'<{tag}[\s\S]*?</{tag}>', '', html, flags=re.IGNORECASE)
    # Remove all HTML tags
    text = re.sub(r'<[^>]+>', '\n', html)
    # Decode common HTML entities
    text = text.replace('&amp;', '&').replace('&lt;', '<').replace('&gt;', '>')
    text = text.replace('&quot;', '"').replace('&#39;', "'").replace('&nbsp;', ' ')
    text = text.replace('&#x27;', "'").replace('&rsquo;', "'").replace('&lsquo;', "'")
    text = text.replace('&rdquo;', '"').replace('&ldquo;', '"')
    text = text.replace('&mdash;', '—').replace('&ndash;', '–')
    text = text.replace('&ensp;', ' ').replace('&emsp;', ' ')
    # Collapse whitespace
    lines = [line.strip() for line in text.splitlines()]
    text = '\n'.join(line for line in lines if line)
    return text.strip()


def _extract_links(html: str, base_url: str) -> set[str]:
    """Extract same-domain links from HTML, including relative paths."""
    links = set()
    base_domain = urlparse(base_url).netloc

    # Skip non-content file extensions at extraction time
    skip_ext = re.compile(r'\.(css|js|jpg|jpeg|png|gif|svg|ico|woff|woff2|ttf|eot|mp3|mp4|pdf|zip|xml|json)$', re.IGNORECASE)

    # Extract from href attributes
    for match in re.finditer(r'href=["\']([^"\'#]+)', html):
        href = match.group(1)
        if skip_ext.search(href):
            continue
        full = urljoin(base_url, href)
        parsed = urlparse(full)
        if parsed.netloc == base_domain and parsed.scheme in ('http', 'https'):
            clean = f"{parsed.scheme}://{parsed.netloc}{parsed.path.rstrip('/')}"
            links.add(clean)

    return links


def _extract_title(html: str) -> str:
    m = re.search(r'<title[^>]*>(.*?)</title>', html, re.IGNORECASE | re.DOTALL)
    return m.group(1).strip()[:200] if m else ""


def _is_useful_page(url: str, text: str) -> bool:
    """Check if a page is likely to contain useful content."""
    # Skip common non-content pages
    skip_patterns = [
        r'/login', r'/signup', r'/register', r'/cart', r'/checkout',
        r'/privacy', r'/terms', r'/cookie', r'/sitemap',
        r'\.(jpg|jpeg|png|gif|svg|pdf|zip|mp3|mp4|css|js)$',
    ]
    url_lower = url.lower()
    if any(re.search(p, url_lower) for p in skip_patterns):
        return False
    # Must have some minimum content
    if len(text) < 100:
        return False
    return True


class CrawlTask:
    """Tracks progress of a background crawl task."""

    def __init__(self, task_id: str, url: str):
        self.task_id = task_id
        self.url = url
        self.status = "running"  # running / completed / failed
        self.pages_found = 0
        self.pages_saved = 0
        self.pages_visited = 0
        self.total_chars = 0
        self.current_url = ""
        self.errors = []
        self.started_at = time.time()
        self.completed_at = None

    def to_dict(self):
        return {
            "task_id": self.task_id,
            "url": self.url,
            "status": self.status,
            "pages_found": self.pages_found,
            "pages_saved": self.pages_saved,
            "pages_visited": self.pages_visited,
            "total_chars": self.total_chars,
            "current_url": self.current_url,
            "errors": self.errors[:10],
            "elapsed": round(time.time() - self.started_at, 1),
            "created_at": self.started_at,
        }


# In-memory task registry
_tasks: dict[str, CrawlTask] = {}


def get_task(task_id: str) -> Optional[CrawlTask]:
    return _tasks.get(task_id)


def get_all_tasks() -> list[dict]:
    return [t.to_dict() for t in _tasks.values()]


async def crawl_website(
    start_url: str,
    max_depth: int = 2,
    max_pages: int = 50,
    on_progress: Optional[Callable] = None,
) -> dict:
    """Crawl a website starting from start_url.

    Returns dict with:
      - pages: list of {url, title, content}
      - total_pages, total_chars, errors
    """
    result = {
        "pages": [],
        "total_pages": 0,
        "total_chars": 0,
        "errors": [],
    }

    if not start_url.startswith(('http://', 'https://')):
        result["errors"].append("URL 必须以 http:// 或 https:// 开头")
        return result

    visited = set()
    to_visit = [(start_url, 0)]
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    }

    async with httpx.AsyncClient(
        timeout=20, follow_redirects=True, headers=headers,
    ) as client:
        while to_visit and len(result["pages"]) < max_pages:
            url, depth = to_visit.pop(0)

            parsed = urlparse(url)
            clean_url = f"{parsed.scheme}://{parsed.netloc}{parsed.path.rstrip('/')}"

            if clean_url in visited:
                continue
            visited.add(clean_url)

            if on_progress:
                on_progress(url)

            try:
                resp = await client.get(url)
                resp.raise_for_status()

                content_type = resp.headers.get("content-type", "")
                if "text/html" not in content_type and "xml" not in content_type:
                    continue

                html = resp.text
                title = _extract_title(html)
                text = _clean_html(html)

                if not _is_useful_page(clean_url, text):
                    continue

                result["pages"].append({
                    "url": clean_url,
                    "title": title,
                    "content": text,
                })
                result["total_pages"] += 1
                result["total_chars"] += len(text)

                # Extract links for next depth level
                if depth < max_depth:
                    links = _extract_links(html, url)
                    for link in links:
                        if link not in visited:
                            to_visit.append((link, depth + 1))

                # Be polite: delay between requests
                await asyncio.sleep(0.3)

            except httpx.TimeoutException:
                result["errors"].append(f"超时: {url}")
            except httpx.HTTPStatusError as e:
                result["errors"].append(f"HTTP {e.response.status_code}: {url}")
            except Exception as e:
                result["errors"].append(f"错误: {url} - {str(e)[:80]}")

    return result


def run_crawl_task(task_id: str, user_id: str, url: str, max_depth: int = 2):
    """Synchronous wrapper for background crawl + save to knowledge base."""
    import asyncio
    from .vector_store import VectorStoreService
    from ..utils.doc_enhancer import enhance_document_text

    task = _tasks.get(task_id)
    if not task:
        logger.error(f"Crawl task {task_id} not found in registry")
        return

    logger.info(f"[CrawlTask {task_id}] Starting crawl: {url} (depth={max_depth})")
    vector_store = VectorStoreService()

    async def _do_crawl():
        def on_progress(current_url):
            task.current_url = current_url
            task.pages_visited += 1
            logger.info(f"[CrawlTask {task_id}] Fetching ({task.pages_visited}): {current_url}")

        result = await crawl_website(url, max_depth=max_depth, max_pages=50, on_progress=on_progress)
        task.pages_found = result["total_pages"]  # Final accurate count
        task.errors = result["errors"]
        logger.info(f"[CrawlTask {task_id}] Crawl done: {result['total_pages']} pages found, {len(result['errors'])} errors")

        saved = 0
        for i, page in enumerate(result["pages"]):
            try:
                filename = f"[网页] {page['title'] or urlparse(page['url']).path}"[:100]
                text = enhance_document_text(page["content"], filename)
                vector_store.add_document(user_id, "knowledge", text, filename, source_url=page["url"])
                saved += 1
                task.pages_saved = saved  # Update incrementally so frontend sees progress
                logger.info(f"[CrawlTask {task_id}] Saved page {i+1}/{len(result['pages'])}: {page['title'][:40]}")
            except Exception as e:
                logger.error(f"[CrawlTask {task_id}] Failed to save page {page['url']}: {e}")
                task.errors.append(f"保存失败 {page['url']}: {str(e)[:80]}")

        task.total_chars = result["total_chars"]
        task.status = "completed"
        task.completed_at = time.time()
        logger.info(f"[CrawlTask {task_id}] Completed: {saved}/{len(result['pages'])} pages saved")

    try:
        asyncio.run(_do_crawl())
    except Exception as e:
        task.status = "failed"
        task.errors.append(str(e))
        task.completed_at = time.time()
        logger.error(f"[CrawlTask {task_id}] Failed: {e}")
