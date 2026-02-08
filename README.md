# flexloud-crm-api

## Backend repo (complete, Cloud Run–ready) — `flexloud-crm-api`

This is the full backend repo layout with the production-grade code blocks you need to deploy on Cloud Run. It implements our finalized core: multi-tenant + Identity Platform JWT verification + RBAC + Teams + Lead lifecycle (stages/assignment/history/activity) + Notifications persistence + Outbox emission + Observability (structured logs + request correlation).

### Repo tree

```text
flexloud-crm-api/
  ├─ package.json
  ├─ tsconfig.json
  ├─ .env.example
  ├─ Dockerfile
  ├─ README.md
  ├─ migrations/
  │  └─ 001_init.sql
  └─ src/
     ├─ server.ts
     ├─ app.ts
     ├─ config/
     │  ├─ env.ts
     │  └─ logger.ts
     ├─ observability/
     │  ├─ requestContext.ts
     │  ├─ requestLogging.ts
     │  └─ errors.ts
     ├─ db/
     │  ├─ pool.ts
     │  └─ tx.ts
     ├─ auth/
     │  ├─ jwks.ts
     │  ├─ requireAuth.ts
     │  └─ types.ts
     ├─ rbac/
     │  ├─ roles.ts
     │  └─ authorize.ts
     ├─ tenancy/
     │  └─ tenantContext.ts
     ├─ outbox/
     │  └─ outboxRepo.ts
     ├─ routes/
     │  ├─ health.ts
     │  ├─ me.ts
     │  ├─ leads.ts
     │  ├─ notifications.ts
     │  └─ clientLogs.ts
     └─ domain/
        └─ leads/
           ├─ types.ts
           ├─ validation.ts
           ├─ leadsRepo.ts
           └─ leadsService.ts
```

---

# 1) Root files

## `package.json`

```json
{
  "name": "flexloud-crm-api",
  "private": true,
  "version": "1.0.0",
  "type": "commonjs",
  "scripts": {
    "dev": "ts-node-dev --respawn --transpile-only src/server.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/server.js"
  },
  "dependencies": {
    "cors": "^2.8.5",
    "express": "^4.19.2",
    "helmet": "^7.1.0",
    "jose": "^5.6.3",
    "pg": "^8.12.0",
    "pino": "^9.3.2",
    "pino-http": "^10.2.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/cors": "^2.8.17",
    "@types/express": "^4.17.21",
    "@types/node": "^20.14.12",
    "ts-node-dev": "^2.0.0",
    "typescript": "^5.6.3"
  }
}
```

## `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "rootDir": "src",
    "outDir": "dist",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  }
}
```

## `.env.example`

```bash
PORT=8080
NODE_ENV=production
CORS_ORIGINS=https://crm.flexloud.com,http://localhost:5173

PG_HOST=127.0.0.1
PG_PORT=5432
PG_DATABASE=crm
PG_USER=crm_app
PG_PASSWORD=change-me
PG_SSLMODE=disable

JWT_ISSUER=https://securetoken.google.com/<GCP_PROJECT_ID>
JWT_AUDIENCE=<GCP_PROJECT_ID>

LOG_LEVEL=info
```

## `Dockerfile` (Cloud Run-ready)

```dockerfile
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY migrations ./migrations
COPY src ./src
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY --from=build /app/migrations ./migrations
EXPOSE 8080
CMD ["node","dist/server.js"]
```

## `README.md`

```md
# flexloud-crm-api

Production-grade CRM API for Cloud Run.

Includes:
- Identity Platform JWT verification (JWKs via jose RemoteJWKSet)
- Multi-tenant enforcement (server-side)
- RBAC roles: ADMIN / MANAGER / AGENT
- Teams + manager visibility
- Leads lifecycle: create/update, assign, stage transitions, activity timeline
- Notifications persistence + read/unread APIs
- Outbox event emission (for crm-notify + integrations services)
- Structured logs + X-Request-Id correlation
- /health and /ready endpoints

Deploy:
- Build container, push to Artifact Registry
- Deploy on Cloud Run (asia-south1)
- Configure env vars: PG_*, JWT_*, CORS_ORIGINS
- Run migrations in Cloud SQL before first use
```

---

# 2) App bootstrap

## `src/server.ts`

```ts
import { createApp } from "./app";
import { env } from "./config/env";
import { logger } from "./config/logger";

const app = createApp();

