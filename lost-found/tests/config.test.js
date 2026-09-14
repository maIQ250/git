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
