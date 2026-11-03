"""Login / αίτημα εγγραφής / logout / heartbeat.

Νέος υπολογιστής → ο χρήστης κάνει login ή στέλνει αίτημα εγγραφής (status 'pending').
Ένας admin το εγκρίνει από τη σελίδα Users· μέχρι τότε το login απορρίπτεται.
"""
import logging

import pyodbc
from fastapi import APIRouter, Depends, Header, HTTPException

from auth import (
    AuthUser,
    create_session,
    end_session,
    hash_password,
    login_throttle,
    require_user,
    verify_password,
)
from user_models import LoginRequest, UserCreate
from user_store import connect_users_db

logger = logging.getLogger(__name__)
router = APIRouter(tags=["auth"])

MAX_PENDING_REQUESTS = 200


def _server_error(exc: Exception) -> HTTPException:
    logger.exception("Auth database error", exc_info=exc)
    return HTTPException(status_code=500, detail="Server error. Check that the users database is reachable.")


@router.post("/api/auth/register", status_code=201)
def register(req: UserCreate):
    conn = None
    try:
        conn = connect_users_db()
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) FROM dbo.AppUsers WHERE Status = 'pending'")
        if cur.fetchone()[0] >= MAX_PENDING_REQUESTS:
            raise HTTPException(status_code=429, detail="Too many pending requests. Contact an administrator.")
        cur.execute(
            "INSERT INTO dbo.AppUsers (Username, FullName, Email, PasswordHash, Status) VALUES (?, ?, ?, ?, 'pending')",
            (req.username, req.full_name, req.email, hash_password(req.password)),
        )
        conn.commit()
        return {"status": "pending"}
    except HTTPException:
        raise
    except pyodbc.IntegrityError:
        raise HTTPException(status_code=409, detail="This username is already taken")
    except Exception as exc:
        raise _server_error(exc)
    finally:
        if conn:
            conn.close()


@router.post("/api/auth/login")
def login(req: LoginRequest):
    username = req.username.strip()
    throttle_key = username.lower()
    if login_throttle.is_locked(throttle_key):
        raise HTTPException(status_code=429, detail="Too many failed attempts. Try again in 15 minutes.")

    conn = None
    try:
        conn = connect_users_db()
        cur = conn.cursor()
        cur.execute(
            "SELECT UserId, Username, IsAdmin, Status, PasswordHash FROM dbo.AppUsers WHERE Username = ?",
            (username,),
        )
        row = cur.fetchone()
        password_ok = verify_password(req.password, row[4] if row else None)
        if row is None or not password_ok:
            login_throttle.record_failure(throttle_key)
            raise HTTPException(status_code=401, detail="Invalid username or password")

        login_throttle.reset(throttle_key)
        user_id, name, is_admin, status, _ = row
        if status == "pending":
            raise HTTPException(status_code=403, detail="Your registration is waiting for admin approval.")
        if status != "active":
            raise HTTPException(status_code=403, detail="Your registration request was declined.")

        token = create_session(conn, user_id)
        return {"token": token, "user": {"id": user_id, "username": name, "is_admin": bool(is_admin)}}
    except HTTPException:
        raise
    except Exception as exc:
        raise _server_error(exc)
    finally:
        if conn:
            conn.close()


@router.post("/api/auth/logout")
def logout(authorization: str | None = Header(default=None)):
    """Ανεκτικό: αν το token δεν υπάρχει ήδη, δεν υπάρχει τίποτα να σβηστεί."""
    _, _, token = (authorization or "").partition(" ")
    if token:
        try:
            end_session(token.strip())
        except Exception as exc:
            raise _server_error(exc)
    return {"ok": True}


@router.get("/api/auth/me")
def me(user: AuthUser = Depends(require_user)):
    return {"id": user.id, "username": user.username, "is_admin": user.is_admin}


@router.post("/api/auth/ping")
def ping(user: AuthUser = Depends(require_user)):
    """Heartbeat από ενεργό χρήστη — το ίδιο το authenticated request ανανεώνει το idle timer."""
    return {"ok": True}
