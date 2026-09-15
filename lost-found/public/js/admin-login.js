import {
  clearAllFieldErrors,
  redirectIfLoggedIn,
  request,
  setBusy,
  showFieldError,
  toast
} from "./api.js";

const TARGET_PAGE = "admin.html";
const USERNAME_PATTERN = /^[A-Za-z0-9_-]{3,20}$/;

const form = document.getElementById("admin-login-form");

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearAllFieldErrors(form);

  const username = document.getElementById("admin-username");
  const password = document.getElementById("admin-password");
  const submit = document.getElementById("admin-submit");

  let firstInvalid = null;
  const usernameValue = username.value.trim();

  if (!usernameValue) {
    showFieldError(username, "请输入管理员账号");
    firstInvalid = username;
  } else if (!USERNAME_PATTERN.test(usernameValue)) {
    showFieldError(username, "账号只能包含字母、数字、下划线和连字符，长度 3-20 位");
    firstInvalid = username;
  }

  if (!password.value) {
    showFieldError(password, "请输入密码");
    firstInvalid ??= password;
  }

  if (firstInvalid) {
    firstInvalid.focus();
    return;
  }

  setBusy(submit, true, "登录中…");

  try {
    await request("/api/admin/login", {
      method: "POST",
      body: { username: usernameValue, password: password.value }
    });
    location.href = TARGET_PAGE;
  } catch (error) {
    setBusy(submit, false);

    if (error.status === 401) {
      showFieldError(password, error.message);
      password.focus();
      password.select();
    } else if (error.status === 403) {
      showFieldError(username, error.message);
      username.focus();
    }

    toast(error.message, "error");
  }
});

redirectIfLoggedIn("admin", TARGET_PAGE);
