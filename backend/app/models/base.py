"""Shared declarative base for all ORM models.

Having a single ``Base`` class keeps the SQLAlchemy metadata in one place
so that Alembic migrations and metadata operations (such as creating tables
for tests) work consistently across the application.
"""

from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    """Base class for all SQLAlchemy ORM models."""

    pass