"""
Admin API — Model & System Status
"""
import os
from pathlib import Path
from typing import Optional
from fastapi import APIRouter
from pydantic import BaseModel

from logging_utils import get_logger
from api.auth import get_saved_token

router = APIRouter()
logger = get_logger("audioghost.backend.admin", "admin.log")

# HF Hub cache base path
HF_HUB_CACHE = Path.home() / ".cache" / "huggingface" / "hub"

# Model definitions
MODELS = [
    {"id": "small",  "repo": "facebook/sam-audio-small"},
    {"id": "base",   "repo": "facebook/sam-audio-base"},
    {"id": "large",  "repo": "facebook/sam-audio-large"},
    {"id": "judge",  "repo": "facebook/sam-audio-judge"},
]


def _hf_cache_dir(repo_id: str) -> Path:
    """Convert a repo ID like 'facebook/sam-audio-base' to its HF Hub cache path."""
    safe = repo_id.replace("/", "--")
    return HF_HUB_CACHE / f"models--{safe}"


def _check_model(repo: str) -> dict:
    """Check whether a model is present in the local HF Hub cache."""
    cache_dir = _hf_cache_dir(repo)
    if not cache_dir.exists():
        return {"exists": False, "size_bytes": 0, "snapshots": []}

    snapshots_dir = cache_dir / "snapshots"
    snapshots = []
    if snapshots_dir.exists():
        for snap_id in snapshots_dir.iterdir():
            if snap_id.is_dir():
                # Calculate total size of all files in this snapshot
                total = sum(
                    f.stat().st_size
                    for f in snap_id.rglob("*")
                    if f.is_file()
                )
                snapshots.append({
                    "snapshot_id": snap_id.name,
                    "size_bytes": total,
                })

    # Total model size across all snapshots
    total_size = sum(s["size_bytes"] for s in snapshots)

    return {
        "exists": len(snapshots) > 0,
        "size_bytes": total_size,
        "snapshots": snapshots,
    }


class ModelStatus(BaseModel):
    id: str
    repo: str
    exists: bool
    size_bytes: int
    size_human: str
    snapshots: list


class AdminStatus(BaseModel):
    authenticated: bool
    models: list[ModelStatus]


def _human_size(bytes_: int) -> str:
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if bytes_ < 1024:
            return f"{bytes_:.1f} {unit}"
        bytes_ /= 1024
    return f"{bytes_:.1f} PB"


@router.get("/models", response_model=AdminStatus)
async def get_admin_models():
    """Check availability of all SAM Audio models in local HF cache."""
    token = get_saved_token()
    authenticated = bool(token)

    models = []
    for m in MODELS:
        info = _check_model(m["repo"])
        models.append(ModelStatus(
            id=m["id"],
            repo=m["repo"],
            exists=info["exists"],
            size_bytes=info["size_bytes"],
            size_human=_human_size(info["size_bytes"]),
            snapshots=info["snapshots"],
        ))

    return AdminStatus(
        authenticated=authenticated,
        models=models,
    )
