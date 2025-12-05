"""Security helpers for file handling and scanning."""

from __future__ import annotations

import os
import subprocess
import tempfile

from loguru import logger

from app.core.config import settings


def scan_file_for_viruses(raw_bytes: bytes) -> bool:
    """Scan uploaded content using Microsoft Defender's CLI.

    Writes the uploaded payload to a temporary file and executes MpCmdRun.exe
    with a custom scan of that file. Returns ``True`` when Defender reports no
    threats, ``False`` otherwise. Any unexpected failures are logged and treated
    as a failed scan to err on the side of safety.
    """

    tmp_path: str | None = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=".upload") as tmp:
            tmp.write(raw_bytes)
            tmp_path = tmp.name

        command = [
            settings.DEFENDER_MPCMDRUN_PATH,
            "-Scan",
            "-ScanType",
            "3",  # custom scan
            "-File",
            tmp_path,
        ]

        try:
            result = subprocess.run(
                command,
                capture_output=True,
                text=True,
                check=False,
                timeout=120,
            )
        except FileNotFoundError:
            logger.error("defender_scanner_missing", path=settings.DEFENDER_MPCMDRUN_PATH)
            return False
        except Exception as exc:  # pragma: no cover - defensive guard
            logger.exception("defender_scan_failed_to_start", exc=exc)
            return False

        logger.bind(
            returncode=result.returncode,
            stdout=result.stdout,
            stderr=result.stderr,
        ).debug("defender_scan_completed")

        return result.returncode == 0
    except Exception as exc:  # pragma: no cover - defensive guard
        logger.exception("defender_scan_exception", exc=exc)
        return False
    finally:
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except OSError:
                logger.warning("defender_scan_temp_cleanup_failed", path=tmp_path)
