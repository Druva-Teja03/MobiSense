"""
notify.py — sends an alert to every department subscribed to a given
issue type, and logs the outcome to `alert_log` so there's an audit
trail of who was told about what, and when.

DRY-RUN MODE (default): if SMTP_HOST is not set in .env, this module
does NOT try to send real email — it just logs the alert to alert_log
with status='simulated' and prints to the console. This means the
accident-alert demo works out of the box on your laptop with no mail
server, and starts sending real email the moment you fill in real SMTP
values in .env — no code changes needed either way.
"""
import os
import smtplib
from email.mime.text import MIMEText

from database import get_cursor

SMTP_HOST = os.getenv("SMTP_HOST", "")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER", "")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
ALERT_FROM_EMAIL = os.getenv("ALERT_FROM_EMAIL", "alerts@mobisense.local")
ALERT_FROM_NAME = os.getenv("ALERT_FROM_NAME", "MobiSense Alerts")

DRY_RUN = not SMTP_HOST  # no SMTP configured -> simulate instead of failing


def _get_departments_for_type(type_key: str):
    with get_cursor() as cur:
        cur.execute(
            """
            SELECT dc.department_id, dc.department_name, dc.email
            FROM department_issue_routes r
            JOIN department_contacts dc ON dc.department_id = r.department_id
            JOIN issue_types it ON it.issue_type_id = r.issue_type_id
            WHERE it.type_key = %s AND dc.is_active = TRUE
            """,
            (type_key,),
        )
        return cur.fetchall()


def _send_email(to_email: str, subject: str, body: str) -> tuple[bool, str | None]:
    if DRY_RUN:
        print(f"[ALERT-SIMULATED] To: {to_email} | Subject: {subject}\n{body}\n")
        return True, None

    try:
        msg = MIMEText(body)
        msg["Subject"] = subject
        msg["From"] = f"{ALERT_FROM_NAME} <{ALERT_FROM_EMAIL}>"
        msg["To"] = to_email

        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=10) as server:
            server.starttls()
            if SMTP_USER:
                server.login(SMTP_USER, SMTP_PASSWORD)
            server.sendmail(ALERT_FROM_EMAIL, [to_email], msg.as_string())
        return True, None
    except Exception as e:
        return False, str(e)


def _log_alert(issue_id: int, department_id: int, status: str, error_message: str | None):
    with get_cursor(commit=True) as cur:
        cur.execute(
            """INSERT INTO alert_log (issue_id, department_id, channel, status, error_message)
               VALUES (%s, %s, 'email', %s, %s)""",
            (issue_id, department_id, status, error_message),
        )


def notify_departments_for_issue(
    issue_id: int,
    issue_code: str,
    type_key: str,
    lat: float,
    lng: float,
    severity: str | None,
    detected_at: str,
):
    """
    Call this once, right when a NEW critical issue (e.g. an accident)
    is created — not on every merged detection, or departments would
    get spammed every time the camera re-detects the same crash.
    """
    departments = _get_departments_for_type(type_key)
    if not departments:
        print(f"[ALERT] No departments configured for type '{type_key}' — nothing sent.")
        return

    maps_link = f"https://www.google.com/maps?q={lat},{lng}"
    subject = f"🚨 {type_key.replace('_', ' ').title()} reported — {issue_code}"
    body = (
        f"MobiSense has detected a new {type_key.replace('_', ' ')} that needs attention.\n\n"
        f"Issue ID:   {issue_code}\n"
        f"Severity:   {severity or 'not specified'}\n"
        f"Location:   {lat}, {lng}\n"
        f"Map link:   {maps_link}\n"
        f"Detected:   {detected_at}\n\n"
        f"Please dispatch the appropriate response team. This issue will remain open "
        f"on the MobiSense dashboard until a field officer marks it resolved."
    )

    for dept in departments:
        ok, err = _send_email(dept["email"], subject, body)
        _log_alert(issue_id, dept["department_id"], "sent" if (ok and not DRY_RUN) else ("simulated" if ok else "failed"), err)
