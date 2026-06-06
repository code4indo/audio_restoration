"""
AudioGhost AI - FastAPI Backend
"""
import os
from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from api import auth, separate, tasks, admin
from logging_utils import get_logger

logger = get_logger("audioghost.backend.main", "backend.log")

# Create necessary directories
BASE_DIR = Path(__file__).resolve().parent
UPLOAD_DIR = BASE_DIR / "uploads"
OUTPUT_DIR = BASE_DIR / "outputs"
CHECKPOINTS_DIR = BASE_DIR.parent / "checkpoints"

UPLOAD_DIR.mkdir(exist_ok=True)
OUTPUT_DIR.mkdir(exist_ok=True)
CHECKPOINTS_DIR.mkdir(exist_ok=True)


def _is_truthy(value: str | None) -> bool:
    return str(value or "").strip().lower() in {"1", "true", "yes", "on"}


@asynccontextmanager
async def lifespan(app: FastAPI):
    offline_mode = _is_truthy(os.environ.get("HF_HUB_OFFLINE")) or _is_truthy(os.environ.get("TRANSFORMERS_OFFLINE"))

    if offline_mode:
        logger.info(
            "Offline mode enabled via environment — loading from local cache only.",
            extra={"event": "startup.offline_mode"},
        )
    else:
        os.environ.pop("HF_HUB_OFFLINE", None)
        os.environ.pop("TRANSFORMERS_OFFLINE", None)
        logger.info(
            "Online fallback enabled — local cache will be used first, then downloads if needed.",
            extra={"event": "startup.online_fallback"},
        )

    auth.ensure_authenticated()
    yield


app = FastAPI(
    title="AudioGhost AI",
    description="AI-Powered Audio Separation Tool",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS Configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3007", "http://localhost:3000", "http://localhost:3001", "http://127.0.0.1:3007", "http://127.0.0.1:3000", "http://127.0.0.1:3001", "*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount static files for downloads
app.mount("/outputs", StaticFiles(directory="outputs"), name="outputs")

# Include routers
app.include_router(auth.router, prefix="/api/auth", tags=["Authentication"])
app.include_router(separate.router, prefix="/api/separate", tags=["Separation"])
app.include_router(tasks.router, prefix="/api/tasks", tags=["Tasks"])
app.include_router(admin.router, prefix="/api/admin", tags=["Admin"])


@app.get("/")
async def root():
    return {
        "name": "AudioGhost AI",
        "version": "1.0.0",
        "status": "running"
    }


@app.get("/health")
async def health():
    return {"status": "healthy"}