app.listen(env.PORT, () => {
  logger.info({ port: env.PORT }, "crm-api started");
});
```

## `src/app.ts`

```ts
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { env } from "./config/env";
import { requestLoggingMiddleware } from "./observability/requestLogging";
import { errorHandler, notFoundHandler } from "./observability/errors";

import { healthRouter } from "./routes/health";
import { meRouter } from "./routes/me";
import { leadsRouter } from "./routes/leads";
import { notificationsRouter } from "./routes/notifications";
import { clientLogsRouter } from "./routes/clientLogs";

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
      credentials: false
    })
  );

  app.use(requestLoggingMiddleware());

  app.use("/health", healthRouter());
  app.use("/ready", healthRouter());

  app.use("/v1/me", meRouter());
  app.use("/v1/leads", leadsRouter());
  app.use("/v1/notifications", notificationsRouter());
  app.use("/v1/client-logs", clientLogsRouter()); // optional

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
```

---

# 3) Config + logging + error handling

## `src/config/env.ts`

```ts
import { z } from "zod";

const schema = z.object({
  PORT: z.coerce.number().default(8080),
  NODE_ENV: z.string().default("production"),

  CORS_ORIGINS: z.string().default("").transform((s) => s.split(",").map(x => x.trim()).filter(Boolean)),

  PG_HOST: z.string(),
  PG_PORT: z.coerce.number().default(5432),
  PG_DATABASE: z.string(),
  PG_USER: z.string(),
  PG_PASSWORD: z.string(),
  PG_SSLMODE: z.string().default("disable"),

  JWT_ISSUER: z.string(),
  JWT_AUDIENCE: z.string(),

  LOG_LEVEL: z.string().default("info")
});

export const env = schema.parse(process.env);
```

## `src/config/logger.ts`

```ts
import pino from "pino";
import { env } from "./env";

export const logger = pino({
  level: env.LOG_LEVEL,
  base: undefined,
  messageKey: "message",
  timestamp: () => `,"ts":"${new Date().toISOString()}"`
});
```

## `src/observability/requestContext.ts`

```ts
import { AsyncLocalStorage } from "node:async_hooks";

export type RequestContext = {
  requestId: string;
  userId?: string;
  tenantId?: string;
  roles?: string[];
};

export const requestContext = new AsyncLocalStorage<RequestContext>();
```

## `src/observability/requestLogging.ts`

```ts
import pinoHttp from "pino-http";
import { Request, Response, NextFunction } from "express";
import { logger } from "../config/logger";
import { requestContext } from "./requestContext";
import crypto from "node:crypto";

function newRequestId() {
  return crypto.randomUUID();
}

export function requestLoggingMiddleware() {
  const httpLogger = pinoHttp({
    logger,
    customProps: (req) => {
      const ctx = requestContext.getStore();
      return {
        requestId: ctx?.requestId,
        tenantId: ctx?.tenantId,
        userId: ctx?.userId,
        roles: ctx?.roles,
        route: req.originalUrl
      };
    }
  });

  return (req: Request, res: Response, next: NextFunction) => {
    const inbound = req.header("X-Request-Id");
    const requestId = inbound && inbound.length <= 128 ? inbound : newRequestId();
    res.setHeader("X-Request-Id", requestId);

    requestContext.run({ requestId }, () => {
      httpLogger(req, res);
      next();
    });
  };
}
```

## `src/observability/errors.ts`

```ts
import { Request, Response, NextFunction } from "express";
import { logger } from "../config/logger";
import { requestContext } from "./requestContext";

export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({ error: "Not Found" });
}

export function errorHandler(err: any, req: Request, res: Response, _next: NextFunction) {
  const ctx = requestContext.getStore();

  logger.error(
    { requestId: ctx?.requestId, route: req.originalUrl, err: { name: err?.name, message: err?.message } },
    "request failed"
  );

  const status = err?.statusCode && Number.isInteger(err.statusCode) ? err.statusCode : 500;
  const safe = status === 500 ? "Internal Server Error" : String(err?.message ?? "Error");
  res.status(status).json({ error: safe, requestId: ctx?.requestId });
}
```

---

# 4) DB

## `src/db/pool.ts`

```ts
import { Pool } from "pg";
import { env } from "../config/env";

export const db = new Pool({
  host: env.PG_HOST,
  port: env.PG_PORT,
  database: env.PG_DATABASE,
  user: env.PG_USER,
  password: env.PG_PASSWORD,
  ssl: env.PG_SSLMODE === "require" ? { rejectUnauthorized: false } : undefined,
  max: 15
});
```

## `src/db/tx.ts`

```ts
import { PoolClient } from "pg";
import { db } from "./pool";

