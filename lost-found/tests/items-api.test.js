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
