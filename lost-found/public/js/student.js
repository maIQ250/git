import { bindLogoutButton, renderUserChip, requireRole } from "./api.js";

const user = await requireRole("student", "student-login.html");

if (user) {
  renderUserChip(document.getElementById("who"), user, "学生");
  bindLogoutButton(document.getElementById("logout"));

  document.getElementById("welcome").textContent =
    `${user.name}，欢迎回来。当前版本已完成账号体系与数据存储，业务功能正在分阶段接入。`;
}
