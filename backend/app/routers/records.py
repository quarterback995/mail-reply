from fastapi import APIRouter, HTTPException, Header
from typing import Optional
from ..services.auth import get_user_from_token, log_audit
from ..models.database import get_user_records, get_user_record, delete_user_record, clear_user_records

router = APIRouter()


@router.get("/list")
async def list_records(
    limit: int = 100,
    offset: int = 0,
    x_session_token: Optional[str] = Header(None),
):
    user = get_user_from_token(x_session_token)
    if not user:
        raise HTTPException(status_code=401, detail="未登录或会话已过期")
    result = get_user_records(user["user_id"], limit=limit, offset=offset)
    return result


@router.get("/{record_id}")
async def get_record(
    record_id: int,
    x_session_token: Optional[str] = Header(None),
):
    user = get_user_from_token(x_session_token)
    if not user:
        raise HTTPException(status_code=401, detail="未登录或会话已过期")
    record = get_user_record(user["user_id"], record_id)
    if not record:
        raise HTTPException(status_code=404, detail="记录不存在")
    return record


@router.delete("/{record_id}")
async def delete_record(
    record_id: int,
    x_session_token: Optional[str] = Header(None),
):
    user = get_user_from_token(x_session_token)
    if not user:
        raise HTTPException(status_code=401, detail="未登录或会话已过期")
    delete_user_record(user["user_id"], record_id)
    log_audit(user["user_id"], "delete_record", resource="record", detail=f"record_id={record_id}")
    return {"message": "已删除"}


@router.delete("/")
async def clear_records(
    x_session_token: Optional[str] = Header(None),
):
    user = get_user_from_token(x_session_token)
    if not user:
        raise HTTPException(status_code=401, detail="未登录或会话已过期")
    clear_user_records(user["user_id"])
    log_audit(user["user_id"], "clear_records", resource="record", detail="cleared all")
    return {"message": "已清空全部记录"}
