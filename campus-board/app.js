/**
 * 珠科雷达 —— 应用逻辑
 *
 * 三件事值得单独说明：
 *  1) 状态是算出来的，不是写死的。所有「还剩几小时 / 已截止 / 已结束」都以
 *     REFERENCE_NOW（考核基准 9月19日14:00）为唯一时间源推算。
 *  2) 补充通知会被合并进主信息（01←09、03←20），列表里只出现一条，
 *     详情里用时间线展示「改了什么」，避免同一条信息重复刷屏。
 *  3) 学生发布的信息要先进一遍「信息体检」：缺时间、缺地点、留私人联系方式、
 *     出现「日结/零门槛」这类词，都会在提交前明确提示，发布后也会带提示标签。
 */

const REF_NOW = Date.parse(REFERENCE_NOW);
const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const STORE_KEY = "campus-board.v1";

const CATEGORY_OF_TYPE = {
  "竞赛训练": "竞赛与训练",
  "竞赛": "竞赛与训练",
  "工作坊": "竞赛与训练",
  "公开课": "讲座与分享",
  "分享会": "讲座与分享",
  "观摩活动": "讲座与分享",
  "团队招募": "招募与组队",
  "科研招募": "招募与组队",
  "志愿者招募": "招募与组队",
  "组队招募": "招募与组队",
  "志愿服务": "志愿与公益",
  "学习小组": "课程与资料",
  "学习资料": "课程与资料",
  "兴趣小组": "兴趣与活动",
  "兴趣交流": "兴趣与活动",
  "约球": "兴趣与活动",
  "交流活动": "兴趣与活动",
  "兼职信息": "兴趣与活动",
  "补充通知": "补充通知",
};

const SOURCE_LABEL = { official: "学校部门", college: "学院发布", student: "学生发布", unknown: "主办方未标注" };

/* ---------------- 工具 ---------------- */

const $ = (id) => document.getElementById(id);

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

function pad(n) { return String(n).padStart(2, "0"); }

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

/** 日期带星期：9月21日 周一。材料里「每周三/每周六」这类描述只有标了星期才能核对 */
function fmtDate(value) {
  const d = new Date(value);
  return `${d.getMonth() + 1}月${d.getDate()}日 ${WEEKDAYS[d.getDay()]}`;
}

/** 只取时刻，00:00 视为「只写了日期」 */
function fmtTime(value) {
  const d = new Date(value);
  const t = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return t === "00:00" ? "" : t;
}

/** 完整时间：9月21日 周一 19:30 */
function fmtDateTime(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const time = fmtTime(value);
  return time ? `${fmtDate(value)} ${time}` : fmtDate(value);
}

/** 相对基准时刻的天数差，用于「今天 / 明天 / 后天」 */
function dayDiff(value) {
  const target = new Date(value);
  const base = new Date(REF_NOW);
  const t = new Date(target.getFullYear(), target.getMonth(), target.getDate()).getTime();
  const b = new Date(base.getFullYear(), base.getMonth(), base.getDate()).getTime();
  return Math.round((t - b) / DAY);
}

function relDayLabel(value) {
  const diff = dayDiff(value);
  if (diff === 0) return "今天";
  if (diff === 1) return "明天";
  if (diff === 2) return "后天";
  return fmtDate(value);
}

/* ---------------- 数据整理 ---------------- */

