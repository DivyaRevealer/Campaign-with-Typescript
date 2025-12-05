"""Concurrency helpers for controlling background thread usage."""

from __future__ import annotations

from typing import Any, Callable

import anyio

from app.core.config import settings

_excel_sem = anyio.Semaphore(settings.EXCEL_MAX_CONCURRENCY)
_security_sem = anyio.Semaphore(getattr(settings, "SECURITY_MAX_CONCURRENCY", 4))


async def run_in_thread_limited(func: Callable[..., Any], *args: Any, **kwargs: Any):
    """Run a sync callable in a worker thread with bounded concurrency."""

    async with _excel_sem:
        return await anyio.to_thread.run_sync(func, *args, **kwargs)


async def run_in_thread_security(func: Callable[..., Any], *args: Any, **kwargs: Any):
    async with _security_sem:
        return await anyio.to_thread.run_sync(func, *args, **kwargs)
