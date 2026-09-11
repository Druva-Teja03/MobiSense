-- =====================================================================
-- MobiSense — Dedup Engine Upgrade
-- Run this AFTER 01_schema.sql .. 05_bangalore_seed.sql have already
-- been loaded. It only ALTERs/REPLACEs — no table is dropped, so your
-- existing users/issues/detections survive.
--
-- This closes the 6 gaps identified in the Phase 1 audit:
--   1. Dedup radius was tuned for a static camera (15-30m). A moving
--      bus with GPS drift needs a much wider match window.
--   2. issues.lat/lng was frozen at the FIRST detection forever. There
--      was no running centroid, so "one marker, not three overlapping"
--      wasn't actually true once a bus passed the same pothole 3x from
--      slightly different GPS fixes.
--   3. There was no concept of WHICH vehicle reported a detection, so
--      "confirmed by 3 vehicles" was impossible to compute.
--   4. AI confidence was captured in the video-feed simulation JSON
--      only — a disconnected mock data path — never in the real
--      ingest payload.
--   5. A later low-confidence/low-severity detection could silently
--      overwrite a High severity issue (COALESCE just took whichever
--      value was non-null, not whichever was worse).
--   6. (Wiring, not schema — see frontend/feed.js.)
-- =====================================================================
USE mobisense_db;

-- ---------------------------------------------------------------------
-- 1. Widen dedup radii for a moving reporting vehicle + GPS drift.
--    Keeps 'accident' tight (20m) — you want crash reports to be a lot
--    more precise before merging two into one.
-- ---------------------------------------------------------------------
UPDATE issue_types SET dedup_radius_m = 120 WHERE type_key = 'pothole';
UPDATE issue_types SET dedup_radius_m = 120 WHERE type_key = 'garbage';
UPDATE issue_types SET dedup_radius_m = 200 WHERE type_key = 'heavy_traffic';
UPDATE issue_types SET dedup_radius_m = 150 WHERE type_key = 'illegal_parking';
-- 'accident' intentionally left at its existing 20m from 04_accident_alerts.sql.

-- ---------------------------------------------------------------------
-- 2. Centroid columns on `issues`. lat/lng stay as the ORIGINAL first-
--    detection point (so nothing that already reads lat/lng breaks);
--    centroid_lat/centroid_lng are the running weighted average that
--    the map should actually plot the marker at.
-- ---------------------------------------------------------------------
ALTER TABLE issues
  ADD COLUMN centroid_lat DECIMAL(10,7) NULL AFTER lng,
  ADD COLUMN centroid_lng DECIMAL(10,7) NULL AFTER centroid_lat;

UPDATE issues SET centroid_lat = lat, centroid_lng = lng WHERE centroid_lat IS NULL;

ALTER TABLE issues
  MODIFY COLUMN centroid_lat DECIMAL(10,7) NOT NULL,
  MODIFY COLUMN centroid_lng DECIMAL(10,7) NOT NULL;

-- ---------------------------------------------------------------------
-- 3 & 4. vehicle_id (who reported it) + confidence (how sure the model
--    was) on the raw audit log. Both nullable — older detections from
--    before this migration simply won't have them.
-- ---------------------------------------------------------------------
ALTER TABLE issue_detections
  ADD COLUMN vehicle_id  VARCHAR(60)   NULL AFTER vehicle_count,
  ADD COLUMN confidence  DECIMAL(4,3)  NULL AFTER severity;

-- ---------------------------------------------------------------------
-- 5. Severity-rank helper — used to enforce "never silently downgrade".
--    Handles both 'moderate' and 'medium' since the frontend/video-feed
--    fallback JSON uses 'medium' while the garbage seed data uses
--    'moderate' for the same concept.
-- ---------------------------------------------------------------------
DROP FUNCTION IF EXISTS fn_severity_rank;

DELIMITER $$
CREATE FUNCTION fn_severity_rank(p_severity VARCHAR(20))
  RETURNS TINYINT DETERMINISTIC
