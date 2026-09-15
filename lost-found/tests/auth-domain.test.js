import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openDb } from "../src/db.js";
import {
  createUser,
  getUserById,
  getUserByUsername,
  authenticate,
  createSession,
  resolveSession,
  deleteSession,
  cleanupExpiredSessions,
  toPublicUser
} from "../src/auth.js";
import { HttpError } from "../src/http-utils.js";

function freshDb() {
  const dir = mkdtempSync(path.join(tmpdir(), "lostfound-auth-"));
  const db = openDb(path.join(dir, "test.db"));
  return { db, dir };
}

test("createUser 写入用户并返回不含密码的对象", () => {
  const { db, dir } = freshDb();
  const user = createUser(db, { username: "stu001", name: "张三", password: "pw123", role: "student" });

  assert.equal(user.username, "stu001");
  assert.equal(user.role, "student");
  assert.equal(user.status, "active");
  assert.ok(!("password_hash" in user));
  assert.deepEqual(toPublicUser(user), { id: user.id, username: "stu001", name: "张三", role: "student" });

  db.close();
  rmSync(dir, { recursive: true, force: true });
});

test("createUser 学号重复时抛 409", () => {
  const { db, dir } = freshDb();
  createUser(db, { username: "stu001", name: "张三", password: "pw123", role: "student" });
  assert.throws(
    () => createUser(db, { username: "stu001", name: "李四", password: "pw456", role: "student" }),
    (error) => error instanceof HttpError && error.status === 409 && error.code === "USERNAME_TAKEN"
  );
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

test("authenticate 正确密码返回用户，错误密码返回 invalid", () => {
  const { db, dir } = freshDb();
  const created = createUser(db, { username: "stu001", name: "张三", password: "pw123", role: "student" });

  const ok = authenticate(db, "stu001", "pw123");
  assert.equal(ok.ok, true);
  assert.equal(ok.user.id, created.id);

  assert.deepEqual(authenticate(db, "stu001", "wrong"), { ok: false, reason: "invalid" });
  assert.deepEqual(authenticate(db, "nobody", "pw123"), { ok: false, reason: "invalid" });

  db.close();
  rmSync(dir, { recursive: true, force: true });
});

test("被封禁的用户登录返回 banned", () => {
  const { db, dir } = freshDb();
  const user = createUser(db, { username: "stu001", name: "张三", password: "pw123", role: "student" });
  db.prepare("UPDATE users SET status = 'banned' WHERE id = ?").run(user.id);

  assert.deepEqual(authenticate(db, "stu001", "pw123"), { ok: false, reason: "banned" });
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

test("会话可以解析回用户，退出后失效", () => {
  const { db, dir } = freshDb();
  const user = createUser(db, { username: "stu001", name: "张三", password: "pw123", role: "student" });
  const token = createSession(db, user.id, { ttlMs: 60_000 });

  assert.equal(resolveSession(db, token).id, user.id);
  assert.equal(resolveSession(db, "not-a-token"), null);
  assert.equal(resolveSession(db, undefined), null);

  deleteSession(db, token);
  assert.equal(resolveSession(db, token), null);

  db.close();
  rmSync(dir, { recursive: true, force: true });
});

test("过期会话被拒绝并顺手删除", () => {
  const { db, dir } = freshDb();
  const user = createUser(db, { username: "stu001", name: "张三", password: "pw123", role: "student" });
  const token = createSession(db, user.id, { ttlMs: -1000 });

  assert.equal(resolveSession(db, token), null);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sessions").get().n, 0);

  db.close();
  rmSync(dir, { recursive: true, force: true });
});

test("用户被封禁后已有会话立即失效", () => {
  const { db, dir } = freshDb();
  const user = createUser(db, { username: "stu001", name: "张三", password: "pw123", role: "student" });
  const token = createSession(db, user.id, { ttlMs: 60_000 });
  db.prepare("UPDATE users SET status = 'banned' WHERE id = ?").run(user.id);

  assert.equal(resolveSession(db, token), null);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sessions").get().n, 0);

  db.close();
  rmSync(dir, { recursive: true, force: true });
});

test("cleanupExpiredSessions 只清理过期会话", () => {
  const { db, dir } = freshDb();
  const user = createUser(db, { username: "stu001", name: "张三", password: "pw123", role: "student" });
  const alive = createSession(db, user.id, { ttlMs: 60_000 });
  const expired = createSession(db, user.id, { ttlMs: -1000 });

  cleanupExpiredSessions(db);

  assert.equal(resolveSession(db, alive).id, user.id);
  assert.equal(db.prepare("SELECT token FROM sessions").all().map((row) => row.token).includes(expired), false);

  db.close();
  rmSync(dir, { recursive: true, force: true });
});

test("getUserById 与 getUserByUsername 查不到时返回 null", () => {
  const { db, dir } = freshDb();
  assert.equal(getUserById(db, 12345), null);
  assert.equal(getUserByUsername(db, "nobody"), null);
  db.close();
  rmSync(dir, { recursive: true, force: true });
});
