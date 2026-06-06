"""
Tasks API - Task Status and Results
With meta.json fallback for expired Celery results
"""
import json
from pathlib import Path
from typing import Optional, List
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel
from celery.result import AsyncResult

from workers.celery_app import celery_app
from logging_utils import get_logger
from utils.spectrogram import get_or_compute_spectrogram

router = APIRouter()
logger = get_logger("audioghost.backend.tasks", "tasks.log")

OUTPUT_DIR = Path(__file__).resolve().parent.parent / "outputs"


class TaskStatus(BaseModel):
    task_id: str
    status: str  # pending, processing, completed, failed
    progress: int  # 0-100
    message: Optional[str] = None
    result: Optional[dict] = None


class TaskResult(BaseModel):
    original_url: str
    ghost_url: str  # Separated target
    clean_url: str  # Residual


def _load_meta(task_id: str) -> Optional[dict]:
    """Load task metadata from meta.json file (fallback when Celery result expires)."""
    meta_path = OUTPUT_DIR / f"{task_id}.meta.json"
    if meta_path.exists():
        try:
            return json.loads(meta_path.read_text())
        except Exception:
            pass
    return None


def _get_task_result(task_id: str) -> Optional[dict]:
    """Get task result from Celery, falling back to meta.json if expired."""
    # Try Celery result first
    result = AsyncResult(task_id, app=celery_app)
    if result.state == "SUCCESS" and result.result:
        return result.result

    # Fallback to meta.json
    meta = _load_meta(task_id)
    if meta and "result" in meta:
        return meta["result"]

    return None


@router.get("/history")
async def get_history():
    """Return list of completed restorations sorted by newest first"""
    meta_files = sorted(
        OUTPUT_DIR.glob("*.meta.json"),
        key=lambda f: f.stat().st_mtime,
        reverse=True
    )
    items = []
    for f in meta_files:
        try:
            items.append(json.loads(f.read_text()))
        except Exception:
            pass
    return items


@router.get("/{task_id}", response_model=TaskStatus)
async def get_task_status(task_id: str):
    """Get the status of a separation task, with meta.json fallback for expired results."""

    result = AsyncResult(task_id, app=celery_app)

    if result.state == "PENDING":
        # Check meta.json fallback - the task might have completed but result expired
        meta = _load_meta(task_id)
        if meta and "result" in meta:
            return TaskStatus(
                task_id=task_id,
                status="completed",
                progress=100,
                message="Task completed successfully",
                result=meta["result"]
            )
        return TaskStatus(
            task_id=task_id,
            status="pending",
            progress=0,
            message="Task is waiting to be processed"
        )

    elif result.state == "PROGRESS":
        info = result.info or {}
        return TaskStatus(
            task_id=task_id,
            status="processing",
            progress=info.get("progress", 0),
            message=info.get("message", "Processing...")
        )

    elif result.state == "SUCCESS":
        return TaskStatus(
            task_id=task_id,
            status="completed",
            progress=100,
            message="Task completed successfully",
            result=result.result
        )

    elif result.state == "FAILURE":
        logger.error(
            "Task failed | error=%s",
            result.info,
            extra={"task_id": task_id, "event": "task.failed"},
        )
        return TaskStatus(
            task_id=task_id,
            status="failed",
            progress=0,
            message=str(result.info)
        )

    else:
        # For any other state, check meta.json fallback
        meta = _load_meta(task_id)
        if meta and "result" in meta:
            return TaskStatus(
                task_id=task_id,
                status="completed",
                progress=100,
                message="Task completed successfully",
                result=meta["result"]
            )
        return TaskStatus(
            task_id=task_id,
            status=result.state.lower(),
            progress=0,
            message=f"Task state: {result.state}"
        )


