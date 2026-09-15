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
