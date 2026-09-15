import fs from "node:fs/promises";
import path from "node:path";
import { HttpError } from "./http-utils.js";

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2"
};

function contentTypeOf(filePath) {
  return MIME_TYPES[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

/**
 * 创建静态文件处理器。
 *
 * 返回 true 表示已经响应；返回 false 表示该路径没有对应文件，
 * 由调用方决定后续如何处理（通常是 404）。
 * 目录之外的路径（含 ../ 穿越与空字节）一律拒绝。
 */
export function createStaticHandler(rootDir) {
  const root = path.resolve(rootDir);

  return async function serveStatic(req, res, pathname) {
    if (req.method !== "GET" && req.method !== "HEAD") {
      return false;
    }

    let decoded;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      throw new HttpError(400, "INVALID_PATH", "请求路径不合法");
    }

    if (decoded.includes("\0")) {
      throw new HttpError(400, "INVALID_PATH", "请求路径不合法");
    }

    const relative = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
    const target = path.resolve(root, relative);

    if (target !== root && !target.startsWith(root + path.sep)) {
      throw new HttpError(403, "FORBIDDEN", "没有权限访问该路径");
    }

    let stat;
    try {
      stat = await fs.stat(target);
    } catch {
      return false;
    }

    if (!stat.isFile()) {
      return false;
    }

    const content = await fs.readFile(target);

    res.writeHead(200, {
      "Content-Type": contentTypeOf(target),
      "Content-Length": content.byteLength,
      "Cache-Control": "no-cache"
    });
    res.end(req.method === "HEAD" ? undefined : content);

    return true;
  };
}
