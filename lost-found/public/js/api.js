// 统一的请求封装与页面公共工具。
// 约定：所有用户输入都用 textContent 写入 DOM，不拼接 HTML 字符串。

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export async function request(path, { method = "GET", body } = {}) {
  let response;
  try {
    response = await fetch(path, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "same-origin"
    });
  } catch {
    throw new ApiError(0, "NETWORK_ERROR", "网络连接失败，请确认服务已启动后重试");
  }

  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }

  if (!response.ok) {
    const error = (data && data.error) || {};
    throw new ApiError(
      response.status,
      error.code || "UNKNOWN_ERROR",
      error.message || "请求失败，请重试"
    );
  }

  return data;
}

/* ===== 轻提示 ===== */

let toastArea = null;

function ensureToastArea() {
  if (!toastArea) {
    toastArea = document.createElement("div");
    toastArea.className = "toast-area";
    toastArea.setAttribute("role", "status");
    toastArea.setAttribute("aria-live", "polite");
    document.body.append(toastArea);
  }
  return toastArea;
}

export function toast(message, kind = "info", timeoutMs = 2800) {
  const area = ensureToastArea();
  const element = document.createElement("div");
  element.className = kind === "info" ? "toast" : `toast ${kind}`;
  element.textContent = message;
  area.append(element);
  setTimeout(() => element.remove(), timeoutMs);
}

/* ===== 表单字段错误 ===== */

function errorBoxOf(input) {
  return document.getElementById(`${input.id}-error`);
}

export function showFieldError(input, message) {
  const box = errorBoxOf(input);
  if (box) {
    box.textContent = message;
    box.classList.add("show");
    input.setAttribute("aria-describedby", box.id);
  }
  input.setAttribute("aria-invalid", "true");
}

export function clearFieldError(input) {
  const box = errorBoxOf(input);
  if (box) {
    box.textContent = "";
    box.classList.remove("show");
    input.removeAttribute("aria-describedby");
  }
  input.removeAttribute("aria-invalid");
}

export function clearAllFieldErrors(form) {
  for (const input of form.querySelectorAll("input")) {
    clearFieldError(input);
  }
}

/* ===== 按钮忙碌状态 ===== */

export function setBusy(button, busy, busyLabel = "处理中…") {
  if (busy) {
    if (button.dataset.idleLabel === undefined) {
      button.dataset.idleLabel = button.textContent;
    }
    button.textContent = busyLabel;
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    return;
  }

  if (button.dataset.idleLabel !== undefined) {
    button.textContent = button.dataset.idleLabel;
    delete button.dataset.idleLabel;
  }
  button.disabled = false;
  button.removeAttribute("aria-busy");
}

/* ===== 会话 ===== */

export async function currentUser() {
  const data = await request("/api/me");
  return data.user;
}

/**
 * 页面守卫：未登录或身份不符时跳转到对应登录页，否则返回当前用户。
 */
export async function requireRole(role, loginPage) {
  let user;
  try {
    user = await currentUser();
  } catch {
    location.replace(loginPage);
    return null;
  }

  if (user.role !== role) {
    location.replace(loginPage);
    return null;
  }

  return user;
}

/**
 * 登录页反向守卫：已登录则直接进入工作台。
 */
export async function redirectIfLoggedIn(role, targetPage) {
  try {
    const user = await currentUser();
    if (user.role === role) {
      location.replace(targetPage);
      return true;
    }
  } catch {
    // 未登录，正常停留在登录页。
  }
  return false;
}

export async function logout() {
  try {
    await request("/api/logout", { method: "POST" });
  } catch {
    // 退出失败也要回到入口页，避免卡在登录态界面。
  }
  location.href = "index.html";
}

/* ===== 顶栏用户信息 ===== */

export function renderUserChip(container, user, roleLabel) {
  container.replaceChildren();

  const avatar = document.createElement("div");
  avatar.className = "avatar";
  avatar.setAttribute("aria-hidden", "true");
  avatar.textContent = (user.name || user.username || "?").trim().slice(0, 1);

  const meta = document.createElement("div");
  meta.className = "meta";

  const name = document.createElement("div");
  name.className = "name";
  name.textContent = user.name || user.username;

  const sub = document.createElement("div");
  sub.className = "sub";
  sub.textContent = `${roleLabel} · ${user.username}`;

  meta.append(name, sub);
  container.append(avatar, meta);
}

export function bindLogoutButton(button) {
  button.addEventListener("click", async () => {
    setBusy(button, true, "退出中…");
    await logout();
  });
}
