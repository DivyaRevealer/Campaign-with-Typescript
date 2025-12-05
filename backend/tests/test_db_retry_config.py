import pytest
from sqlalchemy.exc import OperationalError

from app.core.config import settings
from app.core.db_retry import with_db_retry


class DummyOrig(Exception):
    def __init__(self, code: int, message: str, sqlstate: str | None = None):
        super().__init__(message)
        self.sqlstate = sqlstate
        self.args = (code, message)


class DummySession:
    def __init__(self):
        self.rollback_calls = 0

    async def rollback(self):
        self.rollback_calls += 1


@pytest.mark.anyio
async def test_db_retry_respects_config(monkeypatch):
    monkeypatch.setattr(settings, "DB_RETRY_ATTEMPTS", 2)
    monkeypatch.setattr(settings, "DB_RETRY_BASE_DELAY", 0.0)
    monkeypatch.setattr(settings, "DB_RETRY_JITTER", 0.0)
    monkeypatch.setattr(settings, "DB_NOWAIT_LOCKS", True)

    session = DummySession()
    calls = {"count": 0}

    async def flaky_operation():
        calls["count"] += 1
        if calls["count"] == 1:
            raise OperationalError("stmt", {}, DummyOrig(1213, "deadlock"))
        return "ok"

    result = await with_db_retry(session, flaky_operation)

    assert result == "ok"
    assert calls["count"] == 2
    assert session.rollback_calls == 1


@pytest.mark.anyio
async def test_nowait_lock_conflict_not_retried(monkeypatch):
    monkeypatch.setattr(settings, "DB_RETRY_ATTEMPTS", 2)
    monkeypatch.setattr(settings, "DB_RETRY_BASE_DELAY", 0.0)
    monkeypatch.setattr(settings, "DB_RETRY_JITTER", 0.0)
    monkeypatch.setattr(settings, "DB_NOWAIT_LOCKS", True)

    session = DummySession()
    calls = {"count": 0}

    async def nowait_operation():
        calls["count"] += 1
        raise OperationalError("stmt", {}, DummyOrig(3572, "could not obtain lock"))

    with pytest.raises(OperationalError):
        await with_db_retry(session, nowait_operation)

    assert calls["count"] == 1
    assert session.rollback_calls == 0
