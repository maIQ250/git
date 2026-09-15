import {
  clearAllFieldErrors,
  redirectIfLoggedIn,
  request,
  setBusy,
  showFieldError,
  toast
} from "./api.js";

const TARGET_PAGE = "student.html";
const USERNAME_PATTERN = /^[A-Za-z0-9_-]{3,20}$/;

const tabLogin = document.getElementById("tab-login");
const tabRegister = document.getElementById("tab-register");
const panelLogin = document.getElementById("panel-login");
const panelRegister = document.getElementById("panel-register");

const loginForm = document.getElementById("login-form");
const registerForm = document.getElementById("register-form");

function selectTab(name) {
  const isLogin = name === "login";

  tabLogin.setAttribute("aria-selected", String(isLogin));
  tabRegister.setAttribute("aria-selected", String(!isLogin));
  panelLogin.hidden = !isLogin;
  panelRegister.hidden = isLogin;
}

tabLogin.addEventListener("click", () => selectTab("login"));
tabRegister.addEventListener("click", () => selectTab("register"));

/** 校验字段，返回第一个出错的输入框；全部通过时返回 null。 */
function validate(fields) {
  let firstInvalid = null;

  for (const [input, message] of fields) {
    if (message) {
      showFieldError(input, message);
      firstInvalid ??= input;
    }
  }

  firstInvalid?.focus();
  return firstInvalid;
}

function usernameError(input, label) {
  const value = input.value.trim();

  if (!value) {
    return `请输入${label}`;
  }
  if (!USERNAME_PATTERN.test(value)) {
    return "只能包含字母、数字、下划线和连字符，长度 3-20 位";
  }
  return null;
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearAllFieldErrors(loginForm);

  const username = document.getElementById("login-username");
  const password = document.getElementById("login-password");
  const submit = document.getElementById("login-submit");

  const invalid = validate([
    [username, usernameError(username, "学号")],
    [password, password.value ? null : "请输入密码"]
  ]);

  if (invalid) {
    return;
  }

  setBusy(submit, true, "登录中…");

  try {
    await request("/api/student/login", {
      method: "POST",
      body: { username: username.value.trim(), password: password.value }
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

registerForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearAllFieldErrors(registerForm);

  const username = document.getElementById("register-username");
  const name = document.getElementById("register-name");
  const password = document.getElementById("register-password");
  const confirm = document.getElementById("register-confirm");
  const submit = document.getElementById("register-submit");

  let confirmError = null;
  if (!confirm.value) {
    confirmError = "请再次输入密码";
  } else if (confirm.value !== password.value) {
    confirmError = "两次输入的密码不一致";
  }

  const invalid = validate([
    [username, usernameError(username, "学号")],
    [name, name.value.trim() ? null : "请输入姓名"],
    [password, password.value.length >= 3 && password.value.length <= 64 ? null : "密码长度必须是 3-64 位"],
    [confirm, confirmError]
  ]);

  if (invalid) {
    return;
  }

  setBusy(submit, true, "注册中…");

  try {
    await request("/api/student/register", {
      method: "POST",
      body: {
        username: username.value.trim(),
        name: name.value.trim(),
        password: password.value
      }
    });
    toast("注册成功，正在进入工作台…", "success");
    location.href = TARGET_PAGE;
  } catch (error) {
    setBusy(submit, false);

    if (error.code === "USERNAME_TAKEN") {
      showFieldError(username, error.message);
      username.focus();
      username.select();
    } else if (error.status === 400) {
      showFieldError(password, error.message);
    }

    toast(error.message, "error");
  }
});

redirectIfLoggedIn("student", TARGET_PAGE);
