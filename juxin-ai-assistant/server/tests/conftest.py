import os

import pytest


os.environ.setdefault("AUTH_DEV_BYPASS", "true")


@pytest.fixture
def client():
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as value:
        yield value
