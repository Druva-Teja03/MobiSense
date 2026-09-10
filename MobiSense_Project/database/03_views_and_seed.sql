USE mobisense_db;

-- ---------------------------------------------------------------------
-- v_dashboard_issues — exactly the shape dashboard.js already expects
-- (id, type, lat, lng, timestamp, status, + type-specific fields), so
-- the backend can do `SELECT * FROM v_dashboard_issues` with almost no
-- transformation.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW v_dashboard_issues AS
SELECT
  i.issue_code                 AS id,
  it.type_key                  AS type,
  i.lat                        AS lat,
  i.lng                        AS lng,
  i.last_detected_at           AS timestamp,
  i.status                     AS status,
  i.severity                   AS severity,
  i.traffic_level              AS traffic_level,
  i.detection_count            AS detection_count,
  (SELECT vehicle_count FROM issue_detections d
     WHERE d.issue_id = i.issue_id
     ORDER BY d.detected_at DESC LIMIT 1)          AS vehicle_count,
  (SELECT item_count FROM issue_detections d
     WHERE d.issue_id = i.issue_id
     ORDER BY d.detected_at DESC LIMIT 1)          AS item_count,
  (SELECT source_image FROM issue_detections d
     WHERE d.issue_id = i.issue_id
     ORDER BY d.detected_at DESC LIMIT 1)          AS source_image
FROM issues i
JOIN issue_types it ON it.issue_type_id = i.issue_type_id;

-- ---------------------------------------------------------------------
-- Seed data — re-creates the sample issues that used to live in
-- backend/db.json, but pushed through sp_ingest_detection so you can
-- see the dedup logic actually run. Several of the traffic_/garbage_
-- rows in the old db.json shared the exact same lat/lng and type —
-- watch those collapse into ONE issue with detection_count > 1.
-- ---------------------------------------------------------------------
CALL sp_ingest_detection('pothole', 12.295099, 76.642134, '2026-09-12 09:00:00', NULL, NULL, NULL, NULL, NULL, @id, @code, @merged);
CALL sp_update_issue_status(@id, 'resolved', NULL);

CALL sp_ingest_detection('pothole', 12.287617, 76.644718, '2026-09-12 09:05:00', NULL, NULL, NULL, NULL, NULL, @id, @code, @merged);
CALL sp_update_issue_status(@id, 'resolved', NULL);

CALL sp_ingest_detection('pothole', 12.303894, 76.634465, '2026-09-12 09:10:00', NULL, NULL, NULL, NULL, NULL, @id, @code, @merged);
CALL sp_ingest_detection('pothole', 12.286048, 76.629942, '2026-09-12 09:15:00', NULL, NULL, NULL, NULL, NULL, @id, @code, @merged);
CALL sp_update_issue_status(@id, 'resolved', NULL);

CALL sp_ingest_detection('pothole', 12.302926, 76.644655, '2026-09-12 09:20:00', NULL, NULL, NULL, NULL, NULL, @id, @code, @merged);
CALL sp_ingest_detection('pothole', 12.286794, 76.639690, '2026-09-12 09:25:00', NULL, NULL, NULL, NULL, NULL, @id, @code, @merged);
CALL sp_update_issue_status(@id, 'resolved', NULL);

CALL sp_ingest_detection('pothole', 12.301272, 76.630479, '2026-09-12 09:30:00', NULL, NULL, NULL, NULL, NULL, @id, @code, @merged);
CALL sp_ingest_detection('pothole', 12.302128, 76.647587, '2026-09-12 09:35:00', NULL, NULL, NULL, NULL, NULL, @id, @code, @merged);
CALL sp_ingest_detection('pothole', 12.295248, 76.636407, '2026-09-12 09:40:00', NULL, NULL, NULL, NULL, NULL, @id, @code, @merged);
CALL sp_ingest_detection('pothole', 12.302035, 76.633225, '2026-09-12 09:45:00', NULL, NULL, NULL, NULL, NULL, @id, @code, @merged);

-- These three all share lat=12.2958, lng=76.6394 and type=heavy_traffic
-- in the old db.json — they will MERGE into a single issue here.
CALL sp_ingest_detection('heavy_traffic', 12.2958, 76.6394, '2026-09-12 10:00:00', 6,  'moderate', NULL, NULL, 'istockphoto-1206421561-612x612.jpg', @id, @code, @merged);
CALL sp_ingest_detection('heavy_traffic', 12.2958, 76.6394, '2026-09-12 10:00:05', 11, 'moderate', NULL, NULL, 'traffic.jpg', @id, @code, @merged);
CALL sp_ingest_detection('heavy_traffic', 12.2958, 76.6394, '2026-09-12 10:00:10', 39, 'heavy',    NULL, NULL, 'traffic_photo.jpg', @id, @code, @merged);

-- Same story for garbage at the same point — four detections, one issue.
CALL sp_ingest_detection('garbage', 12.2958, 76.6394, '2026-09-12 10:00:00', NULL, NULL, 1, 'low',      'garbage.jpg',   @id, @code, @merged);
CALL sp_ingest_detection('garbage', 12.2958, 76.6394, '2026-09-12 10:00:05', NULL, NULL, 4, 'moderate', 'images (2).jpg', @id, @code, @merged);
CALL sp_ingest_detection('garbage', 12.2958, 76.6394, '2026-09-12 10:00:10', NULL, NULL, 3, 'moderate', 'images (3).jpg', @id, @code, @merged);
CALL sp_ingest_detection('garbage', 12.2958, 76.6394, '2026-09-12 10:00:15', NULL, NULL, 1, 'low',      'images (4).jpg', @id, @code, @merged);

-- Sanity check after seeding — run this manually to see the merge happen:
-- SELECT id, type, lat, lng, detection_count, status FROM v_dashboard_issues ORDER BY id;
