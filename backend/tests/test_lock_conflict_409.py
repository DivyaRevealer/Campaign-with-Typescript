import pytest
from fastapi import HTTPException
from sqlalchemy.exc import OperationalError

from app.core.db_errors import raise_on_lock_conflict


class DummyOrig(Exception):
    def __init__(self, code: int, message: str):
        super().__init__(message)
        self.sqlstate = None
        self.args = (code, message)


@pytest.mark.anyio
async def test_lock_conflict_translates_to_http_409():
    exc = OperationalError("stmt", {}, DummyOrig(3572, "could not obtain lock"))
    with pytest.raises(HTTPException) as ctx:
        raise_on_lock_conflict(exc)
    assert ctx.value.status_code == 409
    assert "locked" in ctx.value.detail


@pytest.mark.anyio
async def test_non_lock_error_is_re_raised():
    exc = OperationalError("stmt", {}, DummyOrig(9999, "some other error"))
    with pytest.raises(OperationalError):
        raise_on_lock_conflict(exc)
