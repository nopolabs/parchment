CREATE TABLE IF NOT EXISTS certificates (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id     TEXT    NOT NULL,
  name        TEXT    NOT NULL,
  achievement TEXT    NOT NULL,
  r2_key      TEXT    NOT NULL UNIQUE,
  serial      TEXT    NOT NULL,
  email       TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
