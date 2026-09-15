import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openDb } from "../src/db.js";
import { verifyPassword } from "../src/password.js";

function tempDbPath() {
  const dir = mkdtempSync(path.join(tmpdir(), "lostfound-db-"));
  return { dir, file: path.join(dir, "test.db") };
}

const DEMO = [
  { username: "123", name: "系统管理员", password: "456", role: "admin" },
  { username: "111", name: "演示学生", password: "222", role: "student" }
];

test("建库后四张表都存在", () => {
  const { dir, file } = tempDbPath();
  const db = openDb(file, { demoAccounts: DEMO });
  // 过滤 SQLite 内部表（AUTOINCREMENT 会自带 sqlite_sequence），只断言业务表
  const names = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    )
    .all()
    .map((row) => row.name);
  assert.deepEqual(names, ["claims", "items", "sessions", "users"]);
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

test("演示账号被写入，密码可以校验通过", () => {
  const { dir, file } = tempDbPath();
  const db = openDb(file, { demoAccounts: DEMO });

  const admin = db.prepare("SELECT * FROM users WHERE username = ?").get("123");
  assert.equal(admin.role, "admin");
  assert.equal(admin.status, "active");
  assert.equal(verifyPassword("456", admin.password_hash, admin.password_salt), true);
  assert.equal(verifyPassword("457", admin.password_hash, admin.password_salt), false);

  const student = db.prepare("SELECT * FROM users WHERE username = ?").get("111");
  assert.equal(student.role, "student");
  assert.equal(verifyPassword("222", student.password_hash, student.password_salt), true);

  db.close();
  rmSync(dir, { recursive: true, force: true });
});

test("重复初始化不会重复插入演示账号", () => {
  const { dir, file } = tempDbPath();
  openDb(file, { demoAccounts: DEMO }).close();
  const db = openDb(file, { demoAccounts: DEMO });
  const count = db.prepare("SELECT COUNT(*) AS n FROM users").get().n;
  assert.equal(count, 2);
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

test("不传 demoAccounts 时不写入任何账号", () => {
  const { dir, file } = tempDbPath();
  const db = openDb(file);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM users").get().n, 0);
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

test("数据库目录不存在时会自动创建", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "lostfound-db-"));
  const file = path.join(dir, "nested", "deeper", "app.db");
  const db = openDb(file);
  assert.ok(db.prepare("SELECT COUNT(*) AS n FROM users").get().n === 0);
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

test("外键约束生效：插入不存在的 user_id 会被拒绝", () => {
  const { dir, file } = tempDbPath();
  const db = openDb(file);
  assert.throws(() => {
    db.prepare(
      "INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)"
    ).run("t", 999, "2026-01-01T00:00:00.000Z", "2026-01-08T00:00:00.000Z");
  }, /FOREIGN KEY/i);
  db.close();
  rmSync(dir, { recursive: true, force: true });
});
