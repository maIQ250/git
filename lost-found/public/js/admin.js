import {
  bindLogoutButton,
  clearAllFieldErrors,
  clearFieldError,
  renderUserChip,
  request,
  requestForm,
  requireRole,
  setBusy,
  showFieldError,
  toast
} from "./api.js";
import { createItemCard } from "./item-card.js";

const DEFAULT_CONTACT = "行政楼 102 失物招领处";

const user = await requireRole("admin", "admin-login.html");

if (user) {
  start();
}

function start() {
  renderUserChip(document.getElementById("who"), user, "管理员");
  bindLogoutButton(document.getElementById("logout"));

  document.getElementById("welcome").textContent =
    `${user.name}，欢迎回来。登记物品后学生立刻就能在失物招领柜里看到。`;

  const form = document.getElementById("item-form");
  const photoInput = document.getElementById("item-photo");
  const preview = document.getElementById("photo-preview");
  const previewImage = document.getElementById("photo-preview-image");

  document.getElementById("item-contact").value = DEFAULT_CONTACT;
  document.getElementById("item-date").value = new Date().toISOString().slice(0, 10);

  // 选好文件立刻预览；用户取消选择时同步把预览收起来
  photoInput.addEventListener("change", () => {
    const file = photoInput.files[0];
    clearFieldError(photoInput);

    if (!file) {
      preview.hidden = true;
      previewImage.removeAttribute("src");
      return;
    }

    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      showFieldError(photoInput, "只支持 JPEG、PNG、WebP 图片");
      photoInput.value = "";
      preview.hidden = true;
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      showFieldError(photoInput, "图片不能超过 2MB");
      photoInput.value = "";
      preview.hidden = true;
      return;
    }

    previewImage.src = URL.createObjectURL(file);
    preview.hidden = false;
  });

  document.getElementById("photo-remove").addEventListener("click", () => {
    photoInput.value = "";
    previewImage.removeAttribute("src");
    preview.hidden = true;
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearAllFieldErrors(form);

    const submit = document.getElementById("item-submit");
    setBusy(submit, true, "登记中…");

    try {
      const data = new FormData(form);
      const result = await requestForm("/api/items", data);

      toast(`已登记「${result.item.title}」，学生现在就能看到了`, "success");

      form.reset();
      document.getElementById("item-contact").value = DEFAULT_CONTACT;
      document.getElementById("item-date").value = new Date().toISOString().slice(0, 10);
      previewImage.removeAttribute("src");
      preview.hidden = true;

      await loadMyItems();
    } catch (error) {
      toast(error.message, "error");
    } finally {
      setBusy(submit, false);
    }
  });

  loadMyItems();
}

async function loadMyItems() {
  const container = document.getElementById("my-items");
  const summary = document.getElementById("my-items-summary");

  try {
    const data = await request("/api/my/items");
    container.replaceChildren();

    if (data.items.length === 0) {
      summary.textContent = "还没有登记过物品。";
      return;
    }

    summary.textContent = `共 ${data.items.length} 条，其中 ${data.items.filter((item) => item.pendingClaims > 0).length} 条有待处理申请。`;

    for (const item of data.items) {
      container.append(createItemCard(item));
    }
  } catch (error) {
    summary.textContent = "加载失败，请刷新页面重试。";
    toast(error.message, "error");
  }
}
