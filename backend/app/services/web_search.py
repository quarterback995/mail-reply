"""
Web search service for temporal/event context enrichment.
Detects time-sensitive keywords in emails and fetches relevant
web context (holidays, regional events, current dates) before LLM generation.
"""
import re
import logging
from typing import Optional

logger = logging.getLogger(__name__)

# Keywords that suggest temporal/event context is needed
TEMPORAL_KEYWORDS = [
    # Time references
    r'周[一二三四五六日天]',
    r'星期[一二三四五六日天]',
    r'礼拜[一二三四五六日天]',
    r'[今明后]天',
    r'下[周星期礼拜]',
    r'上[周星期礼拜]',
    r'这[周星期礼拜]',
    # Holidays (Chinese)
    r'春节|元旦|中秋|端午|清明|国庆|劳动节|妇女节|儿童节|重阳|七夕|元宵',
    r'除夕|小年|腊八|植树节|教师节|护士节|母亲节|父亲节|青年节',
    # Holidays (Western)
    r'Christmas|Thanksgiving|Easter|Halloween|Valentine',
    r'New Year|Independence Day|Labor Day|Memorial Day',
    # Season/event
    r'假期|放假|调休|补班|旺季|淡季|节假日|黄金周',
    # Date references
    r'\d{1,2}月\d{1,2}[日号]',
    r'\d{4}[-/]\d{1,2}[-/]\d{1,2}',
]

TEMPORAL_PATTERN = re.compile('|'.join(TEMPORAL_KEYWORDS), re.IGNORECASE)


def needs_temporal_context(email_content: str) -> bool:
    """Check if an email contains time-sensitive references that may need web context."""
    return bool(TEMPORAL_PATTERN.search(email_content))


def _build_search_queries(email_content: str) -> list[str]:
    """Extract temporal references from email and build targeted search queries."""
    queries = []
    today_str = __import__('datetime').datetime.now().strftime('%Y年%m月%d日')

    # Extract date references like "5月1日", "2026-05-01"
    date_refs = re.findall(r'(\d{1,2}月\d{1,2}[日号])', email_content)
    for d in date_refs[:2]:
        queries.append(f'{d} 是星期几 节假日 {today_str}')

    # Extract weekday references
    weekday_refs = re.findall(r'([今明后]天|下?[周星期礼拜][一二三四五六日天]?)', email_content)
    for w in weekday_refs[:2]:
        queries.append(f'{w} 是什么日期 {today_str}')

    # Extract holiday names
    holiday_refs = re.findall(
        r'(春节|元旦|中秋|端午|清明|国庆|劳动节|妇女节|儿童节|重阳|七夕|元宵|除夕|小年|'
        r'Christmas|Thanksgiving|Easter|Halloween|Valentine|New Year)',
        email_content, re.IGNORECASE
    )
    for h in holiday_refs[:2]:
        queries.append(f'{h} 日期 放假安排 {today_str}')

    # Season/event queries
    if re.search(r'假期|放假|调休|补班|黄金周', email_content):
        queries.append(f'近期假期调休安排 {today_str}')

    return queries[:3]  # Max 3 searches


async def search_temporal_context(email_content: str) -> Optional[str]:
    """Search web for temporal/event context relevant to the email.

    Returns formatted context string, or None if no search needed or search fails.
    """
    if not needs_temporal_context(email_content):
        return None

    queries = _build_search_queries(email_content)
    if not queries:
        return None

    try:
        from langchain_community.tools import DuckDuckGoSearchResults
        search = DuckDuckGoSearchResults(max_results=3)

        all_results = []
        for q in queries:
            try:
                results = await search.ainvoke(q)
                if results:
                    all_results.append(f"[{q}]\n{results}")
            except Exception as e:
                logger.warning(f"Search query failed: {q} -> {e}")
                continue

        if not all_results:
            return None

        context = (
            "=== WEB SEARCH RESULTS (current date/time context) ===\n"
            + "\n\n".join(all_results)
            + "\n=== END WEB SEARCH RESULTS ===\n\n"
            "Use the above search results to provide accurate date/time/holiday context. "
            "If the search results conflict with document text regarding dates, "
            "the search results take precedence for current information."
        )
        return context

    except ImportError:
        logger.warning("DuckDuckGo search not available (duckduckgo-search not installed)")
        return None
    except Exception as e:
        logger.warning(f"Web search failed: {e}")
        return None
