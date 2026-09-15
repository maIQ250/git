# 校园失物招领系统 · 第二阶段（物品登记与失物招领柜）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让管理员能登记带照片的招领物品，让学生打开工作台就能看到失物招领柜里的东西并搜索。

**Architecture:** 在已有的零依赖 Node HTTP 服务上新增 `src/multipart.js`（手写 multipart 解析 + 图片魔数校验）和 `src/items.js`（物品领域层 + HTTP 处理函数）。领域函数沿用第一阶段的约定：`db` 作为第一个参数注入，不使用模块级状态。路由层新增「处理函数返回 `undefined` 表示已经自行响应」的约定，用来返回图片二进制。前端在已有的 `public/` 目录上扩展管理员登记表单与学生物品柜列表。

**Tech Stack:** Node.js 24 内置模块（`node:http`、`node:sqlite`、`node:test`），原生 HTML / CSS / JavaScript，零第三方依赖。

**Spec:** `lost-found/docs/spec.md`（第 2 版 · 失物招领柜模型）

## Global Constraints

以下规则对每一个 Task 都生效，逐字来自 spec：

- 运行时为 Node.js 24，**package.json 不得出现 dependencies 或 devDependencies**
- 代码风格为 ESM：`"type": "module"`，用 `import.meta.dirname` 取目录
- 所有 SQL 使用参数化查询，禁止字符串拼接 SQL
- 时间统一存 UTC ISO-8601 字符串；用户填写的日期字段为 `YYYY-MM-DD`
- 错误响应统一为 `{ "error": { "code": "SOME_CODE", "message": "中文说明" } }`
- 演示账号：管理员 `123` / 密码 `456`，学生 `111` / 密码 `222`
- 请求体上限：JSON 64KB，图片 2MB
- 图片只接受 `image/jpeg`、`image/png`、`image/webp`，必须校验文件头魔数与声明的类型一致
- 图片以 BLOB 存进数据库，不写磁盘
- 前端一律用 `textContent` 写入用户内容，不拼接 HTML 字符串
- 中文文案与注释，与第一阶段保持一致

第二阶段涉及的状态取值与权限，逐字来自 spec：

- `type` 取值 `lost` / `found`；`status` 取值 `pending` / `approved` / `rejected` / `returned`
- 学生发布 → 强制 `type = lost`、`status = pending`；管理员登记 → 强制 `type = found`、`status = approved`
- 客户端传的 `type` 一律忽略
- 公开列表默认只返回 `approved`；`status` 可选 `approved` / `returned` / `all`
- 非 `approved` 且非 `returned` 的条目，只有作者本人与管理员能看详情，其他人一律 404
- `contact` 不出现在列表接口；详情接口只对已登录用户返回该字段，未登录时为 `null`
- 搜索关键词 `q` 模糊匹配 `title`、`description`、`place`，转义 `%`、`_`、`\` 并配合 `ESCAPE '\'`
- `q` 超过 50 字返回 400；`page` 最小 1；`pageSize` 默认 12、最大 50

## 文件结构

| 文件 | 本阶段职责 | 状态 |
| --- | --- | --- |
| `lost-found/src/multipart.js` | 解析 `multipart/form-data`、图片魔数检测与校验 | 新建 |
| `lost-found/src/items.js` | 物品领域函数（增删改查、搜索、分页、序列化）与 HTTP 处理函数 | 新建 |
| `lost-found/src/validate.js` | 追加 `requireEnum`、`requireDate`、`requireInt`、`requireId` | 修改 |
| `lost-found/src/router.js` | 挂载物品路由；支持处理函数自行响应（图片二进制） | 修改 |
| `lost-found/public/admin.html` | 增加「登记物品」表单与「我登记的物品」列表 | 修改 |
| `lost-found/public/js/admin.js` | 登记表单提交、照片预览、登记列表渲染 | 修改 |
| `lost-found/public/student.html` | 把关卡占位改成失物招领柜：搜索、筛选、卡片列表、详情 | 修改 |
| `lost-found/public/js/student.js` | 列表加载、防抖搜索、筛选、分页、详情渲染 | 修改 |
| `lost-found/public/css/style.css` | 追加物品卡片、缩略图、表单、分页、详情面板样式 | 修改 |
| `lost-found/tests/helpers.js` | 增加 multipart 请求助手 | 修改 |
| `lost-found/tests/multipart.test.js` | multipart 解析与图片校验测试 | 新建 |
| `lost-found/tests/validate.test.js` | 追加日期 / 枚举 / 分页参数校验测试 | 修改 |
| `lost-found/tests/items-domain.test.js` | 物品领域层测试（建、改、删、可见性） | 新建 |
| `lost-found/tests/items-search.test.js` | 搜索、筛选、分页测试 | 新建 |
| `lost-found/tests/items-api.test.js` | 物品接口端到端测试（含图片上传与返回） | 新建 |
| `lost-found/docs/plans/2026-09-15-lost-found-phase2.md` | 本文档 | 新建 |

> 关于阶段划分：spec 第 12 节原来把「接口」和「前端页面」分成第 2、第 4 阶段。本计划改按**可演示的纵向切片**划分
> ——第二阶段同时交付接口和对应的两个页面，这样每做完一个阶段都有一个能打开、能演示的东西。spec 第 12 节的
> 表格需要相应调整（见 Task 9）。

## 结构说明：为什么不把 `items.js` 再拆小

`src/items.js` 同时装领域函数和 HTTP 处理函数，这是沿用第一阶段 `src/auth.js` 已经确立的模式
（领域函数在文件上半部分，HTTP 处理函数在分隔注释之后）。第一阶段该文件 5.8KB，第二阶段预计 12KB，
仍在可控范围内。等第三阶段加入认领逻辑时，`src/claims.js` 会独立成文件，`items.js` 不再继续膨胀。

---

## Task 1: multipart 解析与图片格式校验

**Files:**
- Create: `lost-found/src/multipart.js`
- Test: `lost-found/tests/multipart.test.js`

**Interfaces:**
- Consumes: `src/http-utils.js` 的 `HttpError`
- Produces:
  - `parseBoundary(contentType: string | undefined): string | null`
  - `parseMultipart(buffer: Buffer, boundary: string): { fields: Record<string, string>, files: Array<{ name: string, filename: string, contentType: string, data: Buffer }> }`
  - `detectImageType(data: Buffer): "image/jpeg" | "image/png" | "image/webp" | null`
  - `readPhoto(file, maxBytes: number): { data: Buffer, type: string } | null`
  - `readMultipartForm(buffer: Buffer, contentType: string | undefined, maxBytes: number): { fields: Record<string, string>, files: Array<...> }`

- [ ] **Step 1: 写失败的测试**

创建 `lost-found/tests/multipart.test.js`：

```js
import test from "node:test";
import assert from "node:assert/strict";
import {
  detectImageType,
  parseBoundary,
  parseMultipart,
  readMultipartForm,
  readPhoto
} from "../src/multipart.js";

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(16, 0x11)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)]);
const WEBP = Buffer.concat([
  Buffer.from("RIFF", "latin1"),
  Buffer.from([0x20, 0x00, 0x00, 0x00]),
  Buffer.from("WEBP", "latin1"),
  Buffer.alloc(8)
]);

export function buildMultipart({ fields = {}, files = [], boundary = "----test-boundary" }) {
  const chunks = [];

  for (const [name, value] of Object.entries(fields)) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`
      )
    );
  }

  for (const file of files) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="${file.name}"; filename="${file.filename}"\r\n` +
          `Content-Type: ${file.contentType}\r\n\r\n`
      )
    );
    chunks.push(file.data);
    chunks.push(Buffer.from("\r\n"));
  }

  chunks.push(Buffer.from(`--${boundary}--\r\n`));

  return { body: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` };
}

test("parseBoundary 从 Content-Type 中取出 boundary", () => {
  assert.equal(parseBoundary("multipart/form-data; boundary=abc"), "abc");
  assert.equal(parseBoundary('multipart/form-data; boundary="abc"'), "abc");
});

test("parseBoundary 对非 multipart 返回 null", () => {
  assert.equal(parseBoundary("application/json"), null);
  assert.equal(parseBoundary(undefined), null);
});

test("parseMultipart 解析文本字段与文件字段", () => {
  const { body, contentType } = buildMultipart({
    fields: { title: "黑色雨伞", place: "图书馆一楼" },
    files: [{ name: "photo", filename: "a.jpg", contentType: "image/jpeg", data: JPEG }]
  });

  const parsed = parseMultipart(body, parseBoundary(contentType));

  assert.equal(parsed.fields.title, "黑色雨伞");
  assert.equal(parsed.fields.place, "图书馆一楼");
  assert.equal(parsed.files.length, 1);
  assert.equal(parsed.files[0].name, "photo");
  assert.equal(parsed.files[0].filename, "a.jpg");
  assert.equal(parsed.files[0].contentType, "image/jpeg");
  assert.deepEqual(parsed.files[0].data, JPEG);
});

test("parseMultipart 保留 UTF-8 中文与换行", () => {
  const { body, contentType } = buildMultipart({
    fields: { description: "第一行\n第二行 —— 蓝色" }
  });

  const parsed = parseMultipart(body, parseBoundary(contentType));
  assert.equal(parsed.fields.description, "第一行\n第二行 —— 蓝色");
});

test("parseMultipart 遇到损坏数据抛 400", () => {
  assert.throws(() => parseMultipart(Buffer.from("这不是 multipart"), "boundary"), {
    status: 400,
    code: "INVALID_MULTIPART"
  });
});

test("detectImageType 识别 JPEG / PNG / WebP，拒绝其他内容", () => {
  assert.equal(detectImageType(JPEG), "image/jpeg");
  assert.equal(detectImageType(PNG), "image/png");
  assert.equal(detectImageType(WEBP), "image/webp");
  assert.equal(detectImageType(Buffer.from("hello world")), null);
});

test("readPhoto 放行合法图片并返回真实类型", () => {
  const photo = readPhoto({ contentType: "image/png", data: PNG, filename: "a.png" }, 1024);

  assert.equal(photo.type, "image/png");
  assert.deepEqual(photo.data, PNG);
});

test("readPhoto 对空文件返回 null", () => {
  assert.equal(readPhoto({ contentType: "image/png", data: Buffer.alloc(0), filename: "" }, 1024), null);
  assert.equal(readPhoto(undefined, 1024), null);
});

test("readPhoto 超过大小限制抛 413", () => {
  assert.throws(() => readPhoto({ contentType: "image/png", data: PNG, filename: "a.png" }, 4), {
    status: 413,
    code: "PAYLOAD_TOO_LARGE"
  });
});

test("readPhoto 对不支持的声明类型抛 415", () => {
  assert.throws(() => readPhoto({ contentType: "image/gif", data: PNG, filename: "a.gif" }, 1024), {
    status: 415
  });
});

test("readPhoto 对伪装成图片的文本抛 415", () => {
  assert.throws(
    () => readPhoto({ contentType: "image/png", data: Buffer.from("not an image"), filename: "a.png" }, 1024),
    { status: 415, code: "INVALID_IMAGE" }
  );
});

test("readPhoto 对魔数与声明类型不一致抛 415", () => {
  assert.throws(() => readPhoto({ contentType: "image/png", data: JPEG, filename: "a.png" }, 1024), {
    status: 415,
    code: "MIME_MISMATCH"
  });
});

test("readMultipartForm 对非 multipart 请求抛 415", () => {
  assert.throws(() => readMultipartForm(Buffer.alloc(0), "application/json", 1024), {
    status: 415,
    code: "UNSUPPORTED_MEDIA_TYPE"
  });
});

test("readMultipartForm 一次解析出字段与图片", () => {
  const { body, contentType } = buildMultipart({
    fields: { title: "钥匙" },
    files: [{ name: "photo", filename: "k.png", contentType: "image/png", data: PNG }]
  });

  const parsed = readMultipartForm(body, contentType, 4096);
  assert.equal(parsed.fields.title, "钥匙");
  assert.equal(parsed.files.length, 1);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd lost-found; node --test "tests/multipart.test.js"`
Expected: FAIL，报 `Cannot find module .../src/multipart.js`

- [ ] **Step 3: 实现 `src/multipart.js`**

创建 `lost-found/src/multipart.js`：

```js
import { HttpError } from "./http-utils.js";

const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

/**
 * 从 Content-Type 头里取出 multipart 的 boundary。
 * 不是 multipart/form-data 时返回 null，交给调用方决定报什么错。
 */
export function parseBoundary(contentType) {
  if (typeof contentType !== "string" || !/^multipart\/form-data/i.test(contentType)) {
    return null;
  }

  const match = /boundary="?([^";]+)"?/i.exec(contentType);
  return match ? match[1] : null;
}

function matchDispositionParam(value, key) {
  const match = new RegExp(`${key}="([^"]*)"`, "i").exec(value);
  return match ? match[1] : null;
}

function parsePartHeaders(raw) {
  let name = null;
  let filename = null;
  let contentType = null;

  for (const line of raw.split("\r\n")) {
    const index = line.indexOf(":");
    if (index === -1) {
      continue;
    }

    const key = line.slice(0, index).trim().toLowerCase();
    const value = line.slice(index + 1).trim();

    if (key === "content-disposition") {
      name = matchDispositionParam(value, "name");
      filename = matchDispositionParam(value, "filename");
    } else if (key === "content-type") {
      contentType = value;
    }
  }

  if (!name) {
    throw new HttpError(400, "INVALID_MULTIPART", "multipart 分段缺少 name");
  }

  return { name, filename, contentType };
}

