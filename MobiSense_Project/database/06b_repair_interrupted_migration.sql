-- =====================================================================
-- MobiSense — Repair script for an interrupted 06_dedup_upgrade.sql run
-- =====================================================================
-- What happened: 06_dedup_upgrade.sql's ALTER TABLE on `issues`
-- (adding centroid_lat/centroid_lng) errored with "Duplicate column
-- name 'centroid_lat'" because those columns already existed from an
-- earlier successful run. MySQL Workbench stops a script at its first
-- error by default, so everything AFTER that statement in 06 never
-- ran: issue_detections never got its vehicle_id/confidence columns,
-- sp_ingest_detection was never replaced, and v_dashboard_issues was
-- never recreated. That's why 07_feature_upgrade.sql then failed with
-- "Unknown column 'd.vehicle_id'" — that column genuinely doesn't
-- exist yet.
--
-- This script picks up exactly where 06 left off. It is safe to run
-- even if some of these objects already exist (DROP IF EXISTS / OR
-- REPLACE everywhere), so you can't "duplicate-error" your way out of
-- it again.
--
-- HOW TO RUN: open this file in MySQL Workbench, click the lightning-
-- bolt "Execute" icon (or Ctrl+Shift+Enter) to run the whole script.
-- Then re-run 07_feature_upgrade.sql.
-- =====================================================================
USE mobisense_db;

-- ---------------------------------------------------------------------
-- 1. vehicle_id (who reported it) + confidence (how sure the model
--    was) on the raw audit log. Guarded so re-running this is safe.
-- ---------------------------------------------------------------------
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = 'mobisense_db'
    AND table_name = 'issue_detections'
    AND column_name = 'vehicle_id'
);

SET @sql := IF(@col_exists = 0,
  'ALTER TABLE issue_detections
     ADD COLUMN vehicle_id VARCHAR(60)  NULL AFTER vehicle_count,
     ADD COLUMN confidence DECIMAL(4,3) NULL AFTER severity',
  'SELECT "vehicle_id/confidence already exist — skipping" AS note'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------
-- 2. Severity-rank helper function.
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
    RETURN 0;
  END IF;
END$$
DELIMITER ;

-- ---------------------------------------------------------------------
-- 3. sp_ingest_detection — the version with vehicle_id/confidence IN
--    params and running-centroid logic.
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

  SELECT issue_id INTO v_existing_id
  FROM issues
  WHERE issue_type_id = v_type_id
    AND status <> 'resolved'
    AND ST_Distance_Sphere(geo_point, v_point) <= v_radius_m
  ORDER BY ST_Distance_Sphere(geo_point, v_point) ASC
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    SELECT severity, centroid_lat, centroid_lng, detection_count
      INTO v_old_severity, v_old_centroid_lat, v_old_centroid_lng, v_old_count
    FROM issues WHERE issue_id = v_existing_id
    FOR UPDATE;

    SET v_new_centroid_lat = ((v_old_centroid_lat * v_old_count) + p_lat) / (v_old_count + 1);
    SET v_new_centroid_lng = ((v_old_centroid_lng * v_old_count) + p_lng) / (v_old_count + 1);

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
    INSERT INTO issues (
      issue_code, issue_type_id, lat, lng, centroid_lat, centroid_lng, geo_point, status,
      severity, traffic_level, detection_count,
      first_detected_at, last_detected_at
    ) VALUES (
      CONCAT('ISSUE-', LPAD(0, 6, '0')),
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
-- 4. Rebuild v_dashboard_issues with the confirming_vehicle_count /
--    avg_confidence fields (07_feature_upgrade.sql will extend this
--    further with SLA fields when you re-run it next).
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

-- ---------------------------------------------------------------------
-- Verify the repair worked before moving on:
-- ---------------------------------------------------------------------
SELECT COUNT(*) AS should_be_1 FROM information_schema.columns
WHERE table_schema = 'mobisense_db' AND table_name = 'issue_detections' AND column_name = 'vehicle_id';