/** 合并补充通知：返回主信息列表，每条带上 updates 时间线与最终生效字段 */
function buildViews(published) {
  const all = [...RAW_ITEMS, ...published];
  const updatesOf = new Map();

  for (const item of all) {
    if (item.updateOf) {
      if (!updatesOf.has(item.updateOf)) updatesOf.set(item.updateOf, []);
      updatesOf.get(item.updateOf).push(item);
    }
  }

  const mains = all.filter((item) => !item.updateOf && item.type !== "补充通知");

  return mains.map((item) => {
    const updates = (updatesOf.get(item.id) ?? [])
      .slice()
      .sort((a, b) => Date.parse(a.eventStart ?? 0) - Date.parse(b.eventStart ?? 0));

    // 最终生效值：后来的补充通知覆盖原信息里对应字段
    let effective = { ...item };
    for (const up of updates) {
      effective = {
        ...effective,
        eventStart: up.eventStart ?? effective.eventStart,
        eventEnd: up.eventEnd ?? effective.eventEnd,
        location: up.location ?? effective.location,
        locationNote: up.locationNote ?? effective.locationNote,
        deadline: up.deadline ?? effective.deadline,
        deadlineNote: up.deadlineNote ?? effective.deadlineNote,
        capacity: up.capacity ?? effective.capacity,
      };
    }

    return { ...effective, originalEventStart: item.eventStart, updates, base: item };
  });
}

/**
 * 统一状态机。返回 { key, label, tone, rank, sortAt }
 * tone：urgent | soon | today | open | done | plain
 */
function computeStatus(view) {
  const deadline = view.deadline ? Date.parse(view.deadline) : null;
  const start = view.eventStart ? Date.parse(view.eventStart) : null;
  const end = view.eventEnd ? Date.parse(view.eventEnd) : null;

  if (view.statedStatus === "ended" || (end && end < REF_NOW)) {
    return { key: "done", label: "已结束", tone: "done", rank: 4, sortAt: end ?? start ?? 0 };
  }
  if (deadline && deadline < REF_NOW) {
    const waitlist = /候补/.test(view.deadlineNote ?? "") || (view.flags ?? []).some((f) => /候补/.test(f.text));
    return {
      key: "closed",
      label: waitlist ? "报名已截止 · 可候补" : "报名已截止",
      tone: "done",
      rank: 4,
      sortAt: deadline,
    };
  }
  if (deadline && deadline - REF_NOW <= DAY) {
    const hours = Math.max(1, Math.round((deadline - REF_NOW) / HOUR));
    const isResource = view.type === "学习资料";
    return {
      key: "urgent",
      label: isResource ? `提取信息还剩 ${hours} 小时有效` : `还剩 ${hours} 小时截止`,
      tone: "urgent", rank: 0, sortAt: deadline,
    };
  }
  if (deadline && deadline - REF_NOW <= 3 * DAY) {
    const days = Math.max(1, Math.round((deadline - REF_NOW) / DAY));
    const isResource = view.type === "学习资料";
    return {
      key: "soon",
      label: isResource ? `提取信息还剩 ${days} 天有效` : `还剩 ${days} 天截止`,
      tone: "soon", rank: 1, sortAt: deadline,
    };
  }
  if (start && start >= REF_NOW && dayDiff(start) === 0) {
    return {
      key: "today",
      label: `今天 ${pad(new Date(start).getHours())}:${pad(new Date(start).getMinutes())} 开始`,
      tone: "today", rank: 1, sortAt: start,
    };
  }
  if (start && start >= REF_NOW) {
    return { key: "open", label: `${relDayLabel(start)}开始`, tone: "open", rank: 3, sortAt: start };
  }
  if (deadline) {
    const isResource = view.type === "学习资料";
    return {
      key: "open",
      label: isResource ? `提取信息 ${relDayLabel(deadline)}失效` : `还能报名 · ${relDayLabel(deadline)}截止`,
      tone: "open", rank: 3, sortAt: deadline,
    };
  }
  // 没有截止时间的三类情况分开处理，避免把「还没定」说成「随时可去」
  if (/无需报名|无需提前报名/.test(view.deadlineNote ?? "")) {
    return { key: "open", label: "无需报名 · 随时参与", tone: "open", rank: 3, sortAt: Number.MAX_SAFE_INTEGER };
  }
  if (view.deadlineNote) {
    return { key: "open", label: view.deadlineNote, tone: "plain", rank: 2, sortAt: Number.MAX_SAFE_INTEGER };
  }
  return { key: "open", label: "长期开放 · 无固定截止", tone: "open", rank: 3, sortAt: Number.MAX_SAFE_INTEGER };
}

