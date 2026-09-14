# 校园失物招领系统 —— 设计文档

- 日期：2026-09-14
- 状态：已与需求方确认，待实现
- 开发分支：`codex/lost-found`
- 项目目录：`lost-found/`

## 1. 目标与范围

做一个可以真实运行的校园失物招领系统，包含学生端和管理员端两个入口。
学生可以注册登录、发布失物/招领信息、搜索浏览、提交认领申请；
管理员可以审核发布内容、管理全部信息、管理用户、查看数据概览。

数据保存在服务端的 SQLite 数据库中，多个学生通过浏览器访问同一个服务时看到的是同一份数据。

### 本期做

- 两个入口：学生端、管理员端
- 基于学号的注册与登录、基于服务端会话的身份保持
- 失物 / 招领信息的发布、浏览、搜索、筛选、详情、编辑、删除
- 单张图片上传与展示
- 认领申请闭环：申请 → 发布者处理 → 标记已归还
- 管理员审核、信息管理、用户封禁、数据概览
- 服务端输入校验、权限检查与统一错误响应
- 自动化测试（接口测试 + 页面端到端冒烟）

### 本期不做（非目标）

- 不做邮件 / 短信验证，不做找回密码
- 不做实时通知、站内聊天
- 不做图片压缩、多图上传、裁剪
- 不做 HTTPS、不做线上部署、不做域名与反向代理
- 不做分校区 / 多租户隔离

## 2. 角色与核心流程

### 学生

1. 用学号 + 姓名 + 密码注册，或用学号 + 密码登录
2. 发布信息：选择类型（寻物启事 / 失物招领）、填写标题、描述、地点、时间、联系方式，可选上传一张图片
3. 新发布的信息状态为「待审核」，管理员通过后才会出现在公开列表里
4. 浏览列表，用关键词搜索，按类型、状态筛选，翻页
5. 打开详情，对感兴趣的信息提交认领申请（附一段说明）
6. 在「我的发布」里查看自己发布的信息、收到的认领申请，并决定同意或拒绝
7. 在「我的申请」里查看自己提交过的认领申请及其状态
8. 编辑或删除自己的发布

### 管理员

1. 用管理员账号 + 密码登录
2. 审核：查看待审核列表，通过或驳回（可填写驳回原因）
3. 信息管理：查看全部状态的信息，可搜索、可删除、可标记为已归还
4. 用户管理：查看学生列表，封禁或解封
5. 数据概览：信息总数、待审核数、已归还数、注册用户数

### 信息状态流转

```
学生发布 → pending（待审核）
              ├── 管理员通过 → approved（已通过，公开可见）
              │                    └── 发布者标记 → returned（已归还）
              └── 管理员驳回 → rejected（已驳回，仅本人和管理员可见）
```

### 认领状态流转

```
学生提交 → pending → 发布者同意 → approved（同时信息可标记为已归还）
                   └ 发布者拒绝 → rejected
```

## 3. 技术方案

| 层 | 选型 | 说明 |
| --- | --- | --- |
| 服务端 | Node.js 24 内置 `node:http` | 不引入 Express 等框架，手写最小路由 |
| 数据库 | Node.js 24 内置 `node:sqlite` | 单文件数据库，零第三方依赖 |
| 密码与令牌 | `node:crypto` | `scrypt` 加盐哈希、`randomBytes` 生成会话令牌 |
| 测试 | `node:test` + `node:assert` | 内置测试运行器 |
| 前端 | 原生 HTML / CSS / JavaScript | 与已有 `todo-list` 项目风格保持一致 |

选型理由：这台开发机上没有 npm、没有 Python，Java 缺少构建工具，而 Node 24 已经内置了 HTTP 服务、
SQLite 驱动、加密和测试运行器。整套系统不需要安装任何第三方包，`node server.js` 即可运行，
也不依赖网络下载。

### 运行方式

```bash
cd lost-found
node server.js          # 启动服务，默认 http://localhost:3000
node --test tests/      # 运行接口测试
node scripts/seed-demo.js   # 写入一批演示数据（可选）
```

