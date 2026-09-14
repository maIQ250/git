# 校园失物招领系统 · 第一阶段（骨架 + 数据库 + 认证）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 搭出零依赖的 Node 服务骨架，建好数据库与演示账号，并跑通「注册 / 登录 / 退出 / 当前身份」四个认证接口。

**Architecture:** 单进程 Node HTTP 服务，`node:sqlite` 做持久化。数据库连接由 `server.js` 创建后注入路由工厂，领域函数一律把 `db` 作为第一个参数，不使用模块级全局状态，因此测试可以给每个用例开一个独立的临时数据库。业务错误统一用 `HttpError` 抛出，由路由层转成 `{ error: { code, message } }`。

**Tech Stack:** Node.js 24 内置模块（`node:http`、`node:sqlite`、`node:crypto`、`node:test`），ESM 模块，零第三方依赖。

**Spec:** `lost-found/docs/spec.md`

## Global Constraints

以下规则对每一个 Task 都生效，逐字来自 spec：

- 运行时为 Node.js 24，**package.json 不得出现 dependencies 或 devDependencies**
- 代码风格为 ESM：package.json 设 `"type": "module"`，用 `import.meta.dirname` 取目录
- 所有 SQL 使用参数化查询，禁止字符串拼接 SQL
- 时间统一存 UTC ISO-8601 字符串；用户填写的日期字段为 `YYYY-MM-DD`
- 错误响应统一为 `{ "error": { "code": "SOME_CODE", "message": "中文说明" } }`
- 演示账号：管理员 `123` / 密码 `456`，学生 `111` / 密码 `222`
- 会话 Cookie 名 `sid`，属性 `HttpOnly; SameSite=Lax; Path=/`，有效期 7 天（`Max-Age=604800`）
- 密码使用 `scrypt(password, salt, 64)`，每个用户独立 16 字节随机盐，校验用 `timingSafeEqual`
- 请求体上限：JSON 64KB，图片 2MB（图片在第二阶段使用）

本阶段实现时补的三条细则（spec 未写死，实现前先记在这里）：

- 学号 / 账号规则：长度 3–20，允许字母、数字、下划线、连字符
- 密码规则：长度 3–64（演示密码 `456` 必须能通过校验）
- 学生登录接口只接受 `role = student` 的账号，管理员登录接口只接受 `role = admin` 的账号，
  拿学生账号去管理员入口登录会被拒绝

## 文件结构

| 文件 | 职责 |
| --- | --- |
| `lost-found/.gitignore` | 忽略 `data/`、`node_modules/`、`*.log` |
| `lost-found/package.json` | 项目元信息与脚本，无依赖 |
| `lost-found/src/config.js` | 配置读取，`readConfig(env)` 可注入环境变量 |
| `lost-found/src/password.js` | scrypt 哈希、密码校验、随机令牌生成 |
| `lost-found/src/db.js` | 打开数据库、建表、写入演示账号 |
| `lost-found/src/http-utils.js` | 请求体读取、JSON 响应、Cookie 序列化、错误类与错误输出 |
| `lost-found/src/validate.js` | 输入校验与清洗 |
| `lost-found/src/auth.js` | 用户、会话、权限判定，以及认证接口的处理函数 |
| `lost-found/src/router.js` | 路由表、匹配、鉴权、统一错误兜底 |
| `lost-found/server.js` | 入口：建库、起服务 |
| `lost-found/tests/helpers.js` | 测试用临时服务与请求助手 |
| `lost-found/tests/*.test.js` | 各模块与接口测试 |

> 说明：spec 的文件结构把认证接口的处理函数放在 `src/auth.js`。本阶段照此执行；如果该文件超过约 250 行，
> 再拆出 `src/routes/auth-routes.js`，拆分属于实现细节，不需要改 spec。

---

## Task 1: 项目骨架与配置

**Files:**
- Create: `lost-found/.gitignore`
- Create: `lost-found/package.json`
- Create: `lost-found/src/config.js`
- Test: `lost-found/tests/config.test.js`

**Interfaces:**
- Consumes: 无
- Produces:
  - `readConfig(env = process.env) -> Config`
  - `config: Config`（默认导出实例）
  - `Config` 字段：`port:number`、`dbPath:string`、`sessionTtlMs:number`、`maxJsonBytes:number`、`maxPhotoBytes:number`、`pageSizeDefault:number`、`pageSizeMax:number`、`searchMaxLength:number`、`cookieName:string`、`demoAccounts:Array<{username,name,password,role}>`

- [ ] **Step 1: 写失败的测试**

创建 `lost-found/tests/config.test.js`：