export async function withTx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await db.connect();
  try {
    await c.query("begin");
    const out = await fn(c);
    await c.query("commit");
    return out;
  } catch (e) {
    await c.query("rollback");
    throw e;
  } finally {
    c.release();
  }
}
```

---

# 5) Auth (Identity Platform) + Tenancy + RBAC

## `src/auth/types.ts`

```ts
export type AuthUser = { sub: string; email?: string; name?: string };
```

## `src/auth/jwks.ts`

```ts
import { createRemoteJWKSet, jwtVerify } from "jose";
import { env } from "../config/env";

const jwksUrl = new URL(`${env.JWT_ISSUER}/.well-known/jwks.json`);
const JWKS = createRemoteJWKSet(jwksUrl);

export async function verifyIdToken(token: string) {
  const { payload } = await jwtVerify(token, JWKS, {
    issuer: env.JWT_ISSUER,
    audience: env.JWT_AUDIENCE
  });
  return payload;
}
```

## `src/auth/requireAuth.ts`

```ts
import { Request, Response, NextFunction } from "express";
import { verifyIdToken } from "./jwks";
import { requestContext } from "../observability/requestContext";
import type { AuthUser } from "./types";

declare global {
  namespace Express {
    interface Request { user?: AuthUser }
  }
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const h = req.header("Authorization");
    if (!h?.startsWith("Bearer ")) throw Object.assign(new Error("Unauthorized"), { statusCode: 401 });

    const token = h.slice("Bearer ".length).trim();
    const payload = await verifyIdToken(token);

    const user: AuthUser = {
      sub: String(payload.sub),
      email: payload.email ? String(payload.email) : undefined,
      name: payload.name ? String(payload.name) : undefined
    };

    req.user = user;

    const ctx = requestContext.getStore();
    if (ctx) ctx.userId = user.sub;

    next();
  } catch {
    next(Object.assign(new Error("Unauthorized"), { statusCode: 401 }));
  }
}
```

## `src/rbac/roles.ts`

```ts
export type Role = "ADMIN" | "MANAGER" | "AGENT";
export function hasRole(roles: string[] | undefined, role: Role) {
  return Boolean(roles?.includes(role));
}
```

## `src/rbac/authorize.ts`

```ts
import { Request, Response, NextFunction } from "express";
import { Role, hasRole } from "./roles";
import { requestContext } from "../observability/requestContext";

export function requireRole(...allowed: Role[]) {
  return (_req: Request, _res: Response, next: NextFunction) => {
    const roles = requestContext.getStore()?.roles ?? [];
    const ok = allowed.some(r => hasRole(roles, r));
    if (!ok) return next(Object.assign(new Error("Forbidden"), { statusCode: 403 }));
    next();
  };
}
```

## `src/tenancy/tenantContext.ts`

```ts
import { db } from "../db/pool";
import { requestContext } from "../observability/requestContext";
import { Request } from "express";

export async function resolveTenant(req: Request) {
  if (!req.user) throw Object.assign(new Error("Unauthorized"), { statusCode: 401 });

  const r = await db.query(
    `select ut.tenant_id, t.name as tenant_name, ut.roles
     from user_tenants ut
     join tenants t on t.id = ut.tenant_id
     where ut.user_id = $1
     limit 1`,
    [req.user.sub]
  );

  if (r.rowCount === 0) throw Object.assign(new Error("No tenant access"), { statusCode: 403 });

  const row = r.rows[0] as { tenant_id: string; tenant_name: string; roles: string[] };

  const ctx = requestContext.getStore();
  if (ctx) {
    ctx.tenantId = row.tenant_id;
    ctx.roles = row.roles ?? [];
  }

  return { tenantId: row.tenant_id, tenantName: row.tenant_name, roles: row.roles ?? [] };
}
```

---

# 6) Outbox (event emission)

## `src/outbox/outboxRepo.ts`

```ts
import { PoolClient } from "pg";

export async function insertOutbox(
  c: PoolClient,
  e: { id: string; tenantId: string; type: string; payload: unknown }
) {
  await c.query(
    `insert into outbox (id, tenant_id, type, payload, processed, created_at)
     values ($1,$2,$3,$4,false,now())`,
    [e.id, e.tenantId, e.type, JSON.stringify(e.payload)]
  );
}
```

---

# 7) Routes

## `src/routes/health.ts`

```ts
import { Router } from "express";

