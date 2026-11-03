"""Αυθεντικοποίηση: κωδικοί (PBKDF2), sessions με idle timeout, login throttle, FastAPI dependencies.

Τα sessions ζουν στη βάση (dbo.AppSessions) ώστε να δουλεύουν με πολλά uvicorn workers.
Idle timeout: αν περάσουν > IDLE_TIMEOUT_SECONDS χωρίς authenticated request, το session πεθαίνει.
"""
import hashlib
import hmac
import logging
import secrets
import threading
import time
from dataclasses import dataclass
from typing import Callable

from fastapi import Depends, Header, HTTPException

from user_store import connect_users_db

logger = logging.getLogger(__name__)

IDLE_TIMEOUT_SECONDS = 30 * 60
TOUCH_INTERVAL_SECONDS = 60  # πόσο συχνά γράφουμε LastSeen στη βάση
CACHE_TTL_SECONDS = 15  # πόσο θυμάται ένα process ότι ένα token είναι έγκυρο
PBKDF2_ITERATIONS = 600_000
MAX_FAILED_LOGINS = 5
LOGIN_LOCKOUT_SECONDS = 15 * 60

_DUMMY_SALT = bytes(16)


@dataclass(frozen=True)
class AuthUser:
    id: int
    username: str
    is_admin: bool


# ---- κωδικοί -------------------------------------------------------------------------

def hash_password(password: str) -> str:
    """PBKDF2-SHA256 με τυχαίο salt — ο κωδικός ΔΕΝ αποθηκεύεται ποτέ σε καθαρή μορφή."""
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PBKDF2_ITERATIONS)
    return f"pbkdf2_sha256${PBKDF2_ITERATIONS}${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str | None) -> bool:
    """Constant-time έλεγχος. Αν δεν υπάρχει hash κάνει ψεύτικο hashing ώστε ο χρόνος να μη δείχνει ποιοι χρήστες υπάρχουν."""
    try:
        scheme, iterations, salt_hex, digest_hex = (stored or "").split("$")
        if scheme != "pbkdf2_sha256":
            raise ValueError(scheme)
        salt, expected, rounds = bytes.fromhex(salt_hex), bytes.fromhex(digest_hex), int(iterations)
    except ValueError:
        hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), _DUMMY_SALT, PBKDF2_ITERATIONS)
        return False
    actual = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, rounds)
    return hmac.compare_digest(actual, expected)


# ---- throttle αποτυχημένων login ----------------------------------------------------------

class LoginThrottle:
    """Κλειδώνει ένα username μετά από max_failures αποτυχίες για lockout_seconds (ανά process)."""

    def __init__(
        self,
        max_failures: int = MAX_FAILED_LOGINS,
        lockout_seconds: int = LOGIN_LOCKOUT_SECONDS,
        clock: Callable[[], float] = time.monotonic,
    ):
        self._max_failures = max_failures
        self._lockout_seconds = lockout_seconds
        self._clock = clock
        self._failures: dict[str, int] = {}
        self._locked_until: dict[str, float] = {}
        self._lock = threading.Lock()

    def is_locked(self, key: str) -> bool:
        with self._lock:
            until = self._locked_until.get(key)
            if until is None:
                return False
            if self._clock() >= until:
                del self._locked_until[key]
                self._failures.pop(key, None)
                return False
            return True

    def record_failure(self, key: str) -> None:
        with self._lock:
            count = self._failures.get(key, 0) + 1
            self._failures[key] = count
            if count >= self._max_failures:
                self._locked_until[key] = self._clock() + self._lockout_seconds

    def reset(self, key: str) -> None:
        with self._lock:
            self._failures.pop(key, None)
            self._locked_until.pop(key, None)


login_throttle = LoginThrottle()


# ---- sessions ------------------------------------------------------------------------

def new_token() -> str:
    return secrets.token_urlsafe(32)


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


