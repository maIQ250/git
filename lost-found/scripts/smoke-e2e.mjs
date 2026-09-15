// 用无头 Edge 跑一条真实浏览器流程：管理员登记带照片的物品 → 学生在柜子里搜到它。
// 前置条件：本机已安装 Edge，且服务已在 3000 端口运行。
//
// 运行方式（两个终端）：
//   终端 1：cd lost-found; node server.js
//   终端 2：cd lost-found; node scripts/smoke-e2e.mjs
//
// 脚本会在开始与结束时各清理一次「烟灰色雨伞」这条固定测试数据，因此可以反复执行。
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const BASE = process.env.SMOKE_BASE ?? "http://127.0.0.1:3000";
const CDP_PORT = 9333;
const FIXTURE_TITLE = "烟灰色雨伞";
// 搜索词必须是「只可能命中夹具」的串。不要用「雨伞」这类通用词：
// 只要库里还有别人登记的含「雨伞」的物品，搜索结果就不是 1 条，断言会误报，
// 但那其实是搜索功能在正确工作，不是缺陷。
const FIXTURE_KEYWORD = "烟灰色";
const EDGE_CANDIDATES = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"
];

// 真实的 1x1 PNG。不要用「PNG 魔数 + 填充字节」凑数：那种内容能通过服务端的魔数校验，
// 但浏览器解不了码，缩略图会变成破图，图片相关的断言就失去意义了。
const SMOKE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

const results = [];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function check(name, ok, detail = "") {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  [${detail}]` : ""}`);
}

async function findEdge() {
  for (const candidate of EDGE_CANDIDATES) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // 继续找下一个
    }
  }
  throw new Error("没有找到 Microsoft Edge，请改用手工验证");
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const pending = new Map();
    const events = [];
    let seq = 0;

    ws.addEventListener("error", () => reject(new Error("无法连接浏览器调试端口")));
    ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);

      if (message.id && pending.has(message.id)) {
        const entry = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) {
          entry.reject(new Error(message.error.message));
        } else {
          entry.resolve(message.result);
        }
        return;
      }
      if (message.method) {
        events.push(message);
      }
    });
    ws.addEventListener("open", () => {
      resolve({
        events,
        send(method, params = {}) {
          const id = ++seq;
          return new Promise((resolve, reject) => {
            pending.set(id, { resolve, reject });
            ws.send(JSON.stringify({ id, method, params }));
          });
        },
        close: () => ws.close()
      });
    });
  });
}

async function waitEvent(cdp, method, from, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (let i = from; i < cdp.events.length; i += 1) {
      if (cdp.events[i].method === method) {
        return true;
      }
    }
    await sleep(60);
  }
  return false;
}

const edgePath = await findEdge();
const profile = await fs.mkdtemp(path.join(os.tmpdir(), "lostfound-smoke-"));
const pngPath = path.join(profile, "smoke.png");

await fs.writeFile(pngPath, SMOKE_PNG);

