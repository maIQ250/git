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