/**
 * 解析 multipart/form-data 请求体。
 * 带 filename 的分段归入 files，其余归入 fields。
 */
export function parseMultipart(buffer, boundary) {
  const delimiter = Buffer.from(`--${boundary}`);
  const fields = {};
  const files = [];

  let cursor = buffer.indexOf(delimiter);
  if (cursor === -1) {
    throw new HttpError(400, "INVALID_MULTIPART", "请求体不是合法的 multipart 数据");
  }

  cursor += delimiter.length;

  while (cursor < buffer.length) {
    // 结束标记 "--"
    if (buffer[cursor] === 0x2d && buffer[cursor + 1] === 0x2d) {
      break;
    }
    if (buffer[cursor] === 0x0d && buffer[cursor + 1] === 0x0a) {
      cursor += 2;
    }

    const headerEnd = buffer.indexOf("\r\n\r\n", cursor, "latin1");
    if (headerEnd === -1) {
      throw new HttpError(400, "INVALID_MULTIPART", "请求体不是合法的 multipart 数据");
    }

    const rawHeaders = buffer.toString("utf8", cursor, headerEnd);
    const bodyStart = headerEnd + 4;

    const next = buffer.indexOf(delimiter, bodyStart);
    if (next === -1) {
      throw new HttpError(400, "INVALID_MULTIPART", "请求体不是合法的 multipart 数据");
    }

    // 分隔符前面固定有一个 CRLF，不属于内容
    const bodyEnd = Math.max(bodyStart, next - 2);
    const body = buffer.subarray(bodyStart, bodyEnd);

    const part = parsePartHeaders(rawHeaders);

    if (part.filename === null) {
      fields[part.name] = body.toString("utf8");
    } else {
      files.push({
        name: part.name,
        filename: part.filename,
        contentType: part.contentType ?? "application/octet-stream",
        data: Buffer.from(body)
      });
    }

    cursor = next + delimiter.length;
  }

  return { fields, files };
}

/**
 * 读 multipart 请求体并解析。body 上限由调用方按「图片上限 + 表单开销」传入。
 */
export function readMultipartForm(buffer, contentType, maxBytes) {
  const boundary = parseBoundary(contentType);

  if (!boundary) {
    throw new HttpError(415, "UNSUPPORTED_MEDIA_TYPE", "请使用 multipart/form-data 提交");
  }
  if (buffer.length > maxBytes) {
    throw new HttpError(413, "PAYLOAD_TOO_LARGE", "请求内容超过大小限制");
  }

  return parseMultipart(buffer, boundary);
}

/**
 * 只靠文件头判断图片真实类型，不信任客户端声明的 Content-Type。
 */
export function detectImageType(data) {
  if (
    data.length >= 3 &&
    data[0] === 0xff &&
    data[1] === 0xd8 &&
    data[2] === 0xff
  ) {
    return "image/jpeg";
  }

  const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (data.length >= PNG_SIGNATURE.length && PNG_SIGNATURE.every((byte, i) => data[i] === byte)) {
    return "image/png";
  }

  if (
    data.length >= 12 &&
    data.toString("latin1", 0, 4) === "RIFF" &&
    data.toString("latin1", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }

  return null;
}

/**
 * 校验上传的图片：没有文件返回 null，有文件则必须是受支持的图片且类型与内容一致。
 */
export function readPhoto(file, maxBytes) {
  if (!file || file.data.length === 0) {
    return null;
  }

  if (file.data.length > maxBytes) {
    throw new HttpError(413, "PAYLOAD_TOO_LARGE", `图片不能超过 ${Math.floor(maxBytes / 1024 / 1024 * 100) / 100}MB`);
  }

  if (!ALLOWED_IMAGE_TYPES.has(file.contentType)) {
    throw new HttpError(415, "UNSUPPORTED_MEDIA_TYPE", "只支持 JPEG、PNG、WebP 图片");
  }

  const detected = detectImageType(file.data);
  if (!detected) {
    throw new HttpError(415, "INVALID_IMAGE", "图片内容不是有效的 JPEG、PNG 或 WebP");
  }
  if (detected !== file.contentType) {
    throw new HttpError(415, "MIME_MISMATCH", "图片内容与声明的类型不一致");
  }

  return { data: file.data, type: detected };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd lost-found; node --test "tests/multipart.test.js"`
Expected: PASS，13 项通过

- [ ] **Step 5: 回归第一阶段测试**

Run: `cd lost-found; node --test "tests/*.test.js"`
Expected: 66 项通过、0 失败（原 53 项 + 新增 13 项）

- [ ] **Step 6: 提交**

```bash
git add lost-found/src/multipart.js lost-found/tests/multipart.test.js
git commit -m "feat(lost-found): add multipart parsing and image validation"
```

## Task 2: 校验工具扩展

**Files:**
- Modify: `lost-found/src/validate.js`（在文件末尾追加四个函数）
- Test: `lost-found/tests/validate.test.js`（追加测试）

**Interfaces:**
- Consumes: 同文件已有的 `requireString`、`HttpError`
- Produces:
  - `requireEnum(value: unknown, allowed: string[], { label: string }): string`
  - `requireDate(value: unknown, { label?: string }): string` —— 返回 `YYYY-MM-DD`
  - `requireInt(value: unknown, { label: string, min: number, max: number, fallback: number }): number`
  - `requireId(value: unknown, { label?: string }): number` —— 非正整数一律抛 404

- [ ] **Step 1: 写失败的测试**

把 `lost-found/tests/validate.test.js` 第一行的 import 改成：

```js
import {
  requireDate,
  requireEnum,
  requireId,
  requireInt,
  requirePassword,
  requireString,
  requireUsername
} from "../src/validate.js";
```

在文件末尾追加：

```js
test("requireEnum 接受白名单内的值并去除首尾空格", () => {
  assert.equal(requireEnum(" lost ", ["lost", "found"], { label: "类型" }), "lost");
});

test("requireEnum 拒绝白名单外的值并列出可选项", () => {
  assert.throws(() => requireEnum("other", ["lost", "found"], { label: "类型" }), (error) => {
    assert.equal(error.status, 400);
    assert.match(error.message, /lost \/ found/);
    return true;
  });
});

test("requireDate 接受合法日期并原样返回", () => {
  assert.equal(requireDate("2026-09-15"), "2026-09-15");
  assert.equal(requireDate("2024-02-29"), "2024-02-29");
});

test("requireDate 拒绝格式错误的日期", () => {
  for (const value of ["2026/09/15", "26-09-15", "2026-9-5", "今天", ""]) {
    assert.throws(() => requireDate(value, { label: "拾获日期" }), (error) => {
      assert.equal(error.status, 400);
      return true;
    });
  }
});

test("requireDate 拒绝不存在的日期", () => {
  for (const value of ["2023-02-29", "2026-13-01", "2026-04-31", "2026-00-10"]) {
    assert.throws(() => requireDate(value), { status: 400, code: "INVALID_INPUT" });
  }
});

test("requireInt 缺省时返回 fallback", () => {
  for (const value of [undefined, null, ""]) {
    assert.equal(requireInt(value, { label: "页码", min: 1, max: 999, fallback: 1 }), 1);
  }
});

test("requireInt 接受范围内的整数并拒绝越界与非整数", () => {
  assert.equal(requireInt("3", { label: "页码", min: 1, max: 999, fallback: 1 }), 3);
  assert.throws(() => requireInt("0", { label: "页码", min: 1, max: 999, fallback: 1 }), { status: 400 });
  assert.throws(() => requireInt("1.5", { label: "页码", min: 1, max: 999, fallback: 1 }), { status: 400 });
  assert.throws(() => requireInt("abc", { label: "页码", min: 1, max: 999, fallback: 1 }), { status: 400 });
  assert.throws(() => requireInt("51", { label: "每页条数", min: 1, max: 50, fallback: 12 }), { status: 400 });
});

test("requireId 接受数字字符串并转成数字", () => {
  assert.equal(requireId("42"), 42);
  assert.equal(requireId(7), 7);
});

test("requireId 对非正整数一律抛 404，不泄露资源是否存在", () => {
  for (const value of ["abc", "0", "-1", "1.5", "", undefined, "1e3"]) {
    assert.throws(() => requireId(value), { status: 404, code: "ITEM_NOT_FOUND" });
  }
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd lost-found; node --test "tests/validate.test.js"`
Expected: FAIL，报 `requireDate is not a function`

- [ ] **Step 3: 实现**

在 `lost-found/src/validate.js` 末尾追加：

```js
export function requireEnum(value, allowed, { label }) {
  const text = requireString(value, { label, min: 1, max: 30 });

  if (!allowed.includes(text)) {
    throw new HttpError(400, "INVALID_INPUT", `${label}只能是 ${allowed.join(" / ")}`);
  }

  return text;
}

export function requireDate(value, { label = "日期" } = {}) {
  const text = requireString(value, { label, min: 1, max: 10 });

  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new HttpError(400, "INVALID_INPUT", `${label}格式必须是 YYYY-MM-DD`);
  }

  const [year, month, day] = text.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  // Date 会把 2023-02-29 这类不存在的日期顺延到 3 月，用它反查即可识破
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new HttpError(400, "INVALID_INPUT", `${label}不是有效日期`);
  }

  return text;
}

export function requireInt(value, { label, min, max, fallback }) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const number = typeof value === "number" ? value : Number(String(value).trim());

  if (!Number.isInteger(number)) {
    throw new HttpError(400, "INVALID_INPUT", `${label}必须是整数`);
  }
  if (number < min || number > max) {
    throw new HttpError(400, "INVALID_INPUT", `${label}必须在 ${min} 到 ${max} 之间`);
  }

  return number;
}

export function requireId(value, { label = "编号" } = {}) {
  const text = String(value ?? "");

  if (!/^\d+$/.test(text) || Number(text) < 1) {
    throw new HttpError(404, "ITEM_NOT_FOUND", `${label}对应的信息不存在`);
  }

  return Number(text);
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd lost-found; node --test "tests/validate.test.js"`
Expected: PASS，12 项通过

- [ ] **Step 5: 提交**

```bash
git add lost-found/src/validate.js lost-found/tests/validate.test.js
git commit -m "feat(lost-found): add date, enum and pagination validators"
```

---

## Task 3: 物品领域层 —— 创建、读取、修改、删除

**Files:**
- Create: `lost-found/src/items.js`
- Test: `lost-found/tests/items-domain.test.js`

**Interfaces:**
- Consumes: `openDb`（测试建库）、`HttpError`
- Produces，全部以 `db` 为第一个参数：
  - `LIST_COLUMNS: string` —— 查询列表用的列清单，含 `photo IS NOT NULL AS has_photo`
  - `getItemById(db, id: number): ItemRow | null`
  - `createItem(db, { userId, type, status, title, description, place, happenedAt, contact, photo }): ItemRow`
    - `photo` 为 `{ data: Buffer, type: string } | null`
  - `updateItem(db, id, { title, description, place, happenedAt, contact, photo, status, reviewNote, reviewedBy }): ItemRow`
    - `photo` 三态：`undefined` 保留原图、`null` 删除图片、`{ data, type }` 替换
    - `status` / `reviewNote` / `reviewedBy` 为 `undefined` 时保持原值
  - `deleteItem(db, id): void`
  - `getItemPhoto(db, id): { photo: Uint8Array, photo_type: string } | null`
  - `canManageItem(row, user): boolean` —— 作者本人或任意管理员
  - `isPubliclyVisible(row): boolean` —— `approved` 或 `returned`
  - `toListItem(row): object`
  - `toItemDetail(row, { viewer, author }): object`

- [ ] **Step 1: 写失败的测试**

创建 `lost-found/tests/items-domain.test.js`：

```js
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openDb } from "../src/db.js";
import {
  canManageItem,
  createItem,
  deleteItem,
  getItemById,
  getItemPhoto,
  isPubliclyVisible,
  toItemDetail,
  toListItem,
  updateItem
} from "../src/items.js";

function makeDb() {
  const dir = mkdtempSync(path.join(tmpdir(), "lostfound-items-"));
  const db = openDb(path.join(dir, "test.db"), {
    demoAccounts: [
      { username: "123", name: "系统管理员", password: "456", role: "admin" },
      { username: "111", name: "演示学生", password: "222", role: "student" }
    ]
  });

  const admin = db.prepare("SELECT * FROM users WHERE username = '123'").get();
  const student = db.prepare("SELECT * FROM users WHERE username = '111'").get();

  return { db, admin, student, close: () => { db.close(); rmSync(dir, { recursive: true, force: true }); } };
}

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(32, 7)
]);

test("createItem 写入一条在柜中的招领物品", () => {
  const { db, admin, close } = makeDb();
  try {
    const row = createItem(db, {
      userId: admin.id,
      type: "found",
      status: "approved",
      title: "黑色雨伞",
      description: "长柄，伞面有白色小圆点",
      place: "图书馆一楼大厅",
      happenedAt: "2026-09-10",
      contact: "行政楼 102 失物招领处",
      photo: { data: PNG, type: "image/png" }
    });

    assert.equal(row.type, "found");
    assert.equal(row.status, "approved");
    assert.equal(row.title, "黑色雨伞");
    assert.equal(row.has_photo, 1);
    assert.equal(row.user_id, admin.id);
    assert.match(row.created_at, /^\d{4}-\d{2}-\d{2}T/);
  } finally {
    close();
  }
});

