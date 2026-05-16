"""
Fetch and extract text content from a URL for email reply context.
"""
import re
import logging
import httpx

logger = logging.getLogger(__name__)

# Tags to remove entirely
REMOVE_TAGS = [
    'script', 'style', 'nav', 'header',
    'iframe', 'noscript', 'svg', 'form', 'button', 'input',
    'select', 'textarea', 'label', 'meta', 'link',
]


def _clean_html(html: str) -> str:
    """Simple HTML to text extraction without beautifulsoup dependency."""
    # Remove comments
    html = re.sub(r'<!--.*?-->', '', html, flags=re.DOTALL)
    # Remove script/style/nav/etc blocks
    for tag in REMOVE_TAGS:
        html = re.sub(rf'<{tag}[\s\S]*?</{tag}>', '', html, flags=re.IGNORECASE)
    # Remove all HTML tags
    text = re.sub(r'<[^>]+>', '\n', html)
    # Decode common HTML entities
    text = text.replace('&amp;', '&').replace('&lt;', '<').replace('&gt;', '>')
    text = text.replace('&quot;', '"').replace('&#39;', "'").replace('&nbsp;', ' ')
    # Collapse whitespace
    lines = [line.strip() for line in text.splitlines()]
    text = '\n'.join(line for line in lines if line)
    return text.strip()


async def fetch_url_content(url: str, max_chars: int = 8000) -> dict:
    """Fetch a URL and extract its text content.

    Returns dict with keys: url, title, content, char_count, error
    """
    result = {"url": url, "title": "", "content": "", "char_count": 0, "error": None}

    # Validate URL
    if not url.startswith(('http://', 'https://')):
        result["error"] = "URL 必须以 http:// 或 https:// 开头"
        return result

    try:
        async with httpx.AsyncClient(
            timeout=15,
            follow_redirects=True,
            headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
            },
        ) as client:
            resp = await client.get(url)
            resp.raise_for_status()

            content_type = resp.headers.get("content-type", "")
            if "text/html" not in content_type and "xml" not in content_type:
                result["error"] = f"不支持的内容类型: {content_type}"
                return result

            html = resp.text

            # Extract title
            title_match = re.search(r'<title[^>]*>(.*?)</title>', html, re.IGNORECASE | re.DOTALL)
            if title_match:
                result["title"] = title_match.group(1).strip()[:200]

            # Extract text
            text = _clean_html(html)

            # Truncate if too long
            if len(text) > max_chars:
                text = text[:max_chars] + "\n\n... [内容已截断]"

            result["content"] = text
            result["char_count"] = len(text)
            return result

    except httpx.TimeoutException:
        result["error"] = "请求超时（15秒）"
        return result
    except httpx.HTTPStatusError as e:
        result["error"] = f"HTTP 错误: {e.response.status_code}"
        return result
    except Exception as e:
        result["error"] = f"抓取失败: {str(e)}"
        return result