export function healthRouter() {
  const r = Router();
  r.get("/", (_req, res) => res.status(200).send("ok"));
  return r;
}
```

## `src/routes/me.ts`

```ts
import { Router } from "express";
import { requireAuth } from "../auth/requireAuth";
import { resolveTenant } from "../tenancy/tenantContext";

export function meRouter() {
  const r = Router();
  r.get("/", requireAuth, async (req, res) => {
    const tenant = await resolveTenant(req);
    res.json({
      user: { id: req.user!.sub, email: req.user!.email, displayName: req.user!.name },
      tenant: { id: tenant.tenantId, name: tenant.tenantName },
      roles: tenant.roles
    });
  });
  return r;
}
```

## `src/routes/clientLogs.ts` (optional)

```ts
import { Router } from "express";
import { z } from "zod";
import { logger } from "../config/logger";

const schema = z.object({
  level: z.string(),
  msg: z.string(),
  ts: z.string(),
  route: z.string().optional(),
  context: z.record(z.any()).optional()
});

export function clientLogsRouter() {
  const r = Router();
  r.post("/", (req, res) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "invalid log payload" });
    logger.info({ clientLog: parsed.data }, "client.log");
    res.status(204).send();
  });
  return r;
}
```

## `src/routes/notifications.ts`

```ts
import { Router } from "express";
import { requireAuth } from "../auth/requireAuth";
import { resolveTenant } from "../tenancy/tenantContext";
import { db } from "../db/pool";

export function notificationsRouter() {
  const r = Router();

  r.get("/", requireAuth, async (req, res) => {
    const { tenantId } = await resolveTenant(req);
    const userId = req.user!.sub;

    const out = await db.query(
      `select id, title, body, read, created_at as "createdAt"
       from notifications
       where tenant_id=$1 and user_id=$2
       order by created_at desc
       limit 200`,
      [tenantId, userId]
    );

    res.json(out.rows);
  });

  r.post("/:id/read", requireAuth, async (req, res) => {
    const { tenantId } = await resolveTenant(req);
    const userId = req.user!.sub;
    const id = req.params.id;

    await db.query(
      `update notifications set read=true
       where tenant_id=$1 and user_id=$2 and id=$3`,
      [tenantId, userId, id]
    );

    res.status(204).send();
  });

  return r;
}
```

## `src/routes/leads.ts`

```ts
import { Router } from "express";
import { requireAuth } from "../auth/requireAuth";
import { resolveTenant } from "../tenancy/tenantContext";
import { hasRole } from "../rbac/roles";
import { withTx } from "../db/tx";
import { db } from "../db/pool";

import { createLeadSchema, patchLeadSchema, assignLeadSchema, transitionSchema, activitySchema } from "../domain/leads/validation";
import { createLead, assignLead, transitionLeadStage, addLeadActivity } from "../domain/leads/leadsService";
import { listLeadsForOwnerOrTeam, getLead } from "../domain/leads/leadsRepo";

