"""
auth.py — signup/login logic, password hashing, and JWT issuing.

The core rule this file enforces: nobody sees the dashboard unless they
signed up with a govt ID that exists in `verified_employees` (the DB
already blocks this at the foreign-key level — see 01_schema.sql — this
file just turns that DB error into a friendly message and issues a
token once the check passes).
"""
import os
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from fastapi import HTTPException, Header, status
from mysql.connector import IntegrityError

from database import get_cursor

JWT_SECRET = os.getenv("JWT_SECRET", "dev-secret-change-me")
JWT_ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")
JWT_EXPIRES_MINUTES = int(os.getenv("JWT_EXPIRES_MINUTES", "480"))

# Using the `bcrypt` library directly (not passlib) — passlib 1.7.x has a
# known incompatibility with bcrypt 4.1+/5.x that raises a spurious
# "password cannot be longer than 72 bytes" error on the very first hash.
# bcrypt itself has no such issue, so we skip the middleman.
_BCRYPT_MAX_BYTES = 72  # bcrypt's real, hard limit — not a passlib bug


def hash_password(plain: str) -> str:
    truncated = plain.encode("utf-8")[:_BCRYPT_MAX_BYTES]
    return bcrypt.hashpw(truncated, bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    truncated = plain.encode("utf-8")[:_BCRYPT_MAX_BYTES]
    return bcrypt.checkpw(truncated, hashed.encode("utf-8"))


def create_access_token(user_id: int, email: str, role: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=JWT_EXPIRES_MINUTES)
    payload = {"sub": str(user_id), "email": email, "role": role, "exp": expire}
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def decode_access_token(token: str) -> dict:
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Session expired, please log in again.")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid session token.")


def get_current_user(authorization: str = Header(default=None)) -> dict:
    """FastAPI dependency: reads the 'Authorization: Bearer <token>' header."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing or malformed Authorization header.")
    token = authorization.split(" ", 1)[1]
    payload = decode_access_token(token)
    return payload  # {"sub": user_id, "email": ..., "role": ...}


def require_verified_role(user: dict = None):
    """Extra guard for endpoints only a verified field-incharge/admin should hit."""
    if user["role"] not in ("field_officer", "admin"):
        raise HTTPException(
            status_code=403,
            detail="Your account is pending Govt verification. You'll get dashboard access once approved.",
        )


def signup_user(full_name: str, email: str, password: str, job_title: str, govt_id_number: str) -> dict:
    password_hash = hash_password(password)

    # Look up whether this govt ID is a real, active entry first — lets us
    # give a clear error message instead of a raw DB foreign-key failure.
    with get_cursor() as cur:
        cur.execute(
            "SELECT full_name, department, designation, is_active FROM verified_employees WHERE govt_id_number = %s",
            (govt_id_number,),
        )
        gov_row = cur.fetchone()

    if not gov_row:
        raise HTTPException(
            status_code=400,
            detail="That Govt/Employee ID isn't recognized. You must be a registered government "
                   "employee or an assigned field-incharge to create an account.",
        )
    if not gov_row["is_active"]:
        raise HTTPException(status_code=400, detail="That Govt/Employee ID has been deactivated. Contact your department admin.")

    role = "field_officer"  # matched a whitelisted govt ID -> auto-approved
    is_verified = True

    try:
        with get_cursor(commit=True) as cur:
            cur.execute(
                """INSERT INTO users (full_name, email, password_hash, job_title, govt_id_number, role, is_verified)
                   VALUES (%s, %s, %s, %s, %s, %s, %s)""",
                (full_name, email, password_hash, job_title, govt_id_number, role, is_verified),
            )
            user_id = cur.lastrowid
    except IntegrityError as e:
        if "email" in str(e).lower():
            raise HTTPException(status_code=400, detail="An account with that email already exists.")
        if "govt_id_number" in str(e).lower():
            raise HTTPException(status_code=400, detail="That Govt/Employee ID is already registered to another account.")
        raise HTTPException(status_code=400, detail="Could not create account — check your details and try again.")

    token = create_access_token(user_id, email, role)
    return {"token": token, "user_id": user_id, "role": role, "full_name": full_name}


def login_user(email: str, password: str) -> dict:
    with get_cursor() as cur:
        cur.execute(
            "SELECT user_id, full_name, password_hash, role, is_verified FROM users WHERE email = %s",
            (email,),
        )
        row = cur.fetchone()

    if not row or not verify_password(password, row["password_hash"]):
        raise HTTPException(status_code=401, detail="Incorrect email or password.")

    if not row["is_verified"]:
        raise HTTPException(status_code=403, detail="Your account is awaiting Govt verification.")

    with get_cursor(commit=True) as cur:
        cur.execute("UPDATE users SET last_login_at = NOW() WHERE user_id = %s", (row["user_id"],))

    token = create_access_token(row["user_id"], email, row["role"])
    return {"token": token, "user_id": row["user_id"], "role": row["role"], "full_name": row["full_name"]}
