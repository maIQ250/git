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
