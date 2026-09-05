"""Async workers (spec §64 Jobs, §65 document pipeline, §40.2 retention).

Handlers register themselves with `app.workers.queue.HANDLERS` on import; the Celery
entry point is `app.workers.queue.run_job`, and `registered_jobs()` lists everything
available. Start a worker with:

    celery -A app.workers.queue:get_celery worker -Q documents,evaluation,mining,maintenance
    celery -A app.workers.queue:get_celery beat
"""

from app.workers.queue import (
    HANDLERS,
    InlineQueue,
    JobContext,
    JobQueue,
    JobRetry,
    get_queue,
    job,
    registered_jobs,
    run_handler,
    set_queue,
)

__all__ = [
    "HANDLERS",
    "InlineQueue",
    "JobContext",
    "JobQueue",
    "JobRetry",
    "get_queue",
    "job",
    "registered_jobs",
    "run_handler",
    "set_queue",
]
