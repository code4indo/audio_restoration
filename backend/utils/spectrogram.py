"""
Server-side spectrogram computation with GPU acceleration.
Computes once, caches to disk, serves binary data to clients.

v2: Binary format now includes sample_rate for correct frequency axis.
    load_audio() prioritizes the original uploaded file (upload_path)
    for track="original", and uses soundfile for multi-format support.
"""
import struct
import time
from pathlib import Path
from typing import Optional

import numpy as np
import soundfile as sf

from logging_utils import get_logger

logger = get_logger("audioghost.backend.spectrogram", "spectrogram.log")

# Try importing torch for GPU acceleration
try:
    import torch
    HAS_TORCH = True
    DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
    if torch.cuda.is_available():
        logger.info(
            "GPU acceleration available | device=%s | count=%d",
            torch.cuda.get_device_name(0),
            torch.cuda.device_count(),
            extra={"event": "spectrogram.gpu_available"},
        )
    else:
        logger.info("GPU not available, using CPU.", extra={"event": "spectrogram.cpu_fallback"})
except ImportError:
    HAS_TORCH = False
    DEVICE = "cpu"
    logger.info("PyTorch not available, using NumPy.", extra={"event": "spectrogram.numpy_fallback"})

# Spectrogram parameters
FFT_SIZE = 2048
HOP_SIZE = FFT_SIZE // 4  # 75% overlap
MAX_TIME_FRAMES = 1000

# Cache file extension
CACHE_EXT = ".spectrogram.bin"

# Binary format version (v2 includes sample_rate in header)
BINARY_VERSION = 2


def _compute_spectrogram_gpu(audio: np.ndarray, sample_rate: int) -> np.ndarray:
    """Compute spectrogram using PyTorch on GPU."""
    # Convert to torch tensor and move to GPU
    tensor = torch.from_numpy(audio.astype(np.float32)).to(DEVICE)

    # Ensure 1D (if stereo, take mean)
    if tensor.dim() > 1:
        tensor = tensor.mean(dim=0)

    # torch.stft with center=True handles padding automatically
    window = torch.hann_window(FFT_SIZE, device=DEVICE)
    stft = torch.stft(
        tensor,
        n_fft=FFT_SIZE,
        hop_length=HOP_SIZE,
        win_length=FFT_SIZE,
        window=window,
        center=True,
        return_complex=True,
    )

    # stft shape: (freq_bins, time_frames) → (time, freq)
    mag = torch.abs(stft).T

    # Convert to dB: 20 * log10(mag + epsilon)
    eps = 1e-10
    db = 20 * torch.log10(mag + eps)

    # Normalize: -100dB to 0dB → 0 to 1
    normalized = torch.clamp((db + 100) / 100, 0, 1)

    return normalized.cpu().numpy().astype(np.float32)


def _compute_spectrogram_cpu(audio: np.ndarray, sample_rate: int) -> np.ndarray:
    """Compute spectrogram using NumPy/SciPy (CPU fallback)."""
    from scipy import signal as scipy_signal

    # Compute spectrogram using scipy
    _, _, Sxx = scipy_signal.spectrogram(
        audio,
        fs=sample_rate,
        window="hann",
        nperseg=FFT_SIZE,
        noverlap=FFT_SIZE - HOP_SIZE,
        mode="magnitude",
    )

    # Sxx shape: (freq_bins, time_frames) → transpose to (time, freq)
    Sxx = Sxx.T

    # Convert to dB
    eps = 1e-10
    db = 20 * np.log10(Sxx + eps)

    # Normalize
    normalized = np.clip((db + 100) / 100, 0, 1)

    return normalized


