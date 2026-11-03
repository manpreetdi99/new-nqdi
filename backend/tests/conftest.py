import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

DB_NAME = os.getenv("NQDI_TEST_DB", "DOD_26H2")


@pytest.fixture(scope="session")
def db_name():
    """Βάση για τα @pytest.mark.db tests. Skip αν δεν είναι προσβάσιμη."""
    from db import get_connection
    try:
        get_connection(DB_NAME).close()
    except Exception as e:  # εξαρτάται από το δίκτυο
        pytest.skip(f"Database {DB_NAME} not reachable: {e}")
    return DB_NAME


@pytest.fixture(scope="session")
def client():
    from fastapi.testclient import TestClient
    from app import app
    from auth import AuthUser, require_user

    # Τα DB tests ελέγχουν τα data endpoints, όχι το login: παρακάμπτουμε μόνο το session check.
    app.dependency_overrides[require_user] = lambda: AuthUser(id=0, username="pytest", is_admin=True)
    yield TestClient(app)
    app.dependency_overrides.clear()
