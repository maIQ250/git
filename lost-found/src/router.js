import { HttpError, parseCookies, sendError, sendJson } from "./http-utils.js";
import {
  handleAdminLogin,
  handleLogout,
  handleMe,
  handleRegister,
  handleStudentLogin,
  resolveSession
} from "./auth.js";
import { handleCreateItem } from "./items.js";

const ROUTES = [
  { method: "POST", path: "/api/student/register", handler: handleRegister, access: "public" },
  { method: "POST", path: "/api/student/login", handler: handleStudentLogin, access: "public" },
  { method: "POST", path: "/api/admin/login", handler: handleAdminLogin, access: "public" },
  { method: "POST", path: "/api/logout", handler: handleLogout, access: "any" },
  { method: "GET", path: "/api/me", handler: handleMe, access: "any" },

  { method: "POST", path: "/api/items", handler: handleCreateItem, access: "any" }
];

function matchRoute(method, pathname) {
  const segments = pathname.split("/").filter(Boolean);

  for (const route of ROUTES) {
    if (route.method !== method) {
      continue;
    }

    const routeSegments = route.path.split("/").filter(Boolean);
    if (routeSegments.length !== segments.length) {
      continue;
    }

    const params = {};
    let matched = true;

    for (let i = 0; i < routeSegments.length; i += 1) {
      const routeSegment = routeSegments[i];

      if (routeSegment.startsWith(":")) {
        params[routeSegment.slice(1)] = decodeURIComponent(segments[i]);
        continue;
      }
      if (routeSegment !== segments[i]) {
        matched = false;
        break;
      }
    }

    if (matched) {
      return { route, params };
    }
  }

  return null;
}

function assertAccess(access, user) {
  if (access === "public") {
    return;
  }
  if (!user) {
    throw new HttpError(401, "UNAUTHORIZED", "请先登录");
  }
  if (access !== "any" && user.role !== access) {
    throw new HttpError(403, "FORBIDDEN", "没有权限执行该操作");
  }
}

export function createApp({ db, config, staticHandler }) {
  return async function handle(req, res) {
    try {
      const url = new URL(req.url, "http://localhost");
      const isApiPath = url.pathname === "/api" || url.pathname.startsWith("/api/");

      // 非 /api 开头的请求先交给静态文件服务；没有对应文件再走 404。
      if (!isApiPath && staticHandler && (await staticHandler(req, res, url.pathname))) {
        return;
      }

      const matched = matchRoute(req.method, url.pathname);

      if (!matched) {
        throw new HttpError(404, "NOT_FOUND", isApiPath ? "接口不存在" : "页面不存在");
      }

      const cookies = parseCookies(req.headers.cookie);
      const user = resolveSession(db, cookies[config.cookieName]);

      assertAccess(matched.route.access, user);

      const result = await matched.route.handler({
        req,
        res,
        db,
        config,
        params: matched.params,
        query: url.searchParams,
        user
      });

      sendJson(res, result.status ?? 200, result.body);
    } catch (error) {
      sendError(res, error);
    }
  };
}