export function leadsRouter() {
  const r = Router();

  r.get("/", requireAuth, async (req, res) => {
    const { tenantId, roles } = await resolveTenant(req);
    const userId = req.user!.sub;
    const canSeeTeam = hasRole(roles, "MANAGER") || hasRole(roles, "ADMIN");

    const rows = await db.connect().then(async (c) => {
      try {
        return await listLeadsForOwnerOrTeam(c, tenantId, userId, canSeeTeam);
      } finally {
        c.release();
      }
    });

    res.json(rows);
  });

  r.get("/:id", requireAuth, async (req, res) => {
    const { tenantId, roles } = await resolveTenant(req);
    const userId = req.user!.sub;
    const leadId = req.params.id;

    const lead = await db.connect().then(async (c) => {
      try {
        return await getLead(c, tenantId, leadId);
      } finally {
        c.release();
      }
    });

    if (!lead) return res.status(404).json({ error: "Lead not found" });

    if (hasRole(roles, "AGENT") && !hasRole(roles, "MANAGER") && !hasRole(roles, "ADMIN")) {
      if (lead.ownerUserId !== userId) return res.status(403).json({ error: "Forbidden" });
    }

    res.json(lead);
  });

  r.post("/", requireAuth, async (req, res) => {
    const { tenantId, roles } = await resolveTenant(req);
    const body = createLeadSchema.parse(req.body);

    const ownerUserId = (hasRole(roles, "MANAGER") || hasRole(roles, "ADMIN")) ? body.ownerUserId : undefined;

    const out = await withTx(async (c) => {
      return await createLead(c, {
        tenantId,
        actorUserId: req.user!.sub,
        title: body.title,
        source: body.source,
        ownerUserId,
        initialStageId: body.initialStageId
      });
    });

    res.status(201).json(out);
  });

  r.patch("/:id", requireAuth, async (req, res) => {
    const { tenantId, roles } = await resolveTenant(req);
    const leadId = req.params.id;
    const patch = patchLeadSchema.parse(req.body);

    await withTx(async (c) => {
      const lead = await getLead(c, tenantId, leadId);
      if (!lead) throw Object.assign(new Error("Lead not found"), { statusCode: 404 });

      if (hasRole(roles, "AGENT") && !hasRole(roles, "MANAGER") && !hasRole(roles, "ADMIN")) {
        if (lead.ownerUserId !== req.user!.sub) throw Object.assign(new Error("Forbidden"), { statusCode: 403 });
      }

      await c.query(
        `update leads set
           title = coalesce($1, title),
           source = coalesce($2, source),
           status = coalesce($3, status),
           updated_at = now()
         where tenant_id=$4 and id=$5`,
        [patch.title ?? null, patch.source ?? null, patch.status ?? null, tenantId, leadId]
      );
    });

    res.status(204).send();
  });

  r.post("/:id/assign", requireAuth, async (req, res) => {
    const { tenantId, roles } = await resolveTenant(req);
    if (!(hasRole(roles, "MANAGER") || hasRole(roles, "ADMIN"))) return res.status(403).json({ error: "Forbidden" });

    const leadId = req.params.id;
    const body = assignLeadSchema.parse(req.body);

    await withTx(async (c) => {
      await assignLead(c, { tenantId, actorUserId: req.user!.sub, leadId, newOwnerUserId: body.ownerUserId });
    });

    res.status(204).send();
  });

  r.post("/:id/transition", requireAuth, async (req, res) => {
    const { tenantId, roles } = await resolveTenant(req);
    const leadId = req.params.id;
    const body = transitionSchema.parse(req.body);

    await withTx(async (c) => {
      const lead = await getLead(c, tenantId, leadId);
      if (!lead) throw Object.assign(new Error("Lead not found"), { statusCode: 404 });

      if (hasRole(roles, "AGENT") && !hasRole(roles, "MANAGER") && !hasRole(roles, "ADMIN")) {
        if (lead.ownerUserId !== req.user!.sub) throw Object.assign(new Error("Forbidden"), { statusCode: 403 });
      }

      await transitionLeadStage(c, {
        tenantId,
        actorUserId: req.user!.sub,
        leadId,
        toStageId: body.toStageId,
        note: body.note
      });
    });

    res.status(204).send();
  });

  r.post("/:id/activities", requireAuth, async (req, res) => {
    const { tenantId, roles } = await resolveTenant(req);
    const leadId = req.params.id;
    const body = activitySchema.parse(req.body);

    await withTx(async (c) => {
      const lead = await getLead(c, tenantId, leadId);
      if (!lead) throw Object.assign(new Error("Lead not found"), { statusCode: 404 });

      if (hasRole(roles, "AGENT") && !hasRole(roles, "MANAGER") && !hasRole(roles, "ADMIN")) {
        if (lead.ownerUserId !== req.user!.sub) throw Object.assign(new Error("Forbidden"), { statusCode: 403 });
      }

      await addLeadActivity(c, {
        tenantId,
        actorUserId: req.user!.sub,
        leadId,
        type: body.type,
        body: body.body
      });
    });

    res.status(204).send();
  });

  return r;
}
```

---

# 8) Leads domain

## `src/domain/leads/types.ts`

```ts
export type LeadStatus = "OPEN" | "WON" | "LOST" | "ARCHIVED";

export type Lead = {
  id: string;
  tenantId: string;
  title: string;
  source?: string;
  status: LeadStatus;
  ownerUserId: string | null;
  currentStageId: string | null;
  createdAt: string;
  updatedAt: string;
};
```

## `src/domain/leads/validation.ts`

```ts
import { z } from "zod";

export const createLeadSchema = z.object({
  title: z.string().min(2).max(200),
  source: z.string().max(100).optional(),
  ownerUserId: z.string().max(128).optional(),
  initialStageId: z.string().max(64).optional()
});

