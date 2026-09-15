import { HttpError, parseCookies, readJsonBody, serializeCookie } from "./http-utils.js";
import { createToken, hashPassword, verifyPassword } from "./password.js";
import { requirePassword, requireString, requireUsername } from "./validate.js";

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

// ---------------------------------------------------------------------------
// 以下为 HTTP 接口处理函数。签名统一为 (ctx) => Promise<{ status, body }>，
// ctx 结构：{ req, res, db, config, params, query, user }
// ---------------------------------------------------------------------------

function setSessionCookie(res, token, config) {
  res.setHeader(
    "Set-Cookie",
    serializeCookie(config.cookieName, token, {
      maxAge: Math.floor(config.sessionTtlMs / 1000),
      sameSite: "Lax"
    })
  );
}

function clearSessionCookie(res, config) {
  res.setHeader("Set-Cookie", serializeCookie(config.cookieName, "", { maxAge: 0, sameSite: "Lax" }));
}

async function readCredentials(ctx) {
  const body = await readJsonBody(ctx.req, ctx.config.maxJsonBytes);
  return {
    username: requireUsername(body.username),
    password: requirePassword(body.password),
    name: body.name === undefined ? undefined : requireString(body.name, { label: "姓名", max: 30 })
  };
}

function login(db, res, config, username, password, expectedRole) {
  const result = authenticate(db, username, password);

  if (!result.ok) {
    if (result.reason === "banned") {
      throw new HttpError(403, "ACCOUNT_BANNED", "账号已被封禁，请联系管理员");
    }
    throw new HttpError(401, "INVALID_CREDENTIALS", "学号或密码不正确");
  }

  if (result.user.role !== expectedRole) {
    throw new HttpError(403, "WRONG_ENTRY", expectedRole === "admin" ? "该账号不是管理员账号" : "该账号不是学生账号");
  }

  const token = createSession(db, result.user.id, { ttlMs: config.sessionTtlMs });
  setSessionCookie(res, token, config);

  return { status: 200, body: { user: toPublicUser(result.user) } };
}

export async function handleRegister(ctx) {
  const { username, password, name } = await readCredentials(ctx);

  if (name === undefined) {
    throw new HttpError(400, "INVALID_INPUT", "姓名不能为空");
  }

  const user = createUser(ctx.db, { username, name, password, role: "student" });
  const token = createSession(ctx.db, user.id, { ttlMs: ctx.config.sessionTtlMs });
  setSessionCookie(ctx.res, token, ctx.config);

  return { status: 201, body: { user: toPublicUser(user) } };
}

export async function handleStudentLogin(ctx) {
  const { username, password } = await readCredentials(ctx);
  return login(ctx.db, ctx.res, ctx.config, username, password, "student");
}

export async function handleAdminLogin(ctx) {
  const { username, password } = await readCredentials(ctx);
  return login(ctx.db, ctx.res, ctx.config, username, password, "admin");
}

export async function handleLogout(ctx) {
  const cookies = parseCookies(ctx.req.headers.cookie);
  deleteSession(ctx.db, cookies[ctx.config.cookieName]);
  clearSessionCookie(ctx.res, ctx.config);

  return { status: 200, body: { ok: true } };
}

export async function handleMe(ctx) {
  return { status: 200, body: { user: toPublicUser(ctx.user) } };
}