class _SessionCache:
    def __init__(self, ttl: float = CACHE_TTL_SECONDS, clock: Callable[[], float] = time.monotonic):
        self._ttl = ttl
        self._clock = clock
        self._items: dict[str, tuple[float, AuthUser]] = {}
        self._lock = threading.Lock()

    def get(self, key: str) -> AuthUser | None:
        with self._lock:
            item = self._items.get(key)
            if item is None:
                return None
            if self._clock() >= item[0]:
                del self._items[key]
                return None
            return item[1]

    def put(self, key: str, user: AuthUser) -> None:
        with self._lock:
            if len(self._items) > 1000:
                self._items.clear()
            self._items[key] = (self._clock() + self._ttl, user)

    def evict(self, key: str) -> None:
        with self._lock:
            self._items.pop(key, None)

    def clear(self) -> None:
        with self._lock:
            self._items.clear()


_session_cache = _SessionCache()


def create_session(conn, user_id: int) -> str:
    token = new_token()
    cur = conn.cursor()
    cur.execute("INSERT INTO dbo.AppSessions (TokenHash, UserId) VALUES (?, ?)", (token_hash(token), user_id))
    conn.commit()
    return token


def end_session(token: str) -> None:
    hashed = token_hash(token)
    _session_cache.evict(hashed)
    conn = connect_users_db()
    try:
        conn.cursor().execute("DELETE FROM dbo.AppSessions WHERE TokenHash = ?", (hashed,))
        conn.commit()
    finally:
        conn.close()


def end_user_sessions(conn, user_id: int) -> None:
    """Πετάει όλα τα sessions ενός χρήστη (reject/delete). Άλλα workers το βλέπουν μέσα σε CACHE_TTL_SECONDS."""
    conn.cursor().execute("DELETE FROM dbo.AppSessions WHERE UserId = ?", (user_id,))
    conn.commit()
    _session_cache.clear()


def lookup_session(token: str) -> AuthUser | None:
    """Γυρίζει τον χρήστη του token ή None αν δεν υπάρχει / έληξε (idle) / ο χρήστης δεν είναι active."""
    hashed = token_hash(token)
    cached = _session_cache.get(hashed)
    if cached is not None:
        return cached

    conn = connect_users_db()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT u.UserId, u.Username, u.IsAdmin, u.Status, DATEDIFF(SECOND, s.LastSeen, SYSUTCDATETIME()) "
            "FROM dbo.AppSessions s JOIN dbo.AppUsers u ON u.UserId = s.UserId WHERE s.TokenHash = ?",
            (hashed,),
        )
        row = cur.fetchone()
        if row is None:
            return None
        user_id, username, is_admin, status, idle_seconds = row
        if status != "active" or idle_seconds > IDLE_TIMEOUT_SECONDS:
            cur.execute("DELETE FROM dbo.AppSessions WHERE TokenHash = ?", (hashed,))
            conn.commit()
            return None
        if idle_seconds >= TOUCH_INTERVAL_SECONDS:
            cur.execute("UPDATE dbo.AppSessions SET LastSeen = SYSUTCDATETIME() WHERE TokenHash = ?", (hashed,))
            conn.commit()
        user = AuthUser(id=user_id, username=username, is_admin=bool(is_admin))
        _session_cache.put(hashed, user)
        return user
    finally:
        conn.close()


# ---- FastAPI dependencies ------------------------------------------------------------------

def require_user(authorization: str | None = Header(default=None)) -> AuthUser:
    scheme, _, token = (authorization or "").partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        user = lookup_session(token.strip())
    except Exception:
        # Fail closed: αν δεν μπορούμε να επαληθεύσουμε το session, δεν περνάει κανείς.
        logger.exception("Session lookup failed")
        raise HTTPException(status_code=503, detail="Authentication service unavailable")
    if user is None:
        raise HTTPException(status_code=401, detail="Session expired or invalid")
    return user


def require_admin(user: AuthUser = Depends(require_user)) -> AuthUser:
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="Admin access required")
    return user
