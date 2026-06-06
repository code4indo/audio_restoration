"""Logging utilities for AudioGhost backend and workers."""

from __future__ import annotations

import logging
from logging.handlers import RotatingFileHandler
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent
LOG_DIR = BASE_DIR / "logs"
LOG_DIR.mkdir(exist_ok=True)

LOG_FORMAT = (
    "%(asctime)s | %(levelname)s | %(name)s | task_id=%(task_id)s | "
    "event=%(event)s | %(message)s"
)


class DefaultContextFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        if not hasattr(record, "task_id"):
            record.task_id = "-"
        if not hasattr(record, "event"):
            record.event = "general"
        return True


def _build_handler(log_path: Path) -> RotatingFileHandler:
    handler = RotatingFileHandler(log_path, maxBytes=5 * 1024 * 1024, backupCount=5)
    handler.setFormatter(logging.Formatter(LOG_FORMAT))
    handler.addFilter(DefaultContextFilter())
    return handler


def get_logger(name: str, log_filename: str = "backend.log") -> logging.Logger:
    logger = logging.getLogger(name)
    if logger.handlers:
        return logger

    logger.setLevel(logging.INFO)
    logger.propagate = False

    file_handler = _build_handler(LOG_DIR / log_filename)

    console_handler = logging.StreamHandler()
    console_handler.setFormatter(logging.Formatter(LOG_FORMAT))
    console_handler.addFilter(DefaultContextFilter())

    logger.addHandler(file_handler)
    logger.addHandler(console_handler)
    return logger


def with_task(logger: logging.Logger, task_id: str):
    return logging.LoggerAdapter(logger, {"task_id": task_id})