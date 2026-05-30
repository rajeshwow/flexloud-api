import { NextFunction, Request, Response } from "express";
import { pool } from "../db/pool";

type TenantStatus = "active" | "inactive" | "suspended";

type ResolvedTenant = {
  id: string;
  slug: string;
  name: string;
  status: TenantStatus;
};

function tenantInactiveError(tenant?: ResolvedTenant) {
  return Object.assign(
    new Error("Tenant is inactive. Please contact administrator."),
    {
      statusCode: 403,
      code: "TENANT_INACTIVE",
      response: {
        statusCode: 403,
        message: "Tenant is inactive. Please contact administrator.",
        code: "TENANT_INACTIVE",
        data: {
          tenant: tenant
            ? {
                id: tenant.id,
                slug: tenant.slug,
                name: tenant.name,
                status: tenant.status,
              }
            : null,
        },
      },
    },
  );
}

function tenantNotFoundError() {
  return Object.assign(new Error("Invalid tenant"), {
    statusCode: 404,
    code: "TENANT_NOT_FOUND",
    response: {
      statusCode: 404,
      message: "Invalid tenant",
      code: "TENANT_NOT_FOUND",
      data: null,
    },
  });
}

function tenantSlugMissingError() {
  return Object.assign(new Error("Tenant slug missing"), {
    statusCode: 400,
    code: "TENANT_SLUG_MISSING",
    response: {
      statusCode: 400,
      message: "Tenant slug missing",
      code: "TENANT_SLUG_MISSING",
      data: null,
    },
  });
}

function tenantContextMissingError() {
  return Object.assign(new Error("Tenant context missing"), {
    statusCode: 400,
    code: "TENANT_CONTEXT_MISSING",
    response: {
      statusCode: 400,
      message: "Tenant context missing",
      code: "TENANT_CONTEXT_MISSING",
      data: null,
    },
  });
}

function isTenantActive(tenant: ResolvedTenant) {
  return String(tenant.status || "").toLowerCase() === "active";
}

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
    throw tenantContextMissingError();
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

    /*
      Important:
      This middleware is for tenant-scoped CRM APIs only.
      Super-admin routes should NOT use this middleware,
      otherwise inactive tenants cannot be reactivated from admin panel.
    */

    // 1) Prefer tenant id from header
    if (headerTenantId) {
      const { rows } = await pool.query<ResolvedTenant>(
        `
        SELECT id, slug, name, COALESCE(status, 'active') AS status
        FROM public.tenants
        WHERE id = $1
          AND deleted_at IS NULL
        LIMIT 1
        `,
        [headerTenantId],
      );

      const tenant = rows[0];

      if (!tenant) {
        return next(tenantNotFoundError());
      }

      if (!isTenantActive(tenant)) {
        return next(tenantInactiveError(tenant));
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
      return next(tenantSlugMissingError());
    }

    const { rows } = await pool.query<ResolvedTenant>(
      `
      SELECT id, slug, name, COALESCE(status, 'active') AS status
      FROM public.tenants
      WHERE lower(slug) = lower($1)
        AND deleted_at IS NULL
      LIMIT 1
      `,
      [slug],
    );

    const tenant = rows[0];

    if (!tenant) {
      return next(tenantNotFoundError());
    }

    if (!isTenantActive(tenant)) {
      return next(tenantInactiveError(tenant));
    }

    (req as any).tenant = tenant;
    (req as any).tenantId = tenant.id;
    return next();
  } catch (error) {
    return next(error);
  }
}