端口通过环境变量 `PORT` 覆盖，数据库路径通过 `DB_PATH` 覆盖。

## 4. 目录结构

```
lost-found/
├── README.md                 项目说明
├── .gitignore                忽略 data/*.db 等
├── package.json              仅记录脚本，无 dependencies
├── server.js                 入口：创建服务、挂载路由、静态文件
├── src/
│   ├── config.js             端口、数据库路径、上传限制等常量
│   ├── db.js                 打开数据库、建表、写入演示账号
│   ├── http-utils.js         请求体解析（JSON / multipart）、JSON 响应、错误类
│   ├── validate.js           字段校验与清洗
│   ├── auth.js               注册、登录、会话、权限判定
│   ├── items.js              信息发布、查询、搜索、修改、删除、图片
│   ├── claims.js             认领申请的提交与决策
│   ├── admin.js              审核、用户管理、统计
│   ├── static.js             静态文件服务
│   └── router.js             路由表与分发
├── public/
│   ├── index.html            入口页：选择学生端 / 管理员端
│   ├── student-login.html    学生登录与注册
│   ├── student.html          学生工作台
│   ├── admin-login.html      管理员登录
│   ├── admin.html            管理后台
│   ├── css/style.css         全部样式
│   └── js/
│       ├── api.js            请求封装与统一错误处理
│       ├── student-login.js
│       ├── student.js
│       ├── admin-login.js
│       └── admin.js
├── scripts/
│   └── seed-demo.js          演示数据脚本
├── tests/
│   ├── helpers.js            启动临时服务与数据库、请求助手
│   ├── auth.test.js
│   ├── items.test.js
│   ├── claims.test.js
│   └── admin.test.js
├── data/                     SQLite 数据库文件目录（不入库）
└── docs/
    └── spec.md               本文档
```

## 5. 数据模型

时间统一存 ISO-8601 字符串（UTC），在界面上按本地时区展示。

### users

| 字段 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- |
| id | INTEGER | PK AUTOINCREMENT | |
| username | TEXT | NOT NULL UNIQUE | 登录账号。学生填学号，管理员填账号 |
| name | TEXT | NOT NULL | 姓名 / 显示名 |
| password_hash | TEXT | NOT NULL | scrypt 派生结果（hex） |
| password_salt | TEXT | NOT NULL | 每个用户独立的随机盐（hex） |
| role | TEXT | NOT NULL, `student` / `admin` | 角色 |
| status | TEXT | NOT NULL, `active` / `banned` | 被封禁后不能登录，已有会话失效 |
| created_at | TEXT | NOT NULL | |

演示账号在首次启动建表后自动写入：

| 角色 | 账号 | 密码 |
| --- | --- | --- |
| 管理员 | `123` | `456` |
| 学生 | `111` | `222` |

### items

| 字段 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- |
| id | INTEGER | PK AUTOINCREMENT | |
| user_id | INTEGER | NOT NULL, FK users(id) | 发布者 |
| type | TEXT | NOT NULL, `lost` / `found` | `lost` 寻物启事，`found` 失物招领 |
| title | TEXT | NOT NULL | 标题，1–60 字 |
| description | TEXT | NOT NULL | 详细描述，1–1000 字 |
| place | TEXT | NOT NULL | 地点，1–60 字 |
| happened_at | TEXT | NOT NULL | 丢失 / 拾取日期，格式 `YYYY-MM-DD` |
| contact | TEXT | NOT NULL | 联系方式，1–100 字 |
| photo | BLOB | NULL | 图片二进制，最多 2MB |
| photo_type | TEXT | NULL | 图片 MIME 类型 |
| status | TEXT | NOT NULL, `pending` / `approved` / `rejected` / `returned` | 审核与归还状态 |
| review_note | TEXT | NULL | 审核意见 / 驳回原因 |
| reviewed_by | INTEGER | NULL, FK users(id) | 审核人 |
| reviewed_at | TEXT | NULL | 审核时间 |
| created_at | TEXT | NOT NULL | |
| updated_at | TEXT | NOT NULL | |

### claims

