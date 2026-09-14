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
