"""
Separation API - Audio/Video Separation Endpoints
"""
import json
import uuid
from pathlib import Path
from typing import Optional, List
from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from pydantic import BaseModel

from workers.celery_app import celery_app
from workers.tasks import separate_audio_task
from logging_utils import get_logger

router = APIRouter()
logger = get_logger("audioghost.backend.separate", "separate.log")

BASE_DIR = Path(__file__).resolve().parent.parent
UPLOAD_DIR = BASE_DIR / "uploads"
OUTPUT_DIR = BASE_DIR / "outputs"

# Supported MIME types
AUDIO_TYPES = ["audio/mpeg", "audio/wav", "audio/mp3", "audio/x-wav", "audio/flac", "audio/m4a", "audio/aac"]
VIDEO_TYPES = ["video/mp4", "video/webm", "video/quicktime", "video/x-msvideo", "video/mpeg", "video/x-matroska"]
VIDEO_EXTENSIONS = [".mp4", ".webm", ".mov", ".avi", ".mkv", ".mpeg"]


class SeparationRequest(BaseModel):
    description: str
    mode: str = "extract"  # "extract" or "remove"
    start_time: Optional[float] = None
    end_time: Optional[float] = None
    model_size: str = "base"  # "small", "base", "large"


class SeparationResponse(BaseModel):
    task_id: str
    status: str
    message: str


@router.post("/", response_model=SeparationResponse)
async def create_separation_task(
    file: UploadFile = File(...),
    description: str = Form(...),
    mode: str = Form("extract"),
    start_time: Optional[float] = Form(None),
    end_time: Optional[float] = Form(None),
    model_size: str = Form("base"),
    chunk_duration: float = Form(25.0),
    use_float32: str = Form("false")
):
    """
    Create a new audio/video separation task
    
    - **file**: Audio or video file to process (video audio will be extracted)
    - **description**: Text prompt describing the sound to separate
    - **mode**: "extract" to isolate the sound, "remove" to remove it
    - **start_time**: Optional start time for temporal prompting
    - **end_time**: Optional end time for temporal prompting
    - **model_size**: SAM Audio model size (small/base/large)
    - **chunk_duration**: Audio chunk duration in seconds (5-60, default 25)
    - **use_float32**: Use float32 precision for better quality (default: false)
    """
    
    # Validate chunk_duration
    chunk_duration = max(5.0, min(60.0, chunk_duration))
    
    # Parse use_float32 from string to bool
    use_float32_bool = use_float32.lower() == "true"
    
    # Detect if file is video
    file_extension = Path(file.filename).suffix.lower() if file.filename else ""
    is_video = (
        (file.content_type and file.content_type in VIDEO_TYPES) or
        file_extension in VIDEO_EXTENSIONS
    )
    
    # Generate task ID
    task_id = str(uuid.uuid4())
    
    # Save uploaded file
    file_extension = Path(file.filename).suffix or ".mp3"
    upload_path = UPLOAD_DIR / f"{task_id}{file_extension}"
    
    with open(upload_path, "wb") as f:
        content = await file.read()
        f.write(content)

    logger.info(
        "Queued separation task | file=%s | content_type=%s | mode=%s | model=%s | is_video=%s | upload_path=%s",
        file.filename,
        file.content_type,
        mode,
        model_size,
        is_video,
        upload_path,
        extra={"task_id": task_id, "event": "task.queued"},
    )
    
    # Build anchors for temporal prompting
    anchors = None
    if start_time is not None and end_time is not None:
        anchors = [[["+", start_time, end_time]]]
    
    # Submit Celery task
    celery_task = separate_audio_task.apply_async(
        args=[
            str(upload_path),
            description,
            mode,
            anchors,
            model_size,
            chunk_duration,
            use_float32_bool,
            is_video,
            file.filename or "",
        ],
        task_id=task_id
    )
    
    return SeparationResponse(
        task_id=task_id,
        status="pending",
        message="Task submitted successfully"
    )


@router.post("/reprocess", response_model=SeparationResponse)
async def reprocess_task(
    source_task_id: str = Form(...),
    description: str = Form(...),
    mode: str = Form("extract"),
    model_size: str = Form("base"),
    chunk_duration: float = Form(25.0),
    use_float32: str = Form("false"),
):
    """
    Re-run separation on an already-uploaded file using a new description/settings.
    Resolves the original upload path from the source task's meta.json.
    """
    # Locate original upload path from saved metadata
    meta_path = OUTPUT_DIR / f"{source_task_id}.meta.json"
    if not meta_path.exists():
        raise HTTPException(status_code=404, detail="Source task not found")

    try:
        meta = json.loads(meta_path.read_text())
    except Exception:
        raise HTTPException(status_code=500, detail="Failed to read task metadata")

    upload_path = Path(meta.get("upload_path", ""))
    if not upload_path.exists():
        # Fallback: scan uploads/ directory for a file matching the source task ID
        matches = list(UPLOAD_DIR.glob(f"{source_task_id}.*"))
        if not matches:
            # Final fallback: use the original output file from the previous task
            original_output = OUTPUT_DIR / f"{source_task_id}.original.wav"
            if original_output.exists():
                upload_path = original_output
            else:
                raise HTTPException(status_code=404, detail="Original upload file no longer exists on server")
        else:
            upload_path = matches[0]

    chunk_duration = max(5.0, min(60.0, chunk_duration))
    use_float32_bool = use_float32.lower() == "true"

    file_extension = upload_path.suffix.lower()
    is_video = file_extension in [".mp4", ".webm", ".mov", ".avi", ".mkv", ".mpeg"]

    original_filename = meta.get("original_filename", upload_path.name)

    task_id = str(uuid.uuid4())

    logger.info(
        "Queued reprocess task | source_task_id=%s | model=%s | mode=%s | upload_path=%s",
        source_task_id,
        model_size,
        mode,
        upload_path,
        extra={"task_id": task_id, "event": "task.requeued"},
    )

    separate_audio_task.apply_async(
        args=[
            str(upload_path),
            description,
            mode,
            None,
            model_size,
            chunk_duration,
            use_float32_bool,
            is_video,
            original_filename,
        ],
        task_id=task_id,
    )

    return SeparationResponse(
        task_id=task_id,
        status="pending",
        message="Reprocess task submitted successfully",
    )


@router.post("/batch", response_model=List[SeparationResponse])
async def create_batch_separation(
    file: UploadFile = File(...),
    descriptions: str = Form(...),  # JSON array of descriptions
    mode: str = Form("extract")
):
    """
    Create multiple separation tasks for the same audio file
    Useful for separating multiple stems at once
    """
    import json
    
    try:
        desc_list = json.loads(descriptions)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid descriptions format")
    
    # Save file once
    base_task_id = str(uuid.uuid4())
    file_extension = Path(file.filename).suffix or ".mp3"
    upload_path = UPLOAD_DIR / f"{base_task_id}{file_extension}"
    
    with open(upload_path, "wb") as f:
        content = await file.read()
        f.write(content)
    
    responses = []
    for i, desc in enumerate(desc_list):
        task_id = f"{base_task_id}-{i}"
        
        separate_audio_task.apply_async(
            args=[str(upload_path), desc, mode, None, "small"],
            task_id=task_id
        )
        
        responses.append(SeparationResponse(
            task_id=task_id,
            status="pending",
            message=f"Task for '{desc}' submitted"
        ))
    
    return responses
