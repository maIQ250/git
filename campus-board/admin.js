/**
 * 珠科雷达 · 管理端
 *
 * 只做最小可用的审核闭环：查看待审核信息 → 通过 / 驳回 → 同步学生端。
 * 不引入账号、权限与后端：审核状态和学生端共用同一份 localStorage
 * （key 与 app.js 一致），审核结果直接体现在学生端的公开列表里。
 */

const STORE_KEY = "campus-board.v1";
const FILTERS = [
  { key: "pending", label: "待审核" },
  { key: "published", label: "已发布" },
  { key: "rejected", label: "已驳回" },
  { key: "all", label: "全部" },
];

const STATUS = {
  pending: { label: "待审核", cls: "tag-pending" },
  published: { label: "已发布", cls: "tag-published" },
  rejected: { label: "已驳回", cls: "tag-rejected" },
};

let state = { filter: "pending", openId: null };

const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
));

function load() {
  try {
    const data = JSON.parse(localStorage.getItem(STORE_KEY) ?? "{}");
    return {
      favorites: Array.isArray(data.favorites) ? data.favorites : [],
      published: Array.isArray(data.published) ? data.published : [],
    };
  } catch {
    return { favorites: [], published: [] };
  }
}

function save(data) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({
      favorites: data.favorites ?? [],
      published: data.published ?? [],
    }));
  } catch {
    toast("浏览器不允许保存，本次审核结果只在当前页面有效");
  }
}

function items() {
  return load().published.map((p) => ({ ...p, status: p.status ?? "published" }));
}

function pendingItems() {
  return items().filter((it) => it.status !== "published");
}

function setStatus(id, status) {
  const data = load();
  const target = data.published.find((p) => p.id === id);
  if (!target) return null;
  target.status = status;
  target.reviewedAt = new Date().toISOString();
  save(data);
  return target;
}

function fmt(value) {
  if (!value) return "未填写";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  const week = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][d.getDay()];
  const time = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return `${d.getMonth() + 1}月${d.getDate()}日 ${week} ${time}`;
}

function renderStats() {
  const list = items();
  const count = (key) => list.filter((it) => it.status === key).length;
  $("adminStats").innerHTML = `
    <div class="stat stat-pending"><strong>${count("pending")}</strong><span>待审核</span></div>
    <div class="stat stat-published"><strong>${count("published")}</strong><span>已发布</span></div>
    <div class="stat stat-rejected"><strong>${count("rejected")}</strong><span>已驳回</span></div>`;
}

function renderTabs() {
  const list = items();
  $("adminTabs").innerHTML = FILTERS.map(({ key, label }) => {
    const n = key === "all" ? list.length : list.filter((it) => it.status === key).length;
    return `<button type="button" class="tab${state.filter === key ? " is-active" : ""}" data-filter="${key}">
      ${esc(label)} ${n}</button>`;
  }).join("");
}

function renderList() {
  const all = items();
  const list = state.filter === "all" ? all : all.filter((it) => it.status === state.filter);

  $("adminList").innerHTML = list.map((it) => {
    const st = STATUS[it.status] ?? STATUS.pending;
    const open = state.openId === it.id;
    return `
      <li class="row" data-id="${esc(it.id)}">
        <div class="row-head">
          <div>
            <p class="row-title">${esc(it.title)}</p>
            <div class="row-meta">
              <span>类型：${esc(it.type ?? "未填写")}</span>
              <span>时间：${esc(fmt(it.eventStart))}</span>
              <span>地点：${esc(it.location ?? it.locationNote ?? "未填写")}</span>
            </div>
          </div>
          <span class="tag ${st.cls}">${esc(st.label)}</span>
        </div>

        ${open ? `
          <dl class="row-detail">
            <div class="detail-grid">
              <div><dt>说明</dt><dd>${esc(it.summary ?? "未填写")}</dd></div>
              <div><dt>报名截止</dt><dd>${esc(fmt(it.deadline))}</dd></div>
              <div><dt>联系方式</dt><dd>${esc((it.requirements ?? []).join("；") || "未填写")}</dd></div>
              ${it.reviewedAt ? `<div><dt>审核时间</dt><dd>${esc(fmt(it.reviewedAt))}</dd></div>` : ""}
            </div>
          </dl>` : ""}

        <div class="row-actions">
          <button type="button" class="btn" data-action="toggle" data-id="${esc(it.id)}">${open ? "收起" : "查看"}</button>
          <button type="button" class="btn btn-ok" data-action="approve" data-id="${esc(it.id)}" ${it.status === "published" ? "disabled" : ""}>通过</button>
          <button type="button" class="btn btn-danger" data-action="reject" data-id="${esc(it.id)}" ${it.status === "rejected" ? "disabled" : ""}>驳回</button>
        </div>
      </li>`;
  }).join("");

  const empty = $("adminEmpty");
  empty.hidden = list.length > 0;
  empty.textContent = state.filter === "pending"
    ? "当前没有待审核的信息。学生端提交后会出现在这里。"
    : "这个状态下暂时没有信息。";
}

let toastTimer = null;
function toast(message) {
  const el = $("adminToast");
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
}

function renderAll() {
  renderStats();
  renderTabs();
  renderList();
}

$("adminTabs").addEventListener("click", (e) => {
  const tab = e.target.closest("[data-filter]");
  if (!tab) return;
  state.filter = tab.dataset.filter;
  state.openId = null;
  renderAll();
});

$("adminList").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-action]");
  if (!btn) return;
  const { action, id } = btn.dataset;

  if (action === "toggle") {
    state.openId = state.openId === id ? null : id;
    renderList();
    return;
  }
  if (action === "approve") {
    const item = setStatus(id, "published");
    if (!item) return;
    state.openId = null;
    renderAll();
    toast("已通过，信息已进入学生端的公开信息流");
    return;
  }
  if (action === "reject") {
    const item = setStatus(id, "rejected");
    if (!item) return;
    state.openId = null;
    renderAll();
    toast("已驳回，学生端「我发布的」里会显示已驳回");
  }
});

window.addEventListener("storage", (e) => {
  if (e.key === STORE_KEY) renderAll();
});

renderAll();