```js
import test from "node:test";
import assert from "node:assert/strict";
import { readConfig } from "../src/config.js";

test("默认配置使用 3000 端口和 data/app.db", () => {
  const config = readConfig({});
  assert.equal(config.port, 3000);
  assert.match(config.dbPath, /data[\\/]app\.db$/);
  assert.equal(config.cookieName, "sid");
  assert.equal(config.sessionTtlMs, 7 * 24 * 60 * 60 * 1000);
});

test("环境变量可以覆盖端口和数据库路径", () => {
  const config = readConfig({ PORT: "4100", DB_PATH: "/tmp/custom.db" });
  assert.equal(config.port, 4100);
  assert.equal(config.dbPath, "/tmp/custom.db");
});

test("端口非法时回退到默认值", () => {
  assert.equal(readConfig({ PORT: "abc" }).port, 3000);
  assert.equal(readConfig({ PORT: "-1" }).port, 3000);
  assert.equal(readConfig({ PORT: "0" }).port, 3000);
});

test("内置两个演示账号：管理员 123/456，学生 111/222", () => {
  const config = readConfig({});
  assert.deepEqual(config.demoAccounts, [
    { username: "123", name: "系统管理员", password: "456", role: "admin" },
    { username: "111", name: "演示学生", password: "222", role: "student" }
  ]);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd lost-found && node --test tests/config.test.js`
Expected: FAIL，报错 `Cannot find module '../src/config.js'`

- [ ] **Step 3: 写实现**

`lost-found/src/config.js`：

```js
import path from "node:path";

export const DEFAULT_PORT = 3000;

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export function readConfig(env = process.env) {
  const port = Number(env.PORT);

  return {
    port: Number.isInteger(port) && port > 0 ? port : DEFAULT_PORT,
    dbPath: env.DB_PATH || path.join(import.meta.dirname, "..", "data", "app.db"),
    sessionTtlMs: WEEK_MS,
    maxJsonBytes: 64 * 1024,
    maxPhotoBytes: 2 * 1024 * 1024,
    pageSizeDefault: 12,
    pageSizeMax: 50,
    searchMaxLength: 50,
    cookieName: "sid",
    demoAccounts: [
      { username: "123", name: "系统管理员", password: "456", role: "admin" },
      { username: "111", name: "演示学生", password: "222", role: "student" }
    ]
  };
}

export const config = readConfig();
```

`lost-found/package.json`：

```json
{
  "name": "lost-found",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "校园失物招领系统",
  "scripts": {
    "start": "node server.js",
    "test": "node --test tests/"
  }
}
```

`lost-found/.gitignore`：

```
data/
node_modules/
*.log
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd lost-found && node --test tests/config.test.js`
Expected: PASS，4 个测试全部通过

- [ ] **Step 5: 提交**

```bash
git add lost-found/.gitignore lost-found/package.json lost-found/src/config.js lost-found/tests/config.test.js
git commit -m "feat(lost-found): add project skeleton and config"
```

---

## Task 2: 密码哈希与会话令牌

**Files:**
- Create: `lost-found/src/password.js`
- Test: `lost-found/tests/password.test.js`

**Interfaces:**
- Consumes: 无
- Produces:
  - `hashPassword(password: string) -> { hash: string, salt: string }`
  - `verifyPassword(password: string, hash: string, salt: string) -> boolean`
  - `createToken() -> string`（64 位十六进制）

- [ ] **Step 1: 写失败的测试**

创建 `lost-found/tests/password.test.js`：

```js
import test from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword, createToken } from "../src/password.js";

test("哈希结果含 hash 与 salt，且不包含明文密码", () => {
  const { hash, salt } = hashPassword("456");
  assert.equal(hash.length, 128);
  assert.equal(salt.length, 32);
  assert.ok(!hash.includes("456"));
});

test("同一个密码两次哈希得到不同的盐与哈希", () => {
  const first = hashPassword("456");
  const second = hashPassword("456");
  assert.notEqual(first.salt, second.salt);
  assert.notEqual(first.hash, second.hash);
});

test("正确密码校验通过，错误密码校验失败", () => {
  const { hash, salt } = hashPassword("456");
  assert.equal(verifyPassword("456", hash, salt), true);
  assert.equal(verifyPassword("457", hash, salt), false);
  assert.equal(verifyPassword("", hash, salt), false);
});

test("哈希被篡改时校验失败而不是抛异常", () => {
  const { hash, salt } = hashPassword("456");
  assert.equal(verifyPassword("456", "00", salt), false);
  assert.equal(verifyPassword("456", hash, "zz"), false);
});

test("令牌是 64 位十六进制且每次不同", () => {
  const first = createToken();
  const second = createToken();
  assert.match(first, /^[0-9a-f]{64}$/);
  assert.notEqual(first, second);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd lost-found && node --test tests/password.test.js`
Expected: FAIL，报错找不到 `../src/password.js`

- [ ] **Step 3: 写实现**

`lost-found/src/password.js`：

```js
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const KEY_LENGTH = 64;
const SALT_BYTES = 16;
const TOKEN_BYTES = 32;

export function hashPassword(password) {
  const salt = randomBytes(SALT_BYTES).toString("hex");
  return { hash: scryptSync(password, salt, KEY_LENGTH).toString("hex"), salt };
}

export function verifyPassword(password, hash, salt) {
  let expected;
  try {
    expected = Buffer.from(hash, "hex");
  } catch {
    return false;
  }

  // 长度不一致说明存储被破坏，直接判定失败，避免 timingSafeEqual 抛异常
  if (expected.length !== KEY_LENGTH) {
    return false;
  }

  const actual = scryptSync(password, salt, KEY_LENGTH);
  return timingSafeEqual(actual, expected);
}

export function createToken() {
  return randomBytes(TOKEN_BYTES).toString("hex");
}
```