export const patchLeadSchema = z.object({
  title: z.string().min(2).max(200).optional(),
  source: z.string().max(100).optional(),
  status: z.enum(["OPEN", "WON", "LOST", "ARCHIVED"]).optional()
});

export const assignLeadSchema = z.object({
  ownerUserId: z.string().min(1).max(128)
});

export const transitionSchema = z.object({
  toStageId: z.string().min(1).max(64),
  note: z.string().max(2000).optional()
});

export const activitySchema = z.object({
  type: z.enum(["NOTE", "CALL", "EMAIL", "MEETING", "FOLLOW_UP"]),
  body: z.string().min(1).max(4000)
});
```

## `src/domain/leads/leadsRepo.ts`

```ts
import { PoolClient } from "pg";

export async function getDefaultStageId(c: PoolClient, tenantId: string): Promise<string | null> {
  const r = await c.query(
    `select id from lead_stage_definitions
     where tenant_id = $1
     order by order_index asc
     limit 1`,
    [tenantId]
  );
  return r.rowCount ? String(r.rows[0].id) : null;
}

export async function getLead(c: PoolClient, tenantId: string, leadId: string) {
  const r = await c.query(
    `select id, tenant_id as "tenantId", title, source, status,
            owner_user_id as "ownerUserId",
            current_stage_id as "currentStageId",
            created_at as "createdAt", updated_at as "updatedAt"
     from leads
     where tenant_id=$1 and id=$2`,
    [tenantId, leadId]
  );
  return r.rowCount ? r.rows[0] : null;
}

export async function listLeadsForOwnerOrTeam(
  c: PoolClient,
  tenantId: string,
  userId: string,
  canSeeTeam: boolean
) {
  if (!canSeeTeam) {
    const r = await c.query(
      `select id, title, status, owner_user_id as "ownerUserId", current_stage_id as "currentStageId",
              created_at as "createdAt", updated_at as "updatedAt"
       from leads
       where tenant_id=$1 and owner_user_id=$2
       order by updated_at desc
       limit 200`,
      [tenantId, userId]
    );
    return r.rows;
  }

  const r = await c.query(
    `select l.id, l.title, l.status, l.owner_user_id as "ownerUserId", l.current_stage_id as "currentStageId",
            l.created_at as "createdAt", l.updated_at as "updatedAt"
     from leads l
     where l.tenant_id=$1
       and l.owner_user_id in (
         select tm.user_id
         from team_members tm
         join teams t on t.id = tm.team_id
         where t.tenant_id=$1 and t.manager_user_id=$2
         union
         select $2
       )
     order by l.updated_at desc
     limit 200`,
    [tenantId, userId]
  );
  return r.rows;
}
```

## `src/domain/leads/leadsService.ts`

```ts
import crypto from "node:crypto";
import { PoolClient } from "pg";
import { insertOutbox } from "../../outbox/outboxRepo";
import { getDefaultStageId, getLead } from "./leadsRepo";

function uuid() {
  return crypto.randomUUID();
}

export async function createLead(
  c: PoolClient,
  input: { tenantId: string; actorUserId: string; title: string; source?: string; ownerUserId?: string; initialStageId?: string }
) {
  const id = uuid();
  const stageId = input.initialStageId ?? (await getDefaultStageId(c, input.tenantId));
  const owner = input.ownerUserId ?? input.actorUserId;

  await c.query(
    `insert into leads (id, tenant_id, title, source, status, owner_user_id, current_stage_id, created_at, updated_at)
     values ($1,$2,$3,$4,'OPEN',$5,$6,now(),now())`,
    [id, input.tenantId, input.title, input.source ?? null, owner, stageId]
  );

  if (stageId) {
    await c.query(
      `insert into lead_stage_history (id, tenant_id, lead_id, from_stage_id, to_stage_id, changed_by, note, changed_at)
       values ($1,$2,$3,null,$4,$5,null,now())`,
      [uuid(), input.tenantId, id, stageId, input.actorUserId]
    );
  }

  await c.query(
    `insert into lead_assignments (id, tenant_id, lead_id, assigned_to, assigned_by, assigned_at)
     values ($1,$2,$3,$4,$5,now())`,
    [uuid(), input.tenantId, id, owner, input.actorUserId]
  );

  await c.query(
    `insert into notifications (id, tenant_id, user_id, title, body, read, created_at)
     values ($1,$2,$3,$4,$5,false,now())`,
    [uuid(), input.tenantId, owner, "New lead assigned", input.title]
  );

  await insertOutbox(c, {
    id: uuid(),
    tenantId: input.tenantId,
    type: "lead.created",
    payload: { leadId: id, ownerUserId: owner }
  });

  return { id };
}