def compute_spectrogram(audio: np.ndarray, sample_rate: int) -> np.ndarray:
    """Compute normalized magnitude spectrogram (time × freq).
    
    Uses GPU (PyTorch CUDA) when available, falls back to CPU.
    """
    start = time.perf_counter()

    if HAS_TORCH and DEVICE == "cuda":
        result = _compute_spectrogram_gpu(audio, sample_rate)
        method = "gpu"
    else:
        result = _compute_spectrogram_cpu(audio, sample_rate)
        method = "cpu"

    # Downsample time frames if too many
    num_times = result.shape[0]
    if num_times > MAX_TIME_FRAMES:
        step = num_times / MAX_TIME_FRAMES
        indices = np.floor(np.arange(MAX_TIME_FRAMES) * step).astype(int)
        indices = np.clip(indices, 0, num_times - 1)
        result = result[indices, :]

    elapsed = time.perf_counter() - start
    logger.info(
        "Spectrogram computed | method=%s | shape=%s | audio_duration=%.1fs | elapsed=%.2fs",
        method,
        result.shape,
        len(audio) / sample_rate if sample_rate > 0 else 0,
        elapsed,
        extra={"event": "spectrogram.computed"},
    )

    return result.astype(np.float32)


def get_output_dir() -> Path:
    """Get the output directory relative to this file."""
    return Path(__file__).resolve().parent.parent / "outputs"


def get_cache_path(task_id: str, track: str = "original") -> Path:
    """Get the cache file path for a given task ID and track."""
    return get_output_dir() / f"{task_id}.{track}{CACHE_EXT}"


def _load_audio_with_soundfile(audio_path: Path) -> tuple[Optional[np.ndarray], int]:
    """Load audio using soundfile (supports WAV, FLAC, OGG, MP3, etc.).
    
    Returns (mono_float32_audio, sample_rate).
    Falls back to ffmpeg conversion if soundfile cannot read the format.
    """
    try:
        audio, sr = sf.read(str(audio_path), dtype='float32')
        logger.info(
            "Loaded audio with soundfile | path=%s | sr=%d | shape=%s | dtype=%s",
            audio_path, sr, audio.shape, audio.dtype,
            extra={"event": "spectrogram.soundfile_load"},
        )
    except Exception as sf_err:
        logger.warning(
            "soundfile failed for %s: %s — trying ffmpeg fallback",
            audio_path, sf_err,
            extra={"event": "spectrogram.soundfile_failed"},
        )
        # Fallback: use ffmpeg to convert to WAV in memory, then read with soundfile
        import subprocess
        import io
        try:
            proc = subprocess.run(
                ["ffmpeg", "-y", "-i", str(audio_path),
                 "-ac", "1",           # mono
                 "-ar", "44100",       # keep high sample rate for full spectrum
                 "-f", "wav",
                 "-acodec", "pcm_s16le",
                 "pipe:1"],
                capture_output=True, timeout=30, check=True,
            )
            audio, sr = sf.read(io.BytesIO(proc.stdout), dtype='float32')
            logger.info(
                "Loaded audio with ffmpeg fallback | path=%s | sr=%d | shape=%s",
                audio_path, sr, audio.shape,
                extra={"event": "spectrogram.ffmpeg_fallback"},
            )
        except Exception as ff_err:
            logger.error(
                "ffmpeg fallback also failed for %s: %s",
                audio_path, ff_err,
                extra={"event": "spectrogram.ffmpeg_failed"},
            )
            return None, 0

    # Convert to mono if multi-channel
    if audio.ndim > 1:
        audio = audio.mean(axis=1)

    return audio, sr


