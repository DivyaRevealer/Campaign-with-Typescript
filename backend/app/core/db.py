"""Async database session management helpers."""

from contextlib import asynccontextmanager
from typing import AsyncGenerator, AsyncIterator

from sqlalchemy.exc import ResourceClosedError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import settings

engine = create_async_engine(
    settings.DATABASE_URL,
    pool_pre_ping=True,
    pool_size=settings.DB_POOL_SIZE,
    max_overflow=settings.DB_MAX_OVERFLOW,
    pool_timeout=settings.DB_POOL_TIMEOUT,
    pool_recycle=settings.DB_POOL_RECYCLE,
    isolation_level=settings.DB_ISOLATION_LEVEL,
    echo=settings.DEBUG,
)

SessionLocal = async_sessionmaker(bind=engine, expire_on_commit=False)


async def get_session() -> AsyncIterator[AsyncSession]:
    """FastAPI dependency that yields an async database session."""

    async with SessionLocal() as session:
        yield session


@asynccontextmanager
async def repeatable_read_transaction(session: AsyncSession) -> AsyncGenerator[AsyncSession, None]:
    """Run the enclosed block in a single DB transaction at REPEATABLE READ."""

    # NOTE:
    # ``AsyncSession.connection()`` is a coroutine that returns an ``AsyncConnection``
    # instance.  It cannot be used directly in an ``async with`` statement because
    # that would try to call ``__aenter__`` on the coroutine object itself, leading
    # to ``AttributeError: __aenter__`` (and "coroutine was never awaited" warnings).
    # Instead we explicitly await the coroutine and then manage the resulting
    # connection object's lifecycle manually.
    conn = await session.connection()
    try:
        prev_lock_wait = (
            await conn.exec_driver_sql("SELECT @@SESSION.innodb_lock_wait_timeout")
        ).scalar_one()
        prev_max_exec = (
            await conn.exec_driver_sql("SELECT @@SESSION.max_execution_time")
        ).scalar_one()

        await conn.exec_driver_sql(
            "SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ"
        )
        await conn.exec_driver_sql(
            f"SET SESSION innodb_lock_wait_timeout = {settings.INNODB_LOCK_WAIT_TIMEOUT_SEC}"
        )
        await conn.exec_driver_sql(
            f"SET SESSION MAX_EXECUTION_TIME = {settings.SELECT_MAX_EXECUTION_TIME_MS}"
        )

        if session.in_transaction():
            await session.rollback()

        try:
            async with session.begin():
                yield session
        finally:
            try:
                await conn.exec_driver_sql(
                    f"SET SESSION TRANSACTION ISOLATION LEVEL {settings.DB_ISOLATION_LEVEL}"
                )
                await conn.exec_driver_sql(
                    f"SET SESSION innodb_lock_wait_timeout = {int(prev_lock_wait)}"
                )
                await conn.exec_driver_sql(
                    f"SET SESSION MAX_EXECUTION_TIME = {int(prev_max_exec)}"
                )
            except ResourceClosedError:
                # The ORM may decide to close the dedicated connection as soon as the
                # transaction block finishes (for example after a retry-induced rollback).
                # When that happens the session-level overrides die with the connection,
                # so there is nothing left to reset and we can safely ignore the error.
                pass
    finally:
        await conn.close()