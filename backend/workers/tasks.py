"""
Celery Tasks - Audio Separation Workers
With SAM Audio Lite optimization for low VRAM usage
Enhanced with CPU Offloading Strategy for memory efficiency
Enhanced with Forensic Logging for audit trail and diagnostics
"""
import os
import sys
import gc
import time as _time
import json
import traceback
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, List

from celery import current_task

from workers.celery_app import celery_app
from logging_utils import get_logger, with_task

# Add parent directory to path for SAM Audio imports
sys.path.insert(0, str(Path(__file__).parent.parent.parent))
# Add backend directory to path so api.* imports work from Celery workers
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

BASE_DIR = Path(__file__).resolve().parent.parent
OUTPUT_DIR = BASE_DIR / "outputs"
OUTPUT_DIR.mkdir(exist_ok=True)
FORENSIC_DIR = BASE_DIR / "forensic_logs"
FORENSIC_DIR.mkdir(exist_ok=True)
logger = get_logger("audioghost.backend.worker", "worker.log")

# Global model cache - stores model on CPU to save GPU memory
_model_cache = {}
_processor_cache = {}

# Environment configuration for memory optimization
os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True,max_split_size_mb:512")


# ============================================
# FORENSIC LOGGER - Audit Trail per Task
# ============================================

class ForensicLogger:
    """
    Structured forensic logger that records every processing step
    for a single task. Writes a complete JSON audit trail to disk.

    The log captures:
    - Input metadata (file, duration, sample rate, format)
    - Model configuration (name, dtype, VRAM budget, chunk plan)
    - Per-chunk execution details (timings, memory, overlap)
    - Output file paths and sizes
    - GPU memory snapshots at key points
    - Errors and warnings

    Usage:
        fl = ForensicLogger(task_id)
        fl.log_input(audio_path, duration=18.08, sample_rate=48000, ...)
        fl.log_model("facebook/sam-audio-large", dtype="float32", ...)
        fl.log_chunk(0, chunk_duration=7.5, vram_before=..., vram_after=...)
        fl.log_output(paths={...}, processing_time=42.3)
        fl.save()  # writes to forensic_logs/{task_id}.json
    """

    def __init__(self, task_id: str):
        self.task_id = task_id
        self.entries = []
        self.start_time = _time.time()
        self._add("task.init", {"task_id": task_id})

    def _add(self, event: str, data: dict):
        entry = {
            "ts": datetime.now(timezone.utc).isoformat(),
            "elapsed_s": round(_time.time() - self.start_time, 3),
            "event": event,
            **data,
        }
        self.entries.append(entry)

    def log_input(self, audio_path: str, **kwargs):
        self._add("task.input", {"audio_path": str(audio_path), **kwargs})

    def log_model(self, model_name: str, **kwargs):
        self._add("task.model_loaded", {"model_name": model_name, **kwargs})

    def log_memory(self, label: str, **kwargs):
        self._add("task.memory", {"label": label, **kwargs})

    def log_chunk(self, chunk_index: int, **kwargs):
        self._add("task.chunk_processed", {"chunk_index": chunk_index, **kwargs})

    def log_output(self, **kwargs):
        self._add("task.output", kwargs)

    def log_error(self, error: str, traceback_str: str = ""):
        self._add("task.error", {"error": error, "traceback": traceback_str})

    def log_event(self, event: str, **kwargs):
        self._add(event, kwargs)

    def snapshot_gpu(self, label: str, device: str = "cuda:0"):
        """Record GPU memory state."""
        try:
            import torch
            if not torch.cuda.is_available():
                return
            idx = int(device.split(":")[-1]) if ":" in device else 0
            total = torch.cuda.get_device_properties(idx).total_memory / (1024**3)
            allocated = torch.cuda.memory_allocated(idx) / (1024**3)
            reserved = torch.cuda.memory_reserved(idx) / (1024**3)
            free = total - allocated
            self.log_memory(label,
                gpu_index=idx,
                total_gb=round(total, 2),
                allocated_gb=round(allocated, 2),
                reserved_gb=round(reserved, 2),
                free_gb=round(free, 2),
            )
        except Exception:
            pass

    def save(self) -> str:
        """Write forensic log to disk. Returns the file path."""
        total_time = round(_time.time() - self.start_time, 3)
        self._add("task.complete", {"total_elapsed_s": total_time, "total_events": len(self.entries)})

        output = {
            "task_id": self.task_id,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "total_elapsed_s": total_time,
            "events": self.entries,
        }
        path = FORENSIC_DIR / f"{self.task_id}.json"
        path.write_text(json.dumps(output, ensure_ascii=False, indent=2))
        return str(path)

    def summary(self) -> dict:
        """Return a quick summary dict for logging."""
        chunks = [e for e in self.entries if e.get("event") == "task.chunk_processed"]
        errors = [e for e in self.entries if e.get("event") == "task.error"]
        mem_snapshots = [e for e in self.entries if e.get("event") == "task.memory"]
        return {
            "task_id": self.task_id,
            "total_events": len(self.entries),
            "num_chunks": len(chunks),
            "num_errors": len(errors),
            "num_memory_snapshots": len(mem_snapshots),
            "elapsed_s": round(_time.time() - self.start_time, 3),
        }


def _is_truthy(value: str | None) -> bool:
    return str(value or "").strip().lower() in {"1", "true", "yes", "on"}


def is_huggingface_offline() -> bool:
    return _is_truthy(os.environ.get("HF_HUB_OFFLINE")) or _is_truthy(os.environ.get("TRANSFORMERS_OFFLINE"))


@contextmanager
def temporarily_disable_hf_offline():
    """Temporarily allow Hugging Face network access for model download."""
    saved = {
        "HF_HUB_OFFLINE": os.environ.pop("HF_HUB_OFFLINE", None),
        "TRANSFORMERS_OFFLINE": os.environ.pop("TRANSFORMERS_OFFLINE", None),
    }
    try:
        yield
    finally:
        for key, value in saved.items():
            if value is not None:
                os.environ[key] = value


