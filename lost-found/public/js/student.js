import {
  bindLogoutButton,
  itemStatusBadge,
  itemTypeBadge,
  renderUserChip,
  request,
  requireRole,
  toast
} from "./api.js";
import { createItemCard } from "./item-card.js";

const PAGE_SIZE = 12;
const DEBOUNCE_MS = 300;

const state = { q: "", type: "", status: "approved", page: 1 };

const user = await requireRole("student", "student-login.html");

if (user) {
  start();
}

function start() {
  renderUserChip(document.getElementById("who"), user, "学生");
  bindLogoutButton(document.getElementById("logout"));

  document.getElementById("welcome").textContent =
    `${user.name}，这里是失物招领柜，认领功能正在开发中，先看看有没有你的东西。`;

  bindFilters();
  loadItems();
  loadMyItems();
}

function bindFilters() {
  const input = document.getElementById("search-input");
  const type = document.getElementById("filter-type");
  const status = document.getElementById("filter-status");
  let timer = null;

  input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      applyFilters({ q: input.value });
    }, DEBOUNCE_MS);
  });

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      clearTimeout(timer);
      applyFilters({ q: input.value });
    }
  });

  type.addEventListener("change", () => applyFilters({ type: type.value }));
  status.addEventListener("change", () => applyFilters({ status: status.value }));

  document.getElementById("reset-filters").addEventListener("click", () => {
    input.value = "";
    type.value = "";
    status.value = "approved";
    applyFilters({ q: "", type: "", status: "approved" });
  });

  document.getElementById("prev-page").addEventListener("click", () => {
    if (state.page > 1) {
      state.page -= 1;
      loadItems();
    }
  });

  document.getElementById("next-page").addEventListener("click", () => {
    state.page += 1;
    loadItems();
  });

  document.getElementById("detail-close").addEventListener("click", () => {
    document.getElementById("item-detail").close();
  });
}

function applyFilters(changes) {
  Object.assign(state, changes);
  state.page = 1; // 筛选条件一变就回到第一页，避免停在越界页码
  loadItems();
}

async function loadItems() {
  const cabinet = document.getElementById("cabinet");
  const empty = document.getElementById("cabinet-empty");
  const emptyText = document.getElementById("cabinet-empty-text");
  const summary = document.getElementById("result-summary");
  const pager = document.getElementById("pager");

  const params = new URLSearchParams({
    page: String(state.page),
    pageSize: String(PAGE_SIZE)
  });
  if (state.q.trim()) {
    params.set("q", state.q.trim());
  }
  if (state.type) {
    params.set("type", state.type);
  }
  params.set("status", state.status);

  try {
    const data = await request(`/api/items?${params.toString()}`);

    cabinet.replaceChildren();

    if (data.items.length === 0) {
      empty.hidden = false;
      emptyText.textContent = state.q.trim()
        ? `没有找到与「${state.q.trim()}」相关的信息`
        : "失物招领柜里暂时没有物品";
      summary.textContent = "共 0 条结果";
      pager.hidden = true;
      return;
    }

    empty.hidden = true;
    summary.textContent = `共 ${data.total} 条结果，第 ${data.page} / ${data.totalPages} 页`;

    for (const item of data.items) {
      cabinet.append(createItemCard(item, { onOpen: showDetail }));
    }

    pager.hidden = data.totalPages <= 1;
    document.getElementById("page-indicator").textContent = `第 ${data.page} / ${data.totalPages} 页`;
    document.getElementById("prev-page").disabled = data.page <= 1;
    document.getElementById("next-page").disabled = data.page >= data.totalPages;
  } catch (error) {
    summary.textContent = "加载失败，请刷新页面重试。";
    toast(error.message, "error");
  }
}

async function showDetail(item) {
  const dialog = document.getElementById("item-detail");
  const body = document.getElementById("detail-body");

  document.getElementById("detail-title").textContent = item.title;
  body.replaceChildren();

  try {
    const data = await request(`/api/items/${item.id}`);
    const detail = data.item;

    const badges = document.createElement("div");
    badges.className = "cabinet-badges";

    const type = itemTypeBadge(detail.type);
    const typeBadge = document.createElement("span");
    typeBadge.className = type.className;
    typeBadge.textContent = type.text;

    const status = itemStatusBadge(detail.status);
    const statusBadge = document.createElement("span");
    statusBadge.className = status.className;
    statusBadge.textContent = status.text;

    badges.append(typeBadge, statusBadge);
    body.append(badges);

    if (detail.hasPhoto) {
      const image = document.createElement("img");
      image.className = "detail-photo";
      image.src = `/api/items/${detail.id}/photo`;
      image.alt = `${detail.title} 的照片`;
      body.append(image);
    }

    for (const [label, value] of [
      ["拾获 / 丢失地点", detail.place],
      ["日期", detail.happenedAt],
      ["详细描述", detail.description],
      ["登记人", detail.author ? detail.author.name : "未知"],
      ["领取方式", detail.contact ?? "登录后可见"]
    ]) {
      const row = document.createElement("div");
      row.className = "detail-row";

      const key = document.createElement("span");
      key.className = "detail-key";
      key.textContent = label;

      const text = document.createElement("span");
      text.textContent = value;

      row.append(key, text);
      body.append(row);
    }

    const note = document.createElement("p");
    note.className = "hint";
    note.textContent = "认领功能将在下一个阶段开放，届时可以在这里提交认领申请。";
    body.append(note);

    dialog.showModal();
  } catch (error) {
    toast(error.message, "error");
  }
}

async function loadMyItems() {
  const container = document.getElementById("my-items");
  const summary = document.getElementById("my-items-summary");

  try {
    const data = await request("/api/my/items");
    container.replaceChildren();

    if (data.items.length === 0) {
      summary.textContent = "你还没有发布过寻物启事。";
      return;
    }

    summary.textContent = `共 ${data.items.length} 条。`;
    for (const item of data.items) {
      container.append(createItemCard(item));
    }
  } catch (error) {
    summary.textContent = "加载失败，请刷新页面重试。";
  }
}
