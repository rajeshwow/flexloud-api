import cors from "cors";
import express from "express";
import helmet from "helmet";

import { attachUserContext } from "./auth/attachUserContext";
import { authRouter } from "./auth/auth.routes";
import { requireAuth } from "./common/auth";
import { resolveTenant } from "./common/tenant";
import { env } from "./config/env";

import tanentRouter from "./modules/admin/tenants.routes";
import contactsRouter from "./modules/contacts/contacts.routes";
import leadsRouter from "./modules/leads/leads.route";
import opportunitiesRouter from "./modules/opportunities/opportunities.routes";
import organizationsRouter from "./modules/organizations/organizations.routes";
import usersRouter from "./modules/users/users.routes";
import { errorHandler, notFoundHandler } from "./observability/errors";
import { clientLogsRouter } from "./routes/clientLogs";
import { meRouter } from "./routes/me";
// import { notificationsRouter } from "./routes/notifications";

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

  /**
   * Public / admin routes
   */
  app.use("/v1/admin", tanentRouter);
  app.use("/v1/:slug/auth", resolveTenant, authRouter);

  /**
   * Protected tenant routes
   * Everything below /v1/:slug/* will automatically use these middlewares
   */
  app.use("/v1/:slug", resolveTenant, requireAuth, attachUserContext);

  app.use("/v1/:slug/me", meRouter());
  // app.use("/v1/:slug/notifications", notificationsRouter());
  app.use("/v1/:slug/client-logs", clientLogsRouter());
  app.use("/v1/:slug/users", usersRouter);
  app.use("/v1/:slug/organizations", organizationsRouter);
  app.use("/v1/:slug/contacts", contactsRouter);
  app.use("/v1/:slug/opportunities", opportunitiesRouter);
  app.use("/v1/:slug/leads", leadsRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