def resolve_model_snapshot(model_name: str, hf_token: str | None = None) -> str:
    """Resolve a local snapshot path, downloading it only when offline mode is disabled."""
    from huggingface_hub import snapshot_download

    try:
        local_model_path = snapshot_download(model_name, local_files_only=True, token=hf_token)
        logger.info(
            "Using cached snapshot for %s: %s",
            model_name,
            local_model_path,
            extra={"event": "hf.snapshot_cache_hit"},
        )
        return local_model_path
    except Exception as local_err:
        logger.warning(
            "Cached snapshot for %s not available: %s",
            model_name,
            local_err,
            extra={"event": "hf.snapshot_cache_miss"},
        )

        if is_huggingface_offline():
            raise RuntimeError(
                f"Model {model_name} is not available in the local Hugging Face cache while offline mode is enabled. "
                "Pre-download the model or disable offline mode so AudioGhost can fetch it automatically."
            ) from local_err

        from api.auth import ensure_authenticated, get_saved_token

        effective_token = hf_token or get_saved_token()
        if effective_token:
            ensure_authenticated()

        logger.info("Downloading %s from Hugging Face...", model_name, extra={"event": "hf.snapshot_download"})
        with temporarily_disable_hf_offline():
            try:
                local_model_path = snapshot_download(
                    model_name,
                    local_files_only=False,
                    token=effective_token,
                )
                logger.info(
                    "Downloaded snapshot for %s: %s",
                    model_name,
                    local_model_path,
                    extra={"event": "hf.snapshot_downloaded"},
                )
                return local_model_path
            except Exception as download_err:
                raise RuntimeError(
                    f"Unable to fetch model {model_name} from Hugging Face. "
                    "Check internet access, ensure the server token has access to the model, "
                    f"and then try again. Original error: {download_err}"
                ) from download_err


def update_progress(progress: int, message: str):
    """Update task progress"""
    current_task.update_state(
        state="PROGRESS",
        meta={"progress": progress, "message": message}
    )


def _get_free_vram_mb_nvidia(device_id: int = 0) -> int:
    """
    Get accurate free VRAM in MiB for a specific GPU device using nvidia-smi.
    Unlike torch.cuda.memory_allocated(), this accounts for ALL processes
    using the GPU, not just the current Python process.
    Falls back to torch-based estimate if nvidia-smi is unavailable.
    """
    import subprocess
    try:
        result = subprocess.run(
            ["nvidia-smi", "--query-gpu=memory.free", "--format=csv,noheader,nounits",
             f"--id={device_id}"],
            capture_output=True, text=True, timeout=5, check=True,
        )
        free_mib = int(result.stdout.strip().split("\n")[0].strip())
        return free_mib
    except Exception:
        # Fallback: torch-based estimate (only sees current process)
        import torch
        if torch.cuda.is_available() and device_id < torch.cuda.device_count():
            props = torch.cuda.get_device_properties(device_id)
            allocated = torch.cuda.memory_allocated(device_id)
            return int((props.total_memory - allocated) / (1024 * 1024))
        return 0


def get_best_gpu_device():
    """
    Select the GPU with most free memory (cross-process aware).
    Returns the best CUDA device string or 'cpu' if no GPU available.
    """
    import torch
    
    if not torch.cuda.is_available():
        return "cpu"
    
    num_gpus = torch.cuda.device_count()
    if num_gpus == 0:
        return "cpu"
    
    # Find GPU with most free memory using nvidia-smi (cross-process)
    best_gpu = 0
    max_free_memory = 0
    
    for i in range(num_gpus):
        try:
            free_memory = _get_free_vram_mb_nvidia(i)
            print(f"[DEBUG] GPU {i}: {free_memory / 1024:.2f} GB free (cross-process)")
            if free_memory > max_free_memory:
                max_free_memory = free_memory
                best_gpu = i
        except Exception as e:
            print(f"[DEBUG] Error checking GPU {i}: {e}")
            continue
    
    print(f"[DEBUG] Selected GPU {best_gpu} with {max_free_memory / 1024:.2f} GB free")
    return f"cuda:{best_gpu}"


def create_lite_model_cpu(model_name: str, hf_token: str = None):
    """
    Create a memory-optimized SAM Audio model and keep it on CPU.
    
    CPU Offloading Strategy:
    - Model is loaded and stored on CPU
    - Only moved to GPU during inference
    - Reduces VRAM usage from ~11GB to ~4-5GB
    """
    import torch
    from sam_audio import SAMAudio, SAMAudioProcessor
    
    print(f"[CPU-OFFLOAD] Loading {model_name} to CPU (lite mode)...")

    local_model_path = resolve_model_snapshot(model_name, hf_token)

    # Load model and processor from the resolved snapshot directory to avoid
    # unnecessary Hub lookups once the files are available locally.
    model = SAMAudio.from_pretrained(local_model_path, torch_dtype=torch.float32)
    processor = SAMAudioProcessor.from_pretrained(local_model_path)
    
    print("[CPU-OFFLOAD] Optimizing model for low VRAM...")
    
    # Get vision encoder dim before deleting
    vision_dim = model.vision_encoder.dim if hasattr(model.vision_encoder, 'dim') else 1024
    
    # Delete heavy components
    del model.vision_encoder
    gc.collect()
    
    # Store the dim for _get_video_features
    model._vision_encoder_dim = vision_dim
    
    # Replace _get_video_features to not use vision_encoder
    # Return None instead of zeros — AlignModalities.forward() checks
    # for None and skips the video cross-attention entirely, preventing
    # spurious non-zero activations from LayerNorm(zeros) in the align layer.
    def _get_video_features_lite(self, video, audio_features):
        return None
    
    import types
    model._get_video_features = types.MethodType(_get_video_features_lite, model)
    
    # Delete rankers
    if hasattr(model, 'visual_ranker') and model.visual_ranker is not None:
        del model.visual_ranker
        model.visual_ranker = None
        gc.collect()
    
    if hasattr(model, 'text_ranker') and model.text_ranker is not None:
        del model.text_ranker
        model.text_ranker = None
        gc.collect()
    
    # Delete span predictor
    if hasattr(model, 'span_predictor') and model.span_predictor is not None:
        del model.span_predictor
        model.span_predictor = None
        gc.collect()
    
    if hasattr(model, 'span_predictor_transform') and model.span_predictor_transform is not None:
        del model.span_predictor_transform
        model.span_predictor_transform = None
        gc.collect()
    
    # Keep model on CPU and in eval mode
    model = model.eval().cpu()
    
    # Force garbage collection
    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
    
    print("[CPU-OFFLOAD] Model optimization complete! Model stored on CPU.")
    
    return model, processor


def get_or_load_lite_model_cpu(model_name: str, hf_token: str):
    """
    Get cached lite model from CPU or create it.
    Model stays on CPU until inference time.
    """
    import torch
    
    cache_key = f"{model_name}_lite_cpu"
    
    print(f"[CPU-OFFLOAD] Looking for cached CPU model with key: {cache_key}")
    print(f"[CPU-OFFLOAD] Current cache keys: {list(_model_cache.keys())}")
    
    if cache_key not in _model_cache:
        print(f"[CPU-OFFLOAD] Cache miss - creating new lite model on CPU")
        
        # Clear any existing models first to free memory
        if len(_model_cache) > 0:
            print(f"[CPU-OFFLOAD] Clearing {len(_model_cache)} existing model(s) from cache...")
            for old_key in list(_model_cache.keys()):
                old_model = _model_cache.pop(old_key)
                del old_model
            for old_key in list(_processor_cache.keys()):
                del _processor_cache[old_key]
            gc.collect()
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        
        model, processor = create_lite_model_cpu(model_name, hf_token)
        
        _model_cache[cache_key] = model
        _processor_cache[model_name] = processor
        
        print(f"[CPU-OFFLOAD] Model cached on CPU.")
    else:
        print(f"[CPU-OFFLOAD] Cache hit - using existing CPU model")
    
    return _model_cache[cache_key], _processor_cache[model_name]


