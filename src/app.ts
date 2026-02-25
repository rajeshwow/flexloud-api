import cors from "cors";
import express from "express";
import helmet from "helmet";
import { env } from "./config/env";
import { errorHandler, notFoundHandler } from "./observability/errors";
import { requestLoggingMiddleware } from "./observability/requestLogging";

import tenantsRoutes from "./modules/admin/tenants.routes";
import { usersRouter } from "./modules/users/users.routes";
import { clientLogsRouter } from "./routes/clientLogs";
import { healthRouter } from "./routes/health";
import { leadsRouter } from "./routes/leads";
import { meRouter } from "./routes/me";
import { notificationsRouter } from "./routes/notifications";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");

  app.use(helmet());
  app.use(express.json({ limit: "1mb" }));

  app.use(
    cors({
      origin: (origin, cb) => {
        if (!origin) return cb(null, true);
        const allowed = env.CORS_ORIGINS.includes(origin);
        return cb(allowed ? null : new Error("CORS blocked"), allowed);
      },
      credentials: false,
    }),
  );

  app.use(requestLoggingMiddleware());

  app.use("/health", healthRouter());
  app.use("/ready", healthRouter());

  app.use("/v1/me", meRouter());
  app.use("/v1/leads", leadsRouter());
  app.use("/v1/notifications", notificationsRouter());
  app.use("/v1/client-logs", clientLogsRouter()); // optional
  app.use(tenantsRoutes);
  app.use("/v1/users", usersRouter());

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