def load_audio(task_id: str, track: str = "original") -> tuple[Optional[np.ndarray], int]:
    """Load audio file for a given task from task result metadata.
    
    For track="original": Prioritizes the ORIGINAL uploaded file (upload_path)
    to display the true original spectrogram with full frequency content.
    Falls back to the resampled original.wav only if the upload file is missing.
    
    For other tracks (ghost/clean): Uses the processed output files as before.
    
    Args:
        task_id: The task identifier.
        track: Which track to load ("original", "ghost", or "clean").
    """
    import json

    meta_path = get_output_dir() / f"{task_id}.meta.json"
    if not meta_path.exists():
        logger.warning("Meta file not found | task_id=%s", task_id, extra={"event": "spectrogram.meta_not_found"})
        return None, 0

    try:
        meta = json.loads(meta_path.read_text())
    except Exception as e:
        logger.error("Failed to read meta | task_id=%s | error=%s", task_id, e, extra={"event": "spectrogram.meta_read_error"})
        return None, 0

    result = meta.get("result", meta)
    audio_path = None
    is_original_upload = False  # Track whether we're using the raw upload

    if track == "original":
        # ============================================================
        # PRIORITY FOR "original" TRACK:
        # 1. upload_path — the raw file uploaded by the user (FULL quality)
        # 2. original_path — the resampled/mono version saved by worker
        # 3. File scan fallback
        # ============================================================
        upload_path = meta.get("upload_path", "")
        if upload_path and Path(upload_path).exists():
            audio_path = Path(upload_path)
            is_original_upload = True
            logger.info(
                "Using ORIGINAL uploaded file for spectrogram | task_id=%s | path=%s",
                task_id, audio_path,
                extra={"event": "spectrogram.using_upload_path"},
            )
        
        if not audio_path:
            path_str = result.get("original_path", "")
            if path_str and Path(path_str).exists():
                audio_path = Path(path_str)
                logger.info(
                    "Upload file missing, using resampled original | task_id=%s | path=%s",
                    task_id, audio_path,
                    extra={"event": "spectrogram.using_original_path"},
                )
    else:
        # For ghost/clean tracks: use the processed output files
        path_str = result.get(f"{track}_path", "")
        if path_str and Path(path_str).exists():
            audio_path = Path(path_str)

        # Fallback: original upload path (shouldn't normally happen for ghost/clean)
        if not audio_path:
            upload_path = meta.get("upload_path", "")
            if upload_path and Path(upload_path).exists():
                audio_path = Path(upload_path)

        # Fallback: original output
        if not audio_path:
            path_str = result.get("original_path", "")
            if path_str and Path(path_str).exists():
                audio_path = Path(path_str)

    # Fallback: scan output directory for any matching file
    if not audio_path:
        for suffix in [track, "original"]:
            for ext in [".wav", ".mp3", ".flac", ".ogg", ".m4a", ".aac", ".wma"]:
                candidate = get_output_dir() / f"{task_id}.{suffix}{ext}"
                if candidate.exists():
                    audio_path = candidate
                    break
            if audio_path:
                break

    if not audio_path or not audio_path.exists():
        logger.warning("Audio file not found | task_id=%s | track=%s", task_id, track,
                       extra={"event": "spectrogram.audio_not_found"})
        return None, 0

    # Load audio using soundfile (supports WAV, FLAC, OGG, MP3, etc.)
    # Falls back to ffmpeg conversion for unsupported formats
    audio, sr = _load_audio_with_soundfile(audio_path)
    if audio is None:
        # Last resort: try scipy.io.wavfile (original method)
        try:
            from scipy.io import wavfile as wav_read
            sr, audio = wav_read.read(str(audio_path))
            # Convert to mono if stereo
            if audio.ndim > 1:
                audio = audio.mean(axis=1)
            # Normalize to float32 [-1, 1]
            if audio.dtype == np.int16:
                audio = audio.astype(np.float32) / 32768.0
            elif audio.dtype == np.int32:
                audio = audio.astype(np.float32) / 2147483648.0
            elif audio.dtype == np.uint8:
                audio = (audio.astype(np.float32) - 128) / 128.0
            else:
                audio = audio.astype(np.float32)
            logger.info(
                "Loaded audio with scipy fallback | path=%s | sr=%d",
                audio_path, sr,
                extra={"event": "spectrogram.scipy_fallback"},
            )
        except Exception as e:
            logger.error("All audio loading methods failed | path=%s | error=%s", audio_path, e,
                         extra={"event": "spectrogram.load_error"})
            return None, 0

    # Ensure float32
    if audio.dtype != np.float32:
        audio = audio.astype(np.float32)

    # Only apply peak normalization for ghost/clean tracks.
    # For the "original" track from the raw upload, we preserve the
    # actual amplitude levels so the spectrogram reflects the true
    # loudness of the original file — making before/after comparison
    # meaningful and not misleading.
    if not (track == "original" and is_original_upload):
        peak = np.max(np.abs(audio))
        if peak > 0:
            audio = audio / peak

    logger.info(
        "Audio loaded | task_id=%s | track=%s | path=%s | sr=%d | samples=%d | is_original_upload=%s | peak_norm=%s",
        task_id, track, audio_path, sr, len(audio), is_original_upload,
        not (track == "original" and is_original_upload),
        extra={"event": "spectrogram.audio_loaded"},
    )
    return audio, sr


