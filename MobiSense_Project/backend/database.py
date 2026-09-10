"""
database.py — one place that knows how to talk to MySQL.
Everything else (auth.py, main.py) imports get_connection() from here.
"""
import os
from contextlib import contextmanager

import mysql.connector
from mysql.connector import pooling
from dotenv import load_dotenv

load_dotenv()

DB_CONFIG = {
    "host": os.getenv("DB_HOST", "localhost"),
    "port": int(os.getenv("DB_PORT", "3306")),
    "user": os.getenv("DB_USER", "mobisense_app"),
    "password": os.getenv("DB_PASSWORD", ""),
    "database": os.getenv("DB_NAME", "mobisense_db"),
}

# A small connection pool is enough for a hackathon demo; avoids opening
# a brand-new TCP connection to MySQL on every single API request.
_pool = pooling.MySQLConnectionPool(
    pool_name="mobisense_pool",
    pool_size=5,
    **DB_CONFIG,
)


@contextmanager
def get_connection():
    """Usage:  with get_connection() as conn: ..."""
    conn = _pool.get_connection()
    try:
        yield conn
    finally:
        conn.close()  # returns the connection to the pool, doesn't kill it


@contextmanager
def get_cursor(dictionary: bool = True, commit: bool = False):
    """Usage:  with get_cursor() as cur: cur.execute(...); rows = cur.fetchall()"""
    with get_connection() as conn:
        cur = conn.cursor(dictionary=dictionary)
        try:
            yield cur
            if commit:
                conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            cur.close()