> 注意：`Buffer.from("zz", "hex")` 得到空 Buffer 而不抛异常，所以上面的长度判断同时覆盖了非法 hex 的情况。

- [ ] **Step 4: 运行测试确认通过**

Run: `cd lost-found && node --test tests/password.test.js`
Expected: PASS，5 个测试全部通过

- [ ] **Step 5: 提交**

```bash
git add lost-found/src/password.js lost-found/tests/password.test.js
git commit -m "feat(lost-found): add password hashing and token generation"
```

---

## Task 3: 数据库初始化与演示账号

**Files:**
- Create: `lost-found/src/db.js`
- Test: `lost-found/tests/db.test.js`

**Interfaces:**
- Consumes: `hashPassword`（Task 2）、`demoAccounts`（Task 1）
- Produces:
  - `openDb(dbPath: string, options?: { demoAccounts?: Array }) -> DatabaseSync`
  - `openDb` 会创建目录、开启外键、建 4 张表、按需写入演示账号
  - 建表语句覆盖 `users` / `items` / `claims` / `sessions` 四张表（本阶段只用 users 与 sessions，另外两张先建好，避免后续加迁移）

- [ ] **Step 1: 写失败的测试**

创建 `lost-found/tests/db.test.js`：

```js
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
  const names = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
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
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd lost-found && node --test tests/db.test.js`
Expected: FAIL，报错找不到 `../src/db.js`

- [ ] **Step 3: 写实现**

`lost-found/src/db.js`：

```js
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
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd lost-found && node --test tests/db.test.js`
Expected: PASS，6 个测试全部通过。若出现 `ExperimentalWarning: SQLite is an experimental feature`，属正常提示，不影响结果

- [ ] **Step 5: 提交**

```bash
git add lost-found/src/db.js lost-found/tests/db.test.js
git commit -m "feat(lost-found): add sqlite schema and demo account seeding"
```

---

## Task 4: HTTP 工具层

**Files:**
- Create: `lost-found/src/http-utils.js`
- Test: `lost-found/tests/http-utils.test.js`

**Interfaces:**
- Consumes: 无
- Produces:
  - `class HttpError extends Error`，字段 `status:number`、`code:string`
  - `readRawBody(req, maxBytes: number) -> Promise<Buffer>`，超限抛 `HttpError(413, "PAYLOAD_TOO_LARGE")`
  - `readJsonBody(req, maxBytes: number) -> Promise<object>`，非法 JSON 抛 `HttpError(400, "INVALID_JSON")`
  - `sendJson(res, status: number, body: any) -> void`
  - `parseCookies(header?: string) -> Record<string, string>`
  - `serializeCookie(name: string, value: string, options?: object) -> string`
  - `sendError(res, error: unknown) -> void`

- [ ] **Step 1: 写失败的测试**

创建 `lost-found/tests/http-utils.test.js`：

```js
import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import {
  HttpError,
  readRawBody,
  readJsonBody,
  sendJson,
  parseCookies,
  serializeCookie,
  sendError
} from "../src/http-utils.js";

function fakeReq(chunks) {
  return Readable.from(chunks.map((chunk) => Buffer.from(chunk)));
}

function fakeRes() {
  return {
    statusCode: 0,
    headers: {},
    body: "",
    writeHead(status, headers) {
      this.statusCode = status;
      this.headers = headers;
    },
    end(chunk) {
      this.body = chunk || "";
    }
  };
}

test("readRawBody 拼接完整请求体", async () => {
  const buffer = await readRawBody(fakeReq(["he", "llo"]), 1024);
  assert.equal(buffer.toString("utf8"), "hello");
});

test("readRawBody 超过上限抛 413", async () => {
  await assert.rejects(
    () => readRawBody(fakeReq(["x".repeat(100)]), 10),
    (error) => error instanceof HttpError && error.status === 413 && error.code === "PAYLOAD_TOO_LARGE"
  );
});

test("readJsonBody 解析对象", async () => {
  const parsed = await readJsonBody(fakeReq(['{"username":"111"}']), 1024);
  assert.deepEqual(parsed, { username: "111" });
});

test("readJsonBody 空请求体返回空对象", async () => {
  assert.deepEqual(await readJsonBody(fakeReq([]), 1024), {});
});

test("readJsonBody 非法 JSON 与数组都抛 400", async () => {
  await assert.rejects(
    () => readJsonBody(fakeReq(["{oops"]), 1024),
    (error) => error.status === 400 && error.code === "INVALID_JSON"
  );
  await assert.rejects(
    () => readJsonBody(fakeReq(["[1,2]"]), 1024),
    (error) => error.status === 400 && error.code === "INVALID_JSON"
  );
});

test("sendJson 设置 JSON 头与内容长度", () => {
  const res = fakeRes();
  sendJson(res, 201, { ok: true });
  assert.equal(res.statusCode, 201);
  assert.equal(res.headers["Content-Type"], "application/json; charset=utf-8");
  assert.equal(res.headers["Content-Length"], Buffer.byteLength('{"ok":true}'));
  assert.equal(res.body, '{"ok":true}');
});

test("parseCookies 解析多个 Cookie 并忽略空片段", () => {
  const cookies = parseCookies("sid=abc; theme=dark; broken");
  assert.deepEqual(cookies, { sid: "abc", theme: "dark" });
  assert.deepEqual(parseCookies(undefined), {});
});

test("serializeCookie 生成带 HttpOnly 与 SameSite 的会话 Cookie", () => {
  const cookie = serializeCookie("sid", "abc", { maxAge: 604800, sameSite: "Lax" });
  assert.equal(cookie, "sid=abc; Path=/; Max-Age=604800; HttpOnly; SameSite=Lax");
});

test("serializeCookie 在退出登录时生成立即过期的 Cookie", () => {
  const cookie = serializeCookie("sid", "", { maxAge: 0, sameSite: "Lax" });
  assert.match(cookie, /^sid=; Path=\/; Max-Age=0; HttpOnly; SameSite=Lax$/);
});

test("sendError 输出统一错误结构", () => {
  const res = fakeRes();
  sendError(res, new HttpError(409, "USERNAME_TAKEN", "该学号已被注册"));
  assert.equal(res.statusCode, 409);
  assert.deepEqual(JSON.parse(res.body), {
    error: { code: "USERNAME_TAKEN", message: "该学号已被注册" }
  });
});

test("sendError 对未知异常返回 500 且不泄露堆栈", () => {
  // 服务端会把细节写进日志，测试里临时静音，避免污染测试输出
  const original = console.error;
  console.error = () => {};

  try {
    const res = fakeRes();
    sendError(res, new Error("数据库炸了"));
    assert.equal(res.statusCode, 500);
    const body = JSON.parse(res.body);
    assert.equal(body.error.code, "INTERNAL_ERROR");
    assert.ok(!res.body.includes("数据库炸了"));
  } finally {
    console.error = original;
  }
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd lost-found && node --test tests/http-utils.test.js`
Expected: FAIL，报错找不到 `../src/http-utils.js`