function sourceGroupOf(view) {
  if (view.source.kind === "student") return "student";
  if (view.source.kind === "official" || view.source.kind === "college") return "official";
  return "unknown";
}

function searchIndex(view) {
  return [
    view.title, view.summary, view.location, view.locationNote, view.source.name,
    view.audience, view.type, ...(view.tags ?? []), ...(view.requirements ?? []),
    ...(view.flags ?? []).map((f) => f.text),
  ].filter(Boolean).join(" ").toLowerCase();
}

/* ---------------- 本地保存 ---------------- */

const store = {
  favorites: new Set(),
  published: [],
  load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (Array.isArray(data.favorites)) this.favorites = new Set(data.favorites.filter((x) => typeof x === "string"));
      if (Array.isArray(data.published)) this.published = data.published.filter((x) => x && typeof x === "object");
    } catch {
      // 本地数据损坏或存储被禁用时，退回空状态，页面照常可用
      this.favorites = new Set();
      this.published = [];
    }
  },
  save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        favorites: [...this.favorites],
        published: this.published,
      }));
    } catch {
      toast("浏览器不允许保存，这次操作只在当前页面有效");
    }
  },
};

/* ---------------- 视图状态 ---------------- */

const state = {
  query: "",
  source: "all",
  category: "all",
  status: "all",
  sort: "action",
  view: "all", // all | saved | mine
  selectedId: null,
};

let views = [];

/* ---------------- 渲染：筛选条 ---------------- */

function activeViews() {
  return buildViews(store.published);
}

function countBy(predicate) {
  return activeViews().filter(predicate).length;
}

function renderFilters() {
  const sourceDefs = [
    { key: "all", label: "全部" },
    { key: "official", label: "学校 / 学院" },
    { key: "student", label: "学生发布" },
    { key: "unknown", label: "主办方未标注" },
  ];
  $("filterSource").innerHTML = sourceDefs.map(({ key, label }) => {
    const count = key === "all" ? activeViews().length : countBy((v) => sourceGroupOf(v) === key);
    return `<button type="button" class="chip${state.source === key ? " is-active" : ""}" data-group="source" data-value="${key}">
      ${esc(label)}<span class="chip-count">${count}</span></button>`;
  }).join("");

  const categories = [...new Set(activeViews().map((v) => CATEGORY_OF_TYPE[v.type] ?? "其他"))];
  const order = ["竞赛与训练", "讲座与分享", "招募与组队", "志愿与公益", "课程与资料", "兴趣与活动", "其他"];
  const sorted = categories.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  $("filterType").innerHTML = [{ key: "all", label: "全部" }, ...sorted.map((c) => ({ key: c, label: c }))]
    .map(({ key, label }) => {
      const count = key === "all"
        ? activeViews().length
        : countBy((v) => (CATEGORY_OF_TYPE[v.type] ?? "其他") === key);
      return `<button type="button" class="chip${state.category === key ? " is-active" : ""}" data-group="category" data-value="${esc(key)}">
        ${esc(label)}<span class="chip-count">${count}</span></button>`;
    }).join("");

  const statusDefs = [
    { key: "all", label: "全部" },
    { key: "urgent", label: "即将截止", test: (s) => s.key === "urgent" || s.key === "soon" },
    { key: "today", label: "今天有安排", test: (s) => s.key === "today" },
    { key: "open", label: "还能参与", test: (s) => s.key === "open" },
    { key: "done", label: "已结束 / 已截止", test: (s) => s.key === "done" || s.key === "closed" },
  ];
  $("filterStatus").innerHTML = statusDefs.map(({ key, label, test }) => {
    const count = key === "all" ? activeViews().length : countBy((v) => test(computeStatus(v)));
    return `<button type="button" class="chip${state.status === key ? " is-active" : ""}" data-group="status" data-value="${key}">
      ${esc(label)}<span class="chip-count">${count}</span></button>`;
  }).join("");
}

/* ---------------- 渲染：列表 ---------------- */