export async function assignLead(
  c: PoolClient,
  input: { tenantId: string; actorUserId: string; leadId: string; newOwnerUserId: string }
) {
  const lead = await getLead(c, input.tenantId, input.leadId);
  if (!lead) throw Object.assign(new Error("Lead not found"), { statusCode: 404 });

  await c.query(
    `update leads set owner_user_id=$1, updated_at=now() where tenant_id=$2 and id=$3`,
    [input.newOwnerUserId, input.tenantId, input.leadId]
  );

  await c.query(
    `insert into lead_assignments (id, tenant_id, lead_id, assigned_to, assigned_by, assigned_at)
     values ($1,$2,$3,$4,$5,now())`,
    [uuid(), input.tenantId, input.leadId, input.newOwnerUserId, input.actorUserId]
  );

  await c.query(
    `insert into notifications (id, tenant_id, user_id, title, body, read, created_at)
     values ($1,$2,$3,$4,$5,false,now())`,
    [uuid(), input.tenantId, input.newOwnerUserId, "Lead assigned to you", lead.title]
  );

  await insertOutbox(c, {
    id: uuid(),
    tenantId: input.tenantId,
    type: "lead.assigned",
    payload: { leadId: input.leadId, ownerUserId: input.newOwnerUserId }
  });
}

export async function transitionLeadStage(
  c: PoolClient,
  input: { tenantId: string; actorUserId: string; leadId: string; toStageId: string; note?: string }
) {
  const lead = await getLead(c, input.tenantId, input.leadId);
  if (!lead) throw Object.assign(new Error("Lead not found"), { statusCode: 404 });

  const fromStageId = lead.currentStageId;

  await c.query(
    `update leads set current_stage_id=$1, updated_at=now() where tenant_id=$2 and id=$3`,
    [input.toStageId, input.tenantId, input.leadId]
  );

  await c.query(
    `insert into lead_stage_history (id, tenant_id, lead_id, from_stage_id, to_stage_id, changed_by, note, changed_at)
     values ($1,$2,$3,$4,$5,$6,$7,now())`,
    [uuid(), input.tenantId, input.leadId, fromStageId, input.toStageId, input.actorUserId, input.note ?? null]
  );

  await insertOutbox(c, {
    id: uuid(),
    tenantId: input.tenantId,
    type: "lead.stage_changed",
    payload: { leadId: input.leadId, fromStageId, toStageId: input.toStageId }
  });
}