test("createItem 允许不带图片", () => {
  const { db, admin, close } = makeDb();
  try {
    const row = createItem(db, {
      userId: admin.id,
      type: "found",
      status: "approved",
      title: "蓝色水杯",
      description: "无图片",
      place: "食堂二楼",
      happenedAt: "2026-09-11",
      contact: "行政楼 102",
      photo: null
    });

    assert.equal(row.has_photo, 0);
    assert.equal(getItemPhoto(db, row.id), null);
  } finally {
    close();
  }
});

test("getItemById 对不存在的 id 返回 null", () => {
  const { db, close } = makeDb();
  try {
    assert.equal(getItemById(db, 9999), null);
  } finally {
    close();
  }
});

test("updateItem 在 photo 为 undefined 时保留原图", () => {
  const { db, admin, close } = makeDb();
  try {
    const created = createItem(db, {
      userId: admin.id,
      type: "found",
      status: "approved",
      title: "旧标题",
      description: "旧描述",
      place: "旧地点",
      happenedAt: "2026-09-01",
      contact: "行政楼 102",
      photo: { data: PNG, type: "image/png" }
    });

    const updated = updateItem(db, created.id, {
      title: "新标题",
      description: "新描述",
      place: "新地点",
      happenedAt: "2026-09-02",
      contact: "行政楼 103"
    });

    assert.equal(updated.title, "新标题");
    assert.equal(updated.has_photo, 1);
    assert.equal(getItemPhoto(db, created.id).photo.length, PNG.length);
  } finally {
    close();
  }
});

test("updateItem 在 photo 为 null 时删除图片", () => {
  const { db, admin, close } = makeDb();
  try {
    const created = createItem(db, {
      userId: admin.id,
      type: "found",
      status: "approved",
      title: "有图",
      description: "描述",
      place: "地点",
      happenedAt: "2026-09-01",
      contact: "行政楼 102",
      photo: { data: PNG, type: "image/png" }
    });

    const updated = updateItem(db, created.id, {
      title: "有图",
      description: "描述",
      place: "地点",
      happenedAt: "2026-09-01",
      contact: "行政楼 102",
      photo: null
    });

    assert.equal(updated.has_photo, 0);
    assert.equal(getItemPhoto(db, created.id), null);
  } finally {
    close();
  }
});

test("updateItem 不传 status 时保持原状态", () => {
  const { db, admin, close } = makeDb();
  try {
    const created = createItem(db, {
      userId: admin.id,
      type: "found",
      status: "approved",
      title: "标题",
      description: "描述",
      place: "地点",
      happenedAt: "2026-09-01",
      contact: "行政楼 102",
      photo: null
    });

    const updated = updateItem(db, created.id, {
      title: "改了标题",
      description: "描述",
      place: "地点",
      happenedAt: "2026-09-01",
      contact: "行政楼 102"
    });

    assert.equal(updated.status, "approved");
  } finally {
    close();
  }
});

test("updateItem 对不存在的 id 抛 404", () => {
  const { db, close } = makeDb();
  try {
    assert.throws(
      () => updateItem(db, 9999, { title: "t", description: "d", place: "p", happenedAt: "2026-09-01", contact: "c" }),
      { status: 404, code: "ITEM_NOT_FOUND" }
    );
  } finally {
    close();
  }
});

test("deleteItem 删除条目并连带删除它的认领申请", () => {
  const { db, admin, student, close } = makeDb();
  try {
    const created = createItem(db, {
      userId: admin.id,
      type: "found",
      status: "approved",
      title: "待删除",
      description: "描述",
      place: "地点",
      happenedAt: "2026-09-01",
      contact: "行政楼 102",
      photo: null
    });

    db.prepare(
      "INSERT INTO claims (item_id, user_id, message, status, created_at) VALUES (?, ?, ?, 'pending', ?)"
    ).run(created.id, student.id, "这是我的", new Date().toISOString());

    deleteItem(db, created.id);

    assert.equal(getItemById(db, created.id), null);
    assert.equal(db.prepare("SELECT COUNT(*) AS c FROM claims WHERE item_id = ?").get(created.id).c, 0);
  } finally {
    close();
  }
});

test("isPubliclyVisible 只放行 approved 与 returned", () => {
  assert.equal(isPubliclyVisible({ status: "approved" }), true);
  assert.equal(isPubliclyVisible({ status: "returned" }), true);
  assert.equal(isPubliclyVisible({ status: "pending" }), false);
  assert.equal(isPubliclyVisible({ status: "rejected" }), false);
});

test("canManageItem 放行作者本人与任意管理员", () => {
  const row = { user_id: 2 };

  assert.equal(canManageItem(row, { id: 2, role: "student" }), true);
  assert.equal(canManageItem(row, { id: 1, role: "admin" }), true);
  assert.equal(canManageItem(row, { id: 3, role: "student" }), false);
  assert.equal(canManageItem(row, null), false);
});

test("toListItem 不泄露 contact，只暴露 hasPhoto", () => {
  const { db, admin, close } = makeDb();
  try {
    const row = createItem(db, {
      userId: admin.id,
      type: "found",
      status: "approved",
      title: "黑色雨伞",
      description: "描述",
      place: "图书馆",
      happenedAt: "2026-09-10",
      contact: "13800000000",
      photo: { data: PNG, type: "image/png" }
    });

    const item = toListItem(row);

    assert.deepEqual(Object.keys(item).sort(), [
      "createdAt",
      "description",
      "happenedAt",
      "hasPhoto",
      "id",
      "place",
      "status",
      "title",
      "type"
    ]);
    assert.equal(item.hasPhoto, true);
    assert.equal(JSON.stringify(item).includes("13800000000"), false);
  } finally {
    close();
  }
});

