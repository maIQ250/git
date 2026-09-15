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
