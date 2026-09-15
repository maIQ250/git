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