BEGIN
  DECLARE v VARCHAR(20);
  SET v = LOWER(COALESCE(p_severity, ''));
  IF v IN ('critical', 'severe') THEN
    RETURN 4;
  ELSEIF v = 'high' THEN
    RETURN 3;
  ELSEIF v IN ('moderate', 'medium') THEN
    RETURN 2;
  ELSEIF v = 'low' THEN
    RETURN 1;
  ELSE
    RETURN 0; -- unknown/NULL never outranks a known severity
  END IF;
END$$
DELIMITER ;

-- ---------------------------------------------------------------------
-- Replace sp_ingest_detection with the upgraded version:
--   - accepts p_vehicle_id, p_confidence (2 new IN params, inserted
--     before the OUT params — see backend/main.py for the matching
--     callproc() positional update)
--   - recomputes centroid_lat/lng as a running weighted average on
--     every merge, instead of leaving lat/lng frozen at the first hit
--   - severity can only move up (or hold), never down, on a merge
--   - "closest candidate wins" ordering is unchanged (it already
--     existed via ORDER BY ST_Distance_Sphere ASC) — just widened radii
-- ---------------------------------------------------------------------
DROP PROCEDURE IF EXISTS sp_ingest_detection;

DELIMITER $$
CREATE PROCEDURE sp_ingest_detection (
  IN  p_type_key       VARCHAR(40),
  IN  p_lat            DECIMAL(10,7),
  IN  p_lng            DECIMAL(10,7),
  IN  p_detected_at    TIMESTAMP,
  IN  p_vehicle_count  INT,
  IN  p_traffic_level  VARCHAR(20),
  IN  p_item_count     INT,
  IN  p_severity       VARCHAR(20),
  IN  p_source_image   VARCHAR(255),
  IN  p_vehicle_id     VARCHAR(60),
  IN  p_confidence     DECIMAL(4,3),
  OUT p_issue_id       INT,
  OUT p_issue_code     VARCHAR(20),
  OUT p_was_merged     BOOLEAN
)
BEGIN
  DECLARE v_type_id          TINYINT UNSIGNED;
  DECLARE v_radius_m         SMALLINT UNSIGNED;
  DECLARE v_point            POINT;
  DECLARE v_existing_id      INT UNSIGNED DEFAULT NULL;
  DECLARE v_new_id           INT UNSIGNED;
  DECLARE v_old_severity     VARCHAR(20);
  DECLARE v_old_centroid_lat DECIMAL(10,7);
  DECLARE v_old_centroid_lng DECIMAL(10,7);
  DECLARE v_old_count        INT UNSIGNED;
  DECLARE v_new_centroid_lat DECIMAL(10,7);
  DECLARE v_new_centroid_lng DECIMAL(10,7);
  DECLARE v_new_severity     VARCHAR(20);

  SET v_point = ST_SRID(POINT(p_lng, p_lat), 4326);

  SELECT issue_type_id, dedup_radius_m INTO v_type_id, v_radius_m
  FROM issue_types WHERE type_key = p_type_key
  LIMIT 1;

  IF v_type_id IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Unknown issue type_key passed to sp_ingest_detection';
  END IF;

  -- Step 1: closest OPEN issue of the same type within its dedup radius.
  SELECT issue_id INTO v_existing_id
  FROM issues
  WHERE issue_type_id = v_type_id
    AND status <> 'resolved'
    AND ST_Distance_Sphere(geo_point, v_point) <= v_radius_m
  ORDER BY ST_Distance_Sphere(geo_point, v_point) ASC
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    -- Lock the row so two near-simultaneous detections for the same
    -- issue can't both read the same "old" centroid/count and race.
    SELECT severity, centroid_lat, centroid_lng, detection_count
      INTO v_old_severity, v_old_centroid_lat, v_old_centroid_lng, v_old_count
    FROM issues WHERE issue_id = v_existing_id
    FOR UPDATE;

    -- Running weighted centroid — folds THIS detection's point into the
    -- average of every detection merged so far, not just the first one.
    SET v_new_centroid_lat = ((v_old_centroid_lat * v_old_count) + p_lat) / (v_old_count + 1);
    SET v_new_centroid_lng = ((v_old_centroid_lng * v_old_count) + p_lng) / (v_old_count + 1);

    -- Never-downgrade rule: only adopt the new severity if it's at
    -- least as bad as what's already recorded.
    SET v_new_severity = CASE
      WHEN p_severity IS NOT NULL
           AND fn_severity_rank(p_severity) >= fn_severity_rank(v_old_severity)
        THEN p_severity
      ELSE v_old_severity
    END;

    UPDATE issues
       SET detection_count  = detection_count + 1,
           last_detected_at = p_detected_at,
           severity         = v_new_severity,
           traffic_level    = COALESCE(p_traffic_level, traffic_level),
           centroid_lat     = v_new_centroid_lat,
           centroid_lng     = v_new_centroid_lng
     WHERE issue_id = v_existing_id;

    SET p_issue_id = v_existing_id;
    SET p_was_merged = TRUE;
  ELSE
    -- Genuinely new issue: centroid starts equal to the first point.
    INSERT INTO issues (
      issue_code, issue_type_id, lat, lng, centroid_lat, centroid_lng, geo_point, status,
      severity, traffic_level, detection_count,
      first_detected_at, last_detected_at
    ) VALUES (
      CONCAT('ISSUE-', LPAD(0, 6, '0')), -- placeholder, fixed below
      v_type_id, p_lat, p_lng, p_lat, p_lng, v_point, 'unresolved',
      p_severity, p_traffic_level, 1,
      p_detected_at, p_detected_at
    );

    SET v_new_id = LAST_INSERT_ID();

    UPDATE issues
       SET issue_code = CONCAT('ISSUE-', LPAD(v_new_id, 6, '0'))
     WHERE issue_id = v_new_id;

    SET p_issue_id = v_new_id;
    SET p_was_merged = FALSE;
  END IF;

  SELECT issue_code INTO p_issue_code FROM issues WHERE issue_id = p_issue_id;

  -- Always log the raw detection for audit/history, now with WHICH
  -- vehicle reported it and HOW confident the model was.
  INSERT INTO issue_detections (
    issue_id, issue_type_id, lat, lng, geo_point,
    vehicle_count, vehicle_id, traffic_level, item_count, severity, confidence,
    source_image, detected_at
  ) VALUES (
    p_issue_id, v_type_id, p_lat, p_lng, v_point,
    p_vehicle_count, p_vehicle_id, p_traffic_level, p_item_count, p_severity, p_confidence,
    p_source_image, p_detected_at
  );