@router.get("/{task_id}/download/{file_type}")
async def download_result(task_id: str, file_type: str):
    """
    Download processed audio or video file.
    Falls back to meta.json when Celery result has expired.

    - **file_type**: "original", "ghost", "clean", or "video"
    """

    if file_type not in ["original", "ghost", "clean", "video"]:
        raise HTTPException(status_code=400, detail="Invalid file type")

    # Get result from Celery or meta.json fallback
    task_result = _get_task_result(task_id)

    if not task_result:
        raise HTTPException(status_code=404, detail="Task result not found. The task may not have completed or results have expired.")

    # Handle video file separately
    if file_type == "video":
        video_path = task_result.get("video_path")
        if not video_path:
            raise HTTPException(status_code=404, detail="No video file for this task")

        file_path = Path(video_path)
        if not file_path.exists():
            raise HTTPException(status_code=404, detail="Video file not found on disk")

        extension = file_path.suffix.lower()
        media_types = {
            ".mp4": "video/mp4",
            ".webm": "video/webm",
            ".mov": "video/quicktime",
            ".avi": "video/x-msvideo",
            ".mkv": "video/x-matroska"
        }
        media_type = media_types.get(extension, "video/mp4")

        return FileResponse(
            path=file_path,
            filename=f"{task_id}_video{extension}",
            media_type=media_type
        )

    # Handle audio files
    file_path = Path(task_result.get(f"{file_type}_path", ""))

    if not file_path.exists():
        # Last resort: try to find the file by convention in outputs dir
        # Pattern: {task_id}.{file_type}.wav
        for ext in [".wav", ".mp3", ".flac"]:
            candidate = OUTPUT_DIR / f"{task_id}.{file_type}{ext}"
            if candidate.exists():
                file_path = candidate
                break

    if not file_path.exists():
        raise HTTPException(status_code=404, detail=f"Audio file '{file_type}' not found on disk")

    # Determine media type from extension
    audio_media_types = {
        ".wav": "audio/wav",
        ".mp3": "audio/mpeg",
        ".flac": "audio/flac",
    }
    extension = file_path.suffix.lower()
    media_type = audio_media_types.get(extension, "audio/wav")

    return FileResponse(
        path=file_path,
        filename=f"{task_id}_{file_type}{extension}",
        media_type=media_type
    )


@router.get("/{task_id}/download-video-with-audio/{audio_type}")
async def download_video_with_audio(task_id: str, audio_type: str):
    """
    Download video with merged audio track.
    Falls back to meta.json when Celery result has expired.

    - **audio_type**: "original", "ghost", or "clean"
    """
    import subprocess

    if audio_type not in ["original", "ghost", "clean"]:
        raise HTTPException(status_code=400, detail="Invalid audio type. Use 'original', 'ghost', or 'clean'")

    task_result = _get_task_result(task_id)
    if not task_result:
        raise HTTPException(status_code=404, detail="Task result not found")

    video_path = task_result.get("video_path")
    if not video_path:
        raise HTTPException(status_code=404, detail="No video file for this task")

    video_file = Path(video_path)
    if not video_file.exists():
        raise HTTPException(status_code=404, detail="Video file not found")

    audio_path = Path(task_result.get(f"{audio_type}_path", ""))
    if not audio_path.exists():
        raise HTTPException(status_code=404, detail=f"Audio file '{audio_type}' not found")

    output_dir = video_file.parent
    extension = video_file.suffix.lower()
    output_filename = f"{task_id}_{audio_type}_merged{extension}"
    output_path = output_dir / output_filename

    try:
        cmd = [
            "ffmpeg", "-y",
            "-i", str(video_file),
            "-i", str(audio_path),
            "-c:v", "copy",
            "-c:a", "aac",
            "-b:a", "192k",
            "-map", "0:v:0",
            "-map", "1:a:0",
            "-shortest",
            str(output_path)
        ]
        subprocess.run(cmd, check=True, capture_output=True)
    except subprocess.CalledProcessError as e:
        raise HTTPException(status_code=500, detail=f"FFmpeg error: {e.stderr.decode()}")
    except FileNotFoundError:
        raise HTTPException(status_code=500, detail="FFmpeg not found. Please install FFmpeg.")

    if not output_path.exists():
        raise HTTPException(status_code=500, detail="Failed to create merged video")

    media_types = {
        ".mp4": "video/mp4",
        ".webm": "video/webm",
        ".mov": "video/quicktime",
        ".avi": "video/x-msvideo",
        ".mkv": "video/x-matroska"
    }
    media_type = media_types.get(extension, "video/mp4")

    audio_labels = {
        "original": "original",
        "ghost": "isolated",
        "clean": "without_isolated"
    }

    return FileResponse(
        path=output_path,
        filename=f"{task_id}_{audio_labels[audio_type]}_video{extension}",
        media_type=media_type
    )


