import http from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { readConfig } from "../src/config.js";
import { openDb } from "../src/db.js";
import { createApp } from "../src/router.js";

/**
 * 构造 multipart/form-data 请求体。
 * fields 是普通文本字段，files 的每一项是 { name, filename, contentType, data: Buffer }。
 */
export function multipartBody({ fields = {}, files = [], boundary = "----lostfound-test-boundary" } = {}) {
  const chunks = [];

  for (const [name, value] of Object.entries(fields)) {
    chunks.push(
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`)
    );
  }

  for (const file of files) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="${file.name}"; filename="${file.filename}"\r\n` +
          `Content-Type: ${file.contentType}\r\n\r\n`
      )
    );
    chunks.push(file.data);
    chunks.push(Buffer.from("\r\n"));
  }

  chunks.push(Buffer.from(`--${boundary}--\r\n`));

  return { body: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` };
}

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

    async request(method, pathname, { body, rawBody, contentType, cookie } = {}) {
      const headers = {};
      let payload;

      if (body !== undefined) {
        payload = JSON.stringify(body);
        headers["Content-Type"] = "application/json";
      } else if (rawBody !== undefined) {
        payload = rawBody;
        headers["Content-Type"] = contentType;
      }
      if (cookie) {
        headers.Cookie = cookie;
      }

      const response = await fetch(baseUrl + pathname, { method, headers, body: payload });

      // 先取二进制再转文本。Fetch 的响应体只能读一次，
      // 反过来（先 text() 再 arrayBuffer()）会抛 "Body is unusable: Body has already been read"。
      const buffer = Buffer.from(await response.arrayBuffer());
      const text = buffer.toString("utf8");

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
        buffer,
        headers: response.headers,
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
