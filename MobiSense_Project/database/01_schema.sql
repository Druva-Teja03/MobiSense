-- =====================================================================
-- MobiSense — Database Schema (MySQL 8.0+)
-- Backend + Database module — Druva Teja & Dhanya
-- =====================================================================
-- Design notes:
--   - MySQL 8.0 has real GIS support (POINT/GEOMETRY + SPATIAL INDEX +
--     ST_Distance_Sphere). We use that instead of plain lat/lng math,
--     so the dedup logic below is conceptually IDENTICAL to what you'll
--     write in PostGIS later (ST_DWithin). Porting to Postgres will
--     mostly be a syntax swap, not a redesign.
--   - "Same location" detections get merged into one open `issues` row
--     until it is resolved. Every raw detection is still kept in
--     `issue_detections` for audit/history — nothing is thrown away.
-- =====================================================================

CREATE DATABASE IF NOT EXISTS mobisense_db
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE mobisense_db;

-- ---------------------------------------------------------------------
-- 1. issue_types — lookup table so dedup radius is configurable per type
-- ---------------------------------------------------------------------
CREATE TABLE issue_types (
  issue_type_id     TINYINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  type_key          VARCHAR(40)  NOT NULL UNIQUE,   -- 'pothole','garbage','heavy_traffic','illegal_parking'
  display_name      VARCHAR(80)  NOT NULL,
  dedup_radius_m    SMALLINT UNSIGNED NOT NULL DEFAULT 15, -- meters; how close = "same spot"
  created_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

INSERT INTO issue_types (type_key, display_name, dedup_radius_m) VALUES
  ('pothole',        'Pothole',           15),
  ('garbage',        'Garbage Dump',      15),
  ('heavy_traffic',  'Heavy Traffic',     30),
  ('illegal_parking','Illegal Parking',   15);

-- ---------------------------------------------------------------------
-- 2. verified_employees — whitelist that stands in for a Govt HR feed.
--    In the real hackathon build this would be an API call to a govt
--    system; for the prototype we seed it manually as the "source of
--    truth" for who is allowed to act as a field-incharge.
-- ---------------------------------------------------------------------
CREATE TABLE verified_employees (
  govt_id_number    VARCHAR(50) PRIMARY KEY,
  full_name         VARCHAR(120) NOT NULL,
  department        VARCHAR(120) NOT NULL,
  designation       VARCHAR(120) NOT NULL,
  is_active         BOOLEAN NOT NULL DEFAULT TRUE
) ENGINE=InnoDB;

-- Seed a couple of demo govt IDs so signup has something to match against.
INSERT INTO verified_employees (govt_id_number, full_name, department, designation) VALUES
  ('BBMP-EMP-1001', 'Demo Field Officer', 'BBMP Roads & Infra', 'Junior Engineer'),
  ('BEL-EMP-2002',  'Demo BEL Liaison',   'Bharat Electronics Limited', 'Systems Analyst');

-- ---------------------------------------------------------------------
-- 3. users — anyone who can log into the dashboard
-- ---------------------------------------------------------------------
CREATE TABLE users (
  user_id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  full_name         VARCHAR(120) NOT NULL,
  email             VARCHAR(150) NOT NULL UNIQUE,
  password_hash     VARCHAR(255) NOT NULL,
  job_title         VARCHAR(120) NOT NULL,
  govt_id_number    VARCHAR(50)  NOT NULL UNIQUE,
  role              ENUM('pending','field_officer','admin') NOT NULL DEFAULT 'pending',
  is_verified       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_login_at     TIMESTAMP NULL,
  CONSTRAINT fk_user_govt_id
    FOREIGN KEY (govt_id_number) REFERENCES verified_employees(govt_id_number)
    ON UPDATE CASCADE
) ENGINE=InnoDB;

-- NOTE: the FK above means signup will only succeed if the govt ID the
-- user typed already exists in verified_employees. That is what enforces
-- "must be Govt-registered / a related field-incharge" at the DB level,
-- not just in the UI. See backend/auth logic for the friendly error.

-- ---------------------------------------------------------------------
-- 4. issues — the deduplicated, map-facing table (what dashboard.js reads)
-- ---------------------------------------------------------------------
CREATE TABLE issues (
  issue_id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  issue_code        VARCHAR(20)  NOT NULL UNIQUE,     -- e.g. 'ISSUE-000123', shown in UI
  issue_type_id     TINYINT UNSIGNED NOT NULL,
  lat               DECIMAL(10,7) NOT NULL,
  lng               DECIMAL(10,7) NOT NULL,
  geo_point         POINT NOT NULL SRID 4326,         -- (lng, lat) — used for distance queries
  status            ENUM('unresolved','in_progress','resolved') NOT NULL DEFAULT 'unresolved',
  severity          VARCHAR(20) NULL,                 -- garbage: low/moderate/high
  traffic_level     VARCHAR(20) NULL,                 -- traffic: low/moderate/heavy
  detection_count   INT UNSIGNED NOT NULL DEFAULT 1,  -- how many raw detections merged into this
  first_detected_at TIMESTAMP NOT NULL,
  last_detected_at  TIMESTAMP NOT NULL,
  resolved_at       TIMESTAMP NULL,
  resolved_by       INT UNSIGNED NULL,
  assigned_to       INT UNSIGNED NULL,
  created_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_issue_type FOREIGN KEY (issue_type_id) REFERENCES issue_types(issue_type_id),
  CONSTRAINT fk_issue_resolved_by FOREIGN KEY (resolved_by) REFERENCES users(user_id),
  CONSTRAINT fk_issue_assigned_to FOREIGN KEY (assigned_to) REFERENCES users(user_id),
  SPATIAL INDEX idx_issue_geo (geo_point),
  INDEX idx_issue_type_status (issue_type_id, status)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 5. issue_detections — raw audit log of every single AI detection event
--    (this is what your YOLO scripts / ai-detection folder should POST to)
-- ---------------------------------------------------------------------
CREATE TABLE issue_detections (
  detection_id      BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  issue_id          INT UNSIGNED NOT NULL,
  issue_type_id     TINYINT UNSIGNED NOT NULL,
  lat               DECIMAL(10,7) NOT NULL,
  lng               DECIMAL(10,7) NOT NULL,
  geo_point         POINT NOT NULL SRID 4326,
  vehicle_count     INT UNSIGNED NULL,
  traffic_level     VARCHAR(20) NULL,
  item_count        INT UNSIGNED NULL,
  severity          VARCHAR(20) NULL,
  source_image      VARCHAR(255) NULL,
  detected_at       TIMESTAMP NOT NULL,
  created_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_detection_issue FOREIGN KEY (issue_id) REFERENCES issues(issue_id) ON DELETE CASCADE,
  CONSTRAINT fk_detection_type FOREIGN KEY (issue_type_id) REFERENCES issue_types(issue_type_id),
  SPATIAL INDEX idx_detection_geo (geo_point)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 6. issue_status_history — audit trail (who resolved/reopened what)
-- ---------------------------------------------------------------------
CREATE TABLE issue_status_history (
  history_id        BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  issue_id          INT UNSIGNED NOT NULL,
  old_status        VARCHAR(20) NOT NULL,
  new_status        VARCHAR(20) NOT NULL,
  changed_by        INT UNSIGNED NULL,
  changed_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_history_issue FOREIGN KEY (issue_id) REFERENCES issues(issue_id) ON DELETE CASCADE,
  CONSTRAINT fk_history_user FOREIGN KEY (changed_by) REFERENCES users(user_id)
) ENGINE=InnoDB;