@router.delete("/{task_id}")
async def cancel_task(task_id: str):
    """Cancel a pending or running task"""
    result = AsyncResult(task_id, app=celery_app)
    result.revoke(terminate=True)
    return {"success": True, "message": "Task cancelled"}


@router.delete("/{task_id}/history")
async def delete_history_task(task_id: str):
    """Delete a task from history - removes all associated files"""
    import os

    BASE_DIR = Path(__file__).resolve().parent.parent
    OUTPUT_DIR = BASE_DIR / "outputs"
    UPLOAD_DIR = BASE_DIR / "uploads"

    deleted_files = []
    errors = []

    meta_path = OUTPUT_DIR / f"{task_id}.meta.json"
    if meta_path.exists():
        try:
            meta_path.unlink()
            deleted_files.append(str(meta_path))
        except Exception as e:
            errors.append(f"meta.json: {e}")

    for suffix in ["original", "ghost", "clean"]:
        for ext in [".wav", ".mp3", ".flac", ".mp4", ".webm", ".mov", ".avi", ".mkv"]:
            file_path = OUTPUT_DIR / f"{task_id}{suffix}{ext}"
            if file_path.exists():
                try:
                    file_path.unlink()
                    deleted_files.append(str(file_path))
                except Exception as e:
                    errors.append(f"{suffix}{ext}: {e}")

    upload_matches = list(UPLOAD_DIR.glob(f"{task_id}.*"))
    for upload_file in upload_matches:
        try:
            upload_file.unlink()
            deleted_files.append(str(upload_file))
        except Exception as e:
            errors.append(f"upload: {e}")

    logger.info(
        "Deleted task files | task_id=%s | deleted=%d | errors=%d",
        task_id,
        len(deleted_files),
        len(errors),
        extra={"event": "task.deleted"},
    )

    return {
        "success": True,
        "deleted": deleted_files,
        "errors": errors if errors else None
    }


@router.get("/", response_model=List[TaskStatus])
async def list_recent_tasks(limit: int = 10):
    """List recent tasks"""
    return []


@router.get("/{task_id}/spectrogram")
async def get_task_spectrogram(task_id: str, track: str = "original"):
    """
    Get pre-computed spectrogram data for a completed task.
    
    - **track**: which audio track to analyze ("original", "ghost", "clean")
    
    Computes on first request with GPU acceleration (if available),
    caches result to disk, and returns binary spectrogram data.
    
    Binary format:
    - int32: number of time frames
    - int32: number of frequency bins
    - float32[]: flattened spectrogram data (time-major order)
    
    Subsequent requests return the cached result instantly.
    """
    if track not in ("original", "ghost", "clean"):
        raise HTTPException(status_code=400, detail="Track must be 'original', 'ghost', or 'clean'")

    payload = get_or_compute_spectrogram(task_id, track)
    if payload is None:
        raise HTTPException(
            status_code=404,
            detail="Task audio not found or spectrogram computation failed"
        )

    return Response(
        content=payload,
        media_type="application/octet-stream",
        headers={
            "Cache-Control": "public, max-age=31536000, immutable",
        }
    )
