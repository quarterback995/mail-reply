from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import os
import logging
from dotenv import load_dotenv

from .models.database import init_db
from .routers import data, draft, settings, auth, records

logger = logging.getLogger(__name__)

load_dotenv()

# Initialize user database
init_db()

# Pre-load text2vec model at startup (avoids 5-10s delay on first request)
try:
    from .services.vector_store import VectorStoreService
    _vs = VectorStoreService()
    _vs.embedding_fn.preload()
    logger.info("text2vec model pre-loaded at startup")
except Exception as e:
    logger.warning(f"text2vec pre-load failed (will retry on first request): {e}")

app = FastAPI(title="Mail-Reply-Agent API", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://8.166.143.118",
        "http://8.166.143.118:3000",
        "http://localhost:3000",
        "http://localhost:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)

app.include_router(auth.router, prefix="/api/auth", tags=["Authentication"])
app.include_router(data.router, prefix="/api/data", tags=["Data Management"])
app.include_router(draft.router, prefix="/api/draft", tags=["Draft Generation"])
app.include_router(settings.router, prefix="/api/settings", tags=["Settings"])
app.include_router(records.router, prefix="/api/records", tags=["User Records"])

@app.get("/")
async def root():
    return {"message": "Mail-Reply-Agent API is running"}

@app.get("/api/health")
async def health_check():
    return {
        "status": "healthy",
        "service": "Mail-Reply-Agent API",
        "version": "2.0.0",
        "endpoints": {
            "auth": "/api/auth/login",
            "settings": "/api/settings/test-connection",
            "data": "/api/data/list/style",
            "draft": "/api/draft/generate",
        }
    }
