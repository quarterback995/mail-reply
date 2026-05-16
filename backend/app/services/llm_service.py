import os
from datetime import datetime
from typing import List, Dict, Any, Optional
from langchain_openai import ChatOpenAI
from langchain_anthropic import ChatAnthropic
from langchain_core.messages import HumanMessage, SystemMessage
from ..utils.env_config import get_env

# 提供商默认端点
PROVIDER_ENDPOINTS = {
    "openai": "https://api.openai.com/v1",
    "anthropic": "https://api.anthropic.com",
    "deepseek": "https://api.deepseek.com",
    "moonshot": "https://api.moonshot.cn/v1",
    "zhipu": "https://open.bigmodel.cn/api/paas/v4",
    "xiaomi": "https://token-plan-cn.xiaomimimo.com/v1",
}

# 提供商默认模型
PROVIDER_DEFAULT_MODELS = {
    "openai": "gpt-4",
    "anthropic": "claude-3-sonnet-20240229",
    "deepseek": "deepseek-chat",
    "moonshot": "moonshot-v1-8k",
    "zhipu": "glm-4",
    "xiaomi": "mimo-v2-pro",
}


def get_available_apis() -> List[Dict[str, Any]]:
    """Read all numbered API configs from .env (API_1_*, API_2_*, ...)."""
    apis = []
    for i in range(1, 50):
        name = get_env(f"API_{i}_NAME", "")
        if not name:
            continue
        apis.append({
            "id": i,
            "name": name,
            "provider": get_env(f"API_{i}_PROVIDER", ""),
            "api_key": get_env(f"API_{i}_KEY", ""),
            "base_url": get_env(f"API_{i}_BASE_URL", ""),
            "model_fast": get_env(f"API_{i}_MODEL_FAST", ""),
            "model_balanced": get_env(f"API_{i}_MODEL_BALANCED", ""),
            "model_quality": get_env(f"API_{i}_MODEL_QUALITY", ""),
        })
    return apis


def get_backend_config() -> Dict[str, Any]:
    """Read fixed API config from .env file.
    If numbered APIs exist, use the first one as the default locked config."""
    apis = get_available_apis()
    if apis:
        first = apis[0]
        return {
            "api_key": first["api_key"],
            "provider": first["provider"],
            "model": "",
            "base_url": first["base_url"],
            "temperature": float(get_env("DEFAULT_TEMPERATURE", "0.7")),
            "max_tokens": int(get_env("DEFAULT_MAX_TOKENS", "") or 0) or None,
            "model_fast": first["model_fast"] or get_env("MODEL_FAST", ""),
            "model_balanced": first["model_balanced"] or get_env("MODEL_BALANCED", ""),
            "model_quality": first["model_quality"] or get_env("MODEL_QUALITY", ""),
        }
    # Fallback to legacy single-API config
    return {
        "api_key": get_env("API_KEY", ""),
        "provider": get_env("API_PROVIDER", ""),
        "model": get_env("API_MODEL", ""),
        "base_url": get_env("API_BASE_URL", ""),
        "temperature": float(get_env("DEFAULT_TEMPERATURE", "0.7")),
        "max_tokens": int(get_env("DEFAULT_MAX_TOKENS", "20000")),
        "model_fast": get_env("MODEL_FAST", ""),
        "model_balanced": get_env("MODEL_BALANCED", ""),
        "model_quality": get_env("MODEL_QUALITY", ""),
    }


