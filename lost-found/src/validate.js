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
export function requireEnum(value, allowed, { label }) {
  const text = requireString(value, { label, min: 1, max: 30 });

  if (!allowed.includes(text)) {
    throw new HttpError(400, "INVALID_INPUT", `${label}只能是 ${allowed.join(" / ")}`);
  }

  return text;
}

export function requireDate(value, { label = "日期" } = {}) {
  const text = requireString(value, { label, min: 1, max: 10 });

  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new HttpError(400, "INVALID_INPUT", `${label}格式必须是 YYYY-MM-DD`);
  }

  const [year, month, day] = text.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  // Date 会把 2023-02-29 这类不存在的日期顺延到 3 月，用它反查即可识破
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new HttpError(400, "INVALID_INPUT", `${label}不是有效日期`);
  }

  return text;
}

export function requireInt(value, { label, min, max, fallback }) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const number = typeof value === "number" ? value : Number(String(value).trim());

  if (!Number.isInteger(number)) {
    throw new HttpError(400, "INVALID_INPUT", `${label}必须是整数`);
  }
  if (number < min || number > max) {
    throw new HttpError(400, "INVALID_INPUT", `${label}必须在 ${min} 到 ${max} 之间`);
  }

  return number;
}

export function requireId(value, { label = "编号" } = {}) {
  const text = String(value ?? "");

  if (!/^\d+$/.test(text) || Number(text) < 1) {
    throw new HttpError(404, "ITEM_NOT_FOUND", `${label}对应的信息不存在`);
  }

  return Number(text);
}