| 字段 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- |
| id | INTEGER | PK AUTOINCREMENT | |
| item_id | INTEGER | NOT NULL, FK items(id) ON DELETE CASCADE | |
| user_id | INTEGER | NOT NULL, FK users(id) | 申请人 |
| message | TEXT | NOT NULL | 认领说明，1–500 字 |
| status | TEXT | NOT NULL, `pending` / `approved` / `rejected` | |
| created_at | TEXT | NOT NULL | |
| decided_at | TEXT | NULL | |

约束：同一用户对同一条信息只能有一条待处理的申请。

### sessions

| 字段 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- |
| token | TEXT | PK | `randomBytes(32)` 的 hex |
| user_id | INTEGER | NOT NULL, FK users(id) ON DELETE CASCADE | |
| created_at | TEXT | NOT NULL | |
| expires_at | TEXT | NOT NULL | 默认 7 天 |

索引：`items(status, created_at)`、`items(user_id)`、`claims(item_id)`、`claims(user_id)`、`sessions(user_id)`。

## 6. 接口设计

统一前缀 `/api`，请求与响应均为 JSON（图片上传除外）。带 `sid` Cookie 的请求会自动识别登录身份。

### 认证

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| POST | `/api/student/register` | 公开 | 学号 + 姓名 + 密码注册 |
| POST | `/api/student/login` | 公开 | 学号 + 密码登录 |
| POST | `/api/admin/login` | 公开 | 管理员账号 + 密码登录 |
| POST | `/api/logout` | 登录 | 销毁当前会话 |
| GET | `/api/me` | 登录 | 返回当前用户信息 |

### 信息

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| GET | `/api/items` | 公开 | 列表，支持搜索 / 筛选 / 分页，只返回 `approved` |
| GET | `/api/items/:id` | 公开 / 登录 | 详情，非 `approved` 的信息仅作者与管理员可见 |
| POST | `/api/items` | 学生 | 发布，`multipart/form-data`，含可选图片 |
| PUT | `/api/items/:id` | 作者或管理员 | 修改内容；学生修改后回到 `pending` 重新审核，管理员修改不改变状态 |
| DELETE | `/api/items/:id` | 作者或管理员 | 删除 |
| GET | `/api/items/:id/photo` | 同详情 | 返回图片二进制，带正确 `Content-Type` |
| POST | `/api/items/:id/claims` | 学生 | 提交认领申请 |
| GET | `/api/my/items` | 学生 | 我的发布（含各状态与收到的申请数） |
| GET | `/api/my/claims` | 学生 | 我提交的申请 |
| POST | `/api/claims/:id/decision` | 发布者或管理员 | 同意或拒绝认领 |
| POST | `/api/items/:id/return` | 发布者或管理员 | 标记为已归还 |

### 管理

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| GET | `/api/admin/items` | 管理员 | 全部信息，可按状态与关键词搜索 |
| POST | `/api/admin/items/:id/review` | 管理员 | 审核通过 / 驳回 |
| GET | `/api/admin/users` | 管理员 | 学生列表，可按学号 / 姓名搜索 |
| POST | `/api/admin/users/:id/status` | 管理员 | 封禁 / 解封 |
| GET | `/api/admin/stats` | 管理员 | 数据概览 |

### 响应约定

列表类接口统一返回：

```json
{
  "items": [],
  "page": 1,
  "pageSize": 12,
  "total": 0,
  "totalPages": 0
}
```

错误统一返回：

```json
{ "error": { "code": "INVALID_INPUT", "message": "学号不能为空" } }
```

| 状态码 | 场景 |
| --- | --- |
| 400 | 参数校验失败 |
| 401 | 未登录或会话已过期 |
| 403 | 已登录但无权限（含账号被封禁） |
| 404 | 资源不存在 |
| 409 | 冲突，例如学号已被注册、重复提交待处理申请 |
| 413 | 图片超过大小限制 |
| 415 | 图片类型不支持 |
| 500 | 服务端异常 |

### 可见性与权限细则

这些规则容易在设计里被写含糊，先钉死：