- [ ] **Step 3: 写实现**

`lost-found/src/http-utils.js`：

```js
export class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
  }
}

export function readRawBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;

    req.on("data", (chunk) => {
      if (settled) {
        return;
      }

      size += chunk.length;
      if (size > maxBytes) {
        settled = true;
        reject(new HttpError(413, "PAYLOAD_TOO_LARGE", "请求内容超过大小限制"));
        req.destroy();
        return;
      }

      chunks.push(chunk);
    });

    req.on("end", () => {
      if (!settled) {
        settled = true;
        resolve(Buffer.concat(chunks));
      }
    });

    req.on("error", (error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
  });
}

export async function readJsonBody(req, maxBytes) {
  const raw = await readRawBody(req, maxBytes);

  if (raw.length === 0) {
    return {};
  }

  let parsed;
  try {
    parsed = JSON.parse(raw.toString("utf8"));
  } catch {
    throw new HttpError(400, "INVALID_JSON", "请求体不是合法的 JSON");
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new HttpError(400, "INVALID_JSON", "请求体必须是 JSON 对象");
  }

  return parsed;
}

export function sendJson(res, status, body) {
  const payload = body === undefined ? "" : JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": "no-store"
  });
  res.end(payload);
}

export function parseCookies(header) {
  const cookies = {};

  if (!header) {
    return cookies;
  }

  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) {
      continue;
    }

    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();

    if (key) {
      cookies[key] = decodeURIComponent(value);
    }
  }

  return cookies;
}

export function serializeCookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  parts.push(`Path=${options.path || "/"}`);

  if (options.maxAge !== undefined) {
    parts.push(`Max-Age=${Math.floor(options.maxAge)}`);
  }
  if (options.httpOnly !== false) {
    parts.push("HttpOnly");
  }
  if (options.sameSite) {
    parts.push(`SameSite=${options.sameSite}`);
  }
  if (options.secure) {
    parts.push("Secure");
  }

  return parts.join("; ");
}

export function sendError(res, error) {
  if (error instanceof HttpError) {
    sendJson(res, error.status, { error: { code: error.code, message: error.message } });
    return;
  }

  console.error("[unhandled]", error);
  sendJson(res, 500, { error: { code: "INTERNAL_ERROR", message: "服务器内部错误" } });
}
```

> `sendError` 对未知异常调用 `console.error` 会把细节打到服务端日志，但响应体里只有统一提示，测试断言的就是这一点。

- [ ] **Step 4: 运行测试确认通过**

Run: `cd lost-found && node --test tests/http-utils.test.js`
Expected: PASS，11 个测试全部通过

- [ ] **Step 5: 提交**

```bash
git add lost-found/src/http-utils.js lost-found/tests/http-utils.test.js
git commit -m "feat(lost-found): add http request and response utilities"
```

---

## Task 5: 输入校验

**Files:**
- Create: `lost-found/src/validate.js`
- Test: `lost-found/tests/validate.test.js`

**Interfaces:**
- Consumes: `HttpError`（Task 4）
- Produces:
  - `requireString(value, { label, min = 1, max = 200 }) -> string`（已 trim）
  - `requireUsername(value) -> string`
  - `requirePassword(value) -> string`

