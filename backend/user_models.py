"""Request models + validation για χρήστες (κοινά για εγγραφή και admin προσθήκη)."""
import re

from pydantic import BaseModel, field_validator

MIN_PASSWORD_LEN = 8
MAX_PASSWORD_LEN = 128

_USERNAME_RE = re.compile(r"^[A-Za-z0-9._-]{3,50}$")
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _check_password_length(v: str) -> str:
    if not MIN_PASSWORD_LEN <= len(v) <= MAX_PASSWORD_LEN:
        raise ValueError(f"Password: {MIN_PASSWORD_LEN}-{MAX_PASSWORD_LEN} χαρακτήρες")
    return v


class PasswordReset(BaseModel):
    password: str

    @field_validator("password")
    @classmethod
    def _password(cls, v: str) -> str:
        return _check_password_length(v)


class UserCreate(BaseModel):
    username: str
    password: str
    full_name: str | None = None
    email: str | None = None

    @field_validator("password")
    @classmethod
    def _password(cls, v: str) -> str:
        return _check_password_length(v)

    @field_validator("username")
    @classmethod
    def _username(cls, v: str) -> str:
        v = v.strip()
        if not _USERNAME_RE.match(v):
            raise ValueError("Username: 3-50 χαρακτήρες (γράμματα, αριθμοί, . _ -)")
        return v

    @field_validator("full_name")
    @classmethod
    def _full_name(cls, v: str | None) -> str | None:
        v = (v or "").strip()
        if len(v) > 200:
            raise ValueError("Full name: έως 200 χαρακτήρες")
        return v or None

    @field_validator("email")
    @classmethod
    def _email(cls, v: str | None) -> str | None:
        v = (v or "").strip()
        if not v:
            return None
        if len(v) > 255 or not _EMAIL_RE.match(v):
            raise ValueError("Email: μη έγκυρη διεύθυνση")
        return v


class LoginRequest(BaseModel):
    username: str
    password: str

    @field_validator("username", "password")
    @classmethod
    def _bounded(cls, v: str) -> str:
        # Όριο μήκους ώστε να μην κοστίζει το PBKDF2 σε τεράστια inputs.
        if len(v) > MAX_PASSWORD_LEN:
            raise ValueError("Too long")
        return v
