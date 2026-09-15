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
