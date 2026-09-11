-- =====================================================================
-- MobiSense — Feature Upgrade: SLA tracking + Recurring Hotspots
-- Run this AFTER 01_schema.sql .. 06_dedup_upgrade.sql have already
-- been loaded. Only ALTERs/REPLACEs — no existing table is dropped.
--
-- Adds:
--   1. v_dashboard_issues  — now also exposes first_detected_at,
--      resolved_at, hours_open and is_overdue so the frontend can show
--      SLA badges without a second round-trip per issue.
--   2. v_sla_metrics       — per-category resolution-time rollup.
--   3. v_recurring_hotspots — locations where the SAME issue type has
--      reopened / reappeared more than once over time (grid-bucketed,
--      since a resolved issue's next detection always creates a fresh
--      issue row — see sp_ingest_detection's `status <> 'resolved'`
--      match condition in 06_dedup_upgrade.sql).
-- =====================================================================
USE mobisense_db;

-- ---------------------------------------------------------------------
-- 1. SLA target (hours). 72h = 3 days is a reasonable default for
--    non-critical municipal issues; change this single constant to
--    retune every overdue calculation below.
-- ---------------------------------------------------------------------
-- (kept as a literal in the views below — MySQL views can't reference
--  a session variable, so if you change it, update it in both places
--  marked "SLA_HOURS".)

CREATE OR REPLACE VIEW v_dashboard_issues AS
SELECT
  i.issue_code                    AS id,
  it.type_key                     AS type,
  i.lat                           AS lat,
  i.lng                           AS lng,
  i.centroid_lat                  AS centroid_lat,
  i.centroid_lng                  AS centroid_lng,
  i.last_detected_at              AS timestamp,
  i.first_detected_at             AS first_detected_at,
  i.resolved_at                   AS resolved_at,
  i.status                        AS status,
  i.severity                      AS severity,
  i.traffic_level                 AS traffic_level,
  i.detection_count               AS detection_count,
  (SELECT vehicle_count FROM issue_detections d
     WHERE d.issue_id = i.issue_id
     ORDER BY d.detected_at DESC LIMIT 1)              AS vehicle_count,
  (SELECT COUNT(DISTINCT d.vehicle_id) FROM issue_detections d
     WHERE d.issue_id = i.issue_id AND d.vehicle_id IS NOT NULL) AS confirming_vehicle_count,
  (SELECT ROUND(AVG(d.confidence), 3) FROM issue_detections d
     WHERE d.issue_id = i.issue_id AND d.confidence IS NOT NULL) AS avg_confidence,
  (SELECT item_count FROM issue_detections d
     WHERE d.issue_id = i.issue_id
     ORDER BY d.detected_at DESC LIMIT 1)              AS item_count,
  (SELECT source_image FROM issue_detections d
     WHERE d.issue_id = i.issue_id
     ORDER BY d.detected_at DESC LIMIT 1)              AS source_image,
  -- Hours the issue has been open (resolved issues freeze at resolved_at;
  -- open issues keep counting up against NOW()).
  TIMESTAMPDIFF(HOUR, i.first_detected_at, COALESCE(i.resolved_at, NOW())) AS hours_open,
  -- SLA_HOURS = 72
  (i.status <> 'resolved' AND TIMESTAMPDIFF(HOUR, i.first_detected_at, NOW()) > 72) AS is_overdue
FROM issues i
JOIN issue_types it ON it.issue_type_id = i.issue_type_id;

-- ---------------------------------------------------------------------
-- 2. v_sla_metrics — one row per issue type: how many open, how many
--    resolved, average time-to-resolve, and how many are currently
--    breaching the SLA target.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW v_sla_metrics AS
SELECT
  it.type_key                                                        AS type,
  it.display_name                                                    AS display_name,
  COUNT(*)                                                           AS total_issues,
  SUM(CASE WHEN i.status = 'resolved' THEN 1 ELSE 0 END)             AS resolved_issues,
  SUM(CASE WHEN i.status <> 'resolved' THEN 1 ELSE 0 END)            AS open_issues,
  ROUND(AVG(CASE WHEN i.status = 'resolved'
             THEN TIMESTAMPDIFF(HOUR, i.first_detected_at, i.resolved_at)
             END), 1)                                                AS avg_resolution_hours,
  -- SLA_HOURS = 72
  SUM(CASE WHEN i.status <> 'resolved'
            AND TIMESTAMPDIFF(HOUR, i.first_detected_at, NOW()) > 72
           THEN 1 ELSE 0 END)                                        AS overdue_count
FROM issues i
JOIN issue_types it ON it.issue_type_id = i.issue_type_id
GROUP BY it.type_key, it.display_name;

-- ---------------------------------------------------------------------
-- 3. v_recurring_hotspots — groups issues (resolved + open, across
--    ALL time) into ~110m grid cells per type. A count >= 2 means this
--    is a location where the SAME class of problem has come back after
--    being marked resolved — the strongest "moving sensors beat static
--    ones" evidence MobiSense can show, and something a fixed camera
--    at one junction could never prove.
--
--    Grid size: ROUND(lat/lng, 3) ~= 111m per cell at the equator,
--    which comfortably sits inside the widened 120-200m dedup radii
--    from 06_dedup_upgrade.sql, so it buckets "same physical spot"
--    without needing a spatial self-join.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW v_recurring_hotspots AS
SELECT
  it.type_key                                   AS type,
  it.display_name                                AS display_name,
  ROUND(i.centroid_lat, 3)                       AS grid_lat,
  ROUND(i.centroid_lng, 3)                       AS grid_lng,
  AVG(i.centroid_lat)                            AS avg_lat,
  AVG(i.centroid_lng)                            AS avg_lng,
  COUNT(*)                                       AS occurrence_count,
  SUM(CASE WHEN i.status = 'resolved' THEN 1 ELSE 0 END) AS resolved_count,
  SUM(CASE WHEN i.status <> 'resolved' THEN 1 ELSE 0 END) AS active_count,
  SUM(i.detection_count)                         AS total_ai_observations,
  MIN(i.first_detected_at)                       AS first_seen_at,
  MAX(i.last_detected_at)                        AS last_seen_at,
  GROUP_CONCAT(i.issue_code ORDER BY i.first_detected_at SEPARATOR ',') AS issue_codes
FROM issues i
JOIN issue_types it ON it.issue_type_id = i.issue_type_id
GROUP BY it.type_key, it.display_name, ROUND(i.centroid_lat, 3), ROUND(i.centroid_lng, 3)
HAVING COUNT(*) >= 2
ORDER BY occurrence_count DESC, last_seen_at DESC;

-- ---------------------------------------------------------------------
-- Optional: seed ONE demonstrable recurring hotspot so the Fleet
-- Intelligence demo has something to show immediately, instead of
-- needing to wait for a real re-detection weeks later. Safe to skip —
-- comment it out if you don't want extra demo data.
-- This re-reports a pothole at the SAME spot as the very first seed
-- row in 03_views_and_seed.sql (12.295099, 76.642134), which was
-- already marked resolved — so this creates a genuinely NEW issue at
-- an old coordinate, exactly like a real repeat-failure would.
-- ---------------------------------------------------------------------
CALL sp_ingest_detection('pothole', 12.295099, 76.642134, NOW(), NULL, NULL, NULL, 'high', NULL, 'BUS-014', 0.91, @id, @code, @merged);

-- Sanity checks after loading:
-- SELECT * FROM v_sla_metrics;
-- SELECT * FROM v_recurring_hotspots;
-- SELECT id, type, status, hours_open, is_overdue FROM v_dashboard_issues ORDER BY hours_open DESC;