- [ ] **Step 1: 写失败的测试**

创建 `lost-found/tests/validate.test.js`：

```js
import test from "node:test";
import assert from "node:assert/strict";
import { requireString, requireUsername, requirePassword } from "../src/validate.js";
import { HttpError } from "../src/http-utils.js";

test("requireString 去除首尾空格", () => {
  assert.equal(requireString("  张三  ", { label: "姓名" }), "张三");
});

test("requireString 拒绝非字符串、空串和纯空格", () => {
  for (const value of [undefined, null, 123, [], {}, "", "   ", "\t\n"]) {
    assert.throws(() => requireString(value, { label: "姓名" }), HttpError);
  }
});

test("requireString 超长时报 400 并带上限说明", () => {
  assert.throws(
    () => requireString("x".repeat(31), { label: "姓名", max: 30 }),
    (error) => error.status === 400 && error.message.includes("30")
  );
});

test("requireUsername 接受 3-20 位字母数字下划线连字符", () => {
  assert.equal(requireUsername("111"), "111");
  assert.equal(requireUsername("stu_2024-A"), "stu_2024-A");
});

test("requireUsername 拒绝过短、过长和含非法字符的输入", () => {
  for (const value of ["", "12", "x".repeat(21), "有中文", "has space", "a@b"]) {
    assert.throws(() => requireUsername(value), HttpError);
  }
});

test("requirePassword 接受 3-64 位并保留原始空格", () => {
  assert.equal(requirePassword("456"), "456");
  assert.equal(requirePassword("a b"), "a b");
});

test("requirePassword 拒绝过短或过长的密码", () => {
  assert.throws(() => requirePassword("45"), HttpError);
  assert.throws(() => requirePassword("x".repeat(65)), HttpError);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd lost-found && node --test tests/validate.test.js`
Expected: FAIL，报错找不到 `../src/validate.js`

- [ ] **Step 3: 写实现**

`lost-found/src/validate.js`：

```js
import { HttpError } from "./http-utils.js";

const USERNAME_PATTERN = /^[A-Za-z0-9_-]{3,20}$/;

export function requireString(value, { label, min = 1, max = 200 }) {
  if (typeof value !== "string") {
    throw new HttpError(400, "INVALID_INPUT", `${label}必须是文本`);
  }

  const trimmed = value.trim();
  if (trimmed.length < min) {
    throw new HttpError(400, "INVALID_INPUT", `${label}不能为空`);
  }
  if (trimmed.length > max) {
    throw new HttpError(400, "INVALID_INPUT", `${label}不能超过 ${max} 个字符`);
  }

  return trimmed;
}

export function requireUsername(value) {
  const username = requireString(value, { label: "学号", min: 3, max: 20 });

  if (!USERNAME_PATTERN.test(username)) {
    throw new HttpError(400, "INVALID_INPUT", "学号只能包含字母、数字、下划线和连字符，长度 3-20 位");
  }

  return username;
}

export function requirePassword(value) {
  // 密码不能 trim，空格是密码的一部分
  if (typeof value !== "string") {
    throw new HttpError(400, "INVALID_INPUT", "密码必须是文本");
  }
  if (value.length < 3 || value.length > 64) {
    throw new HttpError(400, "INVALID_INPUT", "密码长度必须是 3-64 位");
  }

  return value;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd lost-found && node --test tests/validate.test.js`
Expected: PASS，7 个测试全部通过

- [ ] **Step 5: 提交**

```bash
git add lost-found/src/validate.js lost-found/tests/validate.test.js
git commit -m "feat(lost-found): add input validation helpers"
```

---

## Task 6: 用户、会话与认证接口

**Files:**
- Create: `lost-found/src/auth.js`
- Test: `lost-found/tests/auth-domain.test.js`

**Interfaces:**
- Consumes: `openDb`（Task 3）、`hashPassword`/`verifyPassword`/`createToken`（Task 2）、`HttpError`（Task 4）、`requireUsername`/`requireString`/`requirePassword`（Task 5）
- Produces:
  - `createUser(db, { username, name, password, role }) -> user`，学号重复抛 `HttpError(409, "USERNAME_TAKEN")`
  - `getUserById(db, id) -> user | null`
  - `getUserByUsername(db, username) -> user | null`
  - `authenticate(db, username, password) -> { ok: true, user } | { ok: false, reason: "invalid" | "banned" }`
  - `createSession(db, userId, { ttlMs }) -> token:string`
  - `resolveSession(db, token) -> user | null`（过期或用户被封禁时自动删除会话并返回 null）
  - `deleteSession(db, token) -> void`
  - `cleanupExpiredSessions(db, now = new Date()) -> void`
  - `toPublicUser(user) -> { id, username, name, role }`

本 Task 只做领域逻辑，不碰 HTTP 请求对象，方便单独测试。

- [ ] **Step 1: 写失败的测试**

创建 `lost-found/tests/auth-domain.test.js`：

```js
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
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd lost-found && node --test tests/auth-domain.test.js`
Expected: FAIL，报错找不到 `../src/auth.js`

- [ ] **Step 3: 写实现**

