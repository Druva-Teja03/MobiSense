"""
main.py — MobiSense backend, now backed by real MySQL instead of an
in-memory list. Run with:  uvicorn main:app --reload --port 8000

Endpoints:
  POST /auth/signup        Register (only succeeds for a whitelisted govt ID)
  POST /auth/login         Log in, returns a JWT
  GET  /issues             Deduplicated issues for the dashboard map (auth required)
  PATCH /issues/{id}       Update an issue's status (auth required)
  POST /detections         Ingest one raw AI detection (called by ai-detection/*.py)
"""
from datetime import datetime

from fastapi import BackgroundTasks, Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from auth import get_current_user, login_user, signup_user
from database import get_cursor
from models import DetectionIngestRequest, LoginRequest, SignupRequest, StatusUpdateRequest
from notify import notify_departments_for_issue

app = FastAPI(title="MobiSense API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # tighten this to your actual frontend origin before deploying
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------
@app.post("/auth/signup")
def signup(body: SignupRequest):
    return signup_user(body.full_name, body.email, body.password, body.job_title, body.govt_id_number)


@app.post("/auth/login")
def login(body: LoginRequest):
    return login_user(body.email, body.password)


# ---------------------------------------------------------------------
# Issues (what dashboard.js reads/writes)
# ---------------------------------------------------------------------
@app.get("/issues")
def get_issues(user: dict = Depends(get_current_user)):
    with get_cursor() as cur:
        cur.execute("SELECT * FROM v_dashboard_issues ORDER BY timestamp DESC")
        rows = cur.fetchall()
    # Convert Decimal/datetime objects to plain JSON-friendly values.
    for r in rows:
        r["lat"] = float(r["lat"])
        r["lng"] = float(r["lng"])
        if r["timestamp"]:
            r["timestamp"] = r["timestamp"].strftime("%Y-%m-%dT%H:%M:%SZ")
    return rows


@app.patch("/issues/{issue_code}")
def update_issue_status(issue_code: str, body: StatusUpdateRequest, user: dict = Depends(get_current_user)):
    with get_cursor() as cur:
        cur.execute("SELECT issue_id FROM issues WHERE issue_code = %s", (issue_code,))
        row = cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Issue not found")

    with get_cursor(commit=True) as cur:
        cur.callproc("sp_update_issue_status", [row["issue_id"], body.status, int(user["sub"])])

    return {"id": issue_code, "status": body.status}


# ---------------------------------------------------------------------
# Detection ingestion — point your ai-detection scripts here instead of
# writing to detected_*.json files.
# ---------------------------------------------------------------------
@app.post("/detections")
def ingest_detection(body: DetectionIngestRequest, background_tasks: BackgroundTasks):
    detected_at = body.detected_at.replace("Z", "")
    try:
        datetime.fromisoformat(detected_at)
    except ValueError:
        raise HTTPException(status_code=400, detail="detected_at must be an ISO timestamp")

    with get_cursor(commit=True) as cur:
        # mysql-connector-python (dictionary cursor) returns OUT params in a
        # dict keyed "<proc_name>_arg<1-indexed position>". Our OUT params
        # are the 10th/11th/12th arguments (p_issue_id, p_issue_code, p_was_merged).
        result_args = cur.callproc(
            "sp_ingest_detection",
            [
                body.type_key, body.lat, body.lng, detected_at,
                body.vehicle_count, body.traffic_level, body.item_count,
                body.severity, body.source_image,
                0, "", False,  # OUT params — placeholders, connector fills these
            ],
        )
    issue_id = result_args["sp_ingest_detection_arg10"]
    issue_code = result_args["sp_ingest_detection_arg11"]
    was_merged = result_args["sp_ingest_detection_arg12"]

    # Only fire an alert the moment a NEW critical issue (e.g. an accident)
    # is created — never on a re-detection merge, or departments would get
    # emailed every time the camera re-confirms the same crash. Running it
    # as a background task means this HTTP response returns immediately;
    # the email/log write happens right after, without blocking the caller.
    if not was_merged:
        with get_cursor() as cur:
            cur.execute("SELECT is_critical FROM issue_types WHERE type_key = %s", (body.type_key,))
            type_row = cur.fetchone()
        if type_row and type_row["is_critical"]:
            background_tasks.add_task(
                notify_departments_for_issue,
                issue_id, issue_code, body.type_key, body.lat, body.lng, body.severity, detected_at,
            )

    return {"issue_id": issue_id, "issue_code": issue_code, "merged_into_existing": bool(was_merged)}


# ---------------------------------------------------------------------
# Alert history — who got notified about a given issue, and when.
# Handy for a dashboard panel or your SIH demo/report.
# ---------------------------------------------------------------------
@app.get("/alerts/{issue_code}")
def get_alerts(issue_code: str, user: dict = Depends(get_current_user)):
    with get_cursor() as cur:
        cur.execute(
            """
            SELECT al.alert_id, dc.department_name, dc.email, al.channel, al.status, al.sent_at
            FROM alert_log al
            JOIN issues i ON i.issue_id = al.issue_id
            JOIN department_contacts dc ON dc.department_id = al.department_id
            WHERE i.issue_code = %s
            ORDER BY al.sent_at DESC
            """,
            (issue_code,),
        )
        rows = cur.fetchall()
    for r in rows:
        if r["sent_at"]:
            r["sent_at"] = r["sent_at"].strftime("%Y-%m-%dT%H:%M:%SZ")
    return rows


@app.get("/health")
def health():
    return {"status": "ok"}


# ---------------------------------------------------------------------
# Current user's profile — powers the avatar/profile dropdown in the
# dashboard header. Reads whichever user the JWT belongs to.
# ---------------------------------------------------------------------
@app.get("/users/me")
def get_my_profile(user: dict = Depends(get_current_user)):
    with get_cursor() as cur:
        cur.execute(
            """SELECT full_name, email, job_title, govt_id_number, role, created_at
               FROM users WHERE user_id = %s""",
            (int(user["sub"]),),
        )
        row = cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="User not found")
    if row["created_at"]:
        row["created_at"] = row["created_at"].strftime("%Y-%m-%dT%H:%M:%SZ")
    return row
