from fastapi import APIRouter, HTTPException, Header
from pydantic import BaseModel
from typing import Optional
from ..services.auth import (
    create_user, authenticate, logout, get_user_from_token,
    check_quota, has_permission, get_audit_logs, TIER_QUOTAS, TIER_PERMISSIONS,
)

router = APIRouter()

class RegisterRequest(BaseModel):
    username: str
    password: str
    tier: str = "free"

class LoginRequest(BaseModel):
    username: str
    password: str


@router.post("/register")
async def register(request: RegisterRequest):
    user_id = create_user(request.username, request.password, request.tier)
    if not user_id:
        raise HTTPException(status_code=400, detail="用户名已存在")
    return {"message": "注册成功", "user_id": user_id}


@router.post("/login")
async def login(request: LoginRequest):
    token = authenticate(request.username, request.password)
    if not token:
        raise HTTPException(status_code=401, detail="用户名或密码错误")
    user = get_user_from_token(token)
    return {
        "message": "登录成功",
        "token": token,
        "user": user,
    }


@router.post("/logout")
async def logout_endpoint(x_session_token: Optional[str] = Header(None)):
    if x_session_token:
        logout(x_session_token)
    return {"message": "已退出登录"}


@router.get("/me")
async def get_me(x_session_token: Optional[str] = Header(None)):
    user = get_user_from_token(x_session_token)
    if not user:
        raise HTTPException(status_code=401, detail="未登录或会话已过期")
    quota = check_quota(user["user_id"])
    return {"user": user, "quota": quota}


@router.get("/quota")
async def get_quota(x_session_token: Optional[str] = Header(None)):
    user = get_user_from_token(x_session_token)
    if not user:
        raise HTTPException(status_code=401, detail="未登录")
    return check_quota(user["user_id"])


@router.get("/permissions")
async def get_permissions(x_session_token: Optional[str] = Header(None)):
    user = get_user_from_token(x_session_token)
    if not user:
        raise HTTPException(status_code=401, detail="未登录")
    tier = user["tier"]
    return {
        "tier": tier,
        "permissions": TIER_PERMISSIONS.get(tier, []),
        "quota": TIER_QUOTAS.get(tier, 20),
    }


@router.get("/audit")
async def get_audit(
    x_session_token: Optional[str] = Header(None),
    limit: int = 50,
):
    user = get_user_from_token(x_session_token)
    if not user:
        raise HTTPException(status_code=401, detail="未登录")
    logs = get_audit_logs(user["user_id"], limit)
    return {"logs": logs}


# --- Admin: change user tier ---
class ChangeTierRequest(BaseModel):
    username: str
    new_tier: str

@router.post("/admin/change-tier")
async def admin_change_tier(
    request: ChangeTierRequest,
    x_session_token: Optional[str] = Header(None),
):
    user = get_user_from_token(x_session_token)
    if not user or not has_permission(user["user_id"], "priority_support"):
        raise HTTPException(status_code=403, detail="无权限执行此操作")

    from ..models.database import get_db
    db = get_db()
    try:
        db.execute(
            "UPDATE users SET tier = ? WHERE username = ?",
            (request.new_tier, request.username),
        )
        db.commit()
        return {"message": f"用户 {request.username} 已升级为 {request.new_tier}"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        db.close()
