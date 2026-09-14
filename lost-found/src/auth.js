import { HttpError } from "./http-utils.js";
import { createToken, hashPassword, verifyPassword } from "./password.js";

const PUBLIC_COLUMNS = "id, username, name, role, status, created_at";

export function createUser(db, { username, name, password, role = "student" }) {
  const { hash, salt } = hashPassword(password);

  try {
    const info = db
      .prepare(
        `INSERT INTO users (username, name, password_hash, password_salt, role, status, created_at)
         VALUES (?, ?, ?, ?, ?, 'active', ?)`
      )
      .run(username, name, hash, salt, role, new Date().toISOString());

    return getUserById(db, Number(info.lastInsertRowid));
  } catch (error) {
    if (String(error.message).includes("UNIQUE")) {
      throw new HttpError(409, "USERNAME_TAKEN", "该学号已被注册");
    }
    throw error;
  }
}

export function getUserById(db, id) {
  return db.prepare(`SELECT ${PUBLIC_COLUMNS} FROM users WHERE id = ?`).get(id) ?? null;
}

export function getUserByUsername(db, username) {
  return (
    db
      .prepare(`SELECT ${PUBLIC_COLUMNS}, password_hash, password_salt FROM users WHERE username = ?`)
      .get(username) ?? null
  );
}

export function authenticate(db, username, password) {
  const user = getUserByUsername(db, username);

  if (!user || !verifyPassword(password, user.password_hash, user.password_salt)) {
    return { ok: false, reason: "invalid" };
  }
  if (user.status === "banned") {
    return { ok: false, reason: "banned" };
  }

  return { ok: true, user };
}

export function createSession(db, userId, { ttlMs }) {
  const token = createToken();
  const now = Date.now();

  db.prepare("INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)").run(
    token,
    userId,
    new Date(now).toISOString(),
    new Date(now + ttlMs).toISOString()
  );

  return token;
}

export function resolveSession(db, token) {
  if (!token) {
    return null;
  }

  const session = db.prepare("SELECT * FROM sessions WHERE token = ?").get(token);
  if (!session) {
    return null;
  }

  if (new Date(session.expires_at).getTime() <= Date.now()) {
    deleteSession(db, token);
    return null;
  }

  const user = getUserById(db, session.user_id);
  if (!user || user.status === "banned") {
    deleteSession(db, token);
    return null;
  }

  return user;
}

export function deleteSession(db, token) {
  if (token) {
    db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
  }
}

export function cleanupExpiredSessions(db, now = new Date()) {
  db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now.toISOString());
}

export function toPublicUser(user) {
  return { id: user.id, username: user.username, name: user.name, role: user.role };
}
