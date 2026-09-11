# MobiSense — Command Center Shell (Frontend Redesign, Part 1 of 3)

This covers just the **dashboard shell redesign** — replacing the old
"GIS Map | Video Feed" header tabs with a persistent Command Center
sidebar. Video feed → real ingestion wiring and the backend dedup
upgrade are separate follow-ups (not in this pass).

## What changed structurally

Every authenticated page now nests inside the same shell:

```
.app-shell                 (flex row, full viewport)
├── .app-nav                (new — collapsible left sidebar, shared)
└── .app-content            (flex column, everything the page used to be)
    └── .app-container      (unchanged internals on dashboard.html/feed.html)
```

`dashboard.html` and `feed.html` kept 100% of their internal markup,
CSS classes, and JS (`dashboard.js`/`feed.js` logic is untouched except
two small additions — see below). They were only wrapped one level
deeper and had their old in-header nav tabs removed, since that nav now
lives in the shared sidebar.

## New files

| File | Purpose |
|---|---|
| `frontend/theme.css` | Design tokens (colors, radii, shadows) extracted from `dashboard.css`'s `:root` block, loaded on every page so new pages match the existing look exactly. `dashboard.css`/`feed.css` still carry their own copy too — same values, so nothing conflicts. |
| `frontend/shell.css` | The sidebar itself: `.app-nav`, `.app-shell`, collapse behaviour, responsive breakpoint. |
| `frontend/shell.js` | `MobiSenseShell.requireAuth()`, `.logout()`, and `.initNav()` (collapse toggle, persisted in `localStorage`). Every new page uses this instead of duplicating auth-guard code. |
| `frontend/command-center.html/.css/.js` | **New home page** — stat strip, mini live map, priority incidents, live activity feed, system status. All numbers come from the real `/issues` endpoint, nothing fabricated. |
| `frontend/incidents.html/.css/.js` | **Incident Center** — sortable/filterable table of all incidents with an expandable detail row and a "Mark resolved" action (same `PATCH /issues/{id}` your dashboard already uses). |
| `frontend/fleet.html/.css/.js` | **Fleet Intelligence** — reports only what the current schema can prove today (AI observations, unique incidents, multi-detection count, per-category breakdown). It has an on-page notice explaining that per-vehicle attribution needs the `vehicle_id` field that's coming in the backend dedup upgrade — no fake bus/GPS data. |
| `frontend/analytics.html/.css/.js` | **Analytics** — the "raw observations → unique incidents → % reduction" headline metric (real, computed from `detection_count`), plus category/severity/status breakdown bars. |

## Modified files

| File | What changed |
|---|---|
| `frontend/dashboard.html` | Wrapped in the shell; old header nav tabs removed (now in sidebar); header title now reads "Live City Map". Map/incident-feed logic is untouched. |
| `frontend/dashboard.js` | One addition: reads `?focus=<id>` from the URL after the first successful fetch, so Command Center / Incidents / Fleet can deep-link straight to a marker (`dashboard.html?focus=MS-1042`). Nothing else changed. |
| `frontend/feed.html` | Same shell wrap; header title now reads "AI Detection Feed". Video/timeline logic untouched. |
| `frontend/feed.js` | One addition: an auth guard at the top (redirects to `login.html` if there's no token), matching every other page — it had none before. |
| `frontend/login.html` | The three post-login/signup redirects now go to `command-center.html` instead of `dashboard.html`, since Command Center is the new landing page. |

## Not touched

- `frontend/index.html`, `frontend/app.js`, `frontend/style.css` — this
  was already a stale, unused placeholder page before this redesign
  (static cards, no backend calls). Left alone; safe to delete later.
- `backend/`, `database/`, `ai-detection/` — nothing here yet. That's
  the next two phases (video feed → real ingestion, then the dedup
  radius/centroid/vehicle-tracking upgrade).

## Known gap this phase intentionally does not paper over

Fleet Intelligence and the "Verified" stat elsewhere are based on
**AI observation count** (`detection_count`), not real vehicle
attribution — there is no `vehicle_id` anywhere in the database yet.
"Confirmed by 3 vehicles" will become literally true once that field
exists; until then the UI says "2+ AI observations" instead of
guessing at a vehicle count.