class LLMService:
    def __init__(
        self,
        api_key: Optional[str] = None,
        provider: Optional[str] = None,
        model: Optional[str] = None,
        base_url: Optional[str] = None,
        temperature: float = 0.7,
        max_tokens: int = 20000,
        top_p: float = 1.0,
        frequency_penalty: float = 0,
        presence_penalty: float = 0,
        timeout: int = 120,
    ):
        # Merge: .env defaults < frontend headers
        backend = get_backend_config()

        self.api_key = api_key or backend["api_key"] or get_env("OPENAI_API_KEY", "")
        self.provider = provider or backend["provider"] or "openai"
        self.model = model or backend["model"] or PROVIDER_DEFAULT_MODELS.get(self.provider, "gpt-4")
        self.base_url = base_url or backend["base_url"] or PROVIDER_ENDPOINTS.get(self.provider, "")
        self.temperature = temperature
        # Only set max_tokens if explicitly configured (0 or negative = use model default)
        self.max_tokens = max_tokens if max_tokens and max_tokens > 0 else None
        self.top_p = top_p
        self.frequency_penalty = frequency_penalty
        self.presence_penalty = presence_penalty
        self.timeout = timeout

        if not self.api_key:
            raise ValueError("未设置 API Key，请在设置页面配置或在后端 .env 文件中设置 API_KEY")

    def _is_anthropic_format(self) -> bool:
        """Detect whether to use Anthropic API format based on provider name or URL."""
        if self.provider == "anthropic":
            return True
        url = (self.base_url or "").lower()
        return "/anthropic" in url or "anthropic.com" in url

    def _get_anthropic_base_url(self) -> Optional[str]:
        """Get the correct base URL for Anthropic SDK (must NOT end with /v1)."""
        if not self.base_url or self.provider == "anthropic":
            return None  # Use default Anthropic endpoint
        url = self.base_url.rstrip("/")
        if url.endswith("/v1"):
            url = url[:-3]
        return url

    @property
    def llm(self):
        """Create LLM instance based on provider or URL format."""
        if self._is_anthropic_format():
            kwargs = {
                "model": self.model,
                "anthropic_api_key": self.api_key,
                "temperature": self.temperature,
                "timeout": self.timeout,
            }
            if self.max_tokens:
                kwargs["max_tokens"] = self.max_tokens
            # For third-party Anthropic-compatible endpoints
            api_url = self._get_anthropic_base_url()
            if api_url:
                kwargs["anthropic_api_url"] = api_url
            return ChatAnthropic(**kwargs)
        else:
            kwargs = {
                "model": self.model,
                "temperature": self.temperature,
                "api_key": self.api_key,
                "timeout": self.timeout,
            }
            if self.max_tokens:
                kwargs["max_tokens"] = self.max_tokens
            if self.base_url:
                kwargs["base_url"] = self.base_url
            return ChatOpenAI(**kwargs)

    async def _fetch_reasoning_fallback(self, messages) -> str:
        """Direct HTTP call for reasoning models that return content in 'reasoning' field."""
        import httpx
        msg_list = []
        for m in messages:
            role = "system" if hasattr(m, 'type') and m.type == "system" else "user"
            msg_list.append({"role": role, "content": m.content})
        payload = {"model": self.model, "messages": msg_list}
        if self.max_tokens:
            payload["max_tokens"] = self.max_tokens
        try:
            async with httpx.AsyncClient(timeout=120) as client:
                resp = await client.post(
                    f"{self.base_url}/chat/completions",
                    headers={"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"},
                    json=payload,
                )
                data = resp.json()
                choice = data["choices"][0]["message"]
                return choice.get("content") or choice.get("reasoning") or ""
        except Exception:
            return ""

    def _extract_style_cues(self, style_samples: list) -> str:
        """Extract explicit style patterns from samples to guide the LLM."""
        all_text = "\n".join(s.get("content", "") for s in style_samples)
        cues = []

        # Detect greeting pattern
        import re
        greetings = re.findall(r'^(Hi|Hello|Dear|您好|你好|尊敬的|嗨)[^\n]*', all_text, re.MULTILINE | re.IGNORECASE)
        if greetings:
            most_common = max(set(greetings), key=greetings.count)
            cues.append(f"Greeting style: \"{most_common.strip()}\"")

        # Detect closing/signature pattern
        closings = re.findall(r'(?:Best regards|Kind regards|Cheers|Thanks|Thank you|Sincerely|此致|敬祝|祝好|谢谢|感谢)[^\n]*', all_text, re.MULTILINE | re.IGNORECASE)
        if closings:
            most_common = max(set(closings), key=closings.count)
            cues.append(f"Closing style: \"{most_common.strip()}\"")

        # Detect language
        cn_chars = len(re.findall(r'[一-鿿]', all_text))
        total = len(all_text)
        if total > 0 and cn_chars / total > 0.3:
            cues.append("Language: Chinese")
        else:
            cues.append("Language: English")

        # Detect formality level
        informal_markers = len(re.findall(r'[!！]{2,}|haha|lol|哈哈|嘻嘻|~', all_text, re.IGNORECASE))
        formal_markers = len(re.findall(r'尊敬的|sincerely|furthermore|regarding|please find', all_text, re.IGNORECASE))
        if informal_markers > formal_markers:
            cues.append("Tone: casual/friendly")
        elif formal_markers > informal_markers:
            cues.append("Tone: formal/professional")
        else:
            cues.append("Tone: professional but approachable")

        if not cues:
            return ""

        return "\n## Detected Style Patterns:\n" + "\n".join(f"- {c}" for c in cues)

    async def generate_reply(
        self,
        email_content: str,
        style_samples: List[Dict[str, Any]],
        knowledge: List[Dict[str, Any]],
        additional_context: Optional[str] = None,
        web_content: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Generate an email reply and return draft + token usage info."""

        style_reference = "\n\n".join([
            f"Example {i+1}:\n{sample['content']}"
            for i, sample in enumerate(style_samples)
        ]) if style_samples else "No style samples available."

        # Extract style cues from samples for explicit instruction
        style_cues = self._extract_style_cues(style_samples) if style_samples else ""

        knowledge_text = "\n\n".join([
            f"Reference {i+1}:\n{item['content']}"
            for i, item in enumerate(knowledge)
        ]) if knowledge else "No additional knowledge available."

        # Determine if we have knowledge context
        has_knowledge = knowledge and knowledge_text.strip() and knowledge_text != "No additional knowledge available."

        # Web search: enrich temporal context when emails reference dates/holidays
        web_context = ""
        if has_knowledge:
            from .web_search import search_temporal_context
            web_context = await search_temporal_context(email_content) or ""

        today = datetime.now()
        today_str = today.strftime("%Y-%m-%d")
        day_of_week = ["周一","周二","周三","周四","周五","周六","周日"][today.weekday()]

        system_prompt = f"""You are an email reply assistant. You MUST strictly follow the writing style and factual content provided below. NEVER use your own general knowledge when reference materials are given.
LANGUAGE RULE: Reply in the same language as the email. If the email is in Chinese, reply in Chinese. If in English, reply in English. If mixed, match the dominant language.

## Current Date Context:
Today is {today_str} ({day_of_week}).

## Writing Style Reference (few-shot examples — match this style exactly):
{style_reference}
{style_cues}

## CRITICAL RULES:
1. When reference materials are provided below, ALL factual claims in your reply MUST come exclusively from those materials. Do NOT invent, assume, or use outside knowledge.
2. NEVER mention the reference materials, knowledge base, or data sources in your reply. Do NOT write phrases like "当前资料未提及", "根据提供的资料", "参考文档中没有提到", "the provided materials do not mention", "based on the reference documents", etc. The recipient should not know you are using reference materials.
3. If the reference materials do not cover a topic, handle it gracefully: either skip that topic, give a polite generic response (e.g., "I'll check and get back to you"), or answer from context clues — but NEVER say "the materials don't mention this."
4. Match the writing style from the Style Reference: copy the same greeting, closing, sentence structure, punctuation habits, level of formality, and overall tone. If the examples use "Hi [Name]!" you should too. If they sign off with "Best regards," do the same.
5. Write naturally and professionally, as if you are a real person writing the email.
6. TEMPORAL REASONING: When reference materials mention specific days (e.g., "周一", "周三"), you MUST check today's date ({today_str}, {day_of_week}) and reason about whether that day applies. Do NOT blindly copy day references — evaluate them against the actual current date. For example, if the material says "周一就是工作日" but today is Saturday, do NOT claim Monday is a working day in the context of today.
7. WEB SEARCH RESULTS: If web search results below provide current date, holiday, or event information, use that information to answer questions about dates, holidays, and schedules. The search results reflect REAL-TIME information and take precedence over document text for date-specific questions.
8. TIME COMPARISON: When reference materials contain time-based rules (e.g., "[TIME THRESHOLD: after 18:00]", "[TIME RANGE: 11:30-14:30]"), you MUST convert any time mentioned in the email to 24-hour numeric format and compare. For example, if the rule says "after 18:00" and the email says "we arrived at 6:30pm", convert 6:30pm → 18:30, compare 18:30 > 18:00, and conclude the rule APPLIES. Do NOT treat "6pm" and "18:00" as different things — they are the same time.
"""

        if additional_context:
            system_prompt += f"\n\n## Additional Context:\n{additional_context}"

        if web_content:
            system_prompt += f"\n\n## Web Page Content (fetched by user):\n{web_content}"

        if has_knowledge:
            web_section = f"\n\n{web_context}\n" if web_context else ""
            user_message = f"""Below are the AUTHORITY reference materials from the user's uploaded documents. You MUST use ONLY the information from these materials to answer. Do NOT use any outside knowledge.
{web_section}
===== REFERENCE MATERIALS =====
{knowledge_text}
===== END OF REFERENCE MATERIALS =====

Now generate a reply to this email using ONLY the information from the reference materials above.
IMPORTANT: Today is {today_str} ({day_of_week}). When the reference materials mention specific days, hours, or time-based rules, you MUST apply temporal reasoning — evaluate whether those rules apply to the actual current date/time, not just copy them verbatim.

{email_content}"""
        else:
            user_message = f"Please generate a reply to this email:\n\n{email_content}"

        messages = [
            SystemMessage(content=system_prompt),
            HumanMessage(content=user_message),
        ]

        response = await self.llm.ainvoke(messages)

        # Extract text from response (Anthropic returns list of content blocks)
        content = response.content
        if isinstance(content, list):
            content = "".join(
                block.get("text", "") if isinstance(block, dict) else str(block)
                for block in content
            )

        # Fallback: reasoning models (e.g. Qwen3.5) return content="" and put
        # the actual text in a "reasoning" field that LangChain ignores.
        if not content or not content.strip():
            content = await self._fetch_reasoning_fallback(messages)

        # Estimate token usage
        input_text = system_prompt + user_message
        input_tokens = len(input_text) // 3
        output_tokens = len(content) // 3

        return {
            "draft": content,
            "usage": {
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "total_tokens": input_tokens + output_tokens,
                "model": self.model,
            },
        }