def move_model_to_device(model, device: str, dtype):
    """
    Temporarily move model to GPU for inference.
    Returns the model on the specified device.
    """
    import torch
    
    print(f"[CPU-OFFLOAD] Moving model to {device} with dtype {dtype}...")
    
    # Clean GPU memory before moving
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
        gc.collect()
    
    model = model.to(device, dtype)
    
    if "cuda" in device:
        allocated = torch.cuda.memory_allocated() / 1024**3
        reserved = torch.cuda.memory_reserved() / 1024**3
        print(f"[CPU-OFFLOAD] GPU Memory - Allocated: {allocated:.2f} GB, Reserved: {reserved:.2f} GB")
    
    return model


def move_model_to_cpu(model):
    """
    Move model back to CPU after inference to free GPU memory.
    """
    import torch
    
    print("[CPU-OFFLOAD] Moving model back to CPU...")
    model = model.cpu()
    model = model.to(torch.float32)  # Convert back to float32 for CPU storage
    
    # Aggressively clean GPU memory
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
        gc.collect()
        allocated = torch.cuda.memory_allocated() / 1024**3
        print(f"[CPU-OFFLOAD] GPU Memory after offload: {allocated:.2f} GB")
    
    return model


def cleanup_gpu_memory():
    """Clean up GPU memory after task"""
    import torch
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
        gc.collect()


# ============================================
# TENSOR PARALLELISM — Split DiT across 2 GPUs
# ============================================
# For float32 large model on dual GPU setup (2× A4000 16GiB).
# Splits the 22 DiT transformer layers across both GPUs:
#   GPU 0: layers 0-10  (first half)
#   GPU 1: layers 11-21 (second half + embeddings + codec + text encoder)
# Halves per-GPU memory from ~15 GiB to ~7 GiB, leaving room for activations.

def _make_tp_forward(mid: int, device_a: str, device_b: str):
    """
    Create a tensor-parallel forward pass for the DiT transformer.
    
    Embeddings run on device_b. First `mid` layers on device_a.
    Remaining layers + output on device_b. Cross-device transfers
    are handled automatically by PyTorch when tensors cross device boundaries.
    """
    from einops import rearrange
    import torch.nn.functional as F
    from sam_audio.model.transformer import modulate
    import copy

    def tp_forward(self, x, time, *, padding_mask=None, memory=None, memory_padding_mask=None):
        # ---- Embeddings on device_b ----
        x = x.to(device_b)
        time = time.to(device_b)
        memory = memory.to(device_b) if memory is not None else None

        x = rearrange(x, "b l c-> b c l")
        h = self.x_embedder(x)
        h = rearrange(h, "b c l -> b l c")
        original_N = h.shape[1]
        h = F.dropout(h, p=self.dropout, training=self.training)

        t = self.t_embedder(time)
        t0 = self.t_block_non_linearity(t)
        t0 = self.t_block(t0)

        y = self.y_embedder(memory)

        # ---- First half of layers on device_a ----
        h = h.to(device_a)
        y_a = y.to(device_a) if y is not None else None
        t0_a = t0.to(device_a)
        pm_a = padding_mask.to(device_a) if padding_mask is not None else None
        mpm_a = memory_padding_mask.to(device_a) if memory_padding_mask is not None else None
        # Copy rope to device_a (separate instance to avoid moving the original)
        rope_a = copy.deepcopy(self.rope_embeddings).to(device_a) if self.rope_embeddings is not None else None

        for layer in self.layers[:mid]:
            h = layer(
                x=h, cross_x=y_a, t=t0_a,
                padding_mask=pm_a,
                memory_padding_mask=mpm_a,
                rope=rope_a,
            )

        # Clean up device_a temporaries
        del y_a, t0_a, pm_a, mpm_a, rope_a

        # ---- Second half of layers on device_b ----
        h = h.to(device_b)
        for layer in self.layers[mid:]:
            h = layer(
                x=h, cross_x=y, t=t0,
                padding_mask=padding_mask,
                memory_padding_mask=memory_padding_mask,
                rope=self.rope_embeddings,
            )

        # ---- Output on device_b ----
        shift, scale = (self.final_layer_scale_shift_table[None] + t[:, None]).chunk(2, dim=1)
        if self.norm is not None:
            h = self.norm(h)
        h = modulate(h, shift, scale)
        h = F.dropout(h, p=self.dropout, training=self.training)
        output = self.output(h)

        N = output.shape[1]
        if original_N != N:
            output = output[:, -original_N:]

        return output

    return tp_forward


def enable_tensor_parallel(model, device_a="cuda:0", device_b="cuda:1"):
    """
    Split DiT layers across 2 GPUs for tensor-parallel inference.
    Call AFTER model is loaded on CPU, BEFORE moving for inference.
    
    Architecture:
      GPU A (device_a): first half of DiT layers (0-10 for large)
      GPU B (device_b): second half (11-21) + embeddings + codec + text encoder
    
    The model cache stays on CPU in original form. TP is enabled per-task.
    """
    import torch
    
    dit = model.transformer
    layers = dit.layers
    n = len(layers)
    mid = n // 2  # 11 for 22-layer large model

    print(f"[TENSOR-PARALLEL] Splitting {n} DiT layers: 0-{mid-1} on {device_a}, {mid}-{n-1} on {device_b}")

    # Store original forward and TP state
    dit._original_forward = dit.forward
    dit._tp_mid = mid
    model._tp_enabled = True
    model._tp_device_a = device_a
    model._tp_device_b = device_b

    # Move embedding/output layers to device_b
    # Note: nn.Parameter.to() returns a plain Tensor, so wrap it back
    dit.x_embedder = dit.x_embedder.to(device_b)
    dit.y_embedder = dit.y_embedder.to(device_b)
    dit.t_embedder = dit.t_embedder.to(device_b)
    dit.t_block = dit.t_block.to(device_b)
    dit.norm = dit.norm.to(device_b)
    dit.output = dit.output.to(device_b)
    dit.final_layer_scale_shift_table = torch.nn.Parameter(
        dit.final_layer_scale_shift_table.to(device_b)
    )
    if dit.rope_embeddings is not None:
        dit.rope_embeddings = dit.rope_embeddings.to(device_b)

    # Move DiT layers to respective devices
    for i, layer in enumerate(layers):
        layer.to(device_a if i < mid else device_b)

    # Move other model components to device_b
    model.audio_codec = model.audio_codec.to(device_b)
    model.text_encoder = model.text_encoder.to(device_b)
    model.proj = model.proj.to(device_b)
    model.align_masked_video = model.align_masked_video.to(device_b)
    model.embed_anchors = model.embed_anchors.to(device_b)
    model.memory_proj = model.memory_proj.to(device_b)
    model.timestep_emb = model.timestep_emb.to(device_b)

    # Replace forward method (use MethodType to bind self properly)
    import types
    dit.forward = types.MethodType(_make_tp_forward(mid, device_a, device_b), dit)

    print(f"[TENSOR-PARALLEL] Enabled: layers 0-{mid-1} on {device_a}, rest on {device_b}")
    return model


