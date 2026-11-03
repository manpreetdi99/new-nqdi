import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

import auth
from auth import AuthUser, LoginThrottle, hash_password, require_admin, require_user, verify_password
from user_models import PasswordReset, UserCreate


def test_hash_password_never_contains_plaintext_and_is_salted():
    first, second = hash_password("correct horse"), hash_password("correct horse")
    assert "correct horse" not in first
    assert first != second


def test_verify_password_accepts_correct_and_rejects_wrong():
    stored = hash_password("correct horse")
    assert verify_password("correct horse", stored)
    assert not verify_password("wrong horse", stored)


@pytest.mark.parametrize("stored", [None, "", "garbage", "md5$1$00$00"])
def test_verify_password_rejects_missing_or_malformed_hash(stored):
    assert not verify_password("anything", stored)


def test_throttle_locks_after_max_failures_and_unlocks_after_lockout():
    now = [0.0]
    throttle = LoginThrottle(max_failures=3, lockout_seconds=60, clock=lambda: now[0])
    for _ in range(2):
        throttle.record_failure("bob")
    assert not throttle.is_locked("bob")
    throttle.record_failure("bob")
    assert throttle.is_locked("bob")
    now[0] = 61.0
    assert not throttle.is_locked("bob")


def test_throttle_reset_clears_failures():
    throttle = LoginThrottle(max_failures=2, lockout_seconds=60)
    throttle.record_failure("bob")
    throttle.reset("bob")
    throttle.record_failure("bob")
    assert not throttle.is_locked("bob")


def test_user_create_rejects_short_password_and_bad_username():
    with pytest.raises(ValueError):
        UserCreate(username="valid.name", password="short")
    with pytest.raises(ValueError):
        UserCreate(username="a b", password="long enough pw")


def test_password_reset_enforces_the_same_length_rules():
    assert PasswordReset(password="long enough pw").password == "long enough pw"
    with pytest.raises(ValueError):
        PasswordReset(password="short")
    with pytest.raises(ValueError):
        PasswordReset(password="x" * 129)


def _client():
    app = FastAPI()

    @app.get("/me")
    def me(user: AuthUser = Depends(require_user)):
        return {"u": user.username}

    @app.get("/admin")
    def admin(user: AuthUser = Depends(require_admin)):
        return {"u": user.username}

    return TestClient(app)


def test_require_user_rejects_missing_and_malformed_header():
    client = _client()
    assert client.get("/me").status_code == 401
    assert client.get("/me", headers={"Authorization": "Basic abc"}).status_code == 401


def test_require_user_rejects_unknown_or_expired_token(monkeypatch):
    monkeypatch.setattr(auth, "lookup_session", lambda token: None)
    assert _client().get("/me", headers={"Authorization": "Bearer nope"}).status_code == 401


def test_require_user_fails_closed_when_lookup_errors(monkeypatch):
    def boom(token):
        raise RuntimeError("db down")

    monkeypatch.setattr(auth, "lookup_session", boom)
    assert _client().get("/me", headers={"Authorization": "Bearer x"}).status_code == 503


def test_require_admin_forbids_regular_user_and_allows_admin(monkeypatch):
    monkeypatch.setattr(auth, "lookup_session", lambda token: AuthUser(1, "bob", False))
    assert _client().get("/admin", headers={"Authorization": "Bearer x"}).status_code == 403
    monkeypatch.setattr(auth, "lookup_session", lambda token: AuthUser(2, "root", True))
    response = _client().get("/admin", headers={"Authorization": "Bearer x"})
    assert response.status_code == 200 and response.json() == {"u": "root"}
