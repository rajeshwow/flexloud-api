import bcrypt from "bcryptjs";
import type { Request, Response } from "express";
import { pool } from "../../db/pool";
import {
  bootstrapTenantSchema,
  createTenantSchema,
  tenantListQuerySchema,
  updateTenantStatusSchema,
} from "./admin-tenants.schema";

const response = (
  res: Response,
  statusCode: number,
  message: string,
  data: any = null,
) => {
  return res.status(statusCode).json({
    statusCode,
    message,
    data,
  });
};

const normalizeSlug = (slug: string) => {
  return slug.trim().toLowerCase().replace(/\s+/g, "-");
};

export async function createTenant(req: Request, res: Response) {
  const client = await pool.connect();

  try {
    const parsed = createTenantSchema.safeParse(req.body);

    if (!parsed.success) {
      return response(res, 400, "Validation failed", parsed.error.flatten());
    }

    const userId = (req as any).user?.id || null;
    const name = parsed.data.name.trim();
    const slug = normalizeSlug(parsed.data.slug);

    await client.query("BEGIN");

    const exists = await client.query(
      `
      SELECT id
      FROM tenants
      WHERE slug = $1
        AND deleted_at IS NULL
      LIMIT 1
      `,
      [slug],
    );

    if (exists.rowCount) {
      await client.query("ROLLBACK");
      return response(res, 409, "Tenant slug already exists", null);
    }

    const result = await client.query(
      `
      INSERT INTO tenants (
        name,
        slug,
        status,
        created_by,
        updated_by
      )
      VALUES ($1, $2, 'inactive', $3, $3)
      RETURNING
        id,
        name,
        slug,
        status,
        is_bootstrapped,
        created_at,
        updated_at
      `,
      [name, slug, userId],
    );

    await client.query("COMMIT");

    return response(res, 201, "Tenant created successfully", result.rows[0]);
  } catch (error: any) {
    await client.query("ROLLBACK");
    console.error("createTenant error:", error);

    return response(res, 500, "Failed to create tenant", {
      error: error?.message,
    });
  } finally {
    client.release();
  }
}