function filteredViews() {
  let list = activeViews();

  if (state.view === "saved") list = list.filter((v) => store.favorites.has(v.id));
  if (state.view === "mine") list = list.filter((v) => v.source.kind === "student" && v.mine);

  if (state.source !== "all") list = list.filter((v) => sourceGroupOf(v) === state.source);
  if (state.category !== "all") list = list.filter((v) => (CATEGORY_OF_TYPE[v.type] ?? "其他") === state.category);
  if (state.status !== "all") {
    const test = {
      urgent: (s) => s.key === "urgent" || s.key === "soon",
      today: (s) => s.key === "today",
      open: (s) => s.key === "open",
      done: (s) => s.key === "done" || s.key === "closed",
    }[state.status];
    list = list.filter((v) => test(computeStatus(v)));
  }
  if (state.query) {
    const q = state.query.toLowerCase();
    list = list.filter((v) => searchIndex(v).includes(q));
  }

  const sorters = {
    action: (a, b) => computeStatus(a).rank - computeStatus(b).rank
      || computeStatus(a).sortAt - computeStatus(b).sortAt,
    deadline: (a, b) => (Date.parse(a.deadline ?? a.eventStart ?? 0) || Number.MAX_SAFE_INTEGER)
      - (Date.parse(b.deadline ?? b.eventStart ?? 0) || Number.MAX_SAFE_INTEGER),
    source: (a, b) => sourceGroupOf(a).localeCompare(sourceGroupOf(b)) || a.id.localeCompare(b.id),
    id: (a, b) => a.id.localeCompare(b.id, "zh"),
  };
  return list.slice().sort(sorters[state.sort] ?? sorters.action);
}

const ICON_CLOCK = `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><circle cx="8" cy="8" r="6.2" stroke="currentColor" stroke-width="1.4" fill="none"/><path d="M8 4.6V8l2.4 1.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" fill="none"/></svg>`;
const ICON_PIN = `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M8 14s4.6-4.3 4.6-7.3A4.6 4.6 0 0 0 3.4 6.7C3.4 9.7 8 14 8 14Z" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linejoin="round"/><circle cx="8" cy="6.6" r="1.6" stroke="currentColor" stroke-width="1.4" fill="none"/></svg>`;
const ICON_USER = `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><circle cx="8" cy="5.6" r="2.6" stroke="currentColor" stroke-width="1.4" fill="none"/><path d="M3.4 13.2c.6-2.3 2.4-3.5 4.6-3.5s4 1.2 4.6 3.5" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round"/></svg>`;
const ICON_ALERT = `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M8 2.6 14 13H2L8 2.6Z" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linejoin="round"/><path d="M8 6.6v3.1M8 11.4v.1" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`;
const ICON_INFO = `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><circle cx="8" cy="8" r="6.2" stroke="currentColor" stroke-width="1.4" fill="none"/><path d="M8 7.2v4M8 4.9v.1" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`;
const ICON_BOOKMARK = (filled) => `<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="M6 3.6h8a1 1 0 0 1 1 1v11.2l-5-3.1-5 3.1V4.6a1 1 0 0 1 1-1Z" stroke="currentColor" stroke-width="1.6" fill="${filled ? "currentColor" : "none"}" stroke-linejoin="round"/></svg>`;

function flagTone(level) {
  return level === "danger" ? "flag-danger" : level === "warn" ? "flag-warn" : "flag-info";
}

