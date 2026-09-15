import { bindLogoutButton, renderUserChip, requireRole } from "./api.js";

const user = await requireRole("admin", "admin-login.html");

if (user) {
  renderUserChip(document.getElementById("who"), user, "管理员");
  bindLogoutButton(document.getElementById("logout"));

  document.getElementById("welcome").textContent =
    `${user.name}，欢迎回来。当前版本已完成管理员登录与权限校验，审核功能正在分阶段接入。`;
}
