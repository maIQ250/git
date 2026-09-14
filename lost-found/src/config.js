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
