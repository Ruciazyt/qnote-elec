CREATE DATABASE IF NOT EXISTS qnote_catalog;

CREATE TABLE IF NOT EXISTS qnote_catalog.published_app (
  id VARCHAR(64) NOT NULL,
  name VARCHAR(255) NOT NULL DEFAULT '',
  description TEXT NOT NULL,
  author VARCHAR(128) NOT NULL DEFAULT '',
  manifest TEXT NOT NULL,
  repo_url VARCHAR(1024) NOT NULL DEFAULT '',
  tags VARCHAR(512) NOT NULL DEFAULT '',
  bundle MEDIUMTEXT NULL,
  version VARCHAR(32) NULL,
  dependencies TEXT NULL,
  pulls BIGINT NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL DEFAULT 0,
  updated_at BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY published_app_updated_at_idx (updated_at DESC)
);
