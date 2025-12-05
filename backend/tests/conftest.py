import os
import sys
from pathlib import Path

import pytest

# Ensure required environment variables are present before settings import
os.environ.setdefault("SECRET_KEY", "test-secret")

# Add the backend directory so `app` package imports resolve during tests
BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.append(str(BACKEND_DIR))

TESTS_DIR = Path(__file__).resolve().parent
if str(TESTS_DIR) not in sys.path:
    sys.path.insert(0, str(TESTS_DIR))


@pytest.fixture
def anyio_backend():
    return "asyncio"
