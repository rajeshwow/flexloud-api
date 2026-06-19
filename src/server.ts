import http from "http";
import { createApp } from "./app";
import { env } from "./config/env";
import { logger } from "./config/logger";

import { initRealtime } from "./common/socket";
import { pool } from "./db/pool";
import { startNotificationSchedulers } from "./modules/notifications/notifications.scheduler";

pool.connect().catch((err) => {
  console.error("❌ DB connection failed", err);
});

const app = createApp();

const server = http.createServer(app);

initRealtime(server);

server.listen(env.PORT, () => {
  logger.info({ port: env.PORT }, "crm-api started");
});

startNotificationSchedulers();