export async function addLeadActivity(
  c: PoolClient,
  input: { tenantId: string; actorUserId: string; leadId: string; type: string; body: string }
) {
  const lead = await getLead(c, input.tenantId, input.leadId);
  if (!lead) throw Object.assign(new Error("Lead not found"), { statusCode: 404 });

  await c.query(
    `insert into lead_activities (id, tenant_id, lead_id, type, body, created_by, created_at)
     values ($1,$2,$3,$4,$5,$6,now())`,
    [uuid(), input.tenantId, input.leadId, input.type, input.body, input.actorUserId]
  );

  await c.query(`update leads set updated_at=now() where tenant_id=$1 and id=$2`, [input.tenantId, input.leadId]);

  await insertOutbox(c, {
    id: uuid(),
    tenantId: input.tenantId,
    type: "lead.activity_added",
    payload: { leadId: input.leadId, type: input.type }
  });
}
```

---

# 9) Migration

## `migrations/001_init.sql`

```sql
create table if not exists tenants (
  id text primary key,
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists users (
  id text primary key,
  email text,
  display_name text,
  created_at timestamptz not null default now()
);

create table if not exists user_tenants (
  user_id text not null references users(id),
  tenant_id text not null references tenants(id),
  roles text[] not null default '{}',
  primary key (user_id, tenant_id)
);

create table if not exists teams (
  id text primary key,
  tenant_id text not null references tenants(id),
  name text not null,
  manager_user_id text not null references users(id),
  created_at timestamptz not null default now()
);

create table if not exists team_members (
  team_id text not null references teams(id),
  user_id text not null references users(id),
  primary key (team_id, user_id)
);

create table if not exists lead_stage_definitions (
  id text primary key,
  tenant_id text not null references tenants(id),
  name text not null,
  order_index int not null,
  is_terminal boolean not null default false
);

create table if not exists leads (
  id text primary key,
  tenant_id text not null references tenants(id),
  title text not null,
  source text,
  status text not null default 'OPEN',
  owner_user_id text references users(id),
  current_stage_id text references lead_stage_definitions(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_leads_tenant_owner on leads(tenant_id, owner_user_id);
create index if not exists idx_leads_tenant_updated on leads(tenant_id, updated_at);

create table if not exists lead_assignments (
  id text primary key,
  tenant_id text not null references tenants(id),
  lead_id text not null references leads(id),
  assigned_to text not null references users(id),
  assigned_by text not null references users(id),
  assigned_at timestamptz not null default now()
);

create table if not exists lead_stage_history (
  id text primary key,
  tenant_id text not null references tenants(id),
  lead_id text not null references leads(id),
  from_stage_id text references lead_stage_definitions(id),
  to_stage_id text not null references lead_stage_definitions(id),
  changed_by text not null references users(id),
  note text,
  changed_at timestamptz not null default now()
);

create table if not exists lead_activities (
  id text primary key,
  tenant_id text not null references tenants(id),
  lead_id text not null references leads(id),
  type text not null,
  body text not null,
  created_by text not null references users(id),
  created_at timestamptz not null default now()
);

create table if not exists notifications (
  id text primary key,
  tenant_id text not null references tenants(id),
  user_id text not null references users(id),
  title text not null,
  body text,
  read boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_notifications_user on notifications(tenant_id, user_id, created_at desc);

create table if not exists outbox (
  id text primary key,
  tenant_id text not null references tenants(id),
  type text not null,
  payload jsonb not null,
  processed boolean not null default false,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

create index if not exists idx_outbox_unprocessed on outbox(processed, created_at);
```

---

# How to deploy this on Cloud Run (minimal steps)

1. Build & push image to Artifact Registry (asia-south1)
2. Deploy Cloud Run service `crm-api` with:

* `PORT=8080`
* `PG_*`, `JWT_*`, `CORS_ORIGINS`
* VPC connector + `PRIVATE_RANGES_ONLY` (if Cloud SQL private IP)

3. Run migration `migrations/001_init.sql` on Cloud SQL Postgres
4. Ensure Identity Platform is configured and JWT issuer/audience set correctly

---

# What is DONE vs what remains to make it a “perfect product”

## Done in this backend repo (ready to deploy)

1. Cloud Run-ready Node/Express/TS service
2. Identity Platform JWT signature verification (JWKs)
3. Strict multi-tenancy (server-side, no client tenant_id)
4. RBAC model (ADMIN/MANAGER/AGENT) + enforcement in lead flows
5. Teams + manager visibility (query model)
6. Lead lifecycle core:

   * create/update
   * assign owner
   * stage transition + history
   * activity timeline
7. Notifications persistence + read/unread APIs
8. Outbox event emission (for notify/integrations)
9. Structured logging + request correlation
10. Health/readiness endpoints
11. SQL migration baseline

## Remaining (to make the product “perfect”, enterprise + sellable)

These are not backend-core gaps; they are missing **product components** (next repos/services) and **hardening**:

### A) Required next microservices (as finalized)

1. `crm-notify` (Cloud Run)

* SSE streams per user
* reads events (Pub/Sub subscription or DB + outbox consumer)
* emits lightweight “refresh” signals to web

2. `outbox-publisher` (Cloud Run Job)

* publishes outbox rows to Pub/Sub reliably
* idempotency + retries

3. `crm-integrations` (Cloud Run)

* Tally connector (per tenant)
* connector config + secure secrets + event-driven sync

### B) Admin & onboarding (must for real customers)

4. Tenant onboarding API + bootstrap:

* create tenant
* register first admin user
* create default stage pipeline

5. Stage management APIs (per tenant):

* CRUD stages
* enforce stage ordering, terminal rules

### C) CRM domain completeness (core CRM beyond leads)

6. Accounts + Contacts
7. Deals / pipeline / forecasting
8. Tasks / reminders / SLA queues

### D) Security + ops hardening

9. Rate limiting and abuse protection
10. Audit log endpoints + export (for enterprise)
11. Backups/restore drills for Cloud SQL
12. CI/CD (build, scan, deploy), policy checks (SAST, dependency scanning)

---