function renderList() {
  const list = filteredViews();
  $("list").innerHTML = list.map((view) => {
    const status = computeStatus(view);
    const saved = store.favorites.has(view.id);
    const topFlag = (view.flags ?? []).find((f) => f.level !== "info") ?? (view.flags ?? [])[0];
    const when = view.eventStart ? `${relDayLabel(view.eventStart)} ${fmtTime(view.eventStart)}`.trim() : null;
    const place = view.location ?? (view.locationNote && view.locationNote !== "未提供" ? view.locationNote : null);

    return `
      <li class="item${state.selectedId === view.id ? " is-selected" : ""}${status.tone === "done" ? " is-done" : ""}"
          data-id="${esc(view.id)}" tabindex="0" role="button" aria-pressed="${state.selectedId === view.id}">
        <button class="save-btn${saved ? " is-saved" : ""}" type="button" data-save="${esc(view.id)}"
                aria-label="${saved ? "取消收藏" : "收藏"}${esc(view.title)}" aria-pressed="${saved}">
          ${ICON_BOOKMARK(saved)}
        </button>
        <div class="item-title-row">
          <div class="item-top">
            <span class="pill pill-${status.tone}">${esc(status.label)}</span>
            <span class="badge ${view.source.kind === "student" ? (view.trust === "low" ? "badge-low" : "badge-student") : "badge-official"}">
              ${esc(SOURCE_LABEL[view.source.kind])}
            </span>
            ${view.mine ? '<span class="badge">我发布的</span>' : ""}
          </div>
          <h2 class="item-title">${esc(view.title)}</h2>
        </div>
        <div class="item-meta">
          ${when ? `<span>${ICON_CLOCK}${esc(when)}</span>` : ""}
          ${place ? `<span>${ICON_PIN}${esc(place)}</span>` : ""}
          <span>${ICON_USER}${esc(view.audience)}</span>
        </div>
        <p class="item-summary">${esc(view.summary)}</p>
        ${topFlag ? `<p class="item-flag ${flagTone(topFlag.level)}">${topFlag.level === "info" ? ICON_INFO : ICON_ALERT}<span>${esc(topFlag.text)}</span></p>` : ""}
      </li>`;
  }).join("");

  const emptyMessages = {
    all: "没有匹配的信息，试着把筛选条件放宽一些。",
    saved: "还没有收藏。点信息右上角的书签图标就能存下来，刷新后依然在。",
    mine: "还没有发布过信息。点右上角「发布信息」就能发一条活动、约球或组队招募。",
  };
  const empty = $("empty");
  empty.hidden = list.length > 0;
  empty.textContent = emptyMessages[state.view];
  $("resultCount").textContent = list.length
    ? `共 ${list.length} 条信息`
    : "";
  $("savedCount").textContent = String(store.favorites.size);
  $("mineCount").textContent = String(store.published.length);
}

/* ---------------- 渲染：详情 ---------------- */

