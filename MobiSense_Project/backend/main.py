from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

# Allow requests from any frontend (needed so Vishal/Rusitha's pages can access this)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Sample data (same format as before)
issues = [
    {
        "id": "issue_001",
        "type": "pothole",
        "lat": 12.3051,
        "lng": 76.6551,
        "timestamp": "2026-09-06T10:30:00Z",
        "status": "unresolved"
    },
    {
        "id": "issue_002",
        "type": "illegal_parking",
        "lat": 12.3081,
        "lng": 76.6601,
        "timestamp": "2026-09-06T10:45:00Z",
        "status": "unresolved"
    },
    {
        "id": "issue_003",
        "type": "garbage",
        "lat": 12.3020,
        "lng": 76.6520,
        "timestamp": "2026-09-06T11:00:00Z",
        "status": "resolved"
    }
]

@app.get("/issues")
def get_issues():
    return issues

@app.patch("/issues/{issue_id}")
def update_issue(issue_id: str, status: str):
    for issue in issues:
        if issue["id"] == issue_id:
            issue["status"] = status
            return issue
    return {"error": "Issue not found"}