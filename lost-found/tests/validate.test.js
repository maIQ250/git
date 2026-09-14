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