test("toItemDetail 只对已登录用户返回 contact", () => {
  const { db, admin, close } = makeDb();
  try {
    const row = createItem(db, {
      userId: admin.id,
      type: "found",
      status: "approved",
      title: "黑色雨伞",
      description: "描述",
      place: "图书馆",
      happenedAt: "2026-09-10",
      contact: "13800000000",
      photo: null
    });

    assert.equal(toItemDetail(row, { viewer: null, author: admin }).contact, null);
    assert.equal(toItemDetail(row, { viewer: admin, author: admin }).contact, "13800000000");
    assert.deepEqual(toItemDetail(row, { viewer: null, author: admin }).author, {
      id: admin.id,
      name: "系统管理员",
      role: "admin"
    });
  } finally {
    close();
  }
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd lost-found; node --test "tests/items-domain.test.js"`
Expected: FAIL，报 `Cannot find module .../src/items.js`

- [ ] **Step 3: 实现领域层**

创建 `lost-found/src/items.js`，先只写领域层（HTTP 处理函数在 Task 5、Task 6 追加）：

```js
import { HttpError } from "./http-utils.js";

// 列表与详情查询共用的列。photo 本身不查出来，只带一个 has_photo 标记，
// 避免把 2MB 的二进制塞进每一个列表响应里。
export const LIST_COLUMNS = `
  id, user_id, type, title, description, place, happened_at, contact,
  status, review_note, reviewed_by, reviewed_at, created_at, updated_at,
  photo_type, (photo IS NOT NULL) AS has_photo
`;

export function getItemById(db, id) {
  return db.prepare(`SELECT ${LIST_COLUMNS} FROM items WHERE id = ?`).get(id) ?? null;
}

export function getItemPhoto(db, id) {
  const row = db.prepare("SELECT photo, photo_type FROM items WHERE id = ?").get(id);

  if (!row || !row.photo) {
    return null;
  }

  return { photo: row.photo, photo_type: row.photo_type };
}

export function createItem(db, {
  userId,
  type,
  status,
  title,
  description,
  place,
  happenedAt,
  contact,
  photo
}) {
  const now = new Date().toISOString();

  const info = db
    .prepare(
      `INSERT INTO items
         (user_id, type, title, description, place, happened_at, contact,
          photo, photo_type, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      userId,
      type,
      title,
      description,
      place,
      happenedAt,
      contact,
      photo ? photo.data : null,
      photo ? photo.type : null,
      status,
      now,
      now
    );

  return getItemById(db, Number(info.lastInsertRowid));
}

/**
 * 更新条目内容。
 * photo 三态：undefined 保留原图 / null 删除图片 / { data, type } 替换。
 * status、reviewNote、reviewedBy 为 undefined 时保持原值。
 */
export function updateItem(db, id, {
  title,
  description,
  place,
  happenedAt,
  contact,
  photo,
  status,
  reviewNote,
  reviewedBy
}) {
  const current = getItemById(db, id);
  if (!current) {
    throw new HttpError(404, "ITEM_NOT_FOUND", "信息不存在");
  }

  const now = new Date().toISOString();
  const nextStatus = status ?? current.status;
  const nextNote = reviewNote === undefined ? current.review_note : reviewNote;
  const nextReviewedBy = reviewedBy === undefined ? current.reviewed_by : reviewedBy;

  if (photo === undefined) {
    db.prepare(
      `UPDATE items
          SET title = ?, description = ?, place = ?, happened_at = ?, contact = ?,
              status = ?, review_note = ?, reviewed_by = ?, updated_at = ?
        WHERE id = ?`
    ).run(title, description, place, happenedAt, contact, nextStatus, nextNote, nextReviewedBy, now, id);
  } else {
    db.prepare(
      `UPDATE items
          SET title = ?, description = ?, place = ?, happened_at = ?, contact = ?,
              photo = ?, photo_type = ?,
              status = ?, review_note = ?, reviewed_by = ?, updated_at = ?
        WHERE id = ?`
    ).run(
      title,
      description,
      place,
      happenedAt,
      contact,
      photo ? photo.data : null,
      photo ? photo.type : null,
      nextStatus,
      nextNote,
      nextReviewedBy,
      now,
      id
    );
  }

  return getItemById(db, id);
}

export function deleteItem(db, id) {
  db.prepare("DELETE FROM items WHERE id = ?").run(id);
}

export function isPubliclyVisible(row) {
  return row.status === "approved" || row.status === "returned";
}

export function canManageItem(row, user) {
  if (!user) {
    return false;
  }

  return user.role === "admin" || user.id === row.user_id;
}

export function toListItem(row) {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    description: row.description,
    place: row.place,
    happenedAt: row.happened_at,
    status: row.status,
    hasPhoto: row.has_photo === 1,
    createdAt: row.created_at
  };
}

export function toItemDetail(row, { viewer, author }) {
  return {
    ...toListItem(row),
    contact: viewer ? row.contact : null,
    author: author ? { id: author.id, name: author.name, role: author.role } : null,
    reviewNote: row.review_note ?? null,
    updatedAt: row.updated_at
  };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd lost-found; node --test "tests/items-domain.test.js"`
Expected: PASS，12 项通过

- [ ] **Step 5: 回归测试**

Run: `cd lost-found; node --test "tests/*.test.js"`
Expected: 全部通过、0 失败

- [ ] **Step 6: 提交**

```bash
git add lost-found/src/items.js lost-found/tests/items-domain.test.js
git commit -m "feat(lost-found): add item domain functions"
```

## Task 4: 物品领域层 —— 搜索、筛选、分页

**Files:**
- Modify: `lost-found/src/items.js`（在领域层末尾追加）
- Test: `lost-found/tests/items-search.test.js`

**Interfaces:**
- Consumes: Task 3 的 `createItem`、`LIST_COLUMNS`
- Produces:
  - `escapeLike(value: string): string` —— 给 `%`、`_`、`\` 加反斜杠前缀
  - `PUBLIC_STATUS_FILTERS: Record<string, string[]>` —— `{ approved: [...], returned: [...], all: [...] }`
  - `resolvePublicStatuses(status: string | undefined): string[]` —— 默认 `["approved"]`，取值非法抛 400
  - `listItems(db, { q, type, statuses, page, pageSize }): { rows: ItemRow[], total: number, page: number, pageSize: number, totalPages: number }`

- [ ] **Step 1: 写失败的测试**

创建 `lost-found/tests/items-search.test.js`：

```js
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openDb } from "../src/db.js";
import { createItem, escapeLike, listItems, resolvePublicStatuses } from "../src/items.js";

function makeDb() {
  const dir = mkdtempSync(path.join(tmpdir(), "lostfound-search-"));
  const db = openDb(path.join(dir, "test.db"), {
    demoAccounts: [{ username: "123", name: "系统管理员", password: "456", role: "admin" }]
  });
  const admin = db.prepare("SELECT * FROM users WHERE username = '123'").get();

  return { db, admin, close: () => { db.close(); rmSync(dir, { recursive: true, force: true }); } };
}

function seed(db, admin, entries) {
  return entries.map((entry, index) =>
    createItem(db, {
      userId: admin.id,
      type: "found",
      status: "approved",
      title: entry.title ?? `物品${index}`,
      description: entry.description ?? "描述",
      place: entry.place ?? "图书馆",
      happenedAt: entry.happenedAt ?? "2026-09-01",
      contact: "行政楼 102",
      photo: null
    })
  );
}

test("escapeLike 转义百分号、下划线和反斜杠", () => {
  assert.equal(escapeLike("100%"), "100\\%");
  assert.equal(escapeLike("a_b"), "a\\_b");
  assert.equal(escapeLike("c\\d"), "c\\\\d");
  assert.equal(escapeLike("普通文字"), "普通文字");
});

test("resolvePublicStatuses 默认只返回在柜与公示中的条目", () => {
  assert.deepEqual(resolvePublicStatuses(undefined), ["approved"]);
  assert.deepEqual(resolvePublicStatuses(""), ["approved"]);
  assert.deepEqual(resolvePublicStatuses("approved"), ["approved"]);
  assert.deepEqual(resolvePublicStatuses("returned"), ["returned"]);
  assert.deepEqual(resolvePublicStatuses("all"), ["approved", "returned"]);
});

test("resolvePublicStatuses 拒绝 pending / rejected / 乱填", () => {
  for (const value of ["pending", "rejected", "随便"]) {
    assert.throws(() => resolvePublicStatuses(value), { status: 400, code: "INVALID_INPUT" });
  }
});

test("listItems 默认按创建时间倒序返回", () => {
  const { db, admin, close } = makeDb();
  try {
    seed(db, admin, [{ title: "第一条" }, { title: "第二条" }, { title: "第三条" }]);

    const result = listItems(db, { statuses: ["approved"], page: 1, pageSize: 12 });

    assert.equal(result.total, 3);
    assert.equal(result.totalPages, 1);
    assert.equal(result.rows[0].title, "第三条");
  } finally {
    close();
  }
});

test("listItems 关键词同时匹配标题、描述与地点", () => {
  const { db, admin, close } = makeDb();
  try {
    seed(db, admin, [
      { title: "黑色雨伞", description: "长柄", place: "图书馆一楼" },
      { title: "蓝色水杯", description: "杯身有雨伞图案", place: "食堂" },
      { title: "学生证", description: "姓名模糊", place: "体育馆门口" }
    ]);

    const byTitle = listItems(db, { q: "雨伞", statuses: ["approved"], page: 1, pageSize: 12 });
    assert.equal(byTitle.total, 2);

    const byPlace = listItems(db, { q: "体育馆", statuses: ["approved"], page: 1, pageSize: 12 });
    assert.equal(byPlace.total, 1);
    assert.equal(byPlace.rows[0].title, "学生证");
  } finally {
    close();
  }
});

test("listItems 把用户输入的 % 当成普通字符而不是通配符", () => {
  const { db, admin, close } = makeDb();
  try {
    seed(db, admin, [
      { title: "进度 100% 的报告" },
      { title: "普通文件夹" },
      { title: "百分号 %" }
    ]);

    const result = listItems(db, { q: "%", statuses: ["approved"], page: 1, pageSize: 12 });

    assert.equal(result.total, 2);
    assert.deepEqual(result.rows.map((row) => row.title).sort(), ["百分号 %", "进度 100% 的报告"]);
  } finally {
    close();
  }
});

test("listItems 把用户输入的下划线当成普通字符", () => {
  const { db, admin, close } = makeDb();
  try {
    seed(db, admin, [{ title: "a_b" }, { title: "axb" }]);

    const result = listItems(db, { q: "a_b", statuses: ["approved"], page: 1, pageSize: 12 });

    assert.equal(result.total, 1);
    assert.equal(result.rows[0].title, "a_b");
  } finally {
    close();
  }
});

test("listItems 可以按类型筛选", () => {
  const { db, admin, close } = makeDb();
  try {
    const found = seed(db, admin, [{ title: "招领一号" }])[0];
    createItem(db, {
      userId: admin.id,
      type: "lost",
      status: "approved",
      title: "寻物一号",
      description: "描述",
      place: "图书馆",
      happenedAt: "2026-09-01",
      contact: "行政楼 102",
      photo: null
    });

    const onlyFound = listItems(db, { type: "found", statuses: ["approved"], page: 1, pageSize: 12 });
    assert.equal(onlyFound.total, 1);
    assert.equal(onlyFound.rows[0].id, found.id);

    const onlyLost = listItems(db, { type: "lost", statuses: ["approved"], page: 1, pageSize: 12 });
    assert.equal(onlyLost.total, 1);
    assert.equal(onlyLost.rows[0].title, "寻物一号");
  } finally {
    close();
  }
});

test("listItems 只返回传入的状态，pending 不会出现在公开列表里", () => {
  const { db, admin, close } = makeDb();
  try {
    seed(db, admin, [{ title: "已通过" }]);
    createItem(db, {
      userId: admin.id,
      type: "lost",
      status: "pending",
      title: "待审核",
      description: "描述",
      place: "图书馆",
      happenedAt: "2026-09-01",
      contact: "行政楼 102",
      photo: null
    });

    assert.equal(listItems(db, { statuses: ["approved"], page: 1, pageSize: 12 }).total, 1);
    assert.equal(listItems(db, { statuses: ["approved", "returned"], page: 1, pageSize: 12 }).total, 1);
    assert.equal(listItems(db, { statuses: ["pending"], page: 1, pageSize: 12 }).total, 1);
  } finally {
    close();
  }
});

test("listItems 分页边界正确", () => {
  const { db, admin, close } = makeDb();
  try {
    seed(db, admin, Array.from({ length: 5 }, (_, i) => ({ title: `第 ${i + 1} 件` })));

    const first = listItems(db, { statuses: ["approved"], page: 1, pageSize: 2 });
    assert.equal(first.total, 5);
    assert.equal(first.totalPages, 3);
    assert.equal(first.rows.length, 2);

    const last = listItems(db, { statuses: ["approved"], page: 3, pageSize: 2 });
    assert.equal(last.rows.length, 1);

    const beyond = listItems(db, { statuses: ["approved"], page: 9, pageSize: 2 });
    assert.equal(beyond.rows.length, 0);
    assert.equal(beyond.total, 5);
  } finally {
    close();
  }
});

test("listItems 空关键词等价于不筛选", () => {
  const { db, admin, close } = makeDb();
  try {
    seed(db, admin, [{ title: "任意" }]);
    assert.equal(listItems(db, { q: "   ", statuses: ["approved"], page: 1, pageSize: 12 }).total, 1);
  } finally {
    close();
  }
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd lost-found; node --test "tests/items-search.test.js"`
Expected: FAIL，报 `listItems is not a function`

- [ ] **Step 3: 实现**

在 `lost-found/src/items.js` 的 `toItemDetail` 之后追加：

```js
const PUBLIC_STATUS_FILTERS = {
  approved: ["approved"],
  returned: ["returned"],
  all: ["approved", "returned"]
};

export function resolvePublicStatuses(status) {
  if (status === undefined || status === null || status === "") {
    return PUBLIC_STATUS_FILTERS.approved;
  }

  const resolved = PUBLIC_STATUS_FILTERS[status];
  if (!resolved) {
    throw new HttpError(400, "INVALID_INPUT", "状态只能是 approved / returned / all");
  }

  return resolved;
}

/**
 * 转义 LIKE 的通配符，配合 SQL 里的 ESCAPE '\' 使用，
 * 保证用户输入的 % 和 _ 被当成普通字符。
 */
export function escapeLike(value) {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

export function listItems(db, { q, type, statuses, page, pageSize }) {
  const conditions = [];
  const params = [];

  if (statuses && statuses.length > 0) {
    conditions.push(`status IN (${statuses.map(() => "?").join(", ")})`);
    params.push(...statuses);
  }

  if (type) {
    conditions.push("type = ?");
    params.push(type);
  }

  const keyword = typeof q === "string" ? q.trim() : "";
  if (keyword) {
    conditions.push(
      "(title LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\' OR place LIKE ? ESCAPE '\\')"
    );
    const pattern = `%${escapeLike(keyword)}%`;
    params.push(pattern, pattern, pattern);
  }

  const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const total = db.prepare(`SELECT COUNT(*) AS count FROM items ${whereSql}`).get(...params).count;

  const rows = db
    .prepare(
      `SELECT ${LIST_COLUMNS} FROM items ${whereSql}
        ORDER BY created_at DESC, id DESC
        LIMIT ? OFFSET ?`
    )
    .all(...params, pageSize, (page - 1) * pageSize);

  return {
    rows,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize)
  };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd lost-found; node --test "tests/items-search.test.js"`
Expected: PASS，12 项通过

- [ ] **Step 5: 回归测试**

Run: `cd lost-found; node --test "tests/*.test.js"`
Expected: 全部通过、0 失败

- [ ] **Step 6: 提交**

```bash
git add lost-found/src/items.js lost-found/tests/items-search.test.js
git commit -m "feat(lost-found): add item search, filtering and pagination"
```

---

## Task 5: 物品接口 —— 登记与图片上传

**Files:**
- Modify: `lost-found/tests/helpers.js`（新增 `multipartBody` 导出，并让 `request` 支持原始请求体）
- Modify: `lost-found/src/items.js`（追加分隔注释与 `handleCreateItem`）
- Modify: `lost-found/src/router.js`（挂载 `POST /api/items`）
- Test: `lost-found/tests/items-api.test.js`

**Interfaces:**
- Consumes: Task 1 的 `readMultipartForm`、`readPhoto`；Task 2 的 `requireString`、`requireDate`；Task 3 的 `createItem`、`toItemDetail`；`http-utils.js` 的 `readRawBody`
- Produces:
  - 测试助手 `multipartBody({ fields, files, boundary }): { body: Buffer, contentType: string }`
  - 测试助手 `server.request(method, pathname, { body, rawBody, contentType, cookie })`
  - HTTP 处理函数 `handleCreateItem(ctx): Promise<{ status: number, body: object }>`

  表单字段名固定为：`title`、`description`、`place`、`happened_at`、`contact`、`photo`

- [ ] **Step 1: 先扩展测试助手**

把 `lost-found/tests/helpers.js` 的 `startTestServer` 之前插入：

```js
/**
 * 构造 multipart/form-data 请求体。
 * fields 是普通文本字段，files 的每一项是 { name, filename, contentType, data: Buffer }。
 */
export function multipartBody({ fields = {}, files = [], boundary = "----lostfound-test-boundary" } = {}) {
  const chunks = [];

  for (const [name, value] of Object.entries(fields)) {
    chunks.push(
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`)
    );
  }

  for (const file of files) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="${file.name}"; filename="${file.filename}"\r\n` +
          `Content-Type: ${file.contentType}\r\n\r\n`
      )
    );
    chunks.push(file.data);
    chunks.push(Buffer.from("\r\n"));
  }

  chunks.push(Buffer.from(`--${boundary}--\r\n`));

  return { body: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` };
}
```

把 `request` 方法替换成支持原始请求体的版本：

```js
    async request(method, pathname, { body, rawBody, contentType, cookie } = {}) {
      const headers = {};
      let payload;

      if (body !== undefined) {
        payload = JSON.stringify(body);
        headers["Content-Type"] = "application/json";
      } else if (rawBody !== undefined) {
        payload = rawBody;
        headers["Content-Type"] = contentType;
      }
      if (cookie) {
        headers.Cookie = cookie;
      }

      const response = await fetch(baseUrl + pathname, { method, headers, body: payload });
      const text = await response.text();

      let json = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }

      const setCookies = response.headers.getSetCookie();
      const buffer = Buffer.from(await response.arrayBuffer());

      return {
        status: response.status,
        json,
        text,
        buffer,
        headers: response.headers,
        setCookie: setCookies,
        cookie: setCookies.length > 0 ? setCookies[0].split(";")[0] : null
      };
    },
```

> 注意：`response.text()` 之后再调用 `arrayBuffer()` 是安全的，`fetch` 的响应体会被缓存。

- [ ] **Step 2: 写失败的测试**

创建 `lost-found/tests/items-api.test.js`：

```js
import test from "node:test";
import assert from "node:assert/strict";
import { multipartBody, startTestServer } from "./helpers.js";

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64, 3)
]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 9)]);

const FOUND_FORM = {
  title: "黑色雨伞",
  description: "长柄，伞面有白色小圆点",
  place: "图书馆一楼大厅",
  happened_at: "2026-09-10",
  contact: "行政楼 102 失物招领处"
};

async function login(server, path, username, password) {
  const response = await server.request("POST", path, { body: { username, password } });
  assert.equal(response.status, 200);
  return response.cookie;
}

async function postItem(server, fields, { cookie, files = [] } = {}) {
  const { body, contentType } = multipartBody({ fields, files });
  return server.request("POST", "/api/items", { rawBody: body, contentType, cookie });
}

test("管理员登记带照片的物品，直接是在柜状态", async () => {
  const server = await startTestServer();
  try {
    const cookie = await login(server, "/api/admin/login", "123", "456");

    const response = await postItem(server, FOUND_FORM, {
      cookie,
      files: [{ name: "photo", filename: "umbrella.png", contentType: "image/png", data: PNG }]
    });

    assert.equal(response.status, 201);
    assert.equal(response.json.item.type, "found");
    assert.equal(response.json.item.status, "approved");
    assert.equal(response.json.item.title, "黑色雨伞");
    assert.equal(response.json.item.happenedAt, "2026-09-10");
    assert.equal(response.json.item.hasPhoto, true);

    const stored = server.db.prepare("SELECT * FROM items WHERE id = ?").get(response.json.item.id);
    assert.equal(stored.photo_type, "image/png");
    assert.equal(stored.photo.length, PNG.length);
    assert.equal(stored.status, "approved");
  } finally {
    await server.close();
  }
});

test("管理员登记时可以不传照片", async () => {
  const server = await startTestServer();
  try {
    const cookie = await login(server, "/api/admin/login", "123", "456");
    const response = await postItem(server, FOUND_FORM, { cookie });

    assert.equal(response.status, 201);
    assert.equal(response.json.item.hasPhoto, false);
  } finally {
    await server.close();
  }
});

test("学生发布走待审核，类型强制为 lost 并忽略客户端传的 type", async () => {
  const server = await startTestServer();
  try {
    const cookie = await login(server, "/api/student/login", "111", "222");

    const response = await postItem(server, { ...FOUND_FORM, type: "found", status: "approved" }, { cookie });

    assert.equal(response.status, 201);
    assert.equal(response.json.item.type, "lost");
    assert.equal(response.json.item.status, "pending");

    const stored = server.db.prepare("SELECT type, status FROM items WHERE id = ?").get(response.json.item.id);
    assert.equal(stored.type, "lost");
    assert.equal(stored.status, "pending");
  } finally {
    await server.close();
  }
});

test("管理员登记时客户端传的 type=lost 也会被忽略", async () => {
  const server = await startTestServer();
  try {
    const cookie = await login(server, "/api/admin/login", "123", "456");
    const response = await postItem(server, { ...FOUND_FORM, type: "lost" }, { cookie });

    assert.equal(response.json.item.type, "found");
  } finally {
    await server.close();
  }
});

test("未登录不能登记物品", async () => {
  const server = await startTestServer();
  try {
    const response = await postItem(server, FOUND_FORM);

    assert.equal(response.status, 401);
    assert.equal(response.json.error.code, "UNAUTHORIZED");
  } finally {
    await server.close();
  }
});

test("缺字段返回 400 并指出是哪个字段", async () => {
  const server = await startTestServer();
  try {
    const cookie = await login(server, "/api/admin/login", "123", "456");

    const missingTitle = await postItem(server, { ...FOUND_FORM, title: "   " }, { cookie });
    assert.equal(missingTitle.status, 400);
    assert.match(missingTitle.json.error.message, /名称/);

    const missingDate = await postItem(server, { ...FOUND_FORM, happened_at: "" }, { cookie });
    assert.equal(missingDate.status, 400);
  } finally {
    await server.close();
  }
});

test("日期格式错误返回 400", async () => {
  const server = await startTestServer();
  try {
    const cookie = await login(server, "/api/admin/login", "123", "456");

    for (const value of ["2026/09/10", "2026-9-1", "2023-02-29"]) {
      const response = await postItem(server, { ...FOUND_FORM, happened_at: value }, { cookie });
      assert.equal(response.status, 400, `期望 ${value} 被拒绝`);
    }
  } finally {
    await server.close();
  }
});

test("声明成图片但内容不是图片，返回 415", async () => {
  const server = await startTestServer();
  try {
    const cookie = await login(server, "/api/admin/login", "123", "456");

    const response = await postItem(server, FOUND_FORM, {
      cookie,
      files: [
        { name: "photo", filename: "fake.png", contentType: "image/png", data: Buffer.from("这不是图片") }
      ]
    });

    assert.equal(response.status, 415);
    assert.equal(response.json.error.code, "INVALID_IMAGE");
  } finally {
    await server.close();
  }
});

test("图片内容与声明类型不一致，返回 415", async () => {
  const server = await startTestServer();
  try {
    const cookie = await login(server, "/api/admin/login", "123", "456");

    const response = await postItem(server, FOUND_FORM, {
      cookie,
      files: [{ name: "photo", filename: "a.png", contentType: "image/png", data: JPEG }]
    });

    assert.equal(response.status, 415);
    assert.equal(response.json.error.code, "MIME_MISMATCH");
  } finally {
    await server.close();
  }
});

test("不支持的图片类型返回 415", async () => {
  const server = await startTestServer();
  try {
    const cookie = await login(server, "/api/admin/login", "123", "456");

    const response = await postItem(server, FOUND_FORM, {
      cookie,
      files: [
        { name: "photo", filename: "a.gif", contentType: "image/gif", data: Buffer.from("GIF89a") }
      ]
    });

    assert.equal(response.status, 415);
  } finally {
    await server.close();
  }
});

test("超大的图片返回 413", async () => {
  const server = await startTestServer();
  try {
    const cookie = await login(server, "/api/admin/login", "123", "456");
    const huge = Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024 + 1024, 5)]);

    const response = await postItem(server, FOUND_FORM, {
      cookie,
      files: [{ name: "photo", filename: "big.png", contentType: "image/png", data: huge }]
    });

    assert.equal(response.status, 413);
  } finally {
    await server.close();
  }
});

test("用 JSON 提交返回 415，提示要用 multipart", async () => {
  const server = await startTestServer();
  try {
    const cookie = await login(server, "/api/admin/login", "123", "456");
    const response = await server.request("POST", "/api/items", { body: FOUND_FORM, cookie });

    assert.equal(response.status, 415);
    assert.equal(response.json.error.code, "UNSUPPORTED_MEDIA_TYPE");
  } finally {
    await server.close();
  }
});

test("被封禁的学生不能登记物品", async () => {
  const server = await startTestServer();
  try {
    const cookie = await login(server, "/api/student/login", "111", "222");
    server.db.prepare("UPDATE users SET status = 'banned' WHERE username = '111'").run();

    const response = await postItem(server, FOUND_FORM, { cookie });

    assert.equal(response.status, 401);
  } finally {
    await server.close();
  }
});
```

- [ ] **Step 3: 运行测试确认失败**

Run: `cd lost-found; node --test "tests/items-api.test.js"`
Expected: FAIL，`POST /api/items` 返回 404 `接口不存在`

- [ ] **Step 4: 实现处理函数**

把 `lost-found/src/items.js` 顶部的 import 区改成：

```js
import { HttpError, readRawBody } from "./http-utils.js";
import { readMultipartForm, readPhoto } from "./multipart.js";
import { requireDate, requireString } from "./validate.js";
import { getUserById } from "./auth.js";
```

在文件末尾追加：

```js
// ---------------------------------------------------------------------------
// 以下为 HTTP 接口处理函数。签名统一为 (ctx) => Promise<{ status, body } | undefined>，
// ctx 结构：{ req, res, db, config, params, query, user }
// 返回 undefined 表示处理函数已经自行把响应写完（目前只有返回图片时这么用）。
// ---------------------------------------------------------------------------

const MULTIPART_OVERHEAD = 64 * 1024;

async function readItemForm(ctx) {
  const limit = ctx.config.maxPhotoBytes + MULTIPART_OVERHEAD;
  const raw = await readRawBody(ctx.req, limit);
  const { fields, files } = readMultipartForm(raw, ctx.req.headers["content-type"], limit);

  const photoFile = files.find((file) => file.name === "photo");

  return {
    fields,
    photo: readPhoto(photoFile, ctx.config.maxPhotoBytes)
  };
}

/**
 * 登记物品。
 * 角色决定一切：管理员登记的是招领物品（直接公开），学生发布的是寻物启事（待审核）。
 * 客户端传的 type / status 一律忽略。
 */
export async function handleCreateItem(ctx) {
  const isAdmin = ctx.user.role === "admin";
  const { fields, photo } = await readItemForm(ctx);

  const row = createItem(ctx.db, {
    userId: ctx.user.id,
    type: isAdmin ? "found" : "lost",
    status: isAdmin ? "approved" : "pending",
    title: requireString(fields.title, { label: isAdmin ? "物品名称" : "标题", max: 60 }),
    description: requireString(fields.description, { label: "描述", max: 1000 }),
    place: requireString(fields.place, { label: isAdmin ? "拾获地点" : "丢失地点", max: 60 }),
    happenedAt: requireDate(fields.happened_at, { label: isAdmin ? "拾获日期" : "丢失日期" }),
    contact: requireString(fields.contact, { label: "联系方式", max: 100 }),
    photo
  });

  return {
    status: 201,
    body: { item: toItemDetail(row, { viewer: ctx.user, author: ctx.user }) }
  };
}
```

- [ ] **Step 5: 挂载路由**

把 `lost-found/src/router.js` 的路由表改成：

```js
import {
  handleAdminLogin,
  handleLogout,
  handleMe,
  handleRegister,
  handleStudentLogin,
  resolveSession
} from "./auth.js";
import { handleCreateItem } from "./items.js";

const ROUTES = [
  { method: "POST", path: "/api/student/register", handler: handleRegister, access: "public" },
  { method: "POST", path: "/api/student/login", handler: handleStudentLogin, access: "public" },
  { method: "POST", path: "/api/admin/login", handler: handleAdminLogin, access: "public" },
  { method: "POST", path: "/api/logout", handler: handleLogout, access: "any" },
  { method: "GET", path: "/api/me", handler: handleMe, access: "any" },

  { method: "POST", path: "/api/items", handler: handleCreateItem, access: "any" }
];
```

- [ ] **Step 6: 运行测试确认通过**

Run: `cd lost-found; node --test "tests/items-api.test.js"`
Expected: PASS，12 项通过

- [ ] **Step 7: 回归测试**

Run: `cd lost-found; node --test "tests/*.test.js"`
Expected: 全部通过、0 失败

- [ ] **Step 8: 提交**

```bash
git add lost-found/src/items.js lost-found/src/router.js lost-found/tests/helpers.js lost-found/tests/items-api.test.js
git commit -m "feat(lost-found): add item registration endpoint with photo upload"
```

## Task 6: 物品接口 —— 物品柜列表、详情、图片、修改、删除

**Files:**
- Modify: `lost-found/src/items.js`（追加六个 HTTP 处理函数，并给 `readItemForm` 补 `photoProvided`）
- Modify: `lost-found/src/router.js`（挂载其余路由 + 支持处理函数自行响应）
- Test: `lost-found/tests/items-api.test.js`（追加测试）

**Interfaces:**
- Consumes: Task 3 / Task 4 的全部领域函数、Task 5 的 `readItemForm`
- Produces:
  - `handleListItems(ctx)` → `{ status: 200, body: { items, page, pageSize, total, totalPages } }`
  - `handleGetItem(ctx)` → `{ status: 200, body: { item } }`
  - `handleGetItemPhoto(ctx)` → `undefined`（自行写出图片二进制）
  - `handleUpdateItem(ctx)` → `{ status: 200, body: { item } }`
  - `handleDeleteItem(ctx)` → `{ status: 200, body: { ok: true } }`
  - `handleMyItems(ctx)` → `{ status: 200, body: { items } }`，每条多带一个 `pendingClaims` 数字

- [ ] **Step 1: 写失败的测试**

在 `lost-found/tests/items-api.test.js` 末尾追加：

```js
test("物品柜列表能看到管理员登记的物品，看不到学生的待审核寻物启事", async () => {
  const server = await startTestServer();
  try {
    const adminCookie = await login(server, "/api/admin/login", "123", "456");
    const studentCookie = await login(server, "/api/student/login", "111", "222");

    await postItem(server, FOUND_FORM, { cookie: adminCookie });
    await postItem(server, { ...FOUND_FORM, title: "我的钱包丢了" }, { cookie: studentCookie });

    const response = await server.request("GET", "/api/items");

    assert.equal(response.status, 200);
    assert.equal(response.json.total, 1);
    assert.equal(response.json.items[0].title, "黑色雨伞");
    assert.equal(response.json.items[0].status, "approved");
    assert.equal(response.json.page, 1);
    assert.equal(response.json.pageSize, 12);
  } finally {
    await server.close();
  }
});

test("列表接口不返回 contact", async () => {
  const server = await startTestServer();
  try {
    const cookie = await login(server, "/api/admin/login", "123", "456");
    await postItem(server, FOUND_FORM, { cookie });

    const response = await server.request("GET", "/api/items");

    assert.equal(response.json.items[0].contact, undefined);
    assert.equal(response.text.includes("行政楼 102"), false);
  } finally {
    await server.close();
  }
});

test("搜索接口按关键词过滤，并在结果为空时返回 0", async () => {
  const server = await startTestServer();
  try {
    const cookie = await login(server, "/api/admin/login", "123", "456");
    await postItem(server, FOUND_FORM, { cookie });
    await postItem(server, { ...FOUND_FORM, title: "蓝色水杯", place: "食堂二楼" }, { cookie });

    const hit = await server.request("GET", "/api/items?q=" + encodeURIComponent("雨伞"));
    assert.equal(hit.json.total, 1);
    assert.equal(hit.json.items[0].title, "黑色雨伞");

    const miss = await server.request("GET", "/api/items?q=" + encodeURIComponent("自行车"));
    assert.equal(miss.json.total, 0);
    assert.deepEqual(miss.json.items, []);
  } finally {
    await server.close();
  }
});

test("搜索关键词超过 50 字返回 400", async () => {
  const server = await startTestServer();
  try {
    const long = "伞".repeat(51);
    const response = await server.request("GET", "/api/items?q=" + encodeURIComponent(long));

    assert.equal(response.status, 400);
  } finally {
    await server.close();
  }
});

test("列表分页与 pageSize 上限", async () => {
  const server = await startTestServer();
  try {
    const cookie = await login(server, "/api/admin/login", "123", "456");
    for (let i = 1; i <= 5; i += 1) {
      await postItem(server, { ...FOUND_FORM, title: `物品 ${i}` }, { cookie });
    }

    const page1 = await server.request("GET", "/api/items?page=1&pageSize=2");
    assert.equal(page1.json.items.length, 2);
    assert.equal(page1.json.total, 5);
    assert.equal(page1.json.totalPages, 3);

    const tooBig = await server.request("GET", "/api/items?pageSize=51");
    assert.equal(tooBig.status, 400);

    const badPage = await server.request("GET", "/api/items?page=0");
    assert.equal(badPage.status, 400);
  } finally {
    await server.close();
  }
});

test("详情未登录时 contact 为 null，登录后能看到", async () => {
  const server = await startTestServer();
  try {
    const cookie = await login(server, "/api/admin/login", "123", "456");
    const created = await postItem(server, FOUND_FORM, { cookie });
    const id = created.json.item.id;

    const anonymous = await server.request("GET", `/api/items/${id}`);
    assert.equal(anonymous.status, 200);
    assert.equal(anonymous.json.item.contact, null);
    assert.equal(anonymous.json.item.author.name, "系统管理员");

    const loggedIn = await server.request("GET", `/api/items/${id}`, { cookie });
    assert.equal(loggedIn.json.item.contact, "行政楼 102 失物招领处");
  } finally {
    await server.close();
  }
});

test("待审核的寻物启事对陌生人 404，对作者与管理员可见", async () => {
  const server = await startTestServer();
  try {
    const adminCookie = await login(server, "/api/admin/login", "123", "456");
    const studentCookie = await login(server, "/api/student/login", "111", "222");

    const created = await postItem(server, { ...FOUND_FORM, title: "我的耳机" }, { cookie: studentCookie });
    const id = created.json.item.id;

    const stranger = await server.request("GET", `/api/items/${id}`);
    assert.equal(stranger.status, 404);

    const owner = await server.request("GET", `/api/items/${id}`, { cookie: studentCookie });
    assert.equal(owner.status, 200);
    assert.equal(owner.json.item.title, "我的耳机");

    const admin = await server.request("GET", `/api/items/${id}`, { cookie: adminCookie });
    assert.equal(admin.status, 200);
  } finally {
    await server.close();
  }
});

test("图片接口返回正确的 Content-Type 与字节", async () => {
  const server = await startTestServer();
  try {
    const cookie = await login(server, "/api/admin/login", "123", "456");
    const created = await postItem(server, FOUND_FORM, {
      cookie,
      files: [{ name: "photo", filename: "a.png", contentType: "image/png", data: PNG }]
    });

    const response = await server.request("GET", `/api/items/${created.json.item.id}/photo`);

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "image/png");
    assert.deepEqual(response.buffer, PNG);
  } finally {
    await server.close();
  }
});

test("没有图片的条目，图片接口返回 404", async () => {
  const server = await startTestServer();
  try {
    const cookie = await login(server, "/api/admin/login", "123", "456");
    const created = await postItem(server, FOUND_FORM, { cookie });

    const response = await server.request("GET", `/api/items/${created.json.item.id}/photo`);

    assert.equal(response.status, 404);
    assert.equal(response.json.error.code, "PHOTO_NOT_FOUND");
  } finally {
    await server.close();
  }
});

test("学生不能修改或删除别人的条目", async () => {
  const server = await startTestServer();
  try {
    const adminCookie = await login(server, "/api/admin/login", "123", "456");
    const studentCookie = await login(server, "/api/student/login", "111", "222");

    const created = await postItem(server, FOUND_FORM, { cookie: adminCookie });
    const id = created.json.item.id;
    const { body, contentType } = multipartBody({ fields: FOUND_FORM });

    const updated = await server.request("PUT", `/api/items/${id}`, { rawBody: body, contentType, cookie: studentCookie });
    assert.equal(updated.status, 404);

    const removed = await server.request("DELETE", `/api/items/${id}`, { cookie: studentCookie });
    assert.equal(removed.status, 404);
  } finally {
    await server.close();
  }
});

test("管理员修改条目后状态不变", async () => {
  const server = await startTestServer();
  try {
    const cookie = await login(server, "/api/admin/login", "123", "456");
    const created = await postItem(server, FOUND_FORM, { cookie });
    const id = created.json.item.id;

    const { body, contentType } = multipartBody({
      fields: { ...FOUND_FORM, title: "黑色折叠伞" }
    });

    const response = await server.request("PUT", `/api/items/${id}`, { rawBody: body, contentType, cookie });

    assert.equal(response.status, 200);
    assert.equal(response.json.item.title, "黑色折叠伞");
    assert.equal(response.json.item.status, "approved");
  } finally {
    await server.close();
  }
});

test("学生修改自己的寻物启事会回到待审核并清空审核意见", async () => {
  const server = await startTestServer();
  try {
    const studentCookie = await login(server, "/api/student/login", "111", "222");
    const created = await postItem(server, { ...FOUND_FORM, title: "我的耳机" }, { cookie: studentCookie });
    const id = created.json.item.id;

    server.db
      .prepare("UPDATE items SET status = 'approved', review_note = '旧意见' WHERE id = ?")
      .run(id);

    const { body, contentType } = multipartBody({ fields: { ...FOUND_FORM, title: "我的黑色耳机" } });
    const response = await server.request("PUT", `/api/items/${id}`, { rawBody: body, contentType, cookie: studentCookie });

    assert.equal(response.status, 200);
    assert.equal(response.json.item.status, "pending");
    assert.equal(response.json.item.reviewNote, null);
  } finally {
    await server.close();
  }
});

test("修改时不带 photo 分段会保留原图，带空的 photo 分段会删图", async () => {
  const server = await startTestServer();
  try {
    const cookie = await login(server, "/api/admin/login", "123", "456");
    const created = await postItem(server, FOUND_FORM, {
      cookie,
      files: [{ name: "photo", filename: "a.png", contentType: "image/png", data: PNG }]
    });
    const id = created.json.item.id;

    const keep = multipartBody({ fields: FOUND_FORM });
    const kept = await server.request("PUT", `/api/items/${id}`, { rawBody: keep.body, contentType: keep.contentType, cookie });
    assert.equal(kept.json.item.hasPhoto, true);

    const remove = multipartBody({
      fields: FOUND_FORM,
      files: [{ name: "photo", filename: "", contentType: "application/octet-stream", data: Buffer.alloc(0) }]
    });
    const removed = await server.request("PUT", `/api/items/${id}`, { rawBody: remove.body, contentType: remove.contentType, cookie });
    assert.equal(removed.json.item.hasPhoto, false);
  } finally {
    await server.close();
  }
});

test("删除条目后再查详情返回 404", async () => {
  const server = await startTestServer();
  try {
    const cookie = await login(server, "/api/admin/login", "123", "456");
    const created = await postItem(server, FOUND_FORM, { cookie });
    const id = created.json.item.id;

    const removed = await server.request("DELETE", `/api/items/${id}`, { cookie });
    assert.equal(removed.status, 200);

    const missing = await server.request("GET", `/api/items/${id}`);
    assert.equal(missing.status, 404);
  } finally {
    await server.close();
  }
});

test("我的登记列表只返回自己登记的条目", async () => {
  const server = await startTestServer();
  try {
    const adminCookie = await login(server, "/api/admin/login", "123", "456");
    const studentCookie = await login(server, "/api/student/login", "111", "222");

    await postItem(server, FOUND_FORM, { cookie: adminCookie });
    await postItem(server, { ...FOUND_FORM, title: "我的耳机" }, { cookie: studentCookie });

    const adminList = await server.request("GET", "/api/my/items", { cookie: adminCookie });
    assert.equal(adminList.json.items.length, 1);
    assert.equal(adminList.json.items[0].type, "found");
    assert.equal(adminList.json.items[0].pendingClaims, 0);

    const studentList = await server.request("GET", "/api/my/items", { cookie: studentCookie });
    assert.equal(studentList.json.items.length, 1);
    assert.equal(studentList.json.items[0].title, "我的耳机");
  } finally {
    await server.close();
  }
});

test("status 过滤可以只看已归还", async () => {
  const server = await startTestServer();
  try {
    const cookie = await login(server, "/api/admin/login", "123", "456");
    const created = await postItem(server, FOUND_FORM, { cookie });
    const id = created.json.item.id;

    server.db.prepare("UPDATE items SET status = 'returned' WHERE id = ?").run(id);

    const inCabinet = await server.request("GET", "/api/items");
    assert.equal(inCabinet.json.total, 0);

    const returned = await server.request("GET", "/api/items?status=returned");
    assert.equal(returned.json.total, 1);
    assert.equal(returned.json.items[0].status, "returned");

    const all = await server.request("GET", "/api/items?status=all");
    assert.equal(all.json.total, 1);
  } finally {
    await server.close();
  }
});

test("非法的 id 返回 404 而不是 500", async () => {
  const server = await startTestServer();
  try {
    for (const id of ["abc", "0", "-1"]) {
      const response = await server.request("GET", `/api/items/${id}`);
      assert.equal(response.status, 404, `期望 ${id} 返回 404`);
    }
  } finally {
    await server.close();
  }
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd lost-found; node --test "tests/items-api.test.js"`
Expected: FAIL，`GET /api/items` 返回 404

- [ ] **Step 3: 让 `readItemForm` 区分「没传照片」与「传了空照片」**

把 Task 5 写下的 `readItemForm` 的返回值改成：

```js
  return {
    fields,
    photo: readPhoto(photoFile, ctx.config.maxPhotoBytes),
    // 完全没有 photo 分段 → 修改时保持原图；有分段但内容为空 → 删除图片
    photoProvided: photoFile !== undefined
  };
```

- [ ] **Step 4: 实现六个处理函数**

在 `lost-found/src/items.js` 的 `handleCreateItem` 之后追加：

```js
function loadItemForViewer(db, id, user) {
  const row = getItemById(db, id);

  // 非公开条目对无关的人一律 404，不泄露「存在但被驳回」这一信息
  if (!row || (!isPubliclyVisible(row) && !canManageItem(row, user))) {
    throw new HttpError(404, "ITEM_NOT_FOUND", "信息不存在");
  }

  return row;
}

export async function handleListItems(ctx) {
  const keyword = ctx.query.get("q") ?? "";

  if (keyword.trim().length > ctx.config.searchMaxLength) {
    throw new HttpError(400, "INVALID_INPUT", `关键词不能超过 ${ctx.config.searchMaxLength} 个字符`);
  }

  const rawType = ctx.query.get("type") ?? "";
  const type = rawType === "" ? null : requireEnum(rawType, ["lost", "found"], { label: "类型" });

  const result = listItems(ctx.db, {
    q: keyword,
    type,
    statuses: resolvePublicStatuses(ctx.query.get("status")),
    page: requireInt(ctx.query.get("page"), { label: "页码", min: 1, max: 10000, fallback: 1 }),
    pageSize: requireInt(ctx.query.get("pageSize"), {
      label: "每页条数",
      min: 1,
      max: ctx.config.pageSizeMax,
      fallback: ctx.config.pageSizeDefault
    })
  });

  return {
    status: 200,
    body: {
      items: result.rows.map(toListItem),
      page: result.page,
      pageSize: result.pageSize,
      total: result.total,
      totalPages: result.totalPages
    }
  };
}

export async function handleGetItem(ctx) {
  const id = requireId(ctx.params.id);
  const row = loadItemForViewer(ctx.db, id, ctx.user);

  return {
    status: 200,
    body: { item: toItemDetail(row, { viewer: ctx.user, author: getUserById(ctx.db, row.user_id) }) }
  };
}

export async function handleGetItemPhoto(ctx) {
  const id = requireId(ctx.params.id);
  loadItemForViewer(ctx.db, id, ctx.user);

  const photo = getItemPhoto(ctx.db, id);
  if (!photo) {
    throw new HttpError(404, "PHOTO_NOT_FOUND", "该信息没有图片");
  }

  const data = Buffer.from(photo.photo);

  ctx.res.writeHead(200, {
    "Content-Type": photo.photo_type,
    "Content-Length": data.length,
    "Cache-Control": "public, max-age=60"
  });
  ctx.res.end(data);

  return undefined;
}

export async function handleUpdateItem(ctx) {
  const id = requireId(ctx.params.id);
  const row = getItemById(ctx.db, id);

  if (!row || !canManageItem(row, ctx.user)) {
    throw new HttpError(404, "ITEM_NOT_FOUND", "信息不存在");
  }

  const isAdmin = ctx.user.role === "admin";
  const { fields, photo, photoProvided } = await readItemForm(ctx);

  const updated = updateItem(ctx.db, id, {
    title: requireString(fields.title, { label: isAdmin ? "物品名称" : "标题", max: 60 }),
    description: requireString(fields.description, { label: "描述", max: 1000 }),
    place: requireString(fields.place, { label: isAdmin ? "拾获地点" : "丢失地点", max: 60 }),
    happenedAt: requireDate(fields.happened_at, { label: isAdmin ? "拾获日期" : "丢失日期" }),
    contact: requireString(fields.contact, { label: "联系方式", max: 100 }),
    photo: photoProvided ? photo : undefined,
    // 学生改过的寻物启事要重新走审核，管理员修改不改变状态
    ...(isAdmin ? {} : { status: "pending", reviewNote: null, reviewedBy: null })
  });

  return {
    status: 200,
    body: { item: toItemDetail(updated, { viewer: ctx.user, author: getUserById(ctx.db, updated.user_id) }) }
  };
}

export async function handleDeleteItem(ctx) {
  const id = requireId(ctx.params.id);
  const row = getItemById(ctx.db, id);

  if (!row || !canManageItem(row, ctx.user)) {
    throw new HttpError(404, "ITEM_NOT_FOUND", "信息不存在");
  }

  deleteItem(ctx.db, id);

  return { status: 200, body: { ok: true } };
}

export async function handleMyItems(ctx) {
  const rows = ctx.db
    .prepare(`SELECT ${LIST_COLUMNS} FROM items WHERE user_id = ? ORDER BY created_at DESC, id DESC`)
    .all(ctx.user.id);

  const pendingCounts = new Map(
    ctx.db
      .prepare("SELECT item_id, COUNT(*) AS count FROM claims WHERE status = 'pending' GROUP BY item_id")
      .all()
      .map((entry) => [entry.item_id, entry.count])
  );

  return {
    status: 200,
    body: {
      items: rows.map((row) => ({
        ...toListItem(row),
        pendingClaims: pendingCounts.get(row.id) ?? 0
      }))
    }
  };
}
```

并把 `lost-found/src/items.js` 里引入校验函数的那一行换成：

```js
import { requireDate, requireEnum, requireId, requireInt, requireString } from "./validate.js";
```

- [ ] **Step 5: 挂载路由并支持处理函数自行响应**

把 `lost-found/src/router.js` 改成：

```js
import { HttpError, parseCookies, sendError, sendJson } from "./http-utils.js";
import {
  handleAdminLogin,
  handleLogout,
  handleMe,
  handleRegister,
  handleStudentLogin,
  resolveSession
} from "./auth.js";
import {
  handleCreateItem,
  handleDeleteItem,
  handleGetItem,
  handleGetItemPhoto,
  handleListItems,
  handleMyItems,
  handleUpdateItem
} from "./items.js";

const ROUTES = [
  { method: "POST", path: "/api/student/register", handler: handleRegister, access: "public" },
  { method: "POST", path: "/api/student/login", handler: handleStudentLogin, access: "public" },
  { method: "POST", path: "/api/admin/login", handler: handleAdminLogin, access: "public" },
  { method: "POST", path: "/api/logout", handler: handleLogout, access: "any" },
  { method: "GET", path: "/api/me", handler: handleMe, access: "any" },

  { method: "GET", path: "/api/items", handler: handleListItems, access: "public" },
  { method: "POST", path: "/api/items", handler: handleCreateItem, access: "any" },
  { method: "GET", path: "/api/items/:id/photo", handler: handleGetItemPhoto, access: "public" },
  { method: "GET", path: "/api/items/:id", handler: handleGetItem, access: "public" },
  { method: "PUT", path: "/api/items/:id", handler: handleUpdateItem, access: "any" },
  { method: "DELETE", path: "/api/items/:id", handler: handleDeleteItem, access: "any" },
  { method: "GET", path: "/api/my/items", handler: handleMyItems, access: "any" }
];
```

并把这个文件里调用处理函数的那一段改成：

```js
      const result = await matched.route.handler({
        req,
        res,
        db,
        config,
        params: matched.params,
        query: url.searchParams,
        user
      });

      // 返回 undefined 表示处理函数已经自行写好响应（例如直接输出图片二进制）
      if (result !== undefined) {
        sendJson(res, result.status ?? 200, result.body);
      }
```

- [ ] **Step 6: 运行测试确认通过**

Run: `cd lost-found; node --test "tests/items-api.test.js"`
Expected: PASS，29 项通过

- [ ] **Step 7: 回归测试**

Run: `cd lost-found; node --test "tests/*.test.js"`
Expected: 全部通过、0 失败

- [ ] **Step 8: 手工验证一次真实接口**

```bash
cd lost-found
node server.js
```

另开一个终端：

```bash
curl -c cookies.txt -H "Content-Type: application/json" -d "{\"username\":\"123\",\"password\":\"456\"}" http://127.0.0.1:3000/api/admin/login
curl http://127.0.0.1:3000/api/items
```

Expected: 第一个返回管理员信息，第二个返回 `{"items":[],"page":1,...}`

- [ ] **Step 9: 提交**

```bash
git add lost-found/src/items.js lost-found/src/router.js lost-found/tests/items-api.test.js
git commit -m "feat(lost-found): add item list, detail, photo, update and delete endpoints"
```

## Task 7: 前端 —— 管理员登记物品

**Files:**
- Modify: `lost-found/public/js/api.js`（新增 `requestForm` 与状态文案工具）
- Create: `lost-found/public/js/item-card.js`（学生端与管理端共用的物品卡片）
- Modify: `lost-found/public/admin.html`
- Modify: `lost-found/public/js/admin.js`
- Modify: `lost-found/public/css/style.css`

**Interfaces:**
- Consumes: 后端 `POST /api/items`（multipart）、`GET /api/my/items`、`GET /api/items/:id/photo`
- Produces:
  - `requestForm(path: string, formData: FormData, { method?: string }): Promise<object>`
  - `itemStatusBadge(status: string): { text: string, className: string }`
  - `itemTypeBadge(type: string): { text: string, className: string }`
  - `createItemCard(item, { onOpen }): HTMLElement`

- [ ] **Step 1: 给 `api.js` 加 multipart 请求与徽章文案**

在 `lost-found/public/js/api.js` 的 `request` 之后追加：

```js
async function readResponse(response) {
  const text = await response.text();
  let data = null;

  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }

  if (!response.ok) {
    const error = (data && data.error) || {};
    throw new ApiError(
      response.status,
      error.code || "UNKNOWN_ERROR",
      error.message || "请求失败，请重试"
    );
  }

  return data;
}

export async function requestForm(path, formData, { method = "POST" } = {}) {
  let response;
  try {
    response = await fetch(path, { method, body: formData, credentials: "same-origin" });
  } catch {
    throw new ApiError(0, "NETWORK_ERROR", "网络连接失败，请确认服务已启动后重试");
  }

  return readResponse(response);
}

export function itemTypeBadge(type) {
  return type === "found"
    ? { text: "招领", className: "badge primary" }
    : { text: "寻物", className: "badge warning" };
}

export function itemStatusBadge(status) {
  switch (status) {
    case "approved":
      return { text: "在柜中", className: "badge success" };
    case "returned":
      return { text: "已归还", className: "badge" };
    case "pending":
      return { text: "待审核", className: "badge warning" };
    default:
      return { text: "已驳回", className: "badge" };
  }
}
```

把原来的 `request` 函数体后半段替换成复用 `readResponse`：

```js
export async function request(path, { method = "GET", body } = {}) {
  let response;
  try {
    response = await fetch(path, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "same-origin"
    });
  } catch {
    throw new ApiError(0, "NETWORK_ERROR", "网络连接失败，请确认服务已启动后重试");
  }

  return readResponse(response);
}
```

> `readResponse` 用函数声明写在文件里，函数声明会被提升，所以放在 `request` 之后也没问题。

- [ ] **Step 2: 建共用卡片组件**

创建 `lost-found/public/js/item-card.js`：

```js
import { itemStatusBadge, itemTypeBadge } from "./api.js";

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) {
    node.className = className;
  }
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
}

/**
 * 生成一张物品卡片。所有用户内容都走 textContent，不拼接 HTML。
 */
export function createItemCard(item, { onOpen } = {}) {
  const card = element("article", "cabinet-card");

  const thumb = element("div", "thumb");
  if (item.hasPhoto) {
    const image = element("img");
    image.src = `/api/items/${item.id}/photo`;
    image.alt = `${item.title} 的照片`;
    image.loading = "lazy";
    thumb.append(image);
  } else {
    thumb.append(element("span", "thumb-placeholder", "无照片"));
  }

  const body = element("div", "cabinet-body");

  const badges = element("div", "cabinet-badges");
  const type = itemTypeBadge(item.type);
  badges.append(element("span", type.className, type.text));

  const status = itemStatusBadge(item.status);
  badges.append(element("span", status.className, status.text));

  if (item.pendingClaims > 0) {
    badges.append(element("span", "badge warning", `${item.pendingClaims} 条待处理申请`));
  }

  const title = element("h3", "cabinet-title", item.title);
  const meta = element("p", "cabinet-meta muted", `${item.place} · ${item.happenedAt}`);
  const description = element("p", "cabinet-desc", item.description);

  body.append(badges, title, meta, description);

  if (onOpen) {
    const button = element("button", "btn ghost", "查看详情");
    button.type = "button";
    button.addEventListener("click", () => onOpen(item));
    body.append(button);
  }

  card.append(thumb, body);
  return card;
}
```

- [ ] **Step 3: 改 `admin.html`，把「即将开放」换成登记表单与登记列表**

把 `lost-found/public/admin.html` 里整个 `<div class="card">…即将开放…</div>` 换成：

```html
      <div class="card">
        <h2>登记物品</h2>
        <p class="muted">把收到的实物登记进来，提交后立刻出现在学生的失物招领柜里。</p>

        <form id="item-form" novalidate>
          <div class="field">
            <label for="item-title">物品名称</label>
            <input type="text" id="item-title" name="title" maxlength="60" />
            <p class="field-error" id="item-title-error"></p>
          </div>

          <div class="field">
            <label for="item-description">详细描述</label>
            <textarea id="item-description" name="description" rows="3" maxlength="1000"></textarea>
            <p class="field-error" id="item-description-error"></p>
          </div>

          <div class="grid-2">
            <div class="field">
              <label for="item-place">拾获地点</label>
              <input type="text" id="item-place" name="place" maxlength="60" />
              <p class="field-error" id="item-place-error"></p>
            </div>

            <div class="field">
              <label for="item-date">拾获日期</label>
              <input type="date" id="item-date" name="happened_at" />
              <p class="field-error" id="item-date-error"></p>
            </div>
          </div>

          <div class="field">
            <label for="item-contact">领取地点与联系方式</label>
            <input type="text" id="item-contact" name="contact" maxlength="100" />
            <p class="field-error" id="item-contact-error"></p>
          </div>

          <div class="field">
            <label for="item-photo">照片（选填）</label>
            <input type="file" id="item-photo" name="photo" accept="image/jpeg,image/png,image/webp" />
            <p class="field-error" id="item-photo-error"></p>

            <div class="photo-preview" id="photo-preview" hidden>
              <img id="photo-preview-image" alt="待上传照片预览" />
              <button class="btn ghost" type="button" id="photo-remove">移除照片</button>
            </div>
          </div>

          <button class="btn" type="submit" id="item-submit">登记物品</button>
        </form>
      </div>

      <div class="card">
        <h2>我登记的物品</h2>
        <p class="muted" id="my-items-summary">加载中…</p>
        <div class="cabinet-grid" id="my-items"></div>
      </div>
```

- [ ] **Step 4: 改 `public/js/admin.js`**

把 `lost-found/public/js/admin.js` 整个替换成：

```js
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
```

- [ ] **Step 5: 补样式**

在 `lost-found/public/css/style.css` 的 `.empty` 规则之前插入：

```css
/* ===== 输入控件补充 ===== */
input[type="date"],
input[type="file"] {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid #d5dbe9;
  border-radius: var(--radius-sm);
  background: #fff;
  color: var(--text);
  font: inherit;
}

input[type="date"]:focus,
input[type="file"]:focus {
  outline: none;
  border-color: var(--primary);
  box-shadow: 0 0 0 3px rgba(59, 91, 219, 0.16);
}

.grid-2 {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 0 16px;
}

/* ===== 照片预览 ===== */
.photo-preview {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 10px;
  padding: 10px;
  border: 1px dashed #cfd7e8;
  border-radius: var(--radius-sm);
  background: #fbfcff;
}

.photo-preview img {
  width: 84px;
  height: 84px;
  object-fit: cover;
  border-radius: 8px;
  background: #eef1f8;
}

/* ===== 物品卡片 ===== */
.cabinet-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
  gap: 16px;
  margin-top: 16px;
}

.cabinet-card {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow-sm);
  transition: box-shadow 0.16s ease, transform 0.16s ease;
}

.cabinet-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow);
}

.cabinet-card .thumb {
  display: grid;
  place-items: center;
  height: 160px;
  background: #eef1f8;
  overflow: hidden;
}

.cabinet-card .thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.thumb-placeholder {
  color: var(--text-muted);
  font-size: 13px;
}

.cabinet-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px 16px 16px;
}

.cabinet-badges {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.cabinet-title {
  margin: 0;
  font-size: 16px;
  line-height: 1.35;
}

.cabinet-meta {
  margin: 0;
  font-size: 13px;
}

.cabinet-desc {
  margin: 0;
  font-size: 14px;
  color: #4c5466;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.cabinet-body .btn {
  align-self: flex-start;
  margin-top: 4px;
}
```

- [ ] **Step 6: 手工验证**

```bash
cd lost-found
node server.js
```

浏览器打开 `http://localhost:3000/admin-login.html`，用 `123` / `456` 登录，然后：

1. 登记一条物品，选一张真实的 jpg 或 png
2. 确认照片在表单里出现缩略图，点「移除照片」后预览消失
3. 点「登记物品」，确认顶部出现成功提示
4. 确认表单被清空、日期回到今天、联系方式回到默认值
5. 确认「我登记的物品」里立刻出现刚登记的卡片，且能看到缩略图
6. 再登记一条不选照片的，确认卡片显示「无照片」占位块

- [ ] **Step 7: 提交**

```bash
git add lost-found/public/js/api.js lost-found/public/js/item-card.js lost-found/public/admin.html lost-found/public/js/admin.js lost-found/public/css/style.css
git commit -m "feat(lost-found): add admin item registration form with photo preview"
```

## Task 8: 前端 —— 学生失物招领柜

**Files:**
- Modify: `lost-found/public/student.html`
- Modify: `lost-found/public/js/student.js`
- Modify: `lost-found/public/css/style.css`

**Interfaces:**
- Consumes: `GET /api/items?q=&type=&status=&page=&pageSize=`、`GET /api/items/:id`、`createItemCard`、`request`
- Produces: 学生工作台页面，状态全部保存在模块级 `state` 对象里

- [ ] **Step 1: 改 `student.html`**

把 `lost-found/public/student.html` 里 `<div class="stats">…</div>` 之后的两个 `<div class="card">` 换成：

```html
      <div class="card">
        <h2>失物招领柜</h2>
        <p class="muted">这里是目前放在失物招领处的东西，认出自己的就打开详情查看领取方式。</p>

        <form class="filters" id="filters" role="search">
          <div class="filter-search">
            <label class="sr-only" for="search-input">搜索关键词</label>
            <input
              type="search"
              id="search-input"
              placeholder="搜索名称、描述或地点，例如「雨伞」"
              maxlength="50"
              autocomplete="off"
            />
          </div>

          <div class="filter-selects">
            <label class="sr-only" for="filter-type">类型</label>
            <select id="filter-type">
              <option value="">全部类型</option>
              <option value="found">只看招领</option>
              <option value="lost">只看寻物</option>
            </select>

            <label class="sr-only" for="filter-status">状态</label>
            <select id="filter-status">
              <option value="approved">只看在柜</option>
              <option value="returned">只看已归还</option>
              <option value="all">包含已归还</option>
            </select>

            <button class="btn ghost" type="button" id="reset-filters">清空</button>
          </div>
        </form>

        <p class="muted" id="result-summary">正在加载…</p>

        <div class="cabinet-grid" id="cabinet"></div>

        <div class="empty" id="cabinet-empty" hidden>
          <div class="icon" aria-hidden="true">📦</div>
          <p id="cabinet-empty-text">还没有物品</p>
        </div>

        <div class="pager" id="pager" hidden>
          <button class="btn ghost" type="button" id="prev-page">上一页</button>
          <span class="muted" id="page-indicator"></span>
          <button class="btn ghost" type="button" id="next-page">下一页</button>
        </div>
      </div>

      <div class="card">
        <h2>我发布的寻物启事</h2>
        <p class="muted" id="my-items-summary">加载中…</p>
        <div class="cabinet-grid" id="my-items"></div>
      </div>

      <dialog id="item-detail" class="detail-dialog" aria-labelledby="detail-title">
        <div class="detail-head">
          <h2 id="detail-title">物品详情</h2>
          <button class="btn ghost" type="button" id="detail-close">关闭</button>
        </div>
        <div class="detail-body" id="detail-body"></div>
      </dialog>
```

- [ ] **Step 2: 改 `public/js/student.js`**

把 `lost-found/public/js/student.js` 整个替换成：

```js
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
```

- [ ] **Step 3: 补样式**

在 `lost-found/public/css/style.css` 的 `.cabinet-body .btn` 规则之后插入：

```css
/* ===== 筛选栏 ===== */
.filters {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 14px 0 6px;
}

.filter-selects {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.filter-selects select {
  width: auto;
  min-width: 130px;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

/* ===== 分页 ===== */
.pager {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 14px;
  margin-top: 20px;
}

/* ===== 详情弹层 ===== */
.detail-dialog {
  width: min(560px, calc(100vw - 32px));
  max-height: calc(100vh - 80px);
  padding: 0;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow-lg);
  color: var(--text);
}

.detail-dialog::backdrop {
  background: rgba(20, 26, 42, 0.45);
}

.detail-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border);
}

.detail-head h2 {
  margin: 0;
  font-size: 18px;
}

.detail-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 18px 20px 22px;
  overflow-y: auto;
}

.detail-photo {
  width: 100%;
  max-height: 320px;
  object-fit: contain;
  border-radius: var(--radius-sm);
  background: #eef1f8;
}

.detail-row {
  display: flex;
  gap: 12px;
  font-size: 14px;
}

.detail-key {
  flex: 0 0 110px;
  color: var(--text-muted);
}

.detail-row span:last-child {
  white-space: pre-wrap;
}
```

- [ ] **Step 4: 手工验证**

1. 管理员端登记 3 条物品（至少两条带照片），标题分别含「雨伞」「水杯」「学生证」
2. 退出，用学生 `111` / `222` 登录
3. 确认学生工作台直接显示 3 张卡片，缩略图正常
4. 在搜索框输入「雨伞」，停顿一下，确认列表自动收窄到 1 条，计数显示「共 1 条结果」
5. 输入「自行车」，确认出现「没有找到与「自行车」相关的信息」
6. 快速连续输入几个字，确认只在停止输入后才发请求（防抖）
7. 按回车，确认立即搜索
8. 点「清空」，确认三个条件都被重置、列表恢复
9. 把状态切到「只看已归还」，确认列表变空
10. 点任意卡片的「查看详情」，确认弹出详情、能看到大图与「领取方式」
11. 按 Esc 关闭详情
12. 把浏览器窗口拉窄到 375px，确认没有横向滚动条

- [ ] **Step 5: 提交**

```bash
git add lost-found/public/student.html lost-found/public/js/student.js lost-found/public/css/style.css
git commit -m "feat(lost-found): add student locker browsing with search and detail"
```

---

## Task 9: 浏览器端到端冒烟与阶段收尾

**Files:**
- Create: `lost-found/scripts/smoke-e2e.mjs`
- Modify: `lost-found/docs/spec.md`（第 12 节阶段表改成纵向切片）
- Modify: `lost-found/package.json`（加一个 `smoke` 脚本）

**Interfaces:**
- Consumes: 前八个 Task 的全部产出
- Produces: 一条可重复执行的浏览器冒烟流程

- [ ] **Step 1: 写端到端脚本**

创建 `lost-found/scripts/smoke-e2e.mjs`：

```js
// 用无头 Edge 跑一条真实浏览器流程：管理员登记带照片的物品 → 学生在柜子里搜到它。
// 前置条件：本机已安装 Edge，且服务已在 3000 端口运行。
//
// 运行方式（两个终端）：
//   终端 1：cd lost-found; node server.js
//   终端 2：cd lost-found; node scripts/smoke-e2e.mjs
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const BASE = process.env.SMOKE_BASE ?? "http://127.0.0.1:3000";
const CDP_PORT = 9333;
const EDGE_CANDIDATES = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"
];

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

// 最小合法 PNG：8 字节签名 + IHDR 头，足够通过服务端的魔数校验
await fs.writeFile(
  pngPath,
  Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from("0000000d49484452", "hex"),
    Buffer.from([0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01]),
    Buffer.alloc(64, 0x42)
  ])
);

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

  // ---- 管理员登记一条带照片的物品 ----

  await goto(`${BASE}/admin-login.html`);
  await submitAndWait(
    'document.getElementById("admin-username").value = "123";' +
      'document.getElementById("admin-password").value = "456";' +
      'document.getElementById("admin-login-form").requestSubmit();',
    true
  );

  check("管理员登录后进入管理后台", (await evaluate("location.pathname")).endsWith("admin.html"));

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

  check("选好照片后出现预览", (await evaluate('document.getElementById("photo-preview").hidden')) === false);

  await submitAndWait('document.getElementById("item-form").requestSubmit();', false);

  const registered = await evaluate(
    'Array.from(document.querySelectorAll("#my-items .cabinet-title")).map((el) => el.textContent)'
  );
  check("登记后「我登记的物品」里立刻出现这条", registered.includes("烟灰色雨伞"), registered.join(" / "));

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
  await cdp.send("Runtime.evaluate", {
    expression: 'document.getElementById("search-input").value = "雨伞";' +
      'document.getElementById("search-input").dispatchEvent(new Event("input", { bubbles: true }));'
  });
  await sleep(1200);

  const summary = await evaluate('document.getElementById("result-summary").textContent');
  check("学生搜索「雨伞」命中刚登记的物品", summary.includes("共 1 条结果"), summary);

  const titles = await evaluate(
    'Array.from(document.querySelectorAll("#cabinet .cabinet-title")).map((el) => el.textContent)'
  );
  check("柜子里显示的正是那条物品", titles.includes("烟灰色雨伞"), titles.join(" / "));

  const thumbOk = await evaluate(
    '(() => { const img = document.querySelector("#cabinet .thumb img");' +
      'return Boolean(img) && img.complete && img.naturalWidth > 0; })()'
  );
  check("卡片缩略图真实加载成功", thumbOk);

  await evaluate('document.querySelector("#cabinet .cabinet-body .btn").click()');
  await sleep(800);

  check("详情弹层已打开", await evaluate('document.getElementById("item-detail").open'));

  const detailText = await evaluate('document.getElementById("detail-body").textContent');
  check("详情里能看到描述与领取方式", detailText.includes("白色小圆点") && detailText.includes("行政楼 102"));

  // ---- 空结果文案 ----

  await evaluate(
    'document.getElementById("search-input").value = "自行车";' +
      'document.getElementById("search-input").dispatchEvent(new Event("input", { bubbles: true }));'
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
  check("375px 宽度下没有横向溢出", overflow.scrollWidth <= overflow.innerWidth + 1, `${overflow.scrollWidth} / ${overflow.innerWidth}`);
} finally {
  cdp?.close();
  edge.kill();
  await fs.rm(profile, { recursive: true, force: true }).catch(() => {});
}

const failed = results.filter((item) => !item.ok);
console.log(`\n合计 ${results.length} 项断言，失败 ${failed.length} 项`);
process.exit(failed.length === 0 ? 0 : 1);
```

- [ ] **Step 2: 加 npm 脚本**

把 `lost-found/package.json` 的 `scripts` 改成：

```json
  "scripts": {
    "start": "node server.js",
    "test": "node --test \"tests/*.test.js\"",
    "smoke": "node scripts/smoke-e2e.mjs"
  },
```

- [ ] **Step 3: 跑全部接口测试**

Run: `cd lost-found; node --test "tests/*.test.js"`
Expected: 全部通过、0 失败。把实际数字记下来，下一阶段写进 README。

- [ ] **Step 4: 跑浏览器冒烟**

```bash
cd lost-found
node server.js
```

另开一个终端：

```bash
cd lost-found
node scripts/smoke-e2e.mjs
```

Expected: 9 项断言全部 PASS，最后打印「合计 9 项断言，失败 0 项」

- [ ] **Step 5: 更新 spec 的阶段表**

把 `lost-found/docs/spec.md` 第 12 节的表格换成：

```markdown
| 阶段 | 内容 | 完成标志 | 状态 |
| --- | --- | --- | --- |
| 1 | 项目骨架、配置、数据库建表与演示账号、HTTP 工具、认证接口 | 认证相关接口测试全部通过 | 已完成，53 项断言通过 |
| 2 | 物品登记与失物招领柜：物品接口、图片上传、搜索筛选分页，以及管理员登记页与学生柜子页 | 接口测试与浏览器冒烟全部通过 | 完成后填写实际数字 |
| 3 | 认领闭环、管理端审核 / 用户管理 / 统计，以及对应的页面 | 认领与管理接口测试全部通过 | 未开始 |
| 4 | README、演示数据脚本、整体收尾 | README 与实际一致 | 未开始 |

说明：阶段划分按「可演示的纵向切片」而不是按技术分层。这样每个阶段结束时都有一个能在浏览器里
真实走一遍的东西，而不是只有接口没有界面。原第 4 阶段「五个前端页面」的内容相应拆进第 2、3 阶段。
```

- [ ] **Step 6: 确认工作区干净并提交**

```bash
git status --short
git add lost-found/scripts/smoke-e2e.mjs lost-found/package.json lost-found/docs/spec.md
git commit -m "test(lost-found): add browser smoke test for locker flow"
```

---

## 阶段二完成标准

全部满足才算阶段二结束：

1. `node --test "tests/*.test.js"` 全部通过、0 失败，实际数字记进 spec 第 12 节
2. `node scripts/smoke-e2e.mjs` 9 项断言全部 PASS
3. 管理员能在浏览器里登记一条带照片的物品，并立刻在「我登记的物品」里看到
4. 学生登录后能直接看到柜子里的物品，能搜索、能筛选、能打开详情看大图
5. 375px 窄屏下没有横向滚动条
6. 第一阶段的认证功能全部照常工作，原有测试一项都没有被改坏
7. 所有用户输入都通过 `textContent` 写入 DOM，没有一处拼接 HTML 字符串

## 阶段二明确不做的事

留到后面阶段，本阶段不要顺手实现：

- 学生提交认领申请、管理员处理认领（阶段三）
- 管理员审核学生发布的寻物启事（阶段三）
- 用户管理、数据概览统计（阶段三）
- 编辑 / 删除界面（接口已经就绪，界面留到阶段三）
- README、演示数据脚本（阶段四）
