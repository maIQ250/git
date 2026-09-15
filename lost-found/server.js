import http from "node:http";
import path from "node:path";
import { config } from "./src/config.js";
import { openDb } from "./src/db.js";
import { cleanupExpiredSessions } from "./src/auth.js";
import { createApp } from "./src/router.js";
import { createStaticHandler } from "./src/static.js";

const db = openDb(config.dbPath, { demoAccounts: config.demoAccounts });
cleanupExpiredSessions(db);

const staticHandler = createStaticHandler(path.join(import.meta.dirname, "public"));

const server = http.createServer(createApp({ db, config, staticHandler }));

server.listen(config.port, () => {
  console.log(`失物招领服务已启动: http://localhost:${config.port}`);
  console.log(`数据库文件: ${config.dbPath}`);
});