def disable_tensor_parallel(model):
    """Restore model to single-device CPU state after tensor-parallel inference."""
    import torch
    import gc
    
    dit = model.transformer
    
    # Restore original forward
    if hasattr(dit, '_original_forward'):
        dit.forward = dit._original_forward
        del dit._original_forward
    
    # Move everything back to CPU
    dit.to("cpu")
    model.audio_codec = model.audio_codec.to("cpu")
    model.text_encoder = model.text_encoder.to("cpu")
    model.proj = model.proj.to("cpu")
    model.align_masked_video = model.align_masked_video.to("cpu")
    model.embed_anchors = model.embed_anchors.to("cpu")
    model.memory_proj = model.memory_proj.to("cpu")
    model.timestep_emb = model.timestep_emb.to("cpu")
    
    model._tp_enabled = False
    
    # Aggressive cleanup
    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
    
    print("[TENSOR-PARALLEL] Disabled — model restored to CPU")
    return model


def estimate_model_vram_mb(model_size: str, dtype_bytes: int = 4) -> int:
    """
    Rough estimate of model VRAM in MiB (weights only, no activations).
    Based on known parameter counts after lite optimization.
    """
    params = {
        "small": 0.4e9,   # ~400M params
        "base":  0.9e9,   # ~900M params
        "large": 2.2e9,   # ~2.2B params
    }
    p = params.get(model_size, 0.9e9)
    return int(p * dtype_bytes / (1024 * 1024))


def get_available_vram_mb(device: str) -> int:
    """Return available VRAM in MiB on the given CUDA device (cross-process aware)."""
    if "cuda" not in device:
        return 0
    idx = int(device.split(":")[-1]) if ":" in device else 0
    return _get_free_vram_mb_nvidia(idx)


def calculate_max_chunk_seconds(
    model_size: str,
    sample_rate: int,
    dtype_bytes: int,
    available_vram_mb: int,
    user_chunk_duration: float,
) -> float:
    """
    Calculate the maximum chunk duration (seconds) that fits in available VRAM.

    Memory budget per chunk:
      model_weights + codec_state + audio_tensor + ODE_activations + overhead
    The dominant variable cost is ODE activation memory, which scales with
    sequence length (audio duration).

    Empirical activation cost (measured from the large model):
      ~0.35 MiB per ms of audio in float32
      ~0.18 MiB per ms of audio in float16
    We use a conservative estimate with 20% overhead margin.
    """
    model_mb = estimate_model_vram_mb(model_size, dtype_bytes)
    # Codec + text encoder state, batch tensors, misc overhead (conservative)
    fixed_mb = model_mb + 200
    # Safety margin
    usable_mb = max(available_vram_mb - fixed_mb, 0)
    if usable_mb <= 0:
        return 5.0  # minimum

    # Activation cost per second of audio (MiB/s)
    # Empirically: large model float32 ~350 MiB/s, float16 ~180 MiB/s
    # Scale by model size relative to large
    model_scale = {"small": 0.35, "base": 0.6, "large": 1.0}.get(model_size, 0.6)
    act_cost_per_sec = 350.0 * model_scale * (dtype_bytes / 4)  # scale by precision

    max_seconds = usable_mb / act_cost_per_sec

    # Clamp to sensible range
    max_seconds = max(5.0, min(60.0, max_seconds))

    # Also respect user's requested chunk duration
    max_seconds = min(max_seconds, user_chunk_duration)

    return max_seconds


