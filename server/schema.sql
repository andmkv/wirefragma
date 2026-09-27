-- Wirefragma accounts + projects schema.
-- MySQL 5.7+ / MariaDB 10.2+ (Namecheap shared hosting). Import once via phpMyAdmin
-- (Import tab) or: mysql -u USER -p DATABASE < schema.sql
-- Safe to re-run: every statement is IF NOT EXISTS.

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS wf_users (
  id                 INT UNSIGNED NOT NULL AUTO_INCREMENT,
  email              VARCHAR(191) NOT NULL,
  password_hash      VARCHAR(255) NOT NULL,
  display_name       VARCHAR(80)  NOT NULL DEFAULT '',
  email_verified_at  DATETIME     NULL,
  privacy_version    VARCHAR(20)  NOT NULL,
  privacy_accepted_at DATETIME    NOT NULL,
  created_at         DATETIME     NOT NULL,
  updated_at         DATETIME     NOT NULL,
  last_login_at      DATETIME     NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_wf_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS wf_email_tokens (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id     INT UNSIGNED NOT NULL,
  purpose     VARCHAR(16)  NOT NULL,          -- 'verify' | 'reset'
  token_hash  CHAR(64)     NOT NULL,          -- sha256 of the emailed token
  expires_at  DATETIME     NOT NULL,
  used_at     DATETIME     NULL,
  created_at  DATETIME     NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_wf_email_tokens_hash (token_hash),
  KEY ix_wf_email_tokens_user (user_id, purpose),
  CONSTRAINT fk_wf_email_tokens_user FOREIGN KEY (user_id) REFERENCES wf_users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS wf_projects (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id     INT UNSIGNED NOT NULL,
  name        VARCHAR(120) NOT NULL,
  position    INT          NOT NULL DEFAULT 0,
  created_at  DATETIME     NOT NULL,
  updated_at  DATETIME     NOT NULL,
  PRIMARY KEY (id),
  KEY ix_wf_projects_user (user_id, position),
  CONSTRAINT fk_wf_projects_user FOREIGN KEY (user_id) REFERENCES wf_users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS wf_wireframes (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  project_id  INT UNSIGNED NOT NULL,
  user_id     INT UNSIGNED NOT NULL,
  title       VARCHAR(160) NOT NULL,
  data        MEDIUMTEXT   NOT NULL,          -- the WireframeProject JSON (same as the ui-project block)
  revision    INT UNSIGNED NOT NULL DEFAULT 1,
  position    INT          NOT NULL DEFAULT 0,
  created_at  DATETIME     NOT NULL,
  updated_at  DATETIME     NOT NULL,
  PRIMARY KEY (id),
  KEY ix_wf_wireframes_project (project_id, position),
  KEY ix_wf_wireframes_user (user_id),
  CONSTRAINT fk_wf_wireframes_project FOREIGN KEY (project_id) REFERENCES wf_projects (id) ON DELETE CASCADE,
  CONSTRAINT fk_wf_wireframes_user FOREIGN KEY (user_id) REFERENCES wf_users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS wf_rate_limits (
  bucket        CHAR(64)     NOT NULL,        -- sha256(action + key)
  window_start  INT UNSIGNED NOT NULL,        -- unix time
  hits          INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