function renderDetail() {
  const view = activeViews().find((v) => v.id === state.selectedId);
  const body = $("detailBody");

  if (!view) {
    body.hidden = true;
    $("detailPlaceholder").hidden = false;
    return;
  }

  const status = computeStatus(view);
  const saved = store.favorites.has(view.id);
  const facts = [
    view.eventStart && {
      label: "活动时间",
      value: `${fmtDateTime(view.eventStart)}${view.eventEnd ? `—${fmtTime(view.eventEnd) || fmtDate(view.eventEnd)}` : ""}`,
      note: view.eventStartNote ?? (view.originalEventStart && view.originalEventStart !== view.eventStart
        ? `原计划 ${fmtDateTime(view.originalEventStart)}，已按补充通知更新` : null),
    },
    { label: "地点", value: view.location ?? "未提供", note: view.locationNote },
    view.deadline && { label: "报名截止", value: fmtDateTime(view.deadline), note: view.deadlineNote },
    view.deadlineNote && !view.deadline && { label: "报名", value: view.deadlineNote },
    { label: "面向对象", value: view.audience },
    view.capacity && { label: "人数", value: view.capacity },
    { label: "费用", value: view.cost ?? "未提供" },
    { label: "来源", value: view.source.name },
  ].filter(Boolean);

  const timeline = [
    {
      label: view.base.updateOf ? "" : "起初发布",
      title: view.base.title,
      text: view.base.summary,
      latest: view.updates.length === 0,
    },
    ...view.updates.map((up, index) => ({
      label: `补充通知 ${index + 1}`,
      title: up.title,
      text: up.summary,
      latest: index === view.updates.length - 1,
    })),
  ];

  body.hidden = false;
  $("detailPlaceholder").hidden = true;
  body.innerHTML = `
    <div class="detail-inner">
      <div class="detail-head">
        <div>
          <h2 class="detail-title">${esc(view.title)}</h2>
          <div class="detail-badges">
            <span class="pill pill-${status.tone}">${esc(status.label)}</span>
            <span class="badge ${view.source.kind === "student" ? "badge-student" : "badge-official"}">${esc(SOURCE_LABEL[view.source.kind])}</span>
            <span class="badge">${esc(CATEGORY_OF_TYPE[view.type] ?? view.type)}</span>
          </div>
        </div>
        <button class="icon-btn detail-close" type="button" data-close-detail aria-label="关闭详情">
          <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
        </button>
      </div>

      <p class="detail-summary">${esc(view.summary)}</p>

      ${(view.flags ?? []).length ? `
        <div class="detail-section">
          <h3>需要留意</h3>
          ${(view.flags ?? []).map((f) => `<p class="item-flag ${flagTone(f.level)}">${f.level === "info" ? ICON_INFO : ICON_ALERT}<span>${esc(f.text)}</span></p>`).join("")}
        </div>` : ""}

      <div class="detail-section">
        <h3>关键信息</h3>
        <dl class="facts">
          ${facts.map((f) => `<div class="fact"><dt>${esc(f.label)}</dt><dd>${esc(f.value)}${f.note ? `<span class="fact-note">${esc(f.note)}</span>` : ""}</dd></div>`).join("")}
        </dl>
      </div>

      ${(view.requirements ?? []).length ? `
        <div class="detail-section">
          <h3>参与条件</h3>
          <ul class="req-list">${view.requirements.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>
        </div>` : ""}

      ${view.updates.length ? `
        <div class="detail-section">
          <h3>这件事变过什么</h3>
          <div class="timeline">
            ${timeline.map((t) => `
              <div class="timeline-item${t.latest ? " is-latest" : ""}">
                <p class="timeline-label">${esc(t.label)}${t.latest ? '<span class="timeline-chip">当前生效</span>' : ""}</p>
                <p class="timeline-title">${esc(t.title)}</p>
                <p class="timeline-text">${esc(t.text)}</p>
              </div>`).join("")}
          </div>
        </div>` : ""}

      <div class="detail-actions">
        <button class="btn ${saved ? "btn-ghost" : "btn-primary"}" type="button" data-save="${esc(view.id)}">
          ${saved ? "已收藏，刷新后还在" : "收藏这条信息"}
        </button>
        <button class="btn btn-ghost" type="button" data-copy="${esc(view.id)}">复制要点</button>
      </div>
      ${view.mine ? `<button class="btn btn-ghost" type="button" data-remove="${esc(view.id)}" style="margin-top:8px;width:100%;justify-content:center">删除我发布的这条</button>` : ""}
      <p class="source-note">材料编号 ${esc(view.id)}。信息来自考核题目，若与实际情况不符请以主办方通知为准。</p>
    </div>`;
}

/* ---------------- 交互 ---------------- */

function selectItem(id) {
  state.selectedId = state.selectedId === id ? null : id;
  renderList();
  renderDetail();
  if (state.selectedId && window.innerWidth <= 860) {
    $("detailBody").scrollIntoView({ behavior: "smooth", block: "end" });
  }
}

function toggleSave(id) {
  if (store.favorites.has(id)) {
    store.favorites.delete(id);
    toast("已取消收藏");
  } else {
    store.favorites.add(id);
    toast("已收藏，重新打开页面也能看到");
  }
  store.save();
  renderFilters();
  renderList();
  renderDetail();
}

let toastTimer = null;
function toast(message) {
  const el = $("toast");
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
}

function copySummary(id) {
  const view = activeViews().find((v) => v.id === id);
  if (!view) return;
  const text = [
    view.title,
    view.summary,
    view.eventStart ? `时间：${fmtDateTime(view.eventStart)}` : "",
    view.deadline ? `报名截止：${fmtDateTime(view.deadline)}` : "",
    view.location ? `地点：${view.location}` : "",
    `来源：${view.source.name}`,
  ].filter(Boolean).join("\n");

  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(
      () => toast("要点已复制，可以直接发给同学"),
      () => toast("复制失败，请手动选择文字"),
    );
  } else {
    toast("当前浏览器不支持一键复制");
  }
}