- `contact`（联系方式）**不出现在列表接口**里；详情接口只对**已登录**用户返回该字段，未登录访问时该字段为 `null`
- 非 `approved` 状态的信息，只有发布者本人和管理员能访问详情，其他人一律 404（不泄露"存在但被驳回"这一信息）
- `happened_at` 使用 `YYYY-MM-DD` 日期格式并由服务端校验；`created_at`、`updated_at`、`reviewed_at`
  等系统时间使用完整的 ISO-8601 时间戳
- 用户管理接口只返回和操作 `student` 角色的账号，管理员账号不出现在列表里，也不能被封禁
- 删除一条信息会连带删除它收到的认领申请（数据库外键 `ON DELETE CASCADE`）

## 7. 搜索与筛选（重点）

搜索是这个系统的核心功能之一，按下面的规则实现。

### 服务端

`GET /api/items` 支持以下查询参数，可以任意组合：

| 参数 | 说明 |
| --- | --- |
| `q` | 关键词，模糊匹配 `title`、`description`、`place` 三个字段 |
| `type` | `lost` / `found`，不传表示不限 |
| `status` | 学生端固定只返回 `approved`，该参数仅在管理端接口生效 |
| `page` | 页码，默认 1，最小 1 |
| `pageSize` | 每页条数，默认 12，最大 50 |

实现细节：

- `q` 先做 `trim()`，空字符串视为不传；长度超过 50 字按 400 处理
- 使用参数化查询 + `LIKE`，并对 `%`、`_`、`\` 三个通配符字符做转义，配合 `ESCAPE '\'`，
  保证用户输入的 `%` 被当成普通字符而不是通配符
- 匹配大小写不敏感（`LIKE` 对 ASCII 默认不敏感；中文按原样子串匹配）
- 关键词与类型、分页条件是 AND 关系，全部拼在同一条 SQL 里，不做内存过滤
- 返回结果附带 `total`，用于界面显示"共 N 条结果"

管理端 `GET /api/admin/items` 复用同一套搜索逻辑，区别是可以指定 `status` 查看待审核等状态。

### 前端

- 学生工作台和管理后台都有搜索框，放在列表上方显眼位置
- 输入停止 300ms 后自动搜索（防抖），按回车立即搜索，不必点按钮
- 提供「清空」按钮，一键恢复未过滤状态
- 搜索条件变化时重置回第 1 页，避免停留在越界页码
- 结果为空时显示明确文案，例如「没有找到与"钥匙"相关的信息」，而不是一片空白
- 搜索条件与类型 / 状态筛选可叠加，界面上用标签显示当前生效的条件

## 8. 前端页面与交互

| 页面 | 内容 |
| --- | --- |
| `index.html` | 两张入口卡片：学生入口、管理员入口，说明各自能做什么 |
| `student-login.html` | 登录 / 注册两个标签页切换；注册需要学号、姓名、密码、确认密码 |
| `student.html` | 顶部身份与退出；搜索与筛选栏；信息卡片列表（标题、类型徽章、地点、时间、状态、缩略图）；发布表单；我的发布；我的申请 |
| `admin-login.html` | 管理员登录表单 |
| `admin.html` | 数据概览卡片；待审核队列；全部信息表格（含搜索与状态筛选）；用户管理表格 |

交互约定：

- 列表项显示类型徽章（寻物 / 招领）和状态徽章（待审核 / 已通过 / 已归还），颜色区分
- 所有异步操作期间按钮进入禁用状态并显示"处理中"，避免重复提交
- 操作结果用页面顶部的轻提示条反馈（成功 / 失败），不使用 `alert`
- 表单错误在对应字段下方就地提示
- 用户输入一律用 `textContent` 写入 DOM，不拼接 HTML 字符串
- 窄屏（≤480px）下卡片与表格改为纵向排列，不出现横向滚动
- 键盘可达：Tab 顺序合理，交互元素带 `:focus-visible` 轮廓，搜索框、登录表单支持回车提交

## 9. 认证与安全

