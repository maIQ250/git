import test from "node:test";
import assert from "node:assert/strict";
import {
  requireDate,
  requireEnum,
  requireId,
  requireInt,
  requirePassword,
  requireString,
  requireUsername
} from "../src/validate.js";
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
test("requireEnum 接受白名单内的值并去除首尾空格", () => {
  assert.equal(requireEnum(" lost ", ["lost", "found"], { label: "类型" }), "lost");
});

test("requireEnum 拒绝白名单外的值并列出可选项", () => {
  assert.throws(() => requireEnum("other", ["lost", "found"], { label: "类型" }), (error) => {
    assert.equal(error.status, 400);
    assert.match(error.message, /lost \/ found/);
    return true;
  });
});

test("requireDate 接受合法日期并原样返回", () => {
  assert.equal(requireDate("2026-09-15"), "2026-09-15");
  assert.equal(requireDate("2024-02-29"), "2024-02-29");
});

test("requireDate 拒绝格式错误的日期", () => {
  for (const value of ["2026/09/15", "26-09-15", "2026-9-5", "今天", ""]) {
    assert.throws(() => requireDate(value, { label: "拾获日期" }), (error) => {
      assert.equal(error.status, 400);
      return true;
    });
  }
});

test("requireDate 拒绝不存在的日期", () => {
  for (const value of ["2023-02-29", "2026-13-01", "2026-04-31", "2026-00-10"]) {
    assert.throws(() => requireDate(value), { status: 400, code: "INVALID_INPUT" });
  }
});

test("requireInt 缺省时返回 fallback", () => {
  for (const value of [undefined, null, ""]) {
    assert.equal(requireInt(value, { label: "页码", min: 1, max: 999, fallback: 1 }), 1);
  }
});

test("requireInt 接受范围内的整数并拒绝越界与非整数", () => {
  assert.equal(requireInt("3", { label: "页码", min: 1, max: 999, fallback: 1 }), 3);
  assert.throws(() => requireInt("0", { label: "页码", min: 1, max: 999, fallback: 1 }), { status: 400 });
  assert.throws(() => requireInt("1.5", { label: "页码", min: 1, max: 999, fallback: 1 }), { status: 400 });
  assert.throws(() => requireInt("abc", { label: "页码", min: 1, max: 999, fallback: 1 }), { status: 400 });
  assert.throws(() => requireInt("51", { label: "每页条数", min: 1, max: 50, fallback: 12 }), { status: 400 });
});

test("requireId 接受数字字符串并转成数字", () => {
  assert.equal(requireId("42"), 42);
  assert.equal(requireId(7), 7);
});

test("requireId 对非正整数一律抛 404，不泄露资源是否存在", () => {
  for (const value of ["abc", "0", "-1", "1.5", "", undefined, "1e3"]) {
    assert.throws(() => requireId(value), { status: 404, code: "ITEM_NOT_FOUND" });
  }
});
