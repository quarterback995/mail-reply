from fastapi import APIRouter, HTTPException, Header
from pydantic import BaseModel
from typing import Optional
from ..services.llm_service import LLMService
from ..services.vector_store import VectorStoreService
from ..services.auth import (
    get_user_from_token, check_quota, increment_quota,
    has_permission, log_audit,
)
from ..models.database import save_user_record

router = APIRouter()
vector_store = VectorStoreService()

class DraftRequest(BaseModel):
    email_content: str
    additional_context: Optional[str] = None
    web_content: Optional[str] = None

class DraftResponse(BaseModel):
    draft: str
    usage: dict


@router.post("/generate", response_model=DraftResponse)
async def generate_draft(
    request: DraftRequest,
    x_session_token: Optional[str] = Header(None),
    x_api_key: Optional[str] = Header(None),
    x_api_provider: Optional[str] = Header(None),
    x_api_model: Optional[str] = Header(None),
    x_api_base_url: Optional[str] = Header(None),
    x_temperature: Optional[str] = Header(None),
    x_max_tokens: Optional[str] = Header(None),
):
    # 1. Authenticate
    user = get_user_from_token(x_session_token)
    if not user:
        raise HTTPException(status_code=401, detail="未登录或会话已过期")

    user_id = user["user_id"]

    # 2. Check quota
    quota = check_quota(user_id)
    if quota["remaining"] <= 0:
        raise HTTPException(
            status_code=429,
            detail=f"今日配额已用完 ({quota['used']}/{quota['limit']})，请升级套餐或明天再试",
        )

    try:
        temperature = float(x_temperature) if x_temperature else 0.7
        max_tokens = int(x_max_tokens) if x_max_tokens else None

        llm_service = LLMService(
            api_key=x_api_key,
            provider=x_api_provider,
            model=x_api_model,
            base_url=x_api_base_url,
            temperature=temperature,
            max_tokens=max_tokens,
        )

        # 3. Retrieve only from THIS user's collections
        # Hybrid style: 3 semantically similar + 2 random (for style diversity)
        style_semantic = vector_store.search(user_id, "style", request.email_content, k=3)
        style_random = vector_store.random_sample(user_id, "style", n=2)
        # Deduplicate by doc_id + chunk_index
        seen = set()
        style_samples = []
        for s in style_semantic + style_random:
            key = (s["metadata"].get("doc_id", ""), s["metadata"].get("chunk_index", 0))
            if key not in seen:
                seen.add(key)
                style_samples.append(s)
        knowledge = vector_store.search(user_id, "knowledge", request.email_content, k=10)

        result = await llm_service.generate_reply(
            email_content=request.email_content,
            style_samples=style_samples,
            knowledge=knowledge,
            additional_context=request.additional_context,
            web_content=request.web_content,
        )

        # 4. Increment quota and audit
        increment_quota(user_id)
        log_audit(
            user_id, "generate_draft",
            resource="email",
            detail=f"style_chunks={len(style_samples)}, knowledge_chunks={len(knowledge)}, tokens={result['usage']['total_tokens']}",
        )

        # 5. Save record (auto-cleanup to 100 per user)
        save_user_record(
            user_id=user_id,
            record_type="draft",
            email_content=request.email_content,
            draft=result["draft"],
            additional_context=request.additional_context,
            token_usage=result["usage"],
            model_name=x_api_model,
        )

        return DraftResponse(draft=result["draft"], usage=result["usage"])
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
