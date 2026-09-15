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