def invalidate_spectrogram_cache(task_id: str, track: str = "original") -> bool:
    """Delete cached spectrogram file so it will be recomputed on next request.
    
    Useful when the source audio changes or when switching to the original
    upload file for the first time.
    """
    cache_path = get_cache_path(task_id, track)
    if cache_path.exists():
        try:
            cache_path.unlink()
            logger.info(
                "Spectrogram cache invalidated | task_id=%s | track=%s",
                task_id, track,
                extra={"event": "spectrogram.cache_invalidated"},
            )
            return True
        except Exception as e:
            logger.warning(
                "Failed to invalidate cache | task_id=%s | error=%s",
                task_id, e,
                extra={"event": "spectrogram.cache_invalidation_error"},
            )
    return False


def get_or_compute_spectrogram(task_id: str, track: str = "original") -> Optional[bytes]:
    """Get cached spectrogram or compute it. Returns binary data ready to send.
    
    Binary format v2:
        <int32 version=2><int32 num_times><int32 num_freqs><int32 sample_rate><float32 data...>
    
    v1 format (legacy, no longer written):
        <int32 num_times><int32 num_freqs><float32 data...>
    """
    cache_path = get_cache_path(task_id, track)

    # Return cached if exists
    if cache_path.exists():
        try:
            data = cache_path.read_bytes()
            logger.debug("Spectrogram cache hit | task_id=%s | size=%d", task_id, len(data),
                         extra={"event": "spectrogram.cache_hit"})
            return data
        except Exception as e:
            logger.warning("Cache read failed, recomputing | task_id=%s | error=%s", task_id, e,
                           extra={"event": "spectrogram.cache_read_error"})

    # Load audio
    audio, sr = load_audio(task_id, track)
    if audio is None:
        return None

    # Compute spectrogram
    try:
        spec = compute_spectrogram(audio, sr)
    except Exception as e:
        logger.error("Spectrogram computation failed | task_id=%s | error=%s", task_id, e,
                     extra={"event": "spectrogram.compute_error"})
        return None

    # Encode to binary v2:
    # <int32 version=2><int32 num_times><int32 num_freqs><int32 sample_rate><float32 data...>
    num_times, num_freqs = spec.shape
    header = struct.pack("<iiii", BINARY_VERSION, num_times, num_freqs, sr)
    body = spec.tobytes()  # float32 in row-major order
    payload = header + body

    # Cache to disk
    try:
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        cache_path.write_bytes(payload)
        logger.info("Spectrogram cached v2 | task_id=%s | shape=(%d,%d) | sr=%d | size=%d",
                     task_id, num_times, num_freqs, sr, len(payload),
                     extra={"event": "spectrogram.cached"})
    except Exception as e:
        logger.warning("Cache write failed | task_id=%s | error=%s", task_id, e,
                       extra={"event": "spectrogram.cache_write_error"})

    return payload