function openModal() {
  $("modal").hidden = false;
  $("pTitle").focus();
  runFormCheck();
}

function closeModal() {
  $("modal").hidden = true;
}

/* -------- 发布表单：发布前先做一次「信息体检」 -------- */

const RISKY_WORDS = [
  { re: /日结|零门槛|返利|刷单|轻松赚钱|包吃住/, text: "出现「日结 / 零门槛」这类表述，容易被同学当成高风险兼职，建议改成具体工作内容和结算方式" },
  { re: /(私|加)\s*(人)?\s*微信|vx|wechat|V信/i, text: "要求加私人微信，建议改成群聊或平台内留言，避免暴露私人联系方式" },
];

function runFormCheck() {
  const title = $("pTitle").value.trim();
  const type = $("pType").value;
  const time = $("pTime").value;
  const location = $("pLocation").value.trim();
  const deadline = $("pDeadline").value;
  const contact = $("pContact").value.trim();
  const summary = $("pSummary").value.trim();

  const lines = [];
  if (!title || !type || !contact) {
    lines.push({ tone: "danger", text: "标题、类型、怎么找到你，这三项填完才能发布。" });
  }
  if (!time) lines.push({ tone: "warn", text: "没填活动时间：同学无法判断「什么时候去」，建议写上，确不了就写大概时段。" });
  if (!location) lines.push({ tone: "warn", text: "没填地点：像「场地待定」这种信息，我们看到后会保留提示，不会替你补一个地点。" });
  if (!deadline) lines.push({ tone: "warn", text: "没填报名截止：建议写清楚，或注明「满员即止」，否则同学不知道该不该现在决定。" });
  if (!summary) lines.push({ tone: "warn", text: "说明为空：补上人数、费用、要求，能少很多来回问。" });
  for (const { re, text } of RISKY_WORDS) {
    if (re.test(`${title} ${summary} ${contact}`)) lines.push({ tone: "danger", text });
  }
  if (!lines.length) {
    lines.push({ tone: "ok", text: "信息体检通过：时间、地点、截止时间、联系方式都齐了。" });
  }

  $("formCheck").innerHTML = lines.map((l) => `
    <p class="check-line check-${l.tone}">
      ${l.tone === "ok" ? ICON_INFO : l.tone === "danger" ? ICON_ALERT : ICON_INFO}<span>${esc(l.text)}</span>
    </p>`).join("");
}

function submitPublish(event) {
  event.preventDefault();
  const title = $("pTitle").value.trim();
  const type = $("pType").value;
  const contact = $("pContact").value.trim();
  if (!title || !type || !contact) {
    runFormCheck();
    toast("还有必填项没填完");
    return;
  }

  const time = $("pTime").value;
  const deadline = $("pDeadline").value;
  const location = $("pLocation").value.trim();
  const summary = $("pSummary").value.trim();

  const flags = [];
  if (!time) flags.push({ level: "warn", text: "发布者没有填写活动时间" });
  if (!location) flags.push({ level: "warn", text: "发布者没有填写地点" });
  if (!deadline) flags.push({ level: "info", text: "没有报名截止时间，满了或结束前建议自行留意" });
  for (const { re, text } of RISKY_WORDS) {
    if (re.test(`${title} ${summary} ${contact}`)) flags.push({ level: "danger", text });
  }

  const id = `P${Date.now().toString().slice(-6)}`;
  store.published.unshift({
    id,
    title,
    source: { kind: "student", name: "学生个人发布" },
    trust: flags.some((f) => f.level === "danger") ? "low" : "medium",
    mine: true,
    type,
    audience: "不限",
    summary: summary || "发布者没有补充更多说明。",
    eventStart: time || null,
    eventStartNote: time ? null : "发布者未填写时间",
    eventEnd: null,
    location: location || null,
    locationNote: location ? null : "发布者未填写地点",
    deadline: deadline || null,
    deadlineNote: deadline ? null : "未注明报名截止",
    cost: "未提供",
    capacity: null,
    requirements: [`联系方式：${contact}`],
    tags: ["学生发起"],
    flags,
  });
  store.save();

  $("publishForm").reset();
  closeModal();
  state.view = "all";
  selectSegment("all");
  renderFilters();
  renderList();
  state.selectedId = id;
  renderList();
  renderDetail();
  toast("已发布到信息板，刷新后仍然在「我发布的」里");
}

