from fastapi import APIRouter, HTTPException, Header
from pydantic import BaseModel
from typing import Optional
import os
import httpx
import logging
import json
from ..utils.env_config import get_env

# 配置日志
logging.basicConfig(
    level=logging.DEBUG,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

router = APIRouter()

class TestConnectionRequest(BaseModel):
    provider: str
    model: str
    apiKey: str
    baseUrl: Optional[str] = None
    temperature: float = 0.7
    maxTokens: int = 2000

class SaveSettingsRequest(BaseModel):
    api_provider: str
    api_model: str
    api_key: str
    api_base_url: Optional[str] = ""
    temperature: str = "0.7"
    max_tokens: str = "2000"
    top_p: str = "1"
    frequency_penalty: str = "0"
    presence_penalty: str = "0"
    timeout: str = "60"

# 提供商默认端点
PROVIDER_ENDPOINTS = {
    "openai": "https://api.openai.com/v1",
    "anthropic": "https://api.anthropic.com",
    "deepseek": "https://api.deepseek.com",
    "moonshot": "https://api.moonshot.cn/v1",
    "zhipu": "https://open.bigmodel.cn/api/paas/v4",
    "xiaomi": "https://token-plan-cn.xiaomimimo.com/v1",
}

@router.post("/test-connection")
async def test_connection(request: TestConnectionRequest):
    """测试 API 连接"""
    logger.info("=" * 60)
    logger.info("开始测试 API 连接")
    logger.info(f"提供商: {request.provider}")
    logger.info(f"模型: {request.model}")
    logger.info(f"Base URL (输入): {request.baseUrl}")
    logger.info(f"API Key: {request.apiKey[:10]}...{request.apiKey[-4:] if len(request.apiKey) > 14 else ''}")
    logger.info("=" * 60)

    try:
        base_url = request.baseUrl or PROVIDER_ENDPOINTS.get(request.provider, "")
        logger.info(f"解析后的 Base URL: {base_url}")

        if not base_url:
            logger.error("未配置 API 端点")
            raise HTTPException(status_code=400, detail="未配置 API 端点")

        # 移除末尾的斜杠
        base_url = base_url.rstrip("/")

        # 自动检测 API 格式: provider名称 或 URL中包含 "anthropic" 则使用 Anthropic 格式
        use_anthropic_format = (
            request.provider == "anthropic"
            or "/anthropic" in base_url.lower()
            or "anthropic.com" in base_url.lower()
        )

        if use_anthropic_format:
            # Anthropic API 测试
            if base_url.endswith("/v1"):
                messages_url = f"{base_url}/messages"
            else:
                messages_url = f"{base_url}/v1/messages"

            logger.info(f"Anthropic 请求 URL: {messages_url}")

            headers = {
                "x-api-key": request.apiKey,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            }
            payload = {
                "model": request.model,
                "max_tokens": 10,
                "messages": [{"role": "user", "content": "Hi"}],
            }

            logger.debug(f"请求头: {headers}")
            logger.debug(f"请求体: {json.dumps(payload, ensure_ascii=False)}")

            async with httpx.AsyncClient(timeout=30) as client:
                response = await client.post(messages_url, headers=headers, json=payload)
                logger.info(f"响应状态码: {response.status_code}")
                logger.debug(f"响应内容: {response.text[:500]}")

                if response.status_code == 200:
                    data = response.json()
                    content = data.get("content", [{}])[0].get("text", "")
                    logger.info(f"成功! 响应: {content}")
                    return {
                        "success": True,
                        "message": f"连接成功！模型: {request.model}",
                        "details": {
                            "provider": request.provider,
                            "model": request.model,
                            "endpoint": base_url,
                            "response": content,
                        },
                    }
                else:
                    try:
                        error_data = response.json()
                        error_msg = error_data.get("error", {}).get("message", str(error_data))
                    except:
                        error_msg = response.text
                    logger.error(f"API 错误: {error_msg}")
                    raise HTTPException(status_code=response.status_code, detail=f"API 错误: {error_msg}")

        else:
            # OpenAI 兼容 API 测试
            if base_url.endswith("/v1"):
                chat_url = f"{base_url}/chat/completions"
            else:
                chat_url = f"{base_url}/chat/completions"

            logger.info(f"请求 URL: {chat_url}")

            headers = {
                "Authorization": f"Bearer {request.apiKey}",
                "Content-Type": "application/json",
            }
            payload = {
                "model": request.model,
                "messages": [{"role": "user", "content": "Hi"}],
                "max_tokens": 10,
                "temperature": 0,
            }

            logger.debug(f"请求头: {headers}")
            logger.debug(f"请求体: {json.dumps(payload, ensure_ascii=False)}")

            async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
                logger.info(f"发送请求...")
                response = await client.post(chat_url, headers=headers, json=payload)

                logger.info(f"响应状态码: {response.status_code}")
                logger.info(f"响应头: {dict(response.headers)}")
                logger.debug(f"响应内容: {response.text[:1000]}")

                if response.status_code == 200:
                    data = response.json()
                    # 尝试多种方式获取内容
                    content = ""
                    if "choices" in data and len(data["choices"]) > 0:
                        choice = data["choices"][0]
                        if "message" in choice:
                            content = choice["message"].get("content", "")
                        elif "text" in choice:
                            content = choice.get("text", "")

                    # 检查是否有推理内容 (reasoning_content)
                    reasoning = ""
                    if "choices" in data and len(data["choices"]) > 0:
                        choice = data["choices"][0]
                        if "message" in choice:
                            reasoning = choice["message"].get("reasoning_content", "")

                    display_content = content or reasoning or "(空响应)"

                    logger.info(f"成功! 内容: {content}, 推理: {reasoning[:100] if reasoning else '无'}")
                    return {
                        "success": True,
                        "message": f"连接成功！模型: {request.model}",
                        "details": {
                            "provider": request.provider,
                            "model": request.model,
                            "endpoint": base_url,
                            "response": display_content[:200],
                        },
                    }
                elif response.status_code == 401:
                    logger.error("API Key 无效")
                    raise HTTPException(status_code=401, detail="API Key 无效或已过期")
                elif response.status_code == 404:
                    logger.warning("主端点返回 404，尝试备用端点...")
                    # 尝试不同的 URL 格式
                    if not base_url.endswith("/v1"):
                        backup_url = f"{base_url}/v1/chat/completions"
                    else:
                        # 已经是 /v1，尝试去掉 /v1
                        root_url = base_url[:-3] if base_url.endswith("/v1") else base_url
                        backup_url = f"{root_url}/chat/completions"

                    logger.info(f"备用 URL: {backup_url}")

                    if backup_url == chat_url:
                        try:
                            error_data = response.json()
                            error_msg = error_data.get("error", {}).get("message", str(error_data))
                        except:
                            error_msg = response.text[:200]
                        raise HTTPException(
                            status_code=404,
                            detail=f"API 端点不存在: {chat_url}。错误: {error_msg}"
                        )

                    async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client2:
                        response2 = await client2.post(backup_url, headers=headers, json=payload)
                        logger.info(f"备用响应状态码: {response2.status_code}")

                        if response2.status_code == 200:
                            data = response2.json()
                            content = data.get("choices", [{}])[0].get("message", {}).get("content", "")
                            logger.info(f"备用端点成功!")
                            return {
                                "success": True,
                                "message": f"连接成功！模型: {request.model}",
                                "details": {
                                    "provider": request.provider,
                                    "model": request.model,
                                    "endpoint": backup_url,
                                    "response": content or "(空响应)",
                                },
                            }
                        else:
                            try:
                                error_data = response2.json()
                                error_msg = error_data.get("error", {}).get("message", str(error_data))
                            except:
                                error_msg = response2.text[:200]
                            logger.error(f"备用端点也失败: {error_msg}")
                            raise HTTPException(status_code=response2.status_code, detail=f"API 错误: {error_msg}")
                else:
                    try:
                        error_data = response.json()
                        error_msg = error_data.get("error", {}).get("message", str(error_data))
                    except:
                        error_msg = response.text[:200]
                    logger.error(f"API 错误 (状态码 {response.status_code}): {error_msg}")
                    raise HTTPException(status_code=response.status_code, detail=f"API 错误: {error_msg}")

    except httpx.TimeoutException:
        logger.error("连接超时")
        raise HTTPException(status_code=408, detail="连接超时，请检查网络或 API 端点")
    except httpx.ConnectError as e:
        logger.error(f"连接错误: {str(e)}")
        raise HTTPException(status_code=502, detail=f"无法连接到 API 服务器: {str(e)}")
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"未预期的错误: {str(e)}")
        raise HTTPException(status_code=500, detail=f"测试失败: {str(e)}")