const edge = spawn(
  edgePath,
  [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${profile}`,
    "about:blank"
  ],
  { stdio: "ignore" }
);

let cdp = null;

try {
  let target = null;
  for (let i = 0; i < 40 && !target; i += 1) {
    await sleep(500);
    try {
      const list = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`).then((r) => r.json());
      target = list.find((entry) => entry.type === "page") ?? null;
    } catch {
      // 浏览器还没起来，继续等
    }
  }

  if (!target) {
    throw new Error("无头浏览器没有在 10 秒内就绪");
  }

  cdp = await connect(target.webSocketDebuggerUrl);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("DOM.enable");
  await cdp.send("Log.enable");
  await cdp.send("Network.enable");

  const evaluate = async (expression) => {
    const result = await cdp.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    }
    return result.result.value;
  };

  const goto = async (url) => {
    const start = cdp.events.length;
    await cdp.send("Page.navigate", { url });
    await waitEvent(cdp, "Page.loadEventFired", start);
    await sleep(500);
  };

  const submitAndWait = async (expression, expectNavigation) => {
    const start = cdp.events.length;
    await evaluate(expression);
    if (expectNavigation) {
      await waitEvent(cdp, "Page.loadEventFired", start, 10000);
      await sleep(500);
    } else {
      await sleep(1200);
    }
  };

  const loginAsAdmin = async () => {
    await goto(`${BASE}/admin-login.html`);
    await submitAndWait(
      'document.getElementById("admin-username").value = "123";' +
        'document.getElementById("admin-password").value = "456";' +
        'document.getElementById("admin-login-form").requestSubmit();',
      true
    );
  };

  const myItems = () =>
    evaluate('(async () => (await fetch("/api/my/items").then((r) => r.json())).items)()');

  const problems = (from) => {
    const list = [];
    const ignored = [];

    for (const event of cdp.events.slice(from)) {
      if (event.method === "Runtime.exceptionThrown") {
        list.push("exception: " + (event.params.exceptionDetails.exception?.description ?? ""));
        continue;
      }

      if (event.method !== "Log.entryAdded" || event.params.entry.level !== "error") {
        continue;
      }

      const entry = event.params.entry;
      const url = entry.url ?? "";
      const text = entry.text ?? "";

      if (url.includes("favicon")) {
        continue;
      }

      // 登录页会主动 GET /api/me 探测是否已登录，未登录时必然拿到 401，
      // 浏览器把这条失败请求记为控制台错误。这是设计内的行为，单独记录、不计入失败。
      if (url.endsWith("/api/me") && text.includes("401")) {
        ignored.push(`${text} (${url})`);
        continue;
      }

      list.push(`log: ${text} ${url}`);
    }

    return { list, ignored };
  };

  // ---- 开始前先清掉上一次可能残留的同名测试数据，保证脚本可重复执行 ----

  await loginAsAdmin();
  for (const item of await myItems()) {
    if (item.title === FIXTURE_TITLE) {
      await evaluate(`(async () => { await fetch("/api/items/${item.id}", { method: "DELETE" }); })()`);
    }
  }

  // ---- 管理员登记一条带照片的物品 ----

  await goto(`${BASE}/admin.html`);
  const pageStart = cdp.events.length;

  await evaluate(
    'document.getElementById("item-title").value = "烟灰色雨伞";' +
      'document.getElementById("item-description").value = "长柄，伞面有白色小圆点";' +
      'document.getElementById("item-place").value = "图书馆一楼大厅";' +
      'document.getElementById("item-date").value = "2026-09-10";'
  );

  const documentNode = await cdp.send("DOM.getDocument");
  const fileInput = await cdp.send("DOM.querySelector", {
    nodeId: documentNode.root.nodeId,
    selector: "#item-photo"
  });
  await cdp.send("DOM.setFileInputFiles", { files: [pngPath], nodeId: fileInput.nodeId });
  await evaluate('document.getElementById("item-photo").dispatchEvent(new Event("change", { bubbles: true }))');
  await sleep(300);

  check("选好照片后出现预览", (await evaluate('document.getElementById("photo-preview").hidden')) === false);

  await submitAndWait('document.getElementById("item-form").requestSubmit();', false);

  const registered = await evaluate(
    'Array.from(document.querySelectorAll("#my-items .cabinet-title")).map((el) => el.textContent)'
  );
  check("登记后「我登记的物品」里立刻出现这条", registered.includes(FIXTURE_TITLE), registered.join(" / "));

  const created = (await myItems()).find((item) => item.title === FIXTURE_TITLE);
  if (!created) {
    throw new Error("登记后的物品没有出现在「我登记的物品」里，后续步骤无法继续");
  }
  check("登记的物品带上了照片", created.hasPhoto === true);

  // ---- 学生打开失物招领柜并搜索 ----

  await cdp.send("Network.clearBrowserCookies");
  await goto(`${BASE}/student-login.html`);
  await submitAndWait(
    'document.getElementById("login-username").value = "111";' +
      'document.getElementById("login-password").value = "222";' +
      'document.getElementById("login-form").requestSubmit();',
    true
  );

  check("学生登录后进入工作台", (await evaluate("location.pathname")).endsWith("student.html"));

  await goto(`${BASE}/student.html`);
  await evaluate(
    '(() => { const box = document.getElementById("search-input");' +
      `box.value = ${JSON.stringify(FIXTURE_KEYWORD)};` +
      'box.dispatchEvent(new Event("input", { bubbles: true })); })()'
  );
  await sleep(1200);

  const summary = await evaluate('document.getElementById("result-summary").textContent');
  check(`学生搜索「${FIXTURE_KEYWORD}」命中刚登记的物品`, summary.includes("共 1 条结果"), summary);

  const titles = await evaluate(
    'Array.from(document.querySelectorAll("#cabinet .cabinet-title")).map((el) => el.textContent)'
  );
  check("柜子里显示的正是那条物品", titles.includes(FIXTURE_TITLE), titles.join(" / "));

  // 缩略图带 loading="lazy"，先滚进可视区域，再判断它是不是真的解码成功
  await evaluate('document.querySelector("#cabinet .cabinet-card").scrollIntoView({ block: "center" })');
  await sleep(1200);

  const thumb = await evaluate(
    '(() => { const img = document.querySelector("#cabinet .thumb img");' +
      'return { has: Boolean(img), complete: Boolean(img) && img.complete,' +
      ' naturalWidth: img ? img.naturalWidth : 0, src: img ? img.getAttribute("src") : null }; })()'
  );
  check(
    "卡片缩略图真实加载并解码成功",
    thumb.has && thumb.complete && thumb.naturalWidth > 0,
    `naturalWidth=${thumb.naturalWidth} src=${thumb.src}`
  );

  const thumbBytes = await evaluate(
    '(async () => { const res = await fetch(document.querySelector("#cabinet .thumb img").getAttribute("src"));' +
      'return { status: res.status, type: res.headers.get("content-type"), size: (await res.arrayBuffer()).byteLength }; })()'
  );
  check(
    "缩略图接口返回的字节数与上传的一致",
    thumbBytes.status === 200 && thumbBytes.type === "image/png" && thumbBytes.size === SMOKE_PNG.length,
    JSON.stringify(thumbBytes)
  );

  await evaluate('document.querySelector("#cabinet .cabinet-body .btn").click()');
  await sleep(1000);

  check("详情弹层已打开", await evaluate('document.getElementById("item-detail").open'));

  const detail = await evaluate(
    '({ text: document.getElementById("detail-body").textContent,' +
      ' photoOk: (() => { const img = document.querySelector(".detail-photo");' +
      '   return Boolean(img) && img.complete && img.naturalWidth > 0; })() })'
  );
  check("详情里能看到描述与领取方式", detail.text.includes("白色小圆点") && detail.text.includes("行政楼 102"));
  check("详情大图真实加载并解码成功", detail.photoOk === true);

  await evaluate('document.getElementById("detail-close").click()');
  await sleep(300);

  // ---- 空结果文案 ----

  await evaluate(
    '(() => { const box = document.getElementById("search-input");' +
      'box.value = "自行车";' +
      'box.dispatchEvent(new Event("input", { bubbles: true })); })()'
  );
  await sleep(1200);

  const emptyText = await evaluate('document.getElementById("cabinet-empty-text").textContent');
  check("搜不到时给出明确文案", emptyText.includes("没有找到与「自行车」相关的信息"), emptyText);

  // ---- 窄屏无横向溢出 ----

  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 375,
    height: 780,
    deviceScaleFactor: 2,
    mobile: true
  });
  await goto(`${BASE}/student.html`);
  await sleep(800);

  const overflow = await evaluate(
    "({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth })"
  );
  check(
    "375px 宽度下没有横向溢出",
    overflow.scrollWidth <= overflow.innerWidth + 1,
    `${overflow.scrollWidth} / ${overflow.innerWidth}`
  );

  const consoleCheck = problems(pageStart);
  check("整条冒烟流程没有意外的控制台错误", consoleCheck.list.length === 0, consoleCheck.list.slice(0, 3).join(" | "));

  if (consoleCheck.ignored.length > 0) {
    console.log(`  说明：忽略了 ${consoleCheck.ignored.length} 条预期内的 401 —— ${consoleCheck.ignored[0]}`);
  }

  await cdp.send("Emulation.clearDeviceMetricsOverride");

  // ---- 清理本次产生的数据，让脚本可以重复执行 ----

  await cdp.send("Network.clearBrowserCookies");
  await loginAsAdmin();
  await evaluate(`(async () => { await fetch("/api/items/${created.id}", { method: "DELETE" }); })()`);
  await sleep(400);

  const leftovers = await myItems();
  check(
    "冒烟产生的数据已清理",
    leftovers.some((item) => item.id === created.id) === false,
    `剩余我登记的物品数=${leftovers.length}`
  );
} finally {
  cdp?.close();
  edge.kill();
  await fs.rm(profile, { recursive: true, force: true }).catch(() => {});
}

const failed = results.filter((item) => !item.ok);
console.log(`\n合计 ${results.length} 项断言，失败 ${failed.length} 项`);
process.exit(failed.length === 0 ? 0 : 1);