`lost-found/src/auth.js`：

```js
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
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd lost-found && node --test tests/auth-domain.test.js`
Expected: PASS，9 个测试全部通过

- [ ] **Step 5: 提交**

```bash
git add lost-found/src/auth.js lost-found/tests/auth-domain.test.js
git commit -m "feat(lost-found): add user, session and authentication logic"
```

---

## Task 7: 路由与服务器装配

**Files:**
- Modify: `lost-found/src/auth.js`（在文件末尾追加 5 个 HTTP 处理函数）
- Create: `lost-found/src/router.js`
- Create: `lost-found/server.js`
- Test: `lost-found/tests/router.test.js`
- Create: `lost-found/tests/helpers.js`

**Interfaces:**
- Consumes: Task 1–6 的全部导出
- Produces:
  - `createApp({ db, config }) -> (req, res) => Promise<void>`
  - 处理函数签名统一为 `(ctx) => Promise<{ status: number, body?: any }>`
  - `ctx` 字段：`{ req, res, db, config, params: object, query: URLSearchParams, user: user | null }`
  - 处理函数：`handleRegister`、`handleStudentLogin`、`handleAdminLogin`、`handleLogout`、`handleMe`
  - `startTestServer() -> Promise<{ baseUrl, db, config, request, close }>`（测试助手）

- [ ] **Step 1: 写测试助手**

创建 `lost-found/tests/helpers.js`：

```js
import http from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { readConfig } from "../src/config.js";
import { openDb } from "../src/db.js";
import { createApp } from "../src/router.js";

export async function startTestServer() {
  const dir = mkdtempSync(path.join(tmpdir(), "lostfound-api-"));
  const config = readConfig({ DB_PATH: path.join(dir, "test.db") });
  const db = openDb(config.dbPath, { demoAccounts: config.demoAccounts });
  const server = http.createServer(createApp({ db, config }));

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  return {
    baseUrl,
    db,
    config,

    async request(method, pathname, { body, cookie } = {}) {
      const headers = {};
      let payload;

      if (body !== undefined) {
        payload = JSON.stringify(body);
        headers["Content-Type"] = "application/json";
      }
      if (cookie) {
        headers.Cookie = cookie;
      }

      const response = await fetch(baseUrl + pathname, { method, headers, body: payload });
      const text = await response.text();

      let json = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }

      const setCookies = response.headers.getSetCookie();

      return {
        status: response.status,
        json,
        text,
        setCookie: setCookies,
        cookie: setCookies.length > 0 ? setCookies[0].split(";")[0] : null
      };
    },

    async close() {
      await new Promise((resolve) => server.close(resolve));
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  };
}
```

- [ ] **Step 2: 写失败的接口测试**

创建 `lost-found/tests/router.test.js`：

