"""Σελίδα User Management (μόνο admin): λίστα, αιτήματα εγγραφής (approve/reject), προσθήκη, διαγραφή.

Οι πίνακες ζουν στη βάση USERS_DB (βλ. user_store.py) — ΟΧΙ σε βάση δεδομένων drive-test.
"""
import logging

import pyodbc
from fastapi import APIRouter, Depends, HTTPException

from auth import AuthUser, end_user_sessions, hash_password, require_admin
from user_models import PasswordReset, UserCreate
from user_store import connect_users_db

logger = logging.getLogger(__name__)
router = APIRouter(tags=["users"], dependencies=[Depends(require_admin)])

_COLUMNS = ("UserId", "Username", "FullName", "Email", "CreatedAt", "IsAdmin", "Status")
_SELECT_COLUMNS = ", ".join(_COLUMNS)
_OUTPUT_COLUMNS = ", ".join(f"INSERTED.{c}" for c in _COLUMNS)


def _serialize(row) -> dict:
    return {
        "id": row[0],
        "username": row[1],
        "full_name": row[2],
        "email": row[3],
        "created_at": row[4].isoformat() if row[4] else None,
        "is_admin": bool(row[5]),
        "status": row[6],
    }


def _server_error(exc: Exception) -> HTTPException:
    logger.exception("Users database error", exc_info=exc)
    return HTTPException(status_code=500, detail=f"Database error: {exc}")


@router.get("/api/users")
def list_users():
    conn = None
    try:
        conn = connect_users_db()
        cur = conn.cursor()
        cur.execute(f"SELECT {_SELECT_COLUMNS} FROM dbo.AppUsers ORDER BY Username")
        return {"users": [_serialize(r) for r in cur.fetchall()]}
    except Exception as exc:
        raise _server_error(exc)
    finally:
        if conn:
            conn.close()


@router.post("/api/users", status_code=201)
def create_user(req: UserCreate):
    """Άμεση προσθήκη από admin: ο χρήστης είναι αμέσως active (χωρίς αίτημα)."""
    conn = None
    try:
        conn = connect_users_db()
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO dbo.AppUsers (Username, FullName, Email, PasswordHash, Status) "
            f"OUTPUT {_OUTPUT_COLUMNS} VALUES (?, ?, ?, ?, 'active')",
            (req.username, req.full_name, req.email, hash_password(req.password)),
        )
        row = cur.fetchone()
        conn.commit()
        return _serialize(row)
    except pyodbc.IntegrityError:
        raise HTTPException(status_code=409, detail=f"Ο χρήστης '{req.username}' υπάρχει ήδη")
    except Exception as exc:
        raise _server_error(exc)
    finally:
        if conn:
            conn.close()


def _set_pending_status(user_id: int, new_status: str) -> dict:
    """Αλλάζει status ΜΟΝΟ σε αιτήματα που περιμένουν — ώστε ένα διπλό κλικ να μην αναιρεί προηγούμενη απόφαση."""
    conn = None
    try:
        conn = connect_users_db()
        cur = conn.cursor()
        cur.execute(
            f"UPDATE dbo.AppUsers SET Status = ? OUTPUT {_OUTPUT_COLUMNS} WHERE UserId = ? AND Status = 'pending'",
            (new_status, user_id),
        )
        row = cur.fetchone()
        conn.commit()
        if row is None:
            raise HTTPException(status_code=404, detail="No pending request found for this user")
        return _serialize(row)
    except HTTPException:
        raise
    except Exception as exc:
        raise _server_error(exc)
    finally:
        if conn:
            conn.close()


@router.post("/api/users/{user_id}/approve")
def approve_user(user_id: int):
    return _set_pending_status(user_id, "active")


@router.post("/api/users/{user_id}/reject")
def reject_user(user_id: int):
    return _set_pending_status(user_id, "rejected")


@router.post("/api/users/{user_id}/password")
def reset_password(user_id: int, req: PasswordReset, admin: AuthUser = Depends(require_admin)):
    """Admin ορίζει νέο κωδικό. Τα sessions του χρήστη λήγουν (ξανακάνει login)· του ίδιου του admin μένει ανοιχτό."""
    conn = None
    try:
        conn = connect_users_db()
        cur = conn.cursor()
        cur.execute("UPDATE dbo.AppUsers SET PasswordHash = ? WHERE UserId = ?", (hash_password(req.password), user_id))
        updated = cur.rowcount
        conn.commit()
        if updated and user_id != admin.id:
            end_user_sessions(conn, user_id)
    except Exception as exc:
        raise _server_error(exc)
    finally:
        if conn:
            conn.close()
    if not updated:
        raise HTTPException(status_code=404, detail="Ο χρήστης δεν βρέθηκε")
    return {"updated": user_id}


@router.delete("/api/users/{user_id}")
def delete_user(user_id: int, admin: AuthUser = Depends(require_admin)):
    if user_id == admin.id:
        raise HTTPException(status_code=400, detail="You cannot delete your own account")
    conn = None
    try:
        conn = connect_users_db()
        cur = conn.cursor()
        end_user_sessions(conn, user_id)
        cur.execute("DELETE FROM dbo.AppUsers WHERE UserId = ?", (user_id,))
        deleted = cur.rowcount
        conn.commit()
    except Exception as exc:
        raise _server_error(exc)
    finally:
        if conn:
            conn.close()
    if not deleted:
        raise HTTPException(status_code=404, detail="Ο χρήστης δεν βρέθηκε")
    return {"deleted": user_id}
