-- =====================================================================
-- MobiSense — Reposition demo data to Bangalore
-- Run this ONCE, after 01-04 are already loaded. It only clears the
-- ISSUE/DETECTION data (your Mysuru demo pins) — it does NOT touch
-- users, verified_employees, or department_contacts, so your signed-up
-- accounts are untouched.
-- =====================================================================
USE mobisense_db;

-- Wipe old demo issues/detections (cascades to alert_log automatically).
DELETE FROM issues;
ALTER TABLE issues AUTO_INCREMENT = 1;
ALTER TABLE issue_detections AUTO_INCREMENT = 1;
ALTER TABLE alert_log AUTO_INCREMENT = 1;

-- ---------------------------------------------------------------------
-- Fresh demo data across real Bangalore landmarks.
-- ---------------------------------------------------------------------

-- Potholes — spread across the city, some already resolved
CALL sp_ingest_detection('pothole', 12.9758, 77.6045, '2026-09-12 09:00:00', NULL,NULL,NULL,NULL,NULL, @id,@code,@m); -- MG Road
CALL sp_update_issue_status(@id, 'resolved', NULL);
CALL sp_ingest_detection('pothole', 12.9352, 77.6245, '2026-09-12 09:05:00', NULL,NULL,NULL,NULL,NULL, @id,@code,@m); -- Koramangala
CALL sp_ingest_detection('pothole', 12.9784, 77.6408, '2026-09-12 09:10:00', NULL,NULL,NULL,NULL,NULL, @id,@code,@m); -- Indiranagar
CALL sp_update_issue_status(@id, 'resolved', NULL);
CALL sp_ingest_detection('pothole', 12.9698, 77.7500, '2026-09-12 09:15:00', NULL,NULL,NULL,NULL,NULL, @id,@code,@m); -- Whitefield
CALL sp_ingest_detection('pothole', 12.9250, 77.5938, '2026-09-12 09:20:00', NULL,NULL,NULL,NULL,NULL, @id,@code,@m); -- Jayanagar
CALL sp_ingest_detection('pothole', 12.8452, 77.6602, '2026-09-12 09:25:00', NULL,NULL,NULL,NULL,NULL, @id,@code,@m); -- Electronic City
CALL sp_update_issue_status(@id, 'resolved', NULL);
CALL sp_ingest_detection('pothole', 13.0358, 77.5970, '2026-09-12 09:30:00', NULL,NULL,NULL,NULL,NULL, @id,@code,@m); -- Hebbal
CALL sp_ingest_detection('pothole', 13.0035, 77.5709, '2026-09-12 09:35:00', NULL,NULL,NULL,NULL,NULL, @id,@code,@m); -- Malleshwaram

-- Heavy traffic — 3 detections at the SAME spot (Silk Board) merge into ONE issue
CALL sp_ingest_detection('heavy_traffic', 12.9177, 77.6233, '2026-09-12 10:00:00', 6,  'moderate', NULL, NULL, 'traffic1.jpg', @id,@code,@m);
CALL sp_ingest_detection('heavy_traffic', 12.9177, 77.6233, '2026-09-12 10:00:05', 15, 'moderate', NULL, NULL, 'traffic2.jpg', @id,@code,@m);
CALL sp_ingest_detection('heavy_traffic', 12.9177, 77.6233, '2026-09-12 10:00:10', 39, 'heavy',    NULL, NULL, 'traffic3.jpg', @id,@code,@m);

-- Garbage — 4 detections at Marathahalli merge into ONE issue
CALL sp_ingest_detection('garbage', 12.9569, 77.7011, '2026-09-12 10:05:00', NULL, NULL, 1, 'low',      'garbage1.jpg', @id,@code,@m);
CALL sp_ingest_detection('garbage', 12.9569, 77.7011, '2026-09-12 10:05:05', NULL, NULL, 4, 'moderate', 'garbage2.jpg', @id,@code,@m);
CALL sp_ingest_detection('garbage', 12.9569, 77.7011, '2026-09-12 10:05:10', NULL, NULL, 3, 'moderate', 'garbage3.jpg', @id,@code,@m);
CALL sp_ingest_detection('garbage', 12.9569, 77.7011, '2026-09-12 10:05:15', NULL, NULL, 1, 'low',      'garbage4.jpg', @id,@code,@m);

-- One accident near Hebbal flyover — fires the auto-alert (check your
-- uvicorn console for [ALERT-SIMULATED] right after this runs, once your
-- backend is up).
CALL sp_ingest_detection('accident', 13.0400, 77.5900, '2026-09-12 10:10:00', 2, NULL, NULL, 'major', 'accident1.jpg', @id,@code,@m);

-- Sanity check:
-- SELECT id, type, lat, lng, detection_count, status FROM v_dashboard_issues ORDER BY id;