```js
import test from "node:test";
import assert from "node:assert/strict";
import { startTestServer } from "./helpers.js";

async function withServer(run) {
  const server = await startTestServer();
  try {
    await run(server);
  } finally {
    await server.close();
  }
}

test("未知接口返回 404 与统一错误结构", async () => {
  await withServer(async (server) => {
    const response = await server.request("GET", "/api/nope");
    assert.equal(response.status, 404);
    assert.equal(response.json.error.code, "NOT_FOUND");
  });
});

test("学生注册成功返回 201、用户信息与 HttpOnly 会话 Cookie", async () => {
  await withServer(async (server) => {
    const response = await server.request("POST", "/api/student/register", {
      body: { username: "stu001", name: "张三", password: "pw123" }
    });

    assert.equal(response.status, 201);
    assert.deepEqual(response.json.user, {
      id: response.json.user.id,
      username: "stu001",
      name: "张三",
      role: "student"
    });
    assert.ok(response.cookie.startsWith("sid="));
    assert.match(response.setCookie[0], /HttpOnly/);
    assert.match(response.setCookie[0], /Max-Age=604800/);
    assert.ok(!response.text.includes("pw123"));
    assert.ok(!response.text.includes("password"));
  });
});

test("注册参数不合法时返回 400 并说明字段", async () => {
  await withServer(async (server) => {
    const empty = await server.request("POST", "/api/student/register", {
      body: { username: "", name: "", password: "" }
    });
    assert.equal(empty.status, 400);
    assert.equal(empty.json.error.code, "INVALID_INPUT");

    const badUsername = await server.request("POST", "/api/student/register", {
      body: { username: "有中文", name: "张三", password: "pw123" }
    });
    assert.equal(badUsername.status, 400);
    assert.match(badUsername.json.error.message, /学号/);

    // 姓名缺失必须被拦下，不能落到数据库的 NOT NULL 约束上变成 500
    const noName = await server.request("POST", "/api/student/register", {
      body: { username: "stu002", password: "pw123" }
    });
    assert.equal(noName.status, 400);
    assert.equal(noName.json.error.code, "INVALID_INPUT");

    const blankName = await server.request("POST", "/api/student/register", {
      body: { username: "stu003", name: "   ", password: "pw123" }
    });
    assert.equal(blankName.status, 400);
    assert.match(blankName.json.error.message, /姓名/);
  });
});

test("重复学号注册返回 409", async () => {
  await withServer(async (server) => {
    const body = { username: "stu001", name: "张三", password: "pw123" };
    await server.request("POST", "/api/student/register", { body });
    const second = await server.request("POST", "/api/student/register", { body });

    assert.equal(second.status, 409);
    assert.equal(second.json.error.code, "USERNAME_TAKEN");
  });
});

test("演示学生账号 111/222 可以登录，密码错误返回 401", async () => {
  await withServer(async (server) => {
    const ok = await server.request("POST", "/api/student/login", {
      body: { username: "111", password: "222" }
    });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.user.username, "111");
    assert.equal(ok.json.user.role, "student");

    const wrong = await server.request("POST", "/api/student/login", {
      body: { username: "111", password: "333" }
    });
    assert.equal(wrong.status, 401);
    assert.equal(wrong.json.error.code, "INVALID_CREDENTIALS");
  });
});

test("演示管理员账号 123/456 只能从管理员入口登录", async () => {
  await withServer(async (server) => {
    const asStudent = await server.request("POST", "/api/student/login", {
      body: { username: "123", password: "456" }
    });
    assert.equal(asStudent.status, 403);
    assert.equal(asStudent.json.error.code, "WRONG_ENTRY");

    const asAdmin = await server.request("POST", "/api/admin/login", {
      body: { username: "123", password: "456" }
    });
    assert.equal(asAdmin.status, 200);
    assert.equal(asAdmin.json.user.role, "admin");
  });
});

test("学生账号不能从管理员入口登录", async () => {
  await withServer(async (server) => {
    const response = await server.request("POST", "/api/admin/login", {
      body: { username: "111", password: "222" }
    });
    assert.equal(response.status, 403);
    assert.equal(response.json.error.code, "WRONG_ENTRY");
  });
});

test("/api/me 未登录返回 401，带 Cookie 返回当前用户", async () => {
  await withServer(async (server) => {
    const anonymous = await server.request("GET", "/api/me");
    assert.equal(anonymous.status, 401);
    assert.equal(anonymous.json.error.code, "UNAUTHORIZED");

    const login = await server.request("POST", "/api/student/login", {
      body: { username: "111", password: "222" }
    });

    const me = await server.request("GET", "/api/me", { cookie: login.cookie });
    assert.equal(me.status, 200);
    assert.equal(me.json.user.username, "111");
  });
});

test("退出登录后会话立即失效", async () => {
  await withServer(async (server) => {
    const login = await server.request("POST", "/api/student/login", {
      body: { username: "111", password: "222" }
    });

    const logout = await server.request("POST", "/api/logout", { cookie: login.cookie });
    assert.equal(logout.status, 200);
    assert.match(logout.setCookie[0], /Max-Age=0/);

    const me = await server.request("GET", "/api/me", { cookie: login.cookie });
    assert.equal(me.status, 401);
  });
});

test("被封禁的用户不能登录，且原有会话立即失效", async () => {
  await withServer(async (server) => {
    const login = await server.request("POST", "/api/student/login", {
      body: { username: "111", password: "222" }
    });
    assert.equal(login.status, 200);

    server.db.prepare("UPDATE users SET status = 'banned' WHERE username = ?").run("111");

    const me = await server.request("GET", "/api/me", { cookie: login.cookie });
    assert.equal(me.status, 401);

    const relogin = await server.request("POST", "/api/student/login", {
      body: { username: "111", password: "222" }
    });
    assert.equal(relogin.status, 403);
    assert.equal(relogin.json.error.code, "ACCOUNT_BANNED");
  });
});

test("伪造的会话 Cookie 视为未登录", async () => {
  await withServer(async (server) => {
    const response = await server.request("GET", "/api/me", { cookie: "sid=deadbeef" });
    assert.equal(response.status, 401);
  });
});
```

- [ ] **Step 3: 运行测试确认失败**

Run: `cd lost-found && node --test tests/router.test.js`
Expected: FAIL，报错找不到 `../src/router.js`

- [ ] **Step 4: 在 auth.js 末尾追加处理函数**

在 `lost-found/src/auth.js` 末尾追加（文件顶部的 import 也要补上新增的依赖）：

```js
import { readJsonBody, serializeCookie } from "./http-utils.js";
import { requirePassword, requireString, requireUsername } from "./validate.js";

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
```

> 说明：ESM 的 `import` 语句必须写在模块顶部，上面单独列出来只是为了让改动清楚；实际落地时把这两行
> 加到 `src/auth.js` 已有的 import 之后即可，`parseCookies` 也要一起加进 `http-utils` 的导入列表。

- [ ] **Step 5: 写路由与服务器**

`lost-found/src/router.js`：

