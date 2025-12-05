"""Application logging configuration helpers."""

from __future__ import annotations

import logging
from contextvars import ContextVar
from sys import stdout
from typing import Any

from loguru import logger

request_id_ctx_var: ContextVar[str] = ContextVar("request_id", default="-")
user_code_ctx_var: ContextVar[str] = ContextVar("user_code", default="-")


def _patch_record(record: dict[str, Any]) -> None:
    record["extra"].setdefault("request_id", request_id_ctx_var.get())
    record["extra"].setdefault("user_code", user_code_ctx_var.get())


def setup_logging() -> None:
    """Configure the standard logging module and Loguru sinks."""

    logging.basicConfig(level=logging.INFO)
    logging.getLogger("passlib.handlers.bcrypt").setLevel(logging.ERROR)
    logger.remove()
    logger.configure(patcher=_patch_record)
    logger.add(
        stdout,
        level="INFO",
        enqueue=True,
        backtrace=False,
        diagnose=False,
        serialize=True,
    )