@router.post("/save")
async def save_settings(request: SaveSettingsRequest):
    """保存 API 设置"""
    return {
        "success": True,
        "message": "设置已保存",
        "settings": {
            "provider": request.api_provider,
            "model": request.api_model,
            "baseUrl": request.api_base_url,
        },
    }

@router.get("/status")
async def get_status(
    x_api_key: Optional[str] = Header(None),
    x_api_provider: Optional[str] = Header(None),
    x_api_model: Optional[str] = Header(None),
):
    """获取当前 API 配置状态"""
    if x_api_key:
        return {
            "configured": True,
            "provider": x_api_provider,
            "model": x_api_model,
            "hasApiKey": True,
        }
    return {
        "configured": False,
        "provider": None,
        "model": None,
        "hasApiKey": False,
    }


@router.get("/locked")
async def get_locked_settings():
    """获取后端 .env 中固定的配置项（前端应设为只读）"""
    from ..services.llm_service import get_backend_config, get_available_apis
    cfg = get_backend_config()
    locked = {}
    if cfg["api_key"]:
        locked["api_key"] = True
    if cfg["provider"]:
        locked["api_provider"] = True
    if cfg["model"]:
        locked["api_model"] = True
    if cfg["base_url"]:
        locked["api_base_url"] = True
    if get_env("DEFAULT_TEMPERATURE"):
        locked["temperature"] = True
    if get_env("DEFAULT_MAX_TOKENS"):
        locked["max_tokens"] = True
    # Tier model locks
    if cfg["model_fast"]:
        locked["model_fast"] = True
    if cfg["model_balanced"]:
        locked["model_balanced"] = True
    if cfg["model_quality"]:
        locked["model_quality"] = True
    return {"locked": locked, "config": {
        "api_key": cfg["api_key"],
        "api_provider": cfg["provider"],
        "api_model": cfg["model"],
        "api_base_url": cfg["base_url"],
        "temperature": cfg["temperature"],
        "max_tokens": cfg["max_tokens"],
        "model_fast": cfg["model_fast"],
        "model_balanced": cfg["model_balanced"],
        "model_quality": cfg["model_quality"],
    }}


@router.get("/apis")
async def get_apis():
    """获取后端配置的所有可用 API 列表"""
    from ..services.llm_service import get_available_apis
    apis = get_available_apis()
    return {"apis": apis}