```js
import { HttpError, parseCookies, sendError, sendJson } from "./http-utils.js";
import {
  handleAdminLogin,
  handleLogout,
  handleMe,
  handleRegister,
  handleStudentLogin,
  resolveSession
} from "./auth.js";

const ROUTES = [
  { method: "POST", path: "/api/student/register", handler: handleRegister, access: "public" },
  { method: "POST", path: "/api/student/login", handler: handleStudentLogin, access: "public" },
  { method: "POST", path: "/api/admin/login", handler: handleAdminLogin, access: "public" },
  { method: "POST", path: "/api/logout", handler: handleLogout, access: "any" },
  { method: "GET", path: "/api/me", handler: handleMe, access: "any" }
];

function matchRoute(method, pathname) {
  const segments = pathname.split("/").filter(Boolean);

  for (const route of ROUTES) {
    if (route.method !== method) {
      continue;
    }

    const routeSegments = route.path.split("/").filter(Boolean);
    if (routeSegments.length !== segments.length) {
      continue;
    }

    const params = {};
    let matched = true;

    for (let i = 0; i < routeSegments.length; i += 1) {
      const routeSegment = routeSegments[i];

      if (routeSegment.startsWith(":")) {
        params[routeSegment.slice(1)] = decodeURIComponent(segments[i]);
        continue;
      }
      if (routeSegment !== segments[i]) {
        matched = false;
        break;
      }
    }

    if (matched) {
      return { route, params };
    }
  }

  return null;
}

function assertAccess(access, user) {
  if (access === "public") {
    return;
  }
  if (!user) {
    throw new HttpError(401, "UNAUTHORIZED", "请先登录");
  }
  if (access !== "any" && user.role !== access) {
    throw new HttpError(403, "FORBIDDEN", "没有权限执行该操作");
  }
}

export function createApp({ db, config }) {
  return async function handle(req, res) {
    try {
      const url = new URL(req.url, "http://localhost");
      const matched = matchRoute(req.method, url.pathname);

      if (!matched) {
        throw new HttpError(404, "NOT_FOUND", "接口不存在");
      }

      const cookies = parseCookies(req.headers.cookie);
      const user = resolveSession(db, cookies[config.cookieName]);

      assertAccess(matched.route.access, user);

      const result = await matched.route.handler({
        req,
        res,
        db,
        config,
        params: matched.params,
        query: url.searchParams,
        user
      });

      sendJson(res, result.status ?? 200, result.body);
    } catch (error) {
      sendError(res, error);
    }
  };
}
```

`lost-found/server.js`：

```js
import http from "node:http";
import { config } from "./src/config.js";
import { openDb } from "./src/db.js";
import { cleanupExpiredSessions } from "./src/auth.js";
import { createApp } from "./src/router.js";

const db = openDb(config.dbPath, { demoAccounts: config.demoAccounts });
cleanupExpiredSessions(db);

const server = http.createServer(createApp({ db, config }));

server.listen(config.port, () => {
  console.log(`失物招领服务已启动: http://localhost:${config.port}`);
  console.log(`数据库文件: ${config.dbPath}`);
});
```

- [ ] **Step 6: 运行测试确认通过**

Run: `cd lost-found && node --test tests/router.test.js`
Expected: PASS，11 个测试全部通过

- [ ] **Step 7: 运行全部测试**

Run: `cd lost-found && node --test tests/`
Expected: PASS，全部测试文件通过（config 4 + password 5 + db 6 + http-utils 11 + validate 7 + auth-domain 9 + router 11 = 53 个）

- [ ] **Step 8: 手动验收**

```bash
cd lost-found
node server.js
```

另开一个终端，逐条执行并核对结果：

```bash
curl -i -X POST http://localhost:3000/api/student/login -H "Content-Type: application/json" -d '{"username":"111","password":"222"}'
```

Expected: `200`，响应体含 `"username":"111"`，响应头含 `Set-Cookie: sid=...; HttpOnly; SameSite=Lax`

```bash
curl -i http://localhost:3000/api/me
```

Expected: `401` 与 `{"error":{"code":"UNAUTHORIZED","message":"请先登录"}}`

```bash
curl -i -X POST http://localhost:3000/api/admin/login -H "Content-Type: application/json" -d '{"username":"123","password":"456"}'
```

Expected: `200`，`"role":"admin"`

确认 `lost-found/data/app.db` 文件已经生成，且 `git status` 里看不到它（被 `.gitignore` 忽略）。

- [ ] **Step 9: 提交**

```bash
git add lost-found/src/auth.js lost-found/src/router.js lost-found/server.js lost-found/tests/helpers.js lost-found/tests/router.test.js
git commit -m "feat(lost-found): add auth routes and http server"
```

---

## 阶段一完成标准

- `cd lost-found && node --test tests/` 全部通过（53 个断言用例，0 失败）
- `node server.js` 能启动，用演示账号 `111/222`、`123/456` 都能在各自入口登录
- 未登录访问 `/api/me` 返回 401；退出后原 Cookie 立即失效
- 被封禁用户的会话立即失效，且无法重新登录
- `lost-found/data/` 不出现在 `git status` 中
- 仓库里已有的 `todo-list/`、`fruits.txt`、根 `index.html` 等文件**没有任何改动**

## 后续阶段

- 第二阶段：信息发布 / 查询 / 搜索 / 分页 / 图片 / 修改 / 删除（计划文件另写）
- 第三阶段：认领申请闭环、管理端审核 / 用户管理 / 统计（计划文件另写）
- 第四阶段：五个前端页面、样式、端到端冒烟、README、演示数据脚本（计划文件另写）
