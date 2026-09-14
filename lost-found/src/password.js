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
