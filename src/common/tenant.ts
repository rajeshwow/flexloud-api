import { NextFunction, Request, Response } from "express";
import { pool } from "../db/pool";

export function getTenantId(req: any): string {
  const tid =
    req?.tenant?.id ||
    req?.tenantId ||
    req?.tenant_id ||
    req?.context?.tenantId ||
    req?.context?.tenant_id ||
    req?.user?.tenantId ||
    req?.user?.tenant_id ||
    req?.auth?.tenantId ||
    req?.auth?.tenant_id ||
    req?.headers?.["x-tenant-id"] ||
    req?.headers?.["x-tenantid"] ||
    req?.headers?.["x-tenant"];

  if (!tid) {
    const err: any = new Error("Tenant context missing");
    err.statusCode = 400;
    throw err;
  }

  return String(tid);
}

export async function resolveTenant(
  req: Request,
  _res: Response,
  next: NextFunction,
) {
  try {
    const headerTenantId =
      (req.headers["x-tenant-id"] as string) ||
      (req.headers["x-tenantid"] as string) ||
      (req.headers["x-tenant"] as string);

    // 1) Prefer tenant id from header
    if (headerTenantId) {
      const { rows } = await pool.query(
        `SELECT id, slug, name FROM tenants WHERE id = $1 LIMIT 1`,
        [headerTenantId],
      );

      const tenant = rows[0];

      if (!tenant) {
        return next(
          Object.assign(new Error("Invalid tenant"), { statusCode: 404 }),
        );
      }

      (req as any).tenant = tenant;
      (req as any).tenantId = tenant.id;
      return next();
    }

    // 2) Fallback to slug from route params
    const slug = String(req.params.slug || "")
      .toLowerCase()
      .trim();

    if (!slug) {
      return next(
        Object.assign(new Error("Tenant slug missing"), { statusCode: 400 }),
      );
    }

    const { rows } = await pool.query(
      `SELECT id, slug, name FROM tenants WHERE slug = $1 LIMIT 1`,
      [slug],
    );

    const tenant = rows[0];

    if (!tenant) {
      return next(
        Object.assign(new Error("Invalid tenant"), { statusCode: 404 }),
      );
    }

    (req as any).tenant = tenant;
    (req as any).tenantId = tenant.id;
    return next();
  } catch (error) {
    return next(error);
  }
}