@celery_app.task(bind=True)
def separate_audio_task(
    self,
    audio_path: str,
    description: str,
    mode: str = "extract",
    anchors: Optional[List] = None,
    model_size: str = "base",
    chunk_duration: float = 25.0,
    use_float32: bool = False,
    is_video: bool = False,
    original_filename: str = ""
):
    """
    Separate audio using SAM Audio Lite with CPU Offloading Strategy
    
    Args:
        audio_path: Path to input audio or video file
        description: Text prompt for separation
        mode: "extract" or "remove"
        anchors: Optional temporal anchors [["+", start, end], ...]
        model_size: Model size (small/base/large)
        chunk_duration: Audio chunk duration in seconds (5-60)
        use_float32: Use float32 precision for better quality
        is_video: If True, extract audio from video file first
    
    Returns:
        Dictionary with paths to output files
    """
    import torch
    import torchaudio
    import time
    import subprocess
    import shutil
    
    task_id = self.request.id
    task_logger = with_task(logger, task_id)
    video_path = None  # Will be set if input is video
    audio_file_path = Path(audio_path).expanduser().resolve()

    # Initialize forensic logger for audit trail
    forensic = ForensicLogger(task_id)
    forensic.log_event("task.received",
        audio_path=str(audio_file_path),
        description=description,
        mode=mode,
        model_size=model_size,
        is_video=is_video,
        chunk_duration=chunk_duration,
        use_float32=use_float32,
        original_filename=original_filename,
    )

    task_logger.info(
        "Task received | audio_path=%s | description=%s | mode=%s | model_size=%s | is_video=%s | chunk_duration=%s | use_float32=%s",
        audio_file_path,
        description,
        mode,
        model_size,
        is_video,
        chunk_duration,
        use_float32,
        extra={"event": "task.received"},
    )

    if not audio_file_path.exists() or audio_file_path.is_dir():
        raise FileNotFoundError(f"Input audio path is invalid: {audio_file_path}")
    
    # Select best GPU based on available memory
    device = get_best_gpu_device()
    
    # Debug: Show received parameter
    task_logger.info(
        "Device selection complete | device=%s | use_float32=%s | is_video=%s",
        device,
        use_float32,
        is_video,
        extra={"event": "task.device_selected"},
    )
    forensic.log_event("task.device_selected", device=device, use_float32=use_float32)
    forensic.snapshot_gpu("before_processing", device if "cuda" in device else "cuda:0")
    
    # Handle video files - extract audio using FFmpeg
    if is_video:
        update_progress(2, "Extracting audio from video...")
        video_path = audio_file_path
        
        # Copy video to output directory for later playback
        output_video_path = OUTPUT_DIR / f"{task_id}.video{video_path.suffix}"
        shutil.copy2(video_path, output_video_path)
        task_logger.info("Copied source video to %s", output_video_path, extra={"event": "task.video_copied"})
        
        # Extract audio from video using FFmpeg
        extracted_audio_path = OUTPUT_DIR / f"{task_id}.extracted.wav"
        ffmpeg_cmd = [
            "ffmpeg", "-y",
            "-i", str(video_path),
            "-vn",                    # No video
            "-acodec", "pcm_s16le",   # PCM 16-bit
            "-ar", "44100",           # 44.1kHz sample rate
            "-ac", "1",               # Mono
            str(extracted_audio_path)
        ]
        
        try:
            result = subprocess.run(
                ffmpeg_cmd,
                capture_output=True,
                text=True,
                check=True
            )
            task_logger.info("FFmpeg audio extraction successful", extra={"event": "task.ffmpeg_ok"})
        except subprocess.CalledProcessError as e:
            raise Exception(f"FFmpeg audio extraction failed: {e.stderr}")
        
        # Use extracted audio for processing
        audio_file_path = extracted_audio_path.resolve()
    
    # Set precision based on use_float32 parameter
    # Use float16 (not bfloat16) by default on GPU — bfloat16 has poor dynamic range
    # on consumer GPUs and causes audible artifacts in the ODE solver.
    if use_float32 or device == "cpu":
        dtype = torch.float32
        task_logger.info("Using float32 precision", extra={"event": "task.precision_float32"})
    else:
        dtype = torch.float16
        task_logger.info("Using float16 precision", extra={"event": "task.precision_float16"})
    
    # Start timing
    start_time = time.time()
    
    try:
        update_progress(5, "Initializing...")

        # Model is loaded from local HuggingFace cache — no network/auth needed
        hf_token = None

        # Select model based on size
        model_name = f"facebook/sam-audio-{model_size}"
        
        update_progress(10, f"Loading {model_name} (CPU offload mode)...")
        
        # Clean up before loading
        cleanup_gpu_memory()
        
        # Load lite model from CPU cache — model stays on CPU
        model, processor = get_or_load_lite_model_cpu(model_name, hf_token)
        
        # Initialize tensor parallelism flag (may be set below if conditions are met)
        use_tensor_parallel = False
        
        # Forensic: record model load (before TP/dtype decision)
        model_param_count = sum(p.numel() for p in model.parameters())
        forensic.log_model(model_name,
            model_param_count=model_param_count,
            model_size_mb=round(model_param_count * 4 / (1024 * 1024), 1),
            dtype="float32 (CPU storage)",
            device="cpu",
        )
        forensic.snapshot_gpu("after_model_load_cpu", device if "cuda" in device else "cuda:0")
        
        # ============================================
        # VRAM BUDGET & CHUNK SIZING
        # ============================================
        sample_rate = processor.audio_sampling_rate
        
        # Measure model weight size on CPU to estimate GPU VRAM needs
        model_param_bytes = sum(p.numel() * p.element_size() for p in model.parameters())
        model_vram_mb = model_param_bytes / (1024 * 1024)
        dtype_bytes = 4 if dtype == torch.float32 else 2
        
        # Measure available VRAM using nvidia-smi (cross-process aware)
        if "cuda" in device:
            raw_free_mb = get_available_vram_mb(device)
            # Reserve 300 MiB for CUDA context, fragmentation, etc.
            usable_vram_mb = max(raw_free_mb - 300, 0)
        else:
            usable_vram_mb = 99999  # CPU: no VRAM limit
            raw_free_mb = 99999
        
        # Auto-downgrade from float32 to float16 if model won't fit.
        # We estimate total GPU memory needed as: model_weights + activations + overhead.
        # Activation memory scales with model size (roughly 30% of weights for SAM Audio).
        model_vram_needed_mb = model_vram_mb * (dtype_bytes / 4)  # scale to target dtype
        estimated_total_mb = model_vram_needed_mb * 1.30  # weights + ~30% activations/codec/overhead
        
        # Check if tensor parallelism is possible (2 GPUs, float32, large model exceeds VRAM)
        use_tensor_parallel = False
        if "cuda" in device and estimated_total_mb > usable_vram_mb * 0.90:
            if use_float32 and torch.cuda.device_count() >= 2:
                # Check if the second GPU has enough free memory for half the model
                free_mb_a = _get_free_vram_mb_nvidia(0)
                free_mb_b = _get_free_vram_mb_nvidia(1)
                half_model_mb = model_vram_needed_mb / 2  # ~6 GB for large
                if free_mb_a > half_model_mb * 1.30 and free_mb_b > half_model_mb * 1.30:
                    task_logger.warning(
                        "Estimated total GPU memory (%.0f MiB) exceeds 90%% of single GPU "
                        "VRAM (%.0f MiB). Enabling tensor parallelism across 2 GPUs to "
                        "keep float32 precision. GPU 0 free=%d MiB, GPU 1 free=%d MiB",
                        estimated_total_mb, usable_vram_mb, free_mb_a, free_mb_b,
                        extra={"event": "task.tensor_parallel"},
                    )
                    use_tensor_parallel = True
                    dtype_bytes = 4  # Keep float32
                    model_vram_needed_mb = model_vram_mb  # Already float32
                    estimated_total_mb = model_vram_needed_mb * 1.30
                    # Override device to use primary GPU for orchestration
                    device = "cuda:1"
                else:
                    # Not enough memory on second GPU either, fall through to downgrade
                    use_tensor_parallel = False
            else:
                use_tensor_parallel = False
            
            if not use_tensor_parallel:
                if use_float32:
                    task_logger.warning(
                        "Estimated total GPU memory (%.0f MiB = weights + activations) exceeds 90%% "
                        "of available VRAM (%.0f MiB). Auto-downgrading from float32 to float16 "
                        "to avoid OOM.",
                        estimated_total_mb, usable_vram_mb,
                        extra={"event": "task.dtype_downgrade"},
                    )
                    dtype = torch.float16
                    dtype_bytes = 2
                    model_vram_needed_mb = model_vram_mb * (dtype_bytes / 4)
                    estimated_total_mb = model_vram_needed_mb * 1.30
                else:
                    task_logger.warning(
                        "Estimated total GPU memory (%.0f MiB) exceeds 90%% of available VRAM "
                        "(%.0f MiB). Expect very small chunks or potential OOM.",
                        estimated_total_mb, usable_vram_mb,
                        extra={"event": "task.vram_tight"},
                    )
        
        # Calculate chunk duration that fits in available VRAM
        CHUNK_DURATION = calculate_max_chunk_seconds(
            model_size, sample_rate, dtype_bytes, usable_vram_mb, chunk_duration
        )
        
        task_logger.info(
            "Memory budget | free_vram=%.0f MiB | model_in_dtype=%.0f MiB | est_total=%.0f MiB | dtype_bytes=%d | chunk_duration=%.1fs | device=%s",
            usable_vram_mb, model_vram_needed_mb, estimated_total_mb, dtype_bytes, CHUNK_DURATION, device,
            extra={"event": "task.memory_budget"},
        )
        
        # Forensic: update model deployment mode (after TP/dtype decision)
        forensic.log_event("task.deployment",
            tensor_parallel=use_tensor_parallel,
            dtype=str(dtype),
            device=device,
            dtype_bytes=dtype_bytes,
        )
        
        MAX_CHUNK_SAMPLES = int(sample_rate * CHUNK_DURATION)
        
        update_progress(30, "Loading audio...")
        
        # Load and preprocess audio
        task_logger.info("Loading input audio from %s", audio_file_path, extra={"event": "task.audio_load_start"})
        audio, orig_sr = torchaudio.load(str(audio_file_path))
        
        # Keep original audio at original sample rate for saving to output.
        # The model processes at 16kHz, but we want to save outputs at the
        # original sample rate so spectrograms show the full frequency axis
        # and before/after comparison is visually comparable.
        original_audio_for_save = audio.clone()
        
        if orig_sr != sample_rate:
            resampler = torchaudio.transforms.Resample(orig_sr, sample_rate)
            audio = resampler(audio)
        
        # Convert to mono if stereo
        if audio.shape[0] > 1:
            audio = audio.mean(dim=0, keepdim=True)
        
        # Also make the saved original mono
        if original_audio_for_save.shape[0] > 1:
            original_audio_for_save = original_audio_for_save.mean(dim=0, keepdim=True)
        
        # Build a resampler to convert model output (16kHz) back to original SR.
        # We will use this after inference to save at the original sample rate.
        resample_back_to_orig = None
        if orig_sr != sample_rate:
            resample_back_to_orig = torchaudio.transforms.Resample(sample_rate, orig_sr)
            task_logger.info(
                "Will resample outputs back to original SR | model_sr=%d | original_sr=%d",
                sample_rate, orig_sr,
                extra={"event": "task.resample_back_setup"},
            )
        
        # Calculate audio duration
        audio_duration = audio.shape[1] / sample_rate
        task_logger.info(
            "Audio loaded | sample_rate=%s | original_sample_rate=%s | duration=%.2fs | channels=%s | chunk_duration=%.1fs",
            sample_rate,
            orig_sr,
            audio_duration,
            audio.shape[0],
            CHUNK_DURATION,
            extra={"event": "task.audio_loaded"},
        )
        
        # Forensic: record audio input
        forensic.log_input(str(audio_file_path),
            duration_s=round(audio_duration, 3),
            original_sample_rate=orig_sr,
            target_sample_rate=sample_rate,
            channels=audio.shape[0],
            samples=audio.shape[1],
            file_size_bytes=audio_file_path.stat().st_size,
        )
        
        # Overlap for crossfade between chunks (1 second overlap on each side)
        OVERLAP_SAMPLES = int(sample_rate * 1.0)
        
        # Forensic: record chunk plan
        forensic.log_event("task.chunk_plan",
            chunk_duration_s=CHUNK_DURATION,
            max_chunk_samples=MAX_CHUNK_SAMPLES,
            overlap_samples=OVERLAP_SAMPLES,
            model_vram_mb=round(model_vram_mb, 1),
            dtype_bytes=dtype_bytes,
            usable_vram_mb=usable_vram_mb,
        )
        
        # ============================================
        # PER-CHUNK OFFLOAD INFERENCE
        # ============================================
        # Strategy: model lives on CPU. For each chunk:
        #   1. Move model to GPU
        #   2. Run inference
        #   3. Move model back to CPU
        #   4. Free GPU memory
        # This allows float32 on GPUs with limited VRAM.
        
        # Check if chunking is needed
        if audio.shape[1] > MAX_CHUNK_SAMPLES:
            task_logger.info(
                "Processing with overlap-add chunking + per-chunk offload | duration=%.2fs | chunk=%.1fs | overlap=%.1fs",
                audio_duration,
                CHUNK_DURATION,
                OVERLAP_SAMPLES / sample_rate,
                extra={"event": "task.chunk_mode"},
            )
            
            audio_tensor = audio.squeeze(0)  # Keep on CPU initially
            total_samples = audio_tensor.shape[-1]
            
            # Build overlapping chunk windows
            chunk_starts = list(range(0, total_samples, MAX_CHUNK_SAMPLES))
            total_chunks = len(chunk_starts)
            
            out_target = []
            out_residual = []
            
            # In tensor-parallel mode, enable once before chunk loop
            if use_tensor_parallel:
                task_logger.info(
                    "Enabling tensor parallelism for chunked processing",
                    extra={"event": "task.tp_enable"},
                )
                model = enable_tensor_parallel(model)
            
            for i, start in enumerate(chunk_starts):
                # Update progress
                chunk_progress = 30 + int((i / total_chunks) * 50)
                update_progress(chunk_progress, f"Processing chunk {i+1}/{total_chunks}...")
                
                # Calculate chunk boundaries with overlap context
                context_start = max(0, start - OVERLAP_SAMPLES) if i > 0 else start
                chunk_end = min(total_samples, start + MAX_CHUNK_SAMPLES)
                
                # Extract chunk with context (on CPU)
                chunk_cpu = audio_tensor[context_start:chunk_end]
                
                # Skip very short chunks
                if chunk_cpu.shape[-1] < sample_rate:
                    task_logger.warning("Skipping chunk %s because it is shorter than 1 second", i + 1, extra={"event": "task.chunk_skipped"})
                    continue
                
                if use_tensor_parallel:
                    # ---- Model is already split across GPU 0 + GPU 1 ----
                    forensic.snapshot_gpu(f"chunk_{i}_before_inference", device if "cuda" in device else "cuda:0")
                    chunk_t0 = time.time()
                    
                    # Prepare batch and move to primary device
                    batch = processor(
                        audios=[chunk_cpu.unsqueeze(0)],
                        descriptions=[description]
                    ).to(device)  # device = "cuda:1"
                    
                    with torch.inference_mode():
                        with torch.amp.autocast(device_type="cuda", enabled=True):
                            result = model.separate(
                                batch,
                                predict_spans=False,
                                reranking_candidates=1
                            )
                    
                    chunk_inference_time = time.time() - chunk_t0
                    
                    target_full = result.target[0].cpu()
                    residual_full = result.residual[0].cpu()
                    del batch, result
                else:
                    # ---- Per-chunk offload: move model to GPU for this chunk ----
                    model = move_model_to_device(model, device, dtype)
                    
                    forensic.snapshot_gpu(f"chunk_{i}_before_inference", device if "cuda" in device else "cuda:0")
                    chunk_t0 = time.time()
                    
                    batch = processor(
                        audios=[chunk_cpu.unsqueeze(0)],
                        descriptions=[description]
                    ).to(device)
                    
                    with torch.inference_mode():
                        with torch.amp.autocast(device_type="cuda" if "cuda" in device else "cpu", enabled=("cuda" in device)):
                            result = model.separate(
                                batch,
                                predict_spans=False,
                                reranking_candidates=1
                            )
                    
                    chunk_inference_time = time.time() - chunk_t0
                    
                    target_full = result.target[0].cpu()
                    residual_full = result.residual[0].cpu()
                    
                    del batch, result
                    model = move_model_to_cpu(model)
                    cleanup_gpu_memory()
                
                # Forensic: record chunk processing
                forensic.log_chunk(i,
                    chunk_start_sample=context_start,
                    chunk_end_sample=chunk_end,
                    chunk_samples=chunk_end - context_start,
                    chunk_duration_s=round((chunk_end - context_start) / sample_rate, 3),
                    inference_time_s=round(chunk_inference_time, 3),
                    has_crossfade=(i > 0),
                )
                forensic.snapshot_gpu(f"chunk_{i}_after_offload", device if "cuda" in device else "cuda:0")
                
                # Apply crossfade in the overlap region
                if i > 0:
                    context_len = start - context_start
                    
                    # Raised-cosine crossfade window
                    fade_in = torch.linspace(0, 1, context_len + 1)[:-1]
                    fade_out = 1.0 - fade_in
                    
                    prev_target = out_target[-1]
                    prev_residual = out_residual[-1]
                    
                    overlap_target_prev = prev_target[-context_len:]
                    overlap_residual_prev = prev_residual[-context_len:]
                    
                    overlap_target_new = target_full[:context_len]
                    overlap_residual_new = residual_full[:context_len]
                    
                    blended_target = overlap_target_prev * fade_out + overlap_target_new * fade_in
                    blended_residual = overlap_residual_prev * fade_out + overlap_residual_new * fade_in
                    
                    out_target[-1] = prev_target[:-context_len]
                    out_residual[-1] = prev_residual[:-context_len]
                    
                    target_full = torch.cat([blended_target, target_full[context_len:]])
                    residual_full = torch.cat([blended_residual, residual_full[context_len:]])
                
                out_target.append(target_full)
                out_residual.append(residual_full)
            
            # Concatenate all chunks
            target_audio = torch.cat(out_target, dim=-1).clamp(-1, 1).float().unsqueeze(0)
            residual_audio = torch.cat(out_residual, dim=-1).clamp(-1, 1).float().unsqueeze(0)
            
            # Ensure output length matches input length
            expected_len = audio.shape[1]
            for _name, _tensor in [('target_audio', target_audio), ('residual_audio', residual_audio)]:
                _len = _tensor.shape[-1]
                if _len > expected_len:
                    _tensor = _tensor[:, :expected_len]
                elif _len < expected_len:
                    _pad = torch.zeros(1, expected_len - _len)
                    _tensor = torch.cat([_tensor, _pad], dim=-1)
                if _name == 'target_audio':
                    target_audio = _tensor
                else:
                    residual_audio = _tensor
            
            del out_target, out_residual, audio_tensor
            
            # Disable tensor parallelism if enabled
            if use_tensor_parallel:
                model = disable_tensor_parallel(model)
            
        else:
            task_logger.info(
                "Processing as single batch | duration=%.2fs | input_path=%s",
                audio_duration,
                audio_file_path,
                extra={"event": "task.single_batch_mode"},
            )
            
            update_progress(50, "Running separation...")
            
            if use_tensor_parallel:
                # ---- Enable tensor parallelism: DiT layers split across GPU 0 + GPU 1 ----
                task_logger.info(
                    "Enabling tensor parallelism for single-batch inference",
                    extra={"event": "task.tp_enable"},
                )
                model = enable_tensor_parallel(model)
            else:
                # ---- Move model to single GPU for inference ----
                model = move_model_to_device(model, device, dtype)
            
            # Forensic: GPU state before single-batch inference
            forensic.snapshot_gpu("single_batch_before_inference", device if "cuda" in device else "cuda:0")
            
            batch_t0 = time.time()
            
            # Process entire audio at once
            batch = processor(
                audios=[audio],
                descriptions=[description]
            ).to(device)
            
            # Run separation
            with torch.inference_mode():
                with torch.amp.autocast(device_type="cuda", enabled=True):
                    result = model.separate(
                        batch,
                        predict_spans=False,
                        reranking_candidates=1
                    )
            
            target_audio = result.target[0].float().unsqueeze(0).cpu()
            residual_audio = result.residual[0].float().unsqueeze(0).cpu()
            
            batch_inference_time = time.time() - batch_t0
            
            del batch, result
            
            if use_tensor_parallel:
                # ---- Restore model to CPU ----
                model = disable_tensor_parallel(model)
            else:
                # ---- Move model back to CPU ----
                model = move_model_to_cpu(model)
                cleanup_gpu_memory()
            
            # Forensic: single batch result
            forensic.log_chunk(0,
                chunk_samples=audio.shape[1],
                chunk_duration_s=round(audio_duration, 3),
                inference_time_s=round(batch_inference_time, 3),
                mode="single_batch",
            )
            forensic.snapshot_gpu("single_batch_after_offload", device if "cuda" in device else "cuda:0")
        
        # ========== Model is already on CPU (per-chunk offload) ==========
        # Update the cache with CPU model
        cache_key = f"{model_name}_lite_cpu"
        _model_cache[cache_key] = model
        
        update_progress(80, "Saving results...")
        
        # Output paths
        output_base = OUTPUT_DIR / task_id
        original_path = output_base.with_suffix(".original.wav")
        ghost_path = output_base.with_suffix(".ghost.wav")
        clean_path = output_base.with_suffix(".clean.wav")
        
        # Save original audio at ORIGINAL sample rate (not model's 16kHz).
        # This ensures the spectrogram "before" shows full frequency content.
        torchaudio.save(str(original_path), original_audio_for_save.cpu(), orig_sr)
        
        # Resample model output back to original sample rate so spectrograms
        # for "after" have the same frequency axis as "before".
        # Note: content above 8kHz will be zero (model bandwidth is limited to 16kHz Nyquist),
        # but the frequency axis will match, making before/after comparison meaningful.
        if resample_back_to_orig is not None:
            target_audio = resample_back_to_orig(target_audio)
            residual_audio = resample_back_to_orig(residual_audio)
            output_sr = orig_sr
            task_logger.info(
                "Resampled outputs to original SR | output_sr=%d | target_shape=%s | residual_shape=%s",
                output_sr, list(target_audio.shape), list(residual_audio.shape),
                extra={"event": "task.output_resampled"},
            )
        else:
            output_sr = sample_rate
        
        # Save separated audio at original sample rate
        # SAM Audio always produces: target (matched to prompt) and residual (everything else)
        # mode="extract": user wants to ISOLATE the sound described by the prompt
        #   → ghost = target (isolated sound), clean = residual (remaining audio)
        # mode="remove": user wants to REMOVE the sound described by the prompt
        #   → ghost = target (removed sound, for reference), clean = residual (audio without the removed sound)
        # In both cases, the "clean" output is always the residual (what's left after separation).
        # The key difference is semantic: in "remove" mode, the prompt describes what to discard,
        # so residual is the desired clean output. In "extract" mode, the prompt describes what to keep,
        # so target is the desired isolated output.
        torchaudio.save(str(ghost_path), target_audio, output_sr)
        torchaudio.save(str(clean_path), residual_audio, output_sr)
        
        # Forensic: record output files
        forensic.log_output(
            original_path=str(original_path),
            ghost_path=str(ghost_path),
            clean_path=str(clean_path),
            original_size_bytes=original_path.stat().st_size if original_path.exists() else 0,
            ghost_size_bytes=ghost_path.stat().st_size if ghost_path.exists() else 0,
            clean_size_bytes=clean_path.stat().st_size if clean_path.exists() else 0,
            output_sample_rate=output_sr if 'output_sr' in dir() else sample_rate,
            original_input_sample_rate=orig_sr,
        )
        
        update_progress(100, "Complete!")
        
        # Aggressive cleanup
        task_logger.info("Cleaning up GPU memory", extra={"event": "task.cleanup_start"})
        del target_audio, residual_audio, audio
        
        gc.collect()
        cleanup_gpu_memory()
        
        if torch.cuda.is_available():
            task_logger.info(
                "GPU memory after cleanup: %.2f GB",
                torch.cuda.memory_allocated() / 1024**3,
                extra={"event": "task.cleanup_gpu"},
            )
        
        # Calculate processing time
        processing_time = time.time() - start_time
        task_logger.info(
            "Processing completed | processing_time=%.2fs | audio_duration=%.2fs | output_base=%s",
            processing_time,
            audio_duration,
            output_base,
            extra={"event": "task.completed"},
        )
        
        # Forensic: save audit trail
        forensic_log_path = forensic.save()
        task_logger.info(
            "Forensic log saved to %s | summary=%s",
            forensic_log_path,
            forensic.summary(),
            extra={"event": "task.forensic_saved"},
        )
        
        # Extract audio metadata from the original file for the user interface
        audio_metadata = {}
        try:
            import subprocess
            probe = subprocess.run(
                ["ffprobe", "-v", "quiet", "-print_format", "json", "-show_format", "-show_streams",
                 str(audio_file_path)],
                capture_output=True, text=True, timeout=10, check=True,
            )
            probe_data = json.loads(probe.stdout)
            streams = probe_data.get("streams", [])
            fmt = probe_data.get("format", {})
            audio_stream = next((s for s in streams if s.get("codec_type") == "audio"), None)
            if audio_stream:
                audio_metadata = {
                    "sample_rate": int(audio_stream.get("sample_rate", 0)),
                    "channels": int(audio_stream.get("channels", 0)),
                    "bit_depth": int(audio_stream.get("bits_per_sample", 0)),
                    "codec": audio_stream.get("codec_name", "unknown"),
                    "format": fmt.get("format_name", "unknown"),
                    "file_size_bytes": int(fmt.get("size", 0)),
                    "original_filename": original_filename or audio_file_path.name,
                }
        except Exception as meta_err:
            task_logger.warning(
                "Failed to extract audio metadata: %s", meta_err,
                extra={"event": "task.metadata_warn"},
            )
        
        result = {
            "original_path": str(original_path),
            "ghost_path": str(ghost_path),
            "clean_path": str(clean_path),
            "description": description,
            "mode": mode,
            "audio_duration": round(audio_duration, 2),
            "processing_time": round(processing_time, 2),
            "model_size": model_size,
            "audio_metadata": audio_metadata,
        }
        
        # Add video path if this was a video file
        if video_path is not None:
            output_video_path = OUTPUT_DIR / f"{task_id}.video{video_path.suffix}"
            result["video_path"] = str(output_video_path)
            result["is_video"] = True

        # Save metadata for history
        from datetime import datetime, timezone
        meta = {
            "task_id": task_id,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "description": description,
            "mode": mode,
            "model_size": model_size,
            "audio_duration": round(audio_duration, 2),
            "processing_time": round(processing_time, 2),
            "original_filename": original_filename,
            "upload_path": str(audio_file_path),
            "result": result,
        }
        meta_path = OUTPUT_DIR / f"{task_id}.meta.json"
        meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2))

        return result

        
    except Exception as e:
        # Forensic: record error (guard: forensic may not be initialized yet)
        try:
            forensic.log_error(str(e), traceback_str=traceback.format_exc())
            forensic.save()
        except:
            pass
        
        # On error, still try to offload model to free GPU
        try:
            if 'model' in dir() and model is not None:
                # Disable tensor parallelism first if enabled
                if getattr(model, '_tp_enabled', False):
                    try:
                        model = disable_tensor_parallel(model)
                    except:
                        # Fallback: move to CPU directly
                        model = model.cpu()
                else:
                    model = move_model_to_cpu(model)
                cache_key = f"facebook/sam-audio-{model_size}_lite_cpu"
                _model_cache[cache_key] = model
        except:
            pass
        
        gc.collect()
        cleanup_gpu_memory()
        task_logger.error(
            "Separation failed | error=%s\n%s",
            e,
            traceback.format_exc(),
            extra={"event": "task.failed"},
        )
        raise Exception(f"Separation failed: {str(e)}") from e



@celery_app.task(bind=True)
def match_pattern_task(
    self,
    audio_path: str,
    sample_path: str,
    threshold: float = 0.85,
    model_size: str = "base"
):
    """
    Find and remove sounds similar to a sample
    
    Args:
        audio_path: Path to input audio file
        sample_path: Path to sample audio file
        threshold: Similarity threshold (0-1)
        model_size: Model size (small/base/large)
    
    Returns:
        Dictionary with paths to output files and matched segments
    """
    # TODO: Implement pattern matching with CLAP embeddings
    # This is a placeholder for MVP v1.0
    
    update_progress(50, "Pattern matching not yet implemented in MVP")
    
    return {
        "status": "not_implemented",
        "message": "Pattern matching will be available in v1.1"
    }