export async function getTenants(req: Request, res: Response) {
  try {
    const parsed = tenantListQuerySchema.safeParse(req.query);

    if (!parsed.success) {
      return response(res, 400, "Validation failed", parsed.error.flatten());
    }

    const { search, status, page, limit } = parsed.data;
    const offset = (page - 1) * limit;

    const params: any[] = [];
    const where: string[] = [`deleted_at IS NULL`];

    if (search) {
      params.push(`%${search.trim()}%`);
      where.push(
        `(name ILIKE $${params.length} OR slug ILIKE $${params.length})`,
      );
    }

    if (status) {
      params.push(status);
      where.push(`status = $${params.length}`);
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    params.push(limit);
    const limitIndex = params.length;

    params.push(offset);
    const offsetIndex = params.length;

    const listQuery = `
      SELECT
        id,
        name,
        slug,
        status,
        is_bootstrapped,
        bootstrapped_at,
        created_at,
        updated_at
      FROM tenants
      ${whereSql}
      ORDER BY created_at DESC
      LIMIT $${limitIndex}
      OFFSET $${offsetIndex}
    `;

    const countQuery = `
      SELECT COUNT(*)::int AS total
      FROM tenants
      ${whereSql}
    `;

    const [listResult, countResult] = await Promise.all([
      pool.query(listQuery, params),
      pool.query(countQuery, params.slice(0, params.length - 2)),
    ]);

    return response(res, 200, "Tenants fetched successfully", {
      items: listResult.rows,
      pagination: {
        page,
        limit,
        total: countResult.rows[0]?.total || 0,
      },
    });
  } catch (error: any) {
    console.error("getTenants error:", error);

    return response(res, 500, "Failed to fetch tenants", {
      error: error?.message,
    });
  }
}

export async function getTenantById(req: Request, res: Response) {
  try {
    const { tenantId } = req.params;

    const result = await pool.query(
      `
      SELECT
        id,
        name,
        slug,
        status,
        is_bootstrapped,
        bootstrapped_at,
        created_at,
        updated_at
      FROM tenants
      WHERE id = $1
        AND deleted_at IS NULL
      LIMIT 1
      `,
      [tenantId],
    );

    if (!result.rowCount) {
      return response(res, 404, "Tenant not found", null);
    }

    return response(res, 200, "Tenant fetched successfully", result.rows[0]);
  } catch (error: any) {
    console.error("getTenantById error:", error);

    return response(res, 500, "Failed to fetch tenant", {
      error: error?.message,
    });
  }
}

export async function updateTenantStatus(req: Request, res: Response) {
  try {
    const { tenantId } = req.params;
    const parsed = updateTenantStatusSchema.safeParse(req.body);

    if (!parsed.success) {
      return response(res, 400, "Validation failed", parsed.error.flatten());
    }

    const userId = (req as any).user?.id || null;

    const result = await pool.query(
      `
      UPDATE tenants
      SET
        status = $1,
        updated_by = $2,
        updated_at = now()
      WHERE id = $3
        AND deleted_at IS NULL
      RETURNING
        id,
        name,
        slug,
        status,
        is_bootstrapped,
        updated_at
      `,
      [parsed.data.status, userId, tenantId],
    );

    if (!result.rowCount) {
      return response(res, 404, "Tenant not found", null);
    }

    return response(
      res,
      200,
      "Tenant status updated successfully",
      result.rows[0],
    );
  } catch (error: any) {
    console.error("updateTenantStatus error:", error);

    return response(res, 500, "Failed to update tenant status", {
      error: error?.message,
    });
  }
}

async function logBootstrapStep(params: {
  tenantId: string;
  stepKey: string;
  stepName: string;
  status: "running" | "success" | "failed" | "skipped";
  message?: string;
  rawPayload?: any;
  createdBy?: string | null;
}) {
  await pool.query(
    `
    INSERT INTO tenant_bootstrap_logs (
      tenant_id,
      step_key,
      step_name,
      status,
      message,
      raw_payload,
      started_at,
      completed_at,
      created_by
    )
    VALUES (
      $1,
      $2,
      $3,
      $4,
      $5,
      $6,
      CASE WHEN $4 = 'running' THEN now() ELSE NULL END,
      CASE WHEN $4 IN ('success', 'failed', 'skipped') THEN now() ELSE NULL END,
      $7
    )
    `,
    [
      params.tenantId,
      params.stepKey,
      params.stepName,
      params.status,
      params.message || null,
      params.rawPayload ? JSON.stringify(params.rawPayload) : null,
      params.createdBy || null,
    ],
  );
}

export async function bootstrapTenant(req: Request, res: Response) {
  const client = await pool.connect();

  try {
    const { tenantId } = req.params;
    const parsed = bootstrapTenantSchema.safeParse(req.body);

    if (!parsed.success) {
      return response(res, 400, "Validation failed", parsed.error.flatten());
    }

    const superAdminId = (req as any).user?.id || null;
    const { adminEmail, adminName, adminPassword } = parsed.data;

    await client.query("BEGIN");

    const tenantResult = await client.query(
      `
      SELECT id, name, slug, is_bootstrapped
      FROM tenants
      WHERE id = $1
        AND deleted_at IS NULL
      LIMIT 1
      `,
      [tenantId],
    );

    if (!tenantResult.rowCount) {
      await client.query("ROLLBACK");
      return response(res, 404, "Tenant not found", null);
    }

    const tenant = tenantResult.rows[0];

    if (tenant.is_bootstrapped) {
      await client.query("ROLLBACK");
      return response(res, 409, "Tenant is already bootstrapped", tenant);
    }

    await client.query(
      `
      INSERT INTO tenant_bootstrap_logs (
        tenant_id,
        step_key,
        step_name,
        status,
        message,
        started_at,
        created_by
      )
      VALUES ($1, 'bootstrap_started', 'Bootstrap Started', 'running', 'Tenant bootstrap started', now(), $2)
      `,
      [tenantId, superAdminId],
    );

    const existingRoleResult = await client.query(
      `
  SELECT id, tenant_id, name, code
  FROM roles
  WHERE tenant_id = $1
    AND code = $2
    AND deleted_at IS NULL
  LIMIT 1
  `,
      [tenantId, "tenant_admin"],
    );

    let adminRole = existingRoleResult.rows[0];

    if (adminRole) {
      const updatedRoleResult = await client.query(
        `
    UPDATE roles
    SET
      name = $3,
      description = $4,
      is_system = true,
      is_active = true,
      updated_by = $5,
      updated_at = now()
    WHERE tenant_id = $1
      AND id = $2
      AND deleted_at IS NULL
    RETURNING id, tenant_id, name, code
    `,
        [
          tenantId,
          adminRole.id,
          "Admin",
          "Default tenant admin role",
          superAdminId,
        ],
      );

      adminRole = updatedRoleResult.rows[0];
    } else {
      const createdRoleResult = await client.query(
        `
    INSERT INTO roles (
      tenant_id,
      name,
      code,
      description,
      is_system,
      is_active,
      created_by,
      updated_by
    )
    VALUES (
      $1,
      $2,
      $3,
      $4,
      true,
      true,
      $5,
      $5
    )
    RETURNING id, tenant_id, name, code
    `,
        [
          tenantId,
          "Admin",
          "tenant_admin",
          "Default tenant admin role",
          superAdminId,
        ],
      );

      adminRole = createdRoleResult.rows[0];
    }

    await client.query(
      `
      INSERT INTO tenant_bootstrap_logs (
        tenant_id,
        step_key,
        step_name,
        status,
        message,
        completed_at,
        created_by
      )
VALUES ($1, 'default_role', 'Default Role Created', 'success', 'Admin role created/updated', now(), $2)      `,
      [tenantId, superAdminId],
    );

    await client.query(
      `
  INSERT INTO role_permissions (role_id, permission_code)
  SELECT $1, p.code
  FROM permissions p
  WHERE NOT EXISTS (
    SELECT 1
    FROM role_permissions rp
    WHERE rp.role_id = $1
      AND rp.permission_code = p.code
  )
  `,
      [adminRole.id],
    );

    await client.query(
      `
      INSERT INTO tenant_bootstrap_logs (
        tenant_id,
        step_key,
        step_name,
        status,
        message,
        completed_at,
        created_by
      )
      VALUES ($1, 'role_permissions', 'Role Permissions Assigned', 'success', 'All permissions assigned to Admin role', now(), $2)
      `,
      [tenantId, superAdminId],
    );

    const passwordHash = await bcrypt.hash(adminPassword, 10);

    const adminUserRole = adminRole.code || "tenant_admin";
    const existingAdminUserResult = await client.query(
      `
  SELECT id, tenant_id, name, email, role
  FROM users
  WHERE tenant_id = $1
    AND lower(email) = lower($2)
    AND deleted_at IS NULL
  LIMIT 1
  `,
      [tenantId, adminEmail.trim()],
    );

    let adminUser = existingAdminUserResult.rows[0];

    if (adminUser) {
      const updatedAdminUserResult = await client.query(
        `
    UPDATE users
    SET
      name = $3,
      email = lower($4),
      password_hash = $5,
      role = $6,
      is_super_admin = false,
      is_active = true,
      updated_by = $7,
      updated_at = now()
    WHERE tenant_id = $1
      AND id = $2
      AND deleted_at IS NULL
    RETURNING id, tenant_id, name, email, role
    `,
        [
          tenantId,
          adminUser.id,
          adminName.trim(),
          adminEmail.trim().toLowerCase(),
          passwordHash,
          adminUserRole,
          superAdminId,
        ],
      );

      adminUser = updatedAdminUserResult.rows[0];
    } else {
      const createdAdminUserResult = await client.query(
        `
    INSERT INTO users (
      tenant_id,
      name,
      email,
      password_hash,
      role,
      is_super_admin,
      is_active,
      created_by,
      updated_by
    )
    VALUES (
      $1,
      $2,
      lower($3),
      $4,
      $5,
      false,
      true,
      $6,
      $6
    )
    RETURNING id, tenant_id, name, email, role
    `,
        [
          tenantId,
          adminName.trim(),
          adminEmail.trim().toLowerCase(),
          passwordHash,
          adminUserRole,
          superAdminId,
        ],
      );

      adminUser = createdAdminUserResult.rows[0];
    }

    await client.query(
      `
  INSERT INTO user_roles (
    user_id,
    tenant_id,
    role_id
  )
  SELECT $1, $2, $3
  WHERE NOT EXISTS (
    SELECT 1
    FROM user_roles ur
    WHERE ur.user_id = $1
      AND ur.tenant_id = $2
      AND ur.role_id = $3
  )
  `,
      [adminUser.id, tenantId, adminRole.id],
    );

    await client.query(
      `
      INSERT INTO tenant_bootstrap_logs (
        tenant_id,
        step_key,
        step_name,
        status,
        message,
        raw_payload,
        completed_at,
        created_by
      )
      VALUES ($1, 'admin_user', 'Admin User Created', 'success', 'Tenant admin user created', $2, now(), $3)
      `,
      [
        tenantId,
        JSON.stringify({
          adminEmail: adminUser.email,
          adminName: adminUser.name,
        }),
        superAdminId,
      ],
    );

    await client.query(
      `
  UPDATE tenants
  SET
    is_bootstrapped = true,
    bootstrapped_at = now(),
    bootstrapped_by = $2,
    bootstrap_status = 'completed',
    updated_by = $2,
    updated_at = now()
  WHERE id = $1
  `,
      [tenantId, superAdminId],
    );

    await client.query(
      `
      INSERT INTO tenant_bootstrap_logs (
        tenant_id,
        step_key,
        step_name,
        status,
        message,
        completed_at,
        created_by
      )
      VALUES ($1, 'bootstrap_completed', 'Bootstrap Completed', 'success', 'Tenant bootstrap completed successfully', now(), $2)
      `,
      [tenantId, superAdminId],
    );

    await client.query("COMMIT");

    return response(res, 200, "Tenant bootstrapped successfully", {
      tenantId,
      tenantName: tenant.name,
      tenantSlug: tenant.slug,
      adminUser: {
        id: adminUser.id,
        name: adminUser.name,
        email: adminUser.email,
      },
      adminRole,
      passwordConfigured: true,
    });
  } catch (error: any) {
    await client.query("ROLLBACK");
    console.error("bootstrapTenant error:", error);

    try {
      await logBootstrapStep({
        tenantId: req.params.tenantId,
        stepKey: "bootstrap_failed",
        stepName: "Bootstrap Failed",
        status: "failed",
        message: error?.message || "Bootstrap failed",
        rawPayload: { error },
        createdBy: (req as any).user?.id || null,
      });
    } catch {}

    return response(res, 500, "Failed to bootstrap tenant", {
      error: error?.message,
    });
  } finally {
    client.release();
  }
}

export async function getTenantBootstrapLogs(req: Request, res: Response) {
  try {
    const { tenantId } = req.params;

    const result = await pool.query(
      `
      SELECT
        id,
        step_key,
        step_name,
        status,
        message,
        raw_payload,
        started_at,
        completed_at,
        created_at
      FROM tenant_bootstrap_logs
      WHERE tenant_id = $1
      ORDER BY created_at ASC
      `,
      [tenantId],
    );

    return response(
      res,
      200,
      "Bootstrap logs fetched successfully",
      result.rows,
    );
  } catch (error: any) {
    console.error("getTenantBootstrapLogs error:", error);

    return response(res, 500, "Failed to fetch bootstrap logs", {
      error: error?.message,
    });
  }
}
