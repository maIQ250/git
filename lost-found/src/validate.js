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