- **密码存储**：`scrypt(password, salt, 64)`，盐为 16 字节随机值，每个用户独立；校验用 `timingSafeEqual`
- **会话**：登录成功后生成 32 字节随机令牌，写入 `sessions` 表，有效期 7 天
- **会话清理**：服务启动时清理一次已过期的会话；鉴权时如果命中的会话已过期，删除该行并按未登录处理
- **Cookie**：`sid=<token>; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800`，前端 JS 读不到令牌
- **鉴权中间件**：每个受保护接口都解析会话 → 取用户 → 检查 `status`，封禁用户立即失效
- **权限检查**：学生只能改删自己的发布；学生不能访问 `/api/admin/*`；认领决策只有发布者本人或管理员可做
- **SQL 注入**：全部使用参数化查询，包括 `LIKE` 模式串
- **XSS**：前端不用 `innerHTML` 写用户内容；由 `node:http` 返回 JSON 时设置 `Content-Type: application/json`
- **上传**：限制 MIME 为 `image/jpeg`、`image/png`、`image/webp`，限制 2MB，
  校验文件头魔数与声明的类型是否一致，图片以 BLOB 存库避免文件系统残留
- **拒绝服务的基本防护**：请求体大小上限（图片 2MB、JSON 64KB），超出直接返回 413
- **密码不出现在任何日志与响应里**

说明：这是课程 / 面试用项目，未做 HTTPS、CSRF Token、登录失败次数限制、验证码等生产级加固，
这些在"后续计划"中列出。

## 10. 错误处理约定

- 服务端所有处理器返回统一结构，未捕获异常由顶层兜底为 500 并记录日志，不把堆栈返回给客户端
- 数据库操作失败（例如唯一约束冲突）转换为对应的 409，而不是 500
- 前端 `api.js` 统一解析错误结构，401 时跳转到对应登录页，403 显示"没有权限"，其余显示服务端返回的
  `message`，网络异常显示"网络连接失败，请重试"
- 列表加载失败时保留上一次的结果并提示，不清空页面

## 11. 测试策略

### 接口测试（`node:test`）

每个测试文件用独立临时数据库与随机端口启动服务，测试之间互不影响。覆盖：

- **认证**：注册成功、重复学号 409、空字段 400、密码错误 401、封禁用户不能登录、
  未登录访问受保护接口 401、退出后会话失效
- **信息**：发布参数校验、图片类型与大小限制、列表分页边界、搜索结果正确性
  （含 `%` 被当普通字符、只匹配标题不匹配描述的情况）、非 `approved` 对他人不可见、
  越权修改 / 删除被拒、发布者可以删除自己的信息
- **认领**：不能认领自己发布的信息、重复申请 409、只有发布者能决策、决策后状态正确
- **管理**：非管理员访问管理接口 403、审核通过后信息出现在公开列表、驳回后不出现、
  封禁用户后其会话立即失效、统计数字与实际数据一致

### 页面端到端冒烟

用无头 Edge（Chrome DevTools Protocol）跑一条主流程：
学生登录 → 发布信息 → 管理员登录审核通过 → 学生搜索到该信息 → 另一个学生提交认领 →
发布者同意 → 标记已归还，并在关键步骤断言页面上的可见文本与持久化结果。

## 12. 分阶段实施计划

每个阶段完成后先跑该阶段的测试，通过后再进入下一阶段。

| 阶段 | 内容 | 完成标志 |
| --- | --- | --- |
| 1 | 项目骨架、配置、数据库建表与演示账号、HTTP 工具、认证接口 | 认证相关接口测试全部通过 |
| 2 | 信息发布 / 查询 / 搜索 / 分页 / 图片 / 修改 / 删除 | 信息与搜索相关接口测试全部通过 |
| 3 | 认领申请闭环、管理端审核 / 用户管理 / 统计 | 认领与管理接口测试全部通过 |
| 4 | 五个前端页面、样式、端到端冒烟、README、演示数据脚本 | 端到端冒烟通过，README 与实际一致 |

## 13. 后续计划（本期不实现）

- 登录失败次数限制与验证码，防止暴力破解
- CSRF Token 与 HTTPS 部署
- 图片压缩与多图上传
- 站内通知：认领被处理时提醒申请人
- 信息过期自动归档、按时间范围筛选
- 把服务部署到云主机，提供在线演示地址