/* ---------------- 事件绑定 ---------------- */

function selectSegment(view) {
  state.view = view;
  for (const [id, key] of [["viewAll", "all"], ["viewSaved", "saved"], ["viewMine", "mine"]]) {
    const el = $(id);
    const active = key === view;
    el.classList.toggle("is-active", active);
    el.setAttribute("aria-selected", String(active));
  }
}

function bind() {
  $("search").addEventListener("input", (e) => {
    state.query = e.target.value.trim();
    renderList();
  });

  $("sort").addEventListener("change", (e) => {
    state.sort = e.target.value;
    renderList();
  });

  $("viewAll").addEventListener("click", () => { selectSegment("all"); renderList(); });
  $("viewSaved").addEventListener("click", () => { selectSegment("saved"); renderList(); });
  $("viewMine").addEventListener("click", () => { selectSegment("mine"); renderList(); });

  document.querySelectorAll(".filters").forEach((root) => {
    root.addEventListener("click", (e) => {
      const chip = e.target.closest(".chip");
      if (!chip) return;
      state[chip.dataset.group] = chip.dataset.value;
      renderFilters();
      renderList();
    });
  });

  $("list").addEventListener("click", (e) => {
    const saveBtn = e.target.closest("[data-save]");
    if (saveBtn) {
      e.stopPropagation();
      toggleSave(saveBtn.dataset.save);
      return;
    }
    const item = e.target.closest(".item");
    if (item) selectItem(item.dataset.id);
  });

  $("list").addEventListener("keydown", (e) => {
    const item = e.target.closest(".item");
    if (!item) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      selectItem(item.dataset.id);
    }
  });

  $("detailBody").addEventListener("click", (e) => {
    const saveBtn = e.target.closest("[data-save]");
    if (saveBtn) { toggleSave(saveBtn.dataset.save); return; }
    const copyBtn = e.target.closest("[data-copy]");
    if (copyBtn) { copySummary(copyBtn.dataset.copy); return; }
    const removeBtn = e.target.closest("[data-remove]");
    if (removeBtn) {
      store.published = store.published.filter((p) => p.id !== removeBtn.dataset.remove);
      store.favorites.delete(removeBtn.dataset.remove);
      store.save();
      state.selectedId = null;
      renderFilters();
      renderList();
      renderDetail();
      toast("已删除");
      return;
    }
    if (e.target.closest("[data-close-detail]")) {
      state.selectedId = null;
      renderList();
      renderDetail();
    }
  });

  $("publishBtn").addEventListener("click", openModal);
  document.querySelectorAll("[data-close]").forEach((el) => el.addEventListener("click", closeModal));
  $("publishForm").addEventListener("input", runFormCheck);
  $("publishForm").addEventListener("submit", submitPublish);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (!$("modal").hidden) closeModal();
      else if (state.selectedId) { state.selectedId = null; renderList(); renderDetail(); }
    }
  });
}

/* ---------------- 启动 ---------------- */

store.load();
bind();
renderFilters();
renderList();
renderDetail();
if (store.favorites.size) {
  toast(`已恢复上次的收藏（${store.favorites.size} 条）`);
}
