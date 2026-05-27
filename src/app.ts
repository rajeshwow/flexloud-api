import cors from "cors";
import express from "express";
import helmet from "helmet";

import { attachUserContext } from "./auth/attachUserContext";
import { authRouter } from "./auth/auth.routes";
import { requireAuth } from "./common/auth";
import { resolveTenant } from "./common/tenant";
import { env } from "./config/env";

import activityRouter from "./modules/activity/activity.routes";
import tanentRouter from "./modules/admin/tenants.routes";
import aiAssistantRouter from "./modules/ai-assistant/ai-assistant.routes";
import aiInsightsRouter from "./modules/ai-insights/ai-insights.routes";
import attendanceRouter from "./modules/attendance/attendance.routes";
import contactsRouter from "./modules/contacts/contacts.routes";
import costCentersRouter from "./modules/cost-centers/cost-centers.routes";
import dashboardRouter from "./modules/dashboard/dashboard.routes";
import deliveryChallansRouter from "./modules/delivery-challans/deliveryChallans.routes";
import geoVisitsRouter from "./modules/geo-visits/geo-visits.routes";
import importsRouter from "./modules/imports/imports.routes";
import interactionsRouter from "./modules/interactions/interactions.routes";
import leadsRouter from "./modules/leads/leads.route";
import leaveRouter from "./modules/leaves/leave.routes";
import masterRouter from "./modules/masters/masters.routes";
import myDayRouter from "./modules/my-day/my-day.routes";
import notificationsRouter from "./modules/notifications/notifications.routes";
import opportunitiesRouter from "./modules/opportunities/opportunities.routes";
import organizationsRouter from "./modules/organizations/organizations.routes";
import outstandingRouter from "./modules/outstandings/outstandings.routes";
import productsRouter from "./modules/products/products.routes";
import purchaseOrderRouter from "./modules/purchase-orders/purchase-orders.routes";
import quotesRouter from "./modules/quotes/quotes.routes";
import rbacRouter from "./modules/rbac/rbac.routes";
import salesOrdersRouter from "./modules/sales-orders/sales-orders.routes";
import tallyCompaniesRouter from "./modules/tally-companies/tally-companies.routes";
import tallyPerformanceRouter from "./modules/tally-performance/tallyPerformance.routes";
import tallyRouter from "./modules/tally/tally.routes";
import tasksRouter from "./modules/tasks/tasks.routes";
import userCostCentersRouter from "./modules/user-cost-centers/user-cost-centers.routes";
import usersRouter from "./modules/users/users.routes";
import visitsRouter from "./modules/visits/visits.routes";
import warehouseRouter from "./modules/warehouse/warehouse.routes";
import { errorHandler, notFoundHandler } from "./observability/errors";
import { clientLogsRouter } from "./routes/clientLogs";
import { meRouter } from "./routes/me";
// import { notificationsRouter } from "./routes/notifications";

export function createApp() {
  const app = express();

  app.disable("x-powered-by");

  app.use(helmet());
  app.use(express.json({ limit: "1mb" }));

  const allowedOrigins = env.CORS_ORIGINS;

  app.use(
    cors({
      origin: (origin, cb) => {
        // allow Postman/curl/server-to-server
        if (!origin) return cb(null, true);

        // allow all localhost in development
        if (
          env.NODE_ENV !== "production" &&
          /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)
        ) {
          return cb(null, true);
        }

        if (allowedOrigins.includes(origin)) {
          return cb(null, true);
        }

        console.log("CORS blocked origin:", origin);
        return cb(new Error(`CORS blocked: ${origin}`));
      },
      credentials: true,
    }),
  );

  /**
   * Public / admin routes
   */
  app.use("/v1/admin", tanentRouter);
  app.use("/v1/:slug/auth", resolveTenant, authRouter);
  app.use("/v1/:slug/tally", resolveTenant, tallyRouter);

  /**
   * Protected tenant routes
   * Everything below /v1/:slug/* will automatically use these middlewares
   */
  app.use("/v1/:slug", resolveTenant, requireAuth, attachUserContext);

  app.use("/v1/:slug/me", meRouter());
  app.use("/v1/:slug/rbac", rbacRouter);
  // app.use("/v1/:slug/notifications", notificationsRouter());
  app.use("/v1/:slug/client-logs", clientLogsRouter());
  app.use("/v1/:slug/user-cost-centers", userCostCentersRouter);
  app.use("/v1/:slug/users", usersRouter);
  app.use("/v1/:slug/organizations", organizationsRouter);
  app.use("/v1/:slug/contacts", contactsRouter);
  app.use("/v1/:slug/opportunities", opportunitiesRouter);
  app.use("/v1/:slug/leads", leadsRouter);
  app.use("/v1/:slug/products", productsRouter);
  app.use("/v1/:slug/tasks", tasksRouter);
  app.use("/v1/:slug/attendance", attendanceRouter);
  app.use("/v1/:slug/leaves", leaveRouter);
  app.use("/v1/:slug/imports", importsRouter);
  app.use("/v1/:slug/visits", visitsRouter);
  app.use("/v1/:slug/activity", activityRouter);
  app.use("/v1/:slug/masters", masterRouter);
  app.use("/v1/:slug/quotes", quotesRouter);
  app.use("/v1/:slug/interactions", interactionsRouter);
  app.use("/v1/:slug/ai-assistant", aiAssistantRouter);
  app.use("/v1/:slug/ai-insights", aiInsightsRouter);
  app.use("/v1/:slug/geo-visits", geoVisitsRouter);
  app.use("/v1/:slug/dashboard", dashboardRouter);
  app.use("/v1/:slug/my-day", myDayRouter);
  // app.use("/v1/:slug/tally", tallyRouter);
  app.use("/v1/:slug/purchase-orders", purchaseOrderRouter);
  app.use("/v1/:slug/sales-orders", salesOrdersRouter);
  app.use("/v1/:slug/delivery-challans", deliveryChallansRouter);
  app.use("/v1/:slug/tally-performance", tallyPerformanceRouter);
  app.use("/v1/:slug/warehouse", warehouseRouter);
  app.use("/v1/:slug/cost-centers", costCentersRouter);
  app.use("/v1/:slug/outstandings", outstandingRouter);
  app.use("/v1/:slug/tally-companies", tallyCompaniesRouter);
  app.use("/v1/:slug/notifications", notificationsRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