END$$
DELIMITER ;

-- ---------------------------------------------------------------------
-- Dashboard view — add the fields the audit called out as missing:
--   centroid_lat/centroid_lng : where the marker should actually plot
--   confirming_vehicle_count  : COUNT(DISTINCT vehicle_id) — "confirmed
--                                by N vehicles" (kept separate from the
--                                existing `vehicle_count`, which is a
--                                traffic-density headcount from a single
--                                frame, not the number of reporters)
--   avg_confidence            : mean AI confidence across all detections
--                                merged into this issue
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW v_dashboard_issues AS
SELECT
  i.issue_code                    AS id,
  it.type_key                     AS type,
  i.lat                           AS lat,
  i.lng                           AS lng,
  i.centroid_lat                  AS centroid_lat,
  i.centroid_lng                  AS centroid_lng,
  i.last_detected_at              AS timestamp,
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
     ORDER BY d.detected_at DESC LIMIT 1)              AS source_image
FROM issues i
JOIN issue_types it ON it.issue_type_id = i.issue_type_id;

-- Sanity checks after loading:
-- SELECT type_key, dedup_radius_m FROM issue_types;
-- SELECT id, type, lat, lng, centroid_lat, centroid_lng, detection_count,
--        confirming_vehicle_count, avg_confidence, severity
-- FROM v_dashboard_issues ORDER BY id;
