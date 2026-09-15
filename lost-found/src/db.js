import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { hashPassword } from "./password.js";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT    NOT NULL UNIQUE,
  name          TEXT    NOT NULL,
  password_hash TEXT    NOT NULL,
  password_salt TEXT    NOT NULL,
  role          TEXT    NOT NULL CHECK (role IN ('student', 'admin')),
  status        TEXT    NOT NULL CHECK (status IN ('active', 'banned')) DEFAULT 'active',
  created_at    TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        TEXT    NOT NULL CHECK (type IN ('lost', 'found')),
  title       TEXT    NOT NULL,
  description TEXT    NOT NULL,
  place       TEXT    NOT NULL,
  happened_at TEXT    NOT NULL,
  contact     TEXT    NOT NULL,
  photo       BLOB,
  photo_type  TEXT,
  status      TEXT    NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'returned')) DEFAULT 'pending',
  review_note TEXT,
  reviewed_by INTEGER REFERENCES users(id),
  reviewed_at TEXT,
  created_at  TEXT    NOT NULL,
  updated_at  TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS claims (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id    INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message    TEXT    NOT NULL,
  status     TEXT    NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')) DEFAULT 'pending',
  created_at TEXT    NOT NULL,
  decided_at TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT    PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT    NOT NULL,
  expires_at TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_items_status_created ON items(status, created_at);
CREATE INDEX IF NOT EXISTS idx_items_user           ON items(user_id);
CREATE INDEX IF NOT EXISTS idx_claims_item          ON claims(item_id);
CREATE INDEX IF NOT EXISTS idx_claims_user          ON claims(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user        ON sessions(user_id);
`;

export function openDb(dbPath, { demoAccounts = [] } = {}) {
  if (dbPath !== ":memory:") {
    mkdirSync(path.dirname(dbPath), { recursive: true });
  }

  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(SCHEMA);

  for (const account of demoAccounts) {
    seedAccount(db, account);
  }

  return db;
}

function seedAccount(db, { username, name, password, role }) {
  const existing = db.prepare("SELECT id FROM users WHERE username = ?").get(username);
  if (existing) {
    return;
  }

  const { hash, salt } = hashPassword(password);
  db.prepare(
    `INSERT INTO users (username, name, password_hash, password_salt, role, status, created_at)
     VALUES (?, ?, ?, ?, ?, 'active', ?)`
  ).run(username, name, hash, salt, role, new Date().toISOString());
}
