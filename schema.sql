-- ============================================================
-- BADSHAH — Citizen Registration Portal
-- Database: MySQL 8.0+ / Standard SQL Compatible
-- ============================================================

CREATE TABLE citizens (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  full_name     VARCHAR(255)   NOT NULL,
  mobile        CHAR(10)       NOT NULL,
  aadhaar       CHAR(12)       NOT NULL,
  dob           DATE           NOT NULL,
  address       TEXT           NOT NULL,
  photo_path    VARCHAR(500),
  registered_at TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,

  -- Enforce uniqueness at DB layer
  CONSTRAINT uq_citizens_mobile  UNIQUE (mobile),
  CONSTRAINT uq_citizens_aadhaar UNIQUE (aadhaar)
);

-- Indexes for duplicate pre-checks and search
CREATE INDEX idx_citizens_mobile   ON citizens(mobile);
CREATE INDEX idx_citizens_aadhaar  ON citizens(aadhaar);
CREATE INDEX idx_citizens_name     ON citizens(full_name);
CREATE INDEX idx_citizens_reg_at   ON citizens(registered_at DESC);

-- Audit log: every INSERT is recorded
CREATE TABLE audit_log (
  log_id      INT AUTO_INCREMENT PRIMARY KEY,
  citizen_id  INT,
  event_type  VARCHAR(50)  NOT NULL,   -- 'INSERT' | 'UPDATE' | 'DELETE'
  changed_by  VARCHAR(100),            -- operator username
  event_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  metadata    JSON,                    -- JSON format for row snapshot
  FOREIGN KEY (citizen_id) REFERENCES citizens(id) ON DELETE SET NULL
);

CREATE INDEX idx_audit_citizen ON audit_log(citizen_id);
CREATE INDEX idx_audit_event   ON audit_log(event_at DESC);

-- Trigger: auto-populate audit_log on new citizen INSERT (MySQL syntax)
DELIMITER $$
CREATE TRIGGER trg_citizen_insert
AFTER INSERT ON citizens
FOR EACH ROW
BEGIN
  INSERT INTO audit_log (citizen_id, event_type, metadata)
  VALUES (
    NEW.id, 
    'INSERT', 
    JSON_OBJECT(
      'id', NEW.id,
      'full_name', NEW.full_name,
      'mobile', NEW.mobile,
      'aadhaar', NEW.aadhaar,
      'dob', CAST(NEW.dob AS CHAR),
      'address', NEW.address,
      'photo_path', NEW.photo_path,
      'registered_at', CAST(NEW.registered_at AS CHAR)
    )
  );
END$$
DELIMITER ;
