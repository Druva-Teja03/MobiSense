# MobiSense — Database & Backend Setup Guide
Backend + Database module — Druva Teja & Dhanya

This covers: installing MySQL, loading the schema, running the FastAPI
backend, and wiring it to the frontend your teammates built. Everything
here has been tested end-to-end (signup → login → dashboard → resolve →
new detection ingestion) on a clean MySQL 8.0 instance before being
handed to you.

---

## 0. What you're setting up

```
database/   → the MySQL schema, stored procedures, and seed data
backend/    → FastAPI app that reads/writes that database
frontend/   → your teammates' HTML/CSS/JS, patched to talk to the backend
```

Data flow:
`login.html` → `POST /auth/login` or `/auth/signup` → gets a JWT → stores
it in the browser → `dashboard.html`/`dashboard.js` sends that JWT on
every `/issues` request → backend checks it → MySQL.

Your AI-detection scripts (`ai-detection/*.py`) should eventually POST to
`/detections` instead of writing `detected_*.json` files — that endpoint
runs the dedup logic. See Section 6.

---

## 1. Install MySQL 8.0

### Windows
1. Download **MySQL Installer** from https://dev.mysql.com/downloads/installer/
2. Choose "Developer Default" (installs MySQL Server 8.0 + Workbench).
3. During setup, set a root password — remember it.
4. Once installed, MySQL runs as a Windows service automatically.

### macOS
```bash
brew install mysql
brew services start mysql
mysql_secure_installation   # set a root password
```

### Linux (Ubuntu/Debian)
```bash
sudo apt update
sudo apt install mysql-server
sudo systemctl start mysql
sudo mysql_secure_installation
```

**Important:** if you already have XAMPP/MariaDB installed, don't run
both on port 3306 at once — pick one. This project was tested against
real **MySQL 8.0**, not MariaDB — MariaDB's GIS functions (`ST_Distance_Sphere`,
`ST_SRID`) behave differently and the dedup logic will not work correctly
on it.

Verify it's running:
```bash
mysql -u root -p -e "SELECT VERSION();"
```
You should see `8.0.x`.

---

## 2. Load the database

From the `database/` folder, run the three files **in order** — each one
depends on the last:

```bash
mysql -u root -p < 01_schema.sql
mysql -u root -p < 02_procedures.sql
mysql -u root -p < 03_views_and_seed.sql
```

Check it worked:
```bash
mysql -u root -p mobisense_db -e "SELECT id, type, lat, lng, detection_count, status FROM v_dashboard_issues ORDER BY id;"
```

You should see 12 rows — including one `heavy_traffic` row with
`detection_count = 3` and one `garbage` row with `detection_count = 4`.
**That's the dedup logic already working** — those started as 3 and 4
separate detections at the same GPS point and got merged into single
issues.

### Create a dedicated app user (don't use root in the backend)
```sql
CREATE USER 'mobisense_app'@'localhost' IDENTIFIED BY 'pick_a_real_password';
GRANT ALL PRIVILEGES ON mobisense_db.* TO 'mobisense_app'@'localhost';
FLUSH PRIVILEGES;
```

---

## 3. Set up the backend

```bash
cd backend
python3 -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

Copy the env template and fill in your real values:
```bash
cp .env.example .env
```
Edit `.env`:
```
DB_HOST=localhost
DB_PORT=3306
DB_USER=mobisense_app
DB_PASSWORD=pick_a_real_password      # same as Section 2
DB_NAME=mobisense_db
JWT_SECRET=<run: python -c "import secrets; print(secrets.token_hex(32))">
JWT_ALGORITHM=HS256
JWT_EXPIRES_MINUTES=480
```

Run it:
```bash
uvicorn main:app --reload --port 8000
```

Check it's alive:
```bash
curl http://localhost:8000/health
# {"status":"ok"}
```

---

## 4. Test the API before touching the frontend

**Reject an unregistered person (should fail with a clear message):**
```bash
curl -X POST http://localhost:8000/auth/signup -H "Content-Type: application/json" \
  -d '{"full_name":"Random Person","email":"random@x.com","password":"password123","job_title":"Nobody","govt_id_number":"NOT-REAL"}'
```
→ `400: "That Govt/Employee ID isn't recognized..."`

**Sign up with one of the two demo govt IDs seeded in the database**
(`BBMP-EMP-1001` or `BEL-EMP-2002`):
```bash
curl -X POST http://localhost:8000/auth/signup -H "Content-Type: application/json" \
  -d '{"full_name":"Druva Teja","email":"druva@x.com","password":"password123","job_title":"Junior Engineer","govt_id_number":"BBMP-EMP-1001"}'
