-- Apply explicitly during deployment; never auto-run from the service.
CREATE TABLE IF NOT EXISTS auth_oidc_artifacts (
  model VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  id VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  payload MEDIUMTEXT NOT NULL,
  expires_at BIGINT NOT NULL,
  grant_id VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NULL,
  user_code VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NULL,
  uid VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NULL,
  consumed BIGINT NULL,
  PRIMARY KEY (model, id),
  INDEX idx_oidc_grant (grant_id),
  INDEX idx_oidc_uid (model, uid),
  INDEX idx_oidc_user_code (model, user_code),
  INDEX idx_oidc_expiry (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
