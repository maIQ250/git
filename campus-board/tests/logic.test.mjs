/**
 * 数据层与判断逻辑的自动化测试。
 * 运行：node --test campus-board/tests/
 *
 * 这些用例守着三个最容易出错、也最影响可信度的地方：
 *   1) 补充通知必须合并进主信息，而不是在列表里重复出现；
 *   2) 状态必须由基准时刻推算（已结束 / 已截止 / 还剩几小时）；
 *   3) 材料没写的信息必须如实标成「未提供」，不能凭空补。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

const dataSource = readFileSync(join(root, "data.js"), "utf8");
const appSource = readFileSync(join(root, "app.js"), "utf8")
  // 只取纯逻辑部分：跳过文件末尾真正操作 DOM 的启动代码
  .split("/* ---------------- 启动 ---------------- */")[0];

const context = {
  console,
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  document: { getElementById: () => null, querySelectorAll: () => [], addEventListener: () => {} },
  window: { innerWidth: 1280 },
  navigator: {},
  setTimeout,
  clearTimeout,
};
vm.createContext(context);
vm.runInContext(`${dataSource}\n${appSource}\nglobalThis.__api = {
  RAW_ITEMS, REFERENCE_NOW, buildViews, computeStatus, sourceGroupOf,
  CATEGORY_OF_TYPE, SOURCE_LABEL, RISKY_WORDS, state, store, fmtClock, fmtDateTime
};`, context);

const api = context.__api;
const views = api.buildViews([]);
const byId = (id) => views.find((v) => v.id === id);

test("材料里的 26 条信息全部进入数据层，编号不重复", () => {
  assert.equal(api.RAW_ITEMS.length, 26);
  const ids = api.RAW_ITEMS.map((i) => i.id);
  assert.equal(new Set(ids).size, 26);
});

test("补充通知被合并：列表里只出现 24 条主信息", () => {
  assert.equal(views.length, 24);
  assert.equal(byId("09"), undefined, "补充通知 09 不应单独作为一条信息出现");
  assert.equal(byId("20"), undefined, "补充通知 20 不应单独作为一条信息出现");
});

test("训练营按补充通知生效：首次训练改为 9月21日19:30、实验楼A402", () => {
  const camp = byId("01");
  assert.equal(camp.updates.length, 1);
  assert.equal(camp.updates[0].id, "09");
  assert.equal(camp.eventStart, "2026-09-21T19:30");
  assert.equal(camp.location, "实验楼A402");
  assert.equal(camp.originalEventStart, "2026-09-20T19:00");
  assert.equal(camp.deadline, "2026-09-24T22:00", "报名截止时间不变");
});

test("招募按补充通知生效：开发方向已满，只补设计与材料", () => {
  const recruit = byId("03");
  assert.equal(recruit.updates.length, 1);
  assert.equal(recruit.updates[0].id, "20");
  assert.equal(recruit.capacity, "开发方向已满");
  assert.equal(recruit.deadline, "2026-09-22T18:00");
});

test("状态由基准时刻算出，而不是写死", () => {
  assert.equal(api.computeStatus(byId("04")).label, "已结束");          // 9月18日的直播已结束
  assert.equal(api.computeStatus(byId("19")).label, "报名已截止 · 可候补"); // 9月18日22:00已过
  assert.match(api.computeStatus(byId("05")).label, /^还剩 22 小时截止$/); // 9月20日12:00截止
  assert.match(api.computeStatus(byId("02")).label, /^今天 19:00 开始$/);   // 当天晚上的公开课
  assert.equal(api.computeStatus(byId("10")).key, "today");                // 15:00 那场
  assert.equal(api.computeStatus(byId("17")).label, "提取信息 9月22日 周二失效"); // 资料有失效时间，日期带星期
  assert.equal(api.computeStatus(byId("16")).tone, "plain");               // 没写截止时间，不能假装随时可去
});

test("材料没写的信息保持未提供，不替主办方补内容", () => {
  assert.equal(byId("12").cost, "未提供", "费用信息材料没给，不能编");
  assert.deepEqual(byId("11").locationNote, "未提供");
  assert.equal(byId("18").eventEnd, null, "只说每两周一次，不能推算下一次日期");
  assert.match(byId("18").flags[0].text, /不做推算/);
});

test("低可信信息带风险提示，学生发布与官方发布能区分开", () => {
  const ad = byId("25");
  const job = byId("24");
  assert.equal(ad.trust, "low");
  assert.ok(ad.flags.some((f) => f.level === "danger"), "标题与内容不符要给出明确提示");
  assert.ok(job.flags.some((f) => /私人微信/.test(f.text)));
  assert.equal(api.sourceGroupOf(byId("21")), "official");
  assert.equal(api.sourceGroupOf(byId("22")), "student");
  assert.equal(api.sourceGroupOf(byId("01")), "unknown", "材料没写主办方的，标成未标注");
});

test("搜索能按材料里出现的细节定位信息", () => {
  api.state.query = "A402";
  const hits = views.filter((v) => [
    v.title, v.summary, v.location, v.locationNote, v.source.name, v.audience, v.type,
    ...(v.tags ?? []), ...(v.requirements ?? []), ...(v.flags ?? []).map((f) => f.text),
  ].filter(Boolean).join(" ").toLowerCase().includes("a402"));
  assert.equal(hits.map((v) => v.id).join(","), "01");
  api.state.query = "";
});

test("发布体检能识别「日结 + 私人微信」这类高风险表述", () => {
  const text = "校园兼职福利分享 零门槛 日结 加私人微信";
  const hits = api.RISKY_WORDS.filter(({ re }) => re.test(text));
  assert.equal(hits.length, 2);
});

test("时间源默认锁定在考核基准，评审时状态可复现", () => {
  // 不传第二个参数时一律按 9月19日 14:00 计算
  assert.equal(api.computeStatus(byId("10")).label, "今天 15:00 开始");
  assert.equal(api.fmtClock(Date.parse(api.REFERENCE_NOW)), "2026年9月19日（周六）14:00");
});

test("改用真实时间后，状态跟着时间走而不是写死", () => {
  const duringClass = Date.parse("2026-09-19T19:30:00+08:00");
  assert.equal(api.computeStatus(byId("02"), duringClass).label, "进行中");

  const twoDaysLater = Date.parse("2026-09-21T20:00:00+08:00");
  assert.equal(api.computeStatus(byId("05"), twoDaysLater).label, "报名已截止");
  assert.match(api.computeStatus(byId("01"), twoDaysLater).label, /^还能报名/);
  assert.equal(api.computeStatus(byId("26"), twoDaysLater).label, "已开始 · 材料未注明结束时间");
  assert.equal(api.computeStatus(byId("19"), twoDaysLater).label, "报名已截止 · 可候补");
});

test("日期一律带星期，材料里的「每周三/每周六」才核对得出来", () => {
  assert.equal(api.fmtDateTime("2026-09-21T19:30"), "9月21日 周一 19:30");
  assert.equal(api.fmtDateTime("2026-09-20T14:30"), "9月20日 周日 14:30");
});
test("所有 26 条的来源与类型都能映射到界面上的分类", () => {
  for (const item of api.RAW_ITEMS) {
    assert.ok(api.SOURCE_LABEL[item.source.kind], `${item.id} 的来源类型未映射`);
    assert.ok(api.CATEGORY_OF_TYPE[item.type], `${item.id} 的类型「${item.type}」未映射到分类`);
    assert.equal(typeof item.summary, "string");
    assert.ok(item.summary.length > 0);
  }
});
