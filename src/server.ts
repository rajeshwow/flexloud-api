import { createApp } from "./app";
import { env } from "./config/env";
import { logger } from "./config/logger";

import { pool } from "./db/pool";

pool.connect().catch((err) => {
  console.error("❌ DB connection failed", err);
});

const app = createApp();

app.listen(env.PORT, () => {
  logger.info({ port: env.PORT }, "crm-api started");
});
