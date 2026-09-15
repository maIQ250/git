import { HttpError, readRawBody } from "./http-utils.js";
import { readMultipartForm, readPhoto } from "./multipart.js";
import { requireDate, requireString } from "./validate.js";
import { getUserById } from "./auth.js";

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