```
→ `200` with a `token`. That's your JWT.

**Fetch the dashboard data with it:**
```bash
curl -H "Authorization: Bearer <paste token here>" http://localhost:8000/issues
```
→ the 12 deduplicated issues.

To register real teammates or officers later, add rows to
`verified_employees` — that table is your "who's allowed to sign up"
whitelist:
```sql
INSERT INTO verified_employees (govt_id_number, full_name, department, designation)
VALUES ('YOUR-ID-HERE', 'Full Name', 'Department', 'Designation');
```

---

## 5. Wire up the frontend

The `frontend/` files in this package are already patched:

- **`login.html`** — the login and signup forms now call
  `POST /auth/login` and `POST /auth/signup` for real. On success, the
  JWT is saved to `localStorage` and the page redirects to
  `dashboard.html`. If someone's govt ID isn't in `verified_employees`,
  they see the real error message instead of a demo alert.
- **`dashboard.js`** — checks for a saved token on load and redirects
  back to `login.html` if there isn't one (so nobody reaches the
  dashboard without logging in first). Every `/issues` request now
  sends `Authorization: Bearer <token>`. A "Log out" button was added
  to the header.

**One line to change before running:** both files currently point at
`http://localhost:8000`. If you deploy the backend elsewhere (a cloud VM,
ngrok tunnel, etc. for your SIH demo), update:
- `login.html` → find `const API_BASE = "http://localhost:8000";`
- `dashboard.js` → find `API_URL: 'http://localhost:8000/issues'`

To run the frontend, just open `login.html` in a browser (or serve the
`frontend/` folder with any static file server — e.g. `python3 -m http.server`
from inside that folder). Make sure the backend (`uvicorn`) is running
first.

**Try it:** open `login.html`, sign up with `govt_id_number: BBMP-EMP-1001`,
watch it redirect you straight into `dashboard.html` with the 12 seeded
incidents on the map.

---

## 6. Pointing your AI-detection scripts at the backend

Right now, `ai-detection/pothole_test.py`, `traffic_test.py`, and
`garbage_test.py` each write to their own `detected_*.json` file. To get
real dedup, replace that final `json.dump(...)` step with an HTTP POST:

```python
import requests

requests.post("http://localhost:8000/detections", json={
    "type_key": "pothole",           # or "heavy_traffic" / "garbage" / "illegal_parking"
    "lat": 12.3051,
    "lng": 76.6551,
    "detected_at": "2026-09-12T10:30:00Z",
    "vehicle_count": None,           # fill in for heavy_traffic
    "traffic_level": None,
    "item_count": None,              # fill in for garbage
    "severity": None,
    "source_image": filename,
})
```

The response tells you whether it merged into an existing issue:
```json
{"issue_id": 11, "issue_code": "ISSUE-000011", "merged_into_existing": true}
```

---

## 7. Migrating to PostgreSQL + PostGIS later (for the SIH round)

You mentioned wanting to move to PostgreSQL/PostGIS if this problem
statement is selected. The good news: because we used MySQL's native
spatial types (`POINT`, `SPATIAL INDEX`, `ST_Distance_Sphere`) instead of
raw lat/lng math, the *concepts* map almost directly:

| MySQL (this build)              | PostgreSQL + PostGIS equivalent           |
|----------------------------------|--------------------------------------------|
| `POINT NOT NULL SRID 4326`      | `geography(Point, 4326)`                   |
| `SPATIAL INDEX`                  | `CREATE INDEX ... USING GIST`              |
| `ST_Distance_Sphere(a, b) <= r` | `ST_DWithin(a, b, r)`                      |
| `ST_SRID(POINT(x,y), 4326)`     | `ST_SetSRID(ST_MakePoint(x,y), 4326)`      |
| Stored procedure (`DELIMITER $$`)| Same idea, PL/pgSQL syntax (`$$ ... $$`)   |

The table structure, the `verified_employees` whitelist idea, and the
overall "merge nearby unresolved detections, reopen fresh issues after
resolution" logic all carry over unchanged — only the spatial function
names and the procedural SQL dialect change.

---

## Troubleshooting

- **`Can't connect to MySQL server`** — MySQL isn't running, or your
  `.env` has the wrong host/port.
- **`Access denied for user`** — check the `DB_USER`/`DB_PASSWORD` in
  `.env` match what you set up in Section 2.
- **Signup always fails with "Govt ID isn't recognized"** — the ID you
  typed isn't in `verified_employees` yet; insert it (Section 4) or use
  one of the two seeded demo IDs.
- **Dashboard redirects straight back to login** — the token wasn't
  saved, or it expired (default: 8 hours). Log in again.
- **CORS errors in the browser console** — make sure you're loading
  `dashboard.html`/`login.html` as actual files/served pages, not via
  `file://` in some strict browser setups, and that the backend is
  running on the exact host/port the frontend expects.
