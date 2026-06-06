"""
Celery Application Configuration
"""
from celery import Celery

celery_app = Celery(
    "audioghost",
    broker="redis://localhost:6379/0",
    backend="redis://localhost:6379/0",
    include=["workers.tasks"]
)

# Celery Configuration
celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    task_track_started=True,
    task_time_limit=3600,  # 1 hour max per task
    worker_prefetch_multiplier=1,  # Process one task at a time (GPU memory)
    result_expires=604800,  # Results expire after 7 days
)
