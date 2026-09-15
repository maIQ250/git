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
