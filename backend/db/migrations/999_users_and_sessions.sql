-- =============================================================
-- 999_users_and_sessions.sql
-- Auth-only tables them vao schema goc (18 bang) — chi server can.
-- =============================================================

-- 19. USERS — tai khoan KH/KTS/Admin
CREATE TABLE IF NOT EXISTS users (
  id              TEXT PRIMARY KEY,
  email           TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  year_born       INTEGER,
  phone_zalo      TEXT,
  role            TEXT NOT NULL DEFAULT 'client'
                  CHECK (role IN ('client','kts','engineer','admin','viewer')),
  status          TEXT NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active','disabled','pending')),
  last_login_at   TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_users_email  ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role   ON users(role);

-- 20. SESSIONS — JWT session tracking de revoke
CREATE TABLE IF NOT EXISTS sessions (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL,
  jti           TEXT NOT NULL UNIQUE,
  ip            TEXT,
  ua            TEXT,
  expires_at    TEXT NOT NULL,
  revoked       INTEGER NOT NULL DEFAULT 0 CHECK (revoked IN (0,1)),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_jti  ON sessions(jti);
