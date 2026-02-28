import cors from "cors";
import express from "express";
import helmet from "helmet";
import { attachUserContext } from "./auth/attachUserContext";
import { authRouter } from "./auth/auth.routes";
import { requireAuth } from "./common/auth";
import { resolveTenant } from "./common/tenant";
import { env } from "./config/env";
import tanentRouter from "./modules/admin/tenants.routes";
import { usersRouter } from "./modules/users/users.routes";
import { errorHandler, notFoundHandler } from "./observability/errors";
import { clientLogsRouter } from "./routes/clientLogs";
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

  // ✅ ADMIN routes (NO slug / NO resolveTenant)
  // If bootstrap should be public, keep it before requireAuth
  app.use("/v1/admin", tanentRouter);

  // ✅ PUBLIC LOGIN (tenant slug required)
  app.use("/v1/:slug/auth", resolveTenant, authRouter);

  // ✅ PROTECTED tenant routes
  app.use("/v1/:slug", resolveTenant, requireAuth, attachUserContext);

  app.use("/v1/:slug/me", meRouter());
  app.use("/v1/:slug/leads", leadsRouter());
  app.use("/v1/:slug/notifications", notificationsRouter());
  app.use("/v1/:slug/client-logs", clientLogsRouter());
  app.use("/v1/:slug/users", usersRouter());

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
