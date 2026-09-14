import http from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { readConfig } from "../src/config.js";
import { openDb } from "../src/db.js";
import { createApp } from "../src/router.js";

export async function startTestServer() {
  const dir = mkdtempSync(path.join(tmpdir(), "lostfound-api-"));
  const config = readConfig({ DB_PATH: path.join(dir, "test.db") });
  const db = openDb(config.dbPath, { demoAccounts: config.demoAccounts });
  const server = http.createServer(createApp({ db, config }));

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  return {
    baseUrl,
    db,
    config,

    async request(method, pathname, { body, cookie } = {}) {
      const headers = {};
      let payload;

      if (body !== undefined) {
        payload = JSON.stringify(body);
        headers["Content-Type"] = "application/json";
      }
      if (cookie) {
        headers.Cookie = cookie;
      }

      const response = await fetch(baseUrl + pathname, { method, headers, body: payload });
      const text = await response.text();

      let json = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }

      const setCookies = response.headers.getSetCookie();

      return {
        status: response.status,
        json,
        text,
        setCookie: setCookies,
        cookie: setCookies.length > 0 ? setCookies[0].split(";")[0] : null
      };
    },

    async close() {
      await new Promise((resolve) => server.close(resolve));
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  };
}
