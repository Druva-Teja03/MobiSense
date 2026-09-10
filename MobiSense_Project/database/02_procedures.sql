-- =====================================================================
-- MobiSense — Stored Procedures
-- This is the file that answers: "multiple detections at the same
-- GPS spot must become ONE issue, until that issue is resolved."
-- =====================================================================
USE mobisense_db;

DELIMITER $$

-- ---------------------------------------------------------------------
-- sp_ingest_detection
--   Call this once per AI detection event (one call per pothole/garbage/
--   traffic frame your YOLO scripts produce). It will:
--     1. Find any OPEN (not resolved) issue of the same type within
--        that type's dedup radius of this lat/lng.
--     2. If found -> attach this detection to that issue, bump its
--        detection_count and last_detected_at.
--     3. If not found -> create a brand-new issue row.
--   Either way, the raw detection is always inserted into
--   issue_detections, so no data is ever lost.
-- ---------------------------------------------------------------------
CREATE PROCEDURE sp_ingest_detection (
  IN p_type_key       VARCHAR(40),
  IN p_lat            DECIMAL(10,7),
  IN p_lng            DECIMAL(10,7),
  IN p_detected_at    TIMESTAMP,
  IN p_vehicle_count  INT,
  IN p_traffic_level  VARCHAR(20),
  IN p_item_count     INT,
  IN p_severity       VARCHAR(20),
  IN p_source_image   VARCHAR(255),
  OUT p_issue_id      INT,
  OUT p_issue_code    VARCHAR(20),
  OUT p_was_merged    BOOLEAN
)
BEGIN
  DECLARE v_type_id       TINYINT UNSIGNED;
  DECLARE v_radius_m      SMALLINT UNSIGNED;
  DECLARE v_point         POINT;
  DECLARE v_existing_id   INT UNSIGNED DEFAULT NULL;
  DECLARE v_new_id        INT UNSIGNED;

  SET v_point = ST_SRID(POINT(p_lng, p_lat), 4326);

  SELECT issue_type_id, dedup_radius_m INTO v_type_id, v_radius_m
  FROM issue_types WHERE type_key = p_type_key
  LIMIT 1;

  IF v_type_id IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Unknown issue type_key passed to sp_ingest_detection';
  END IF;

  -- Step 1: look for an existing OPEN issue of the same type nearby.
  -- ST_Distance_Sphere returns meters for SRID 4326 points.
  SELECT issue_id INTO v_existing_id
  FROM issues
  WHERE issue_type_id = v_type_id
    AND status <> 'resolved'
    AND ST_Distance_Sphere(geo_point, v_point) <= v_radius_m
  ORDER BY ST_Distance_Sphere(geo_point, v_point) ASC
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    -- Step 2: merge into the existing issue.
    UPDATE issues
       SET detection_count = detection_count + 1,
           last_detected_at = p_detected_at,
           severity = COALESCE(p_severity, severity),
           traffic_level = COALESCE(p_traffic_level, traffic_level)
     WHERE issue_id = v_existing_id;

    SET p_issue_id = v_existing_id;
    SET p_was_merged = TRUE;
  ELSE
    -- Step 3: no open issue nearby -> this is a genuinely new problem.
    INSERT INTO issues (
      issue_code, issue_type_id, lat, lng, geo_point, status,
      severity, traffic_level, detection_count,
      first_detected_at, last_detected_at
    ) VALUES (
      CONCAT('ISSUE-', LPAD(0, 6, '0')), -- placeholder, fixed below
      v_type_id, p_lat, p_lng, v_point, 'unresolved',
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

  -- Always log the raw detection for audit/history, linked to whichever
  -- issue it ended up under.
  INSERT INTO issue_detections (
    issue_id, issue_type_id, lat, lng, geo_point,
    vehicle_count, traffic_level, item_count, severity,
    source_image, detected_at
  ) VALUES (
    p_issue_id, v_type_id, p_lat, p_lng, v_point,
    p_vehicle_count, p_traffic_level, p_item_count, p_severity,
    p_source_image, p_detected_at
  );
END$$

-- ---------------------------------------------------------------------
-- sp_update_issue_status
--   Central place to change an issue's status so the history table
--   always stays in sync. Resolving an issue means the NEXT detection
--   at that same spot will open a fresh issue (see sp_ingest_detection,
--   which only matches status <> 'resolved').
-- ---------------------------------------------------------------------
CREATE PROCEDURE sp_update_issue_status (
  IN p_issue_id     INT UNSIGNED,
  IN p_new_status   VARCHAR(20),
  IN p_changed_by   INT UNSIGNED
)
BEGIN
  DECLARE v_old_status VARCHAR(20);

  SELECT status INTO v_old_status FROM issues WHERE issue_id = p_issue_id;

  IF v_old_status IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Issue not found';
  END IF;

  UPDATE issues
     SET status = p_new_status,
         resolved_at = CASE WHEN p_new_status = 'resolved' THEN NOW() ELSE resolved_at END,
         resolved_by = CASE WHEN p_new_status = 'resolved' THEN p_changed_by ELSE resolved_by END
   WHERE issue_id = p_issue_id;

  INSERT INTO issue_status_history (issue_id, old_status, new_status, changed_by)
  VALUES (p_issue_id, v_old_status, p_new_status, p_changed_by);
END$$

DELIMITER ;
