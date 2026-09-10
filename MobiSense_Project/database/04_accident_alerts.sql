-- =====================================================================
-- MobiSense — Accident Detection & Auto-Alert add-on
-- Run this AFTER 01_schema.sql, 02_procedures.sql, 03_views_and_seed.sql
-- have already been loaded (it references issues, issue_types, users).
-- =====================================================================
USE mobisense_db;

-- ---------------------------------------------------------------------
-- 1. Register 'accident' as a new issue type.
--    Small dedup radius (20m) and short time sense: multiple camera
--    frames of the SAME crash within a few seconds should merge into
--    one issue, but this is still routed through the exact same
--    sp_ingest_detection dedup logic as every other type — no special
--    casing needed there.
-- ---------------------------------------------------------------------
INSERT INTO issue_types (type_key, display_name, dedup_radius_m)
VALUES ('accident', 'Road Accident', 20)
ON DUPLICATE KEY UPDATE display_name = VALUES(display_name);

-- Mark which issue types are "critical" — i.e. should trigger an
-- immediate outbound alert the moment a NEW issue (not a merge) is
-- created for them. Everything else just shows up on the dashboard
-- like normal.
ALTER TABLE issue_types
  ADD COLUMN is_critical BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE issue_types SET is_critical = TRUE WHERE type_key = 'accident';

-- ---------------------------------------------------------------------
-- 2. department_contacts — who gets notified. Seeded with demo/dummy
--    contacts; replace with your team's real department emails/numbers
--    before the SIH round.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS department_contacts (
  department_id     INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  department_name   VARCHAR(120) NOT NULL UNIQUE,
  email             VARCHAR(150) NOT NULL,
  phone             VARCHAR(20)  NULL,
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

INSERT INTO department_contacts (department_name, email, phone) VALUES
  ('Traffic Police Control Room', 'traffic.control@example.gov.in', '100'),
  ('Emergency Ambulance (108)',   'ambulance.108@example.gov.in',   '108'),
  ('BBMP Roads & Infra',          'bbmp.roads@example.gov.in',      NULL),
  ('BBMP Sanitation',             'bbmp.sanitation@example.gov.in', NULL)
ON DUPLICATE KEY UPDATE email = VALUES(email);

-- ---------------------------------------------------------------------
-- 3. department_issue_routes — which department(s) hear about which
--    issue type. Many-to-many: an accident goes to BOTH Traffic Police
--    and the Ambulance service, for example.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS department_issue_routes (
  route_id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  department_id     INT UNSIGNED NOT NULL,
  issue_type_id     TINYINT UNSIGNED NOT NULL,
  CONSTRAINT fk_route_department FOREIGN KEY (department_id) REFERENCES department_contacts(department_id) ON DELETE CASCADE,
  CONSTRAINT fk_route_issue_type FOREIGN KEY (issue_type_id) REFERENCES issue_types(issue_type_id) ON DELETE CASCADE,
  UNIQUE KEY uq_department_issue (department_id, issue_type_id)
) ENGINE=InnoDB;

INSERT IGNORE INTO department_issue_routes (department_id, issue_type_id)
SELECT d.department_id, t.issue_type_id
FROM department_contacts d
JOIN issue_types t
  ON (d.department_name = 'Traffic Police Control Room' AND t.type_key IN ('accident', 'heavy_traffic'))
  OR (d.department_name = 'Emergency Ambulance (108)'   AND t.type_key = 'accident')
  OR (d.department_name = 'BBMP Roads & Infra'           AND t.type_key = 'pothole')
  OR (d.department_name = 'BBMP Sanitation'              AND t.type_key = 'garbage');

-- ---------------------------------------------------------------------
-- 4. alert_log — audit trail of every notification the backend fires.
--    This is what the /alerts/{issue_code} API endpoint reads from,
--    and what proves (for your SIH demo/report) that the system really
--    does contact departments automatically.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS alert_log (
  alert_id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  issue_id          INT UNSIGNED NOT NULL,
  department_id     INT UNSIGNED NOT NULL,
  channel           ENUM('email','sms') NOT NULL DEFAULT 'email',
  status            ENUM('sent','simulated','failed') NOT NULL,
  error_message     VARCHAR(255) NULL,
  sent_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_alert_issue FOREIGN KEY (issue_id) REFERENCES issues(issue_id) ON DELETE CASCADE,
  CONSTRAINT fk_alert_department FOREIGN KEY (department_id) REFERENCES department_contacts(department_id)
) ENGINE=InnoDB;

-- Sanity check after loading — should show 2 rows (Traffic Police + Ambulance):
-- SELECT dc.department_name, dc.email FROM department_issue_routes r
--   JOIN department_contacts dc ON dc.department_id = r.department_id
--   JOIN issue_types it ON it.issue_type_id = r.issue_type_id
--   WHERE it.type_key = 'accident';
