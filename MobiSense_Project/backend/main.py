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

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from auth import get_current_user, login_user, signup_user
from database import get_cursor
from models import DetectionIngestRequest, LoginRequest, SignupRequest, StatusUpdateRequest

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
def ingest_detection(body: DetectionIngestRequest):
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

    return {"issue_id": issue_id, "issue_code": issue_code, "merged_into_existing": bool(was_merged)}


@app.get("/health")
def health():
    return {"status": "ok"}
