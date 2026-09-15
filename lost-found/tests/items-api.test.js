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
