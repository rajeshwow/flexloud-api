import bcrypt from "bcryptjs";
import type { Request, Response } from "express";
import { pool } from "../../db/pool";
import {
  bootstrapTenantSchema,
  createTenantSchema,
  tenantIdParamSchema,
  tenantListQuerySchema,
  updateTenantPermissionsSchema,
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

const normalizePermissionCodes = (permissionCodes: string[]) => {
  return Array.from(
    new Set(
      permissionCodes
        .map((code) => String(code || "").trim())
        .filter((code) => code.length > 0),
    ),
  );
};

const groupPermissionsByModule = (items: any[]) => {
  const moduleMap = new Map<string, any>();

  for (const item of items) {
    const moduleKey = item.module_key || "system";
    const subModuleKey = item.sub_module_key || item.module_key || "general";

    if (!moduleMap.has(moduleKey)) {
      moduleMap.set(moduleKey, {
        module_key: moduleKey,
        module_label: item.module_label || moduleKey,
        module_sort_order: item.module_sort_order ?? 999,
        sub_modules: new Map<string, any>(),
        permissions: [],
      });
    }

    const moduleItem = moduleMap.get(moduleKey);

    if (!moduleItem.sub_modules.has(subModuleKey)) {
      moduleItem.sub_modules.set(subModuleKey, {
        sub_module_key: subModuleKey,
        sub_module_label: item.sub_module_label || subModuleKey,
        sub_module_sort_order: item.sub_module_sort_order ?? 999,
        permissions: [],
      });
    }

    moduleItem.sub_modules.get(subModuleKey).permissions.push(item);
    moduleItem.permissions.push(item);
  }

  return Array.from(moduleMap.values())
    .sort((a, b) => {
      if (a.module_sort_order !== b.module_sort_order) {
        return a.module_sort_order - b.module_sort_order;
      }

      return String(a.module_label || "").localeCompare(
        String(b.module_label || ""),
      );
    })
    .map((moduleItem) => ({
      ...moduleItem,
      sub_modules: Array.from(moduleItem.sub_modules.values()).sort(
        (a: any, b: any) => {
          if (a.sub_module_sort_order !== b.sub_module_sort_order) {
            return a.sub_module_sort_order - b.sub_module_sort_order;
          }

          return String(a.sub_module_label || "").localeCompare(
            String(b.sub_module_label || ""),
          );
        },
      ),
    }));
};

const permissionSelectSql = `
  p.code,
  p.description,
  p.module_key,
  p.module_label,
  p.sub_module_key,
  p.sub_module_label,
  p.action_key,
  p.action_label,
  p.module_sort_order,
  p.sub_module_sort_order,
  p.action_sort_order,
  p.is_active,
  p.created_at,
  p.updated_at
`;

const permissionOrderSql = `
  COALESCE(p.module_sort_order, 999) ASC,
  COALESCE(p.module_label, p.module_key, 'Other') ASC,
  COALESCE(p.sub_module_sort_order, 999) ASC,
  COALESCE(p.sub_module_label, p.sub_module_key, 'General') ASC,
  COALESCE(p.action_sort_order, 999) ASC,
  COALESCE(p.action_label, p.action_key, p.code) ASC,
  p.code ASC
`;

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
    const where: string[] = [`t.deleted_at IS NULL`];

    if (search) {
      params.push(`%${search.trim()}%`);
      where.push(
        `(t.name ILIKE $${params.length} OR t.slug ILIKE $${params.length})`,
      );
    }

    if (status) {
      params.push(status);
      where.push(`t.status = $${params.length}`);
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const countParams = [...params];

    params.push(limit);
    const limitIndex = params.length;

    params.push(offset);
    const offsetIndex = params.length;

    const listQuery = `
      SELECT
        t.id,
        t.name,
        t.slug,
        t.status,
        t.is_bootstrapped,
        t.bootstrapped_at,
        t.created_at,
        t.updated_at,
        COALESCE((
          SELECT COUNT(*)::int
          FROM tenant_permission_allowlist tpa
          WHERE tpa.tenant_id = t.id
            AND tpa.deleted_at IS NULL
            AND tpa.is_active = true
        ), 0) AS allowed_permission_count
      FROM tenants t
      ${whereSql}
      ORDER BY t.created_at DESC
      LIMIT $${limitIndex}
      OFFSET $${offsetIndex}
    `;

    const countQuery = `
      SELECT COUNT(*)::int AS total
      FROM tenants t
      ${whereSql}
    `;

    const [listResult, countResult] = await Promise.all([
      pool.query(listQuery, params),
      pool.query(countQuery, countParams),
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
    const parsedParams = tenantIdParamSchema.safeParse(req.params);

    if (!parsedParams.success) {
      return response(
        res,
        400,
        "Validation failed",
        parsedParams.error.flatten(),
      );
    }

    const { tenantId } = parsedParams.data;

    const result = await pool.query(
      `
      SELECT
        t.id,
        t.name,
        t.slug,
        t.status,
        t.is_bootstrapped,
        t.bootstrapped_at,
        t.created_at,
        t.updated_at,
        COALESCE((
          SELECT COUNT(*)::int
          FROM tenant_permission_allowlist tpa
          WHERE tpa.tenant_id = t.id
            AND tpa.deleted_at IS NULL
            AND tpa.is_active = true
        ), 0) AS allowed_permission_count
      FROM tenants t
      WHERE t.id = $1
        AND t.deleted_at IS NULL
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
    const parsedParams = tenantIdParamSchema.safeParse(req.params);

    if (!parsedParams.success) {
      return response(
        res,
        400,
        "Validation failed",
        parsedParams.error.flatten(),
      );
    }

    const { tenantId } = parsedParams.data;
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

export async function getPermissionCatalog(req: Request, res: Response) {
  try {
    const result = await pool.query(
      `
      SELECT
        ${permissionSelectSql}
      FROM permissions p
      WHERE p.is_active = true
      ORDER BY ${permissionOrderSql}
      `,
    );

    return response(res, 200, "Permission catalog fetched successfully", {
      items: result.rows,
      grouped: groupPermissionsByModule(result.rows),
    });
  } catch (error: any) {
    console.error("getPermissionCatalog error:", error);

    return response(res, 500, "Failed to fetch permission catalog", {
      error: error?.message,
    });
  }
}

export async function getTenantPermissions(req: Request, res: Response) {
  try {
    const parsedParams = tenantIdParamSchema.safeParse(req.params);

    if (!parsedParams.success) {
      return response(
        res,
        400,
        "Validation failed",
        parsedParams.error.flatten(),
      );
    }

    const { tenantId } = parsedParams.data;

    const tenantResult = await pool.query(
      `
      SELECT id, name, slug, status, is_bootstrapped
      FROM tenants
      WHERE id = $1
        AND deleted_at IS NULL
      LIMIT 1
      `,
      [tenantId],
    );

    if (!tenantResult.rowCount) {
      return response(res, 404, "Tenant not found", null);
    }

    const permissionsResult = await pool.query(
      `
      SELECT
        ${permissionSelectSql},
        CASE WHEN tpa.id IS NULL THEN false ELSE true END AS is_allowed
      FROM permissions p
      LEFT JOIN tenant_permission_allowlist tpa
        ON tpa.permission_code = p.code
       AND tpa.tenant_id = $1
       AND tpa.deleted_at IS NULL
       AND tpa.is_active = true
      WHERE p.is_active = true
      ORDER BY ${permissionOrderSql}
      `,
      [tenantId],
    );

    const allowedPermissionCodes = permissionsResult.rows
      .filter((item) => item.is_allowed)
      .map((item) => item.code);

    return response(res, 200, "Tenant permissions fetched successfully", {
      tenant: tenantResult.rows[0],
      allowedPermissionCodes,
      allowedPermissionCount: allowedPermissionCodes.length,
      items: permissionsResult.rows,
      grouped: groupPermissionsByModule(permissionsResult.rows),
    });
  } catch (error: any) {
    console.error("getTenantPermissions error:", error);

    return response(res, 500, "Failed to fetch tenant permissions", {
      error: error?.message,
    });
  }
}

export async function updateTenantPermissions(req: Request, res: Response) {
  const client = await pool.connect();

  try {
    const parsedParams = tenantIdParamSchema.safeParse(req.params);

    if (!parsedParams.success) {
      return response(
        res,
        400,
        "Validation failed",
        parsedParams.error.flatten(),
      );
    }

    const parsedBody = updateTenantPermissionsSchema.safeParse(req.body);

    if (!parsedBody.success) {
      return response(
        res,
        400,
        "Validation failed",
        parsedBody.error.flatten(),
      );
    }

    const { tenantId } = parsedParams.data;
    const superAdminId = (req as any).user?.id || null;
    const permissionCodes = normalizePermissionCodes(
      parsedBody.data.permissionCodes || [],
    );

    await client.query("BEGIN");

    const tenantResult = await client.query(
      `
      SELECT id, name, slug, status, is_bootstrapped
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

    if (permissionCodes.length) {
      const validPermissionsResult = await client.query(
        `
        SELECT code
        FROM permissions
        WHERE code = ANY($1::text[])
          AND is_active = true
        `,
        [permissionCodes],
      );

      const validSet = new Set(
        validPermissionsResult.rows.map((row) => row.code),
      );
      const invalidCodes = permissionCodes.filter(
        (code) => !validSet.has(code),
      );

      if (invalidCodes.length) {
        await client.query("ROLLBACK");

        return response(res, 400, "Invalid permission codes found", {
          invalidCodes,
        });
      }
    }

    if (permissionCodes.length) {
      await client.query(
        `
        INSERT INTO tenant_permission_allowlist (
          tenant_id,
          permission_code,
          is_active,
          created_by,
          updated_by,
          deleted_at
        )
        SELECT
          $1,
          selected.permission_code,
          true,
          $3,
          $3,
          NULL
        FROM unnest($2::text[]) AS selected(permission_code)
        ON CONFLICT (tenant_id, permission_code)
        WHERE deleted_at IS NULL
        DO UPDATE SET
          is_active = true,
          updated_by = EXCLUDED.updated_by,
          updated_at = now(),
          deleted_at = NULL
        `,
        [tenantId, permissionCodes, superAdminId],
      );
    }

    const disabledAllowlistResult = await client.query(
      `
      UPDATE tenant_permission_allowlist
      SET
        is_active = false,
        deleted_at = COALESCE(deleted_at, now()),
        updated_by = $3,
        updated_at = now()
      WHERE tenant_id = $1
        AND deleted_at IS NULL
        AND NOT (permission_code = ANY($2::text[]))
      RETURNING permission_code
      `,
      [tenantId, permissionCodes, superAdminId],
    );

    const removedRolePermissionsResult = await client.query(
      `
      DELETE FROM role_permissions rp
      USING roles r
      WHERE rp.role_id = r.id
        AND r.tenant_id = $1
        AND r.deleted_at IS NULL
        AND NOT (rp.permission_code = ANY($2::text[]))
      RETURNING rp.permission_code
      `,
      [tenantId, permissionCodes],
    );

    let addedTenantAdminPermissionsCount = 0;

    if (permissionCodes.length) {
      const addedTenantAdminPermissionsResult = await client.query(
        `
        INSERT INTO role_permissions (
          role_id,
          permission_code
        )
        SELECT
          r.id,
          selected.permission_code
        FROM roles r
        JOIN unnest($2::text[]) AS selected(permission_code)
          ON true
        WHERE r.tenant_id = $1
          AND r.deleted_at IS NULL
          AND r.is_active = true
          AND r.system_key = 'tenant_admin'
          AND NOT EXISTS (
            SELECT 1
            FROM role_permissions rp
            WHERE rp.role_id = r.id
              AND rp.permission_code = selected.permission_code
          )
        RETURNING permission_code
        `,
        [tenantId, permissionCodes],
      );

      addedTenantAdminPermissionsCount =
        addedTenantAdminPermissionsResult.rowCount || 0;
    }

    const finalAllowedResult = await client.query(
      `
      SELECT
        ${permissionSelectSql}
      FROM tenant_permission_allowlist tpa
      JOIN permissions p
        ON p.code = tpa.permission_code
      WHERE tpa.tenant_id = $1
        AND tpa.deleted_at IS NULL
        AND tpa.is_active = true
        AND p.is_active = true
      ORDER BY ${permissionOrderSql}
      `,
      [tenantId],
    );

    await client.query("COMMIT");

    return response(res, 200, "Tenant permissions updated successfully", {
      tenant: tenantResult.rows[0],
      allowedPermissionCodes: finalAllowedResult.rows.map((row) => row.code),
      allowedPermissionCount: finalAllowedResult.rowCount,
      removedAllowlistCount: disabledAllowlistResult.rowCount || 0,
      removedRolePermissionCount: removedRolePermissionsResult.rowCount || 0,
      addedTenantAdminPermissionCount: addedTenantAdminPermissionsCount,
      items: finalAllowedResult.rows,
      grouped: groupPermissionsByModule(finalAllowedResult.rows),
    });
  } catch (error: any) {
    await client.query("ROLLBACK");
    console.error("updateTenantPermissions error:", error);

    return response(res, 500, "Failed to update tenant permissions", {
      error: error?.message,
    });
  } finally {
    client.release();
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
    const parsedParams = tenantIdParamSchema.safeParse(req.params);

    if (!parsedParams.success) {
      return response(
        res,
        400,
        "Validation failed",
        parsedParams.error.flatten(),
      );
    }

    const { tenantId } = parsedParams.data;
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
      SELECT id, tenant_id, name, code, system_key
      FROM roles
      WHERE tenant_id = $1
        AND system_key = 'tenant_admin'
        AND deleted_at IS NULL
      ORDER BY created_at ASC
      LIMIT 1
      `,
      [tenantId],
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
          is_protected = true,
          system_key = 'tenant_admin',
          is_active = true,
          updated_by = $5,
          updated_at = now()
        WHERE tenant_id = $1
          AND id = $2
          AND deleted_at IS NULL
        RETURNING id, tenant_id, name, code, system_key
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
          is_protected,
          system_key,
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
          'tenant_admin',
          true,
          $5,
          $5
        )
        RETURNING id, tenant_id, name, code, system_key
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
      VALUES ($1, 'default_role', 'Default Role Created', 'success', 'Admin role created/updated', now(), $2)
      `,
      [tenantId, superAdminId],
    );

    const allowedPermissionResult = await client.query(
      `
      INSERT INTO role_permissions (role_id, permission_code)
      SELECT
        $1,
        tpa.permission_code
      FROM tenant_permission_allowlist tpa
      JOIN permissions p
        ON p.code = tpa.permission_code
      WHERE tpa.tenant_id = $2
        AND tpa.deleted_at IS NULL
        AND tpa.is_active = true
        AND p.is_active = true
        AND NOT EXISTS (
          SELECT 1
          FROM role_permissions rp
          WHERE rp.role_id = $1
            AND rp.permission_code = tpa.permission_code
        )
      RETURNING permission_code
      `,
      [adminRole.id, tenantId],
    );

    const assignedPermissionCount = allowedPermissionResult.rowCount || 0;

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
      VALUES ($1, 'role_permissions', 'Role Permissions Assigned', 'success', $2, $3, now(), $4)
      `,
      [
        tenantId,
        assignedPermissionCount
          ? `${assignedPermissionCount} allowed permissions assigned to Admin role`
          : "No permissions selected for this tenant. Admin role created without CRM permissions.",
        JSON.stringify({
          assignedPermissionCount,
        }),
        superAdminId,
      ],
    );

    const passwordHash = await bcrypt.hash(adminPassword, 10);

    const adminUserRole = adminRole.code || "tenant_admin";
    const existingAdminUserResult = await client.query(
      `
      SELECT id, tenant_id, name, email, role
      FROM public.users
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
      assignedPermissionCount,
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
    const parsedParams = tenantIdParamSchema.safeParse(req.params);

    if (!parsedParams.success) {
      return response(
        res,
        400,
        "Validation failed",
        parsedParams.error.flatten(),
      );
    }

    const { tenantId } = parsedParams.data;

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
