import { NextFunction, Response } from "express";
import { z } from "zod";
import { getPagination } from "../../common/pagination";
import { getTenantId } from "../../common/tenant";
import { pool } from "../../db/pool";
import {
  CloneRoleSchema,
  CreateRoleSchema,
  UpdateRoleSchema,
  UpdateUserRolesSchema,
} from "./rbac.schema";

const normalizeRoleCode = (value: string) => {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized || "role";
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

async function assertPermissionsAllowed(
  db: any,
  tenantId: string,
  permissionCodes: string[],
) {
  const normalizedCodes = normalizePermissionCodes(permissionCodes);

  if (!normalizedCodes.length) {
    return [];
  }

  const allowedRes = await db.query(
    `
    SELECT p.code
    FROM tenant_permission_allowlist tpa
    JOIN permissions p
      ON p.code = tpa.permission_code
    WHERE tpa.tenant_id = $1
      AND tpa.permission_code = ANY($2::text[])
      AND tpa.deleted_at IS NULL
      AND tpa.is_active = true
      AND p.is_active = true
    `,
    [tenantId, normalizedCodes],
  );

  const allowedSet = new Set(allowedRes.rows.map((row: any) => row.code));
  const invalidPermissionCodes = normalizedCodes.filter(
    (code) => !allowedSet.has(code),
  );

  if (invalidPermissionCodes.length) {
    const err: any = new Error(
      "One or more permissions are not allowed for this tenant",
    );
    err.statusCode = 400;
    err.details = {
      invalidPermissionCodes,
    };
    throw err;
  }

  return normalizedCodes;
}

async function insertRolePermissions(
  db: any,
  roleId: string,
  permissionCodes: string[],
) {
  const normalizedCodes = normalizePermissionCodes(permissionCodes);

  if (!normalizedCodes.length) {
    return 0;
  }

  const result = await db.query(
    `
    INSERT INTO role_permissions (
      role_id,
      permission_code
    )
    SELECT
      $1,
      selected.permission_code
    FROM unnest($2::text[]) AS selected(permission_code)
    WHERE NOT EXISTS (
      SELECT 1
      FROM role_permissions rp
      WHERE rp.role_id = $1
        AND rp.permission_code = selected.permission_code
    )
    RETURNING permission_code
    `,
    [roleId, normalizedCodes],
  );

  return result.rowCount || 0;
}

export const rbacService = {
  async getPermissionGroups(tenantId: string) {
    const { rows } = await pool.query(
      `
      SELECT
        p.code,
        p.description,
        p.module_key,
        p.action_key,
        p.is_active
      FROM tenant_permission_allowlist tpa
      JOIN permissions p
        ON p.code = tpa.permission_code
      WHERE tpa.tenant_id = $1
        AND tpa.deleted_at IS NULL
        AND tpa.is_active = true
        AND p.is_active = true
      ORDER BY
        COALESCE(p.module_key, 'other') ASC,
        COALESCE(p.action_key, '') ASC,
        p.code ASC
      `,
      [tenantId],
    );

    const map = new Map<string, any>();

    for (const row of rows) {
      const moduleKey = row.module_key || "other";

      if (!map.has(moduleKey)) {
        map.set(moduleKey, {
          module_key: moduleKey,
          module_label: moduleKey,
          permissions: [],
        });
      }

      map.get(moduleKey).permissions.push({
        code: row.code,
        label: row.action_key || row.code,
        action_key: row.action_key,
        description: row.description,
      });
    }

    return Array.from(map.values());
  },

  async listRoles(tenantId: string, query: any) {
    const { page, limit, offset } = getPagination(query);
    const search = (query.search as string | undefined)?.trim();
    const isActive = query.is_active as string | undefined;

    const where: string[] = ["r.tenant_id = $1", "r.deleted_at IS NULL"];
    const values: any[] = [tenantId];
    let i = 2;

    if (search) {
      where.push(`(
        r.name ILIKE $${i}
        OR r.code ILIKE $${i}
        OR COALESCE(r.description, '') ILIKE $${i}
      )`);
      values.push(`%${search}%`);
      i++;
    }

    if (isActive === "true" || isActive === "false") {
      where.push(`r.is_active = $${i}`);
      values.push(isActive === "true");
      i++;
    }

    const countRes = await pool.query(
      `
      SELECT COUNT(*)::int AS total
      FROM roles r
      WHERE ${where.join(" AND ")}
      `,
      values,
    );

    const dataRes = await pool.query(
      `
      SELECT
        r.id,
        r.tenant_id,
        r.name,
        r.code,
        r.description,
        r.is_system,
        r.is_active,
        r.created_by_id,
        r.updated_by_id,
        r.created_at,
        r.updated_at,
        COALESCE((
          SELECT COUNT(*)::int
          FROM user_roles ur
          JOIN users u
            ON u.id = ur.user_id
          WHERE ur.role_id = r.id
            AND ur.tenant_id = r.tenant_id
            AND u.deleted_at IS NULL
        ), 0) AS user_count,
        COALESCE((
          SELECT COUNT(*)::int
          FROM role_permissions rp
          JOIN tenant_permission_allowlist tpa
            ON tpa.permission_code = rp.permission_code
           AND tpa.tenant_id = r.tenant_id
           AND tpa.deleted_at IS NULL
           AND tpa.is_active = true
          JOIN permissions p
            ON p.code = rp.permission_code
           AND p.is_active = true
          WHERE rp.role_id = r.id
        ), 0) AS permission_count
      FROM roles r
      WHERE ${where.join(" AND ")}
      ORDER BY r.created_at DESC
      LIMIT $${i} OFFSET $${i + 1}
      `,
      [...values, limit, offset],
    );

    const total = countRes.rows[0]?.total ?? 0;

    return {
      data: dataRes.rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  },

  async createRole(tenantId: string, userId: string | null, body: unknown) {
    const payload = CreateRoleSchema.parse(body);
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const roleCode = normalizeRoleCode(payload.code || payload.name);
      const allowedPermissions = await assertPermissionsAllowed(
        client,
        tenantId,
        payload.permissions,
      );

      const duplicateCodeRes = await client.query(
        `
        SELECT id
        FROM roles
        WHERE tenant_id = $1
          AND lower(code) = lower($2)
          AND deleted_at IS NULL
        LIMIT 1
        `,
        [tenantId, roleCode],
      );

      if (duplicateCodeRes.rowCount) {
        const err: any = new Error("Role code already exists");
        err.statusCode = 409;
        throw err;
      }

      const roleRes = await client.query(
        `
        INSERT INTO roles (
          tenant_id,
          name,
          code,
          description,
          is_system,
          is_active,
          created_by_id,
          updated_by_id
        )
        VALUES ($1, $2, $3, $4, false, $5, $6, $6)
        RETURNING *
        `,
        [
          tenantId,
          payload.name.trim(),
          roleCode,
          payload.description ?? null,
          payload.is_active ?? true,
          userId,
        ],
      );

      const role = roleRes.rows[0];

      await insertRolePermissions(client, role.id, allowedPermissions);

      await client.query("COMMIT");
      return await this.getRoleById(tenantId, role.id);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  },

  async getRoleById(tenantId: string, roleId: string) {
    const roleRes = await pool.query(
      `
      SELECT *
      FROM roles
      WHERE id = $1
        AND tenant_id = $2
        AND deleted_at IS NULL
      `,
      [roleId, tenantId],
    );

    const role = roleRes.rows[0];
    if (!role) return null;

    const permissionRes = await pool.query<{ permission_code: string }>(
      `
      SELECT rp.permission_code
      FROM role_permissions rp
      JOIN tenant_permission_allowlist tpa
        ON tpa.permission_code = rp.permission_code
       AND tpa.tenant_id = $2
       AND tpa.deleted_at IS NULL
       AND tpa.is_active = true
      JOIN permissions p
        ON p.code = rp.permission_code
       AND p.is_active = true
      WHERE rp.role_id = $1
      ORDER BY rp.permission_code ASC
      `,
      [roleId, tenantId],
    );

    const userRes = await pool.query(
      `
      SELECT
        u.id,
        u.name,
        u.email,
        u.role,
        u.is_active,
        u.created_at
      FROM user_roles ur
      INNER JOIN users u
        ON u.id = ur.user_id
      WHERE ur.role_id = $1
        AND ur.tenant_id = $2
        AND u.deleted_at IS NULL
      ORDER BY u.name ASC, u.email ASC
      `,
      [roleId, tenantId],
    );

    return {
      ...role,
      permissions: permissionRes.rows.map((r) => r.permission_code),
      assigned_users: userRes.rows,
    };
  },

  async updateRole(
    tenantId: string,
    roleId: string,
    userId: string | null,
    body: unknown,
  ) {
    const payload = UpdateRoleSchema.parse(body);
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const existingRoleRes = await client.query(
        `
        SELECT *
        FROM roles
        WHERE id = $1
          AND tenant_id = $2
          AND deleted_at IS NULL
        `,
        [roleId, tenantId],
      );

      const existingRole = existingRoleRes.rows[0];

      if (!existingRole) {
        const err: any = new Error("Role not found");
        err.statusCode = 404;
        throw err;
      }

      const updates: string[] = [];
      const values: any[] = [];
      let i = 1;

      if (payload.name !== undefined) {
        updates.push(`name = $${i++}`);
        values.push(payload.name.trim());
      }

      if (payload.code !== undefined) {
        const nextCode = normalizeRoleCode(payload.code);

        const duplicateCodeRes = await client.query(
          `
          SELECT id
          FROM roles
          WHERE tenant_id = $1
            AND lower(code) = lower($2)
            AND id <> $3
            AND deleted_at IS NULL
          LIMIT 1
          `,
          [tenantId, nextCode, roleId],
        );

        if (duplicateCodeRes.rowCount) {
          const err: any = new Error("Role code already exists");
          err.statusCode = 409;
          throw err;
        }

        updates.push(`code = $${i++}`);
        values.push(nextCode);
      }

      if (payload.description !== undefined) {
        updates.push(`description = $${i++}`);
        values.push(payload.description ?? null);
      }

      if (payload.is_active !== undefined) {
        updates.push(`is_active = $${i++}`);
        values.push(payload.is_active);
      }

      updates.push(`updated_by_id = $${i++}`);
      values.push(userId);

      if (updates.length > 0) {
        const roleIdIndex = i++;
        const tenantIdIndex = i++;

        values.push(roleId);
        values.push(tenantId);

        await client.query(
          `
          UPDATE roles
          SET ${updates.join(", ")}, updated_at = now()
          WHERE id = $${roleIdIndex}
            AND tenant_id = $${tenantIdIndex}
            AND deleted_at IS NULL
          `,
          values,
        );
      }

      if (payload.permissions !== undefined) {
        const allowedPermissions = await assertPermissionsAllowed(
          client,
          tenantId,
          payload.permissions,
        );

        await client.query(
          `
          DELETE FROM role_permissions
          WHERE role_id = $1
          `,
          [roleId],
        );

        await insertRolePermissions(client, roleId, allowedPermissions);
      }

      await client.query("COMMIT");
      return await this.getRoleById(tenantId, roleId);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  },

  async cloneRole(
    tenantId: string,
    sourceRoleId: string,
    userId: string | null,
    body: unknown,
  ) {
    const payload = CloneRoleSchema.parse(body);
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const sourceRoleRes = await client.query(
        `
        SELECT *
        FROM roles
        WHERE id = $1
          AND tenant_id = $2
          AND deleted_at IS NULL
        `,
        [sourceRoleId, tenantId],
      );

      const sourceRole = sourceRoleRes.rows[0];

      if (!sourceRole) {
        const err: any = new Error("Source role not found");
        err.statusCode = 404;
        throw err;
      }

      const roleCode = normalizeRoleCode(payload.name);

      const duplicateCodeRes = await client.query(
        `
        SELECT id
        FROM roles
        WHERE tenant_id = $1
          AND lower(code) = lower($2)
          AND deleted_at IS NULL
        LIMIT 1
        `,
        [tenantId, roleCode],
      );

      if (duplicateCodeRes.rowCount) {
        const err: any = new Error("Role code already exists");
        err.statusCode = 409;
        throw err;
      }

      const newRoleRes = await client.query(
        `
        INSERT INTO roles (
          tenant_id,
          name,
          code,
          description,
          is_system,
          is_active,
          created_by_id,
          updated_by_id
        )
        VALUES ($1, $2, $3, $4, false, true, $5, $5)
        RETURNING *
        `,
        [
          tenantId,
          payload.name.trim(),
          roleCode,
          payload.description ?? null,
          userId,
        ],
      );

      const newRole = newRoleRes.rows[0];

      await client.query(
        `
        INSERT INTO role_permissions (
          role_id,
          permission_code
        )
        SELECT
          $1,
          rp.permission_code
        FROM role_permissions rp
        JOIN tenant_permission_allowlist tpa
          ON tpa.permission_code = rp.permission_code
         AND tpa.tenant_id = $3
         AND tpa.deleted_at IS NULL
         AND tpa.is_active = true
        JOIN permissions p
          ON p.code = rp.permission_code
         AND p.is_active = true
        WHERE rp.role_id = $2
          AND NOT EXISTS (
            SELECT 1
            FROM role_permissions existing_rp
            WHERE existing_rp.role_id = $1
              AND existing_rp.permission_code = rp.permission_code
          )
        `,
        [newRole.id, sourceRoleId, tenantId],
      );

      await client.query("COMMIT");
      return await this.getRoleById(tenantId, newRole.id);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  },

  async assignUsersToRole(
    tenantId: string,
    roleId: string,
    actorUserId: string | null,
    body: unknown,
  ) {
    void actorUserId;

    const payload = z
      .object({
        user_ids: z.array(z.string().uuid()).default([]),
      })
      .parse(body);

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const roleRes = await client.query(
        `
        SELECT id, tenant_id
        FROM roles
        WHERE id = $1
          AND tenant_id = $2
          AND deleted_at IS NULL
        `,
        [roleId, tenantId],
      );

      if (!roleRes.rows[0]) {
        const err: any = new Error("Role not found");
        err.statusCode = 404;
        throw err;
      }

      if (payload.user_ids.length > 0) {
        const userCheckRes = await client.query(
          `
          SELECT id
          FROM public.users
          WHERE tenant_id = $1
            AND id = ANY($2::uuid[])
            AND deleted_at IS NULL
          `,
          [tenantId, payload.user_ids],
        );

        if (userCheckRes.rows.length !== payload.user_ids.length) {
          const err: any = new Error("One or more users are invalid");
          err.statusCode = 400;
          throw err;
        }
      }

      await client.query(
        `
        DELETE FROM user_roles
        WHERE role_id = $1
          AND tenant_id = $2
        `,
        [roleId, tenantId],
      );

      if (payload.user_ids.length > 0) {
        const valuesSql: string[] = [];
        const values: any[] = [];

        payload.user_ids.forEach((userId, index) => {
          const base = index * 3;
          valuesSql.push(`($${base + 1}, $${base + 2}, $${base + 3})`);
          values.push(userId, roleId, tenantId);
        });

        await client.query(
          `
          INSERT INTO user_roles (
            user_id,
            role_id,
            tenant_id
          )
          VALUES ${valuesSql.join(", ")}
          `,
          values,
        );
      }

      await client.query("COMMIT");

      return await this.getRoleById(tenantId, roleId);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  },

  async updateUserRoles(tenantId: string, userId: string, body: unknown) {
    const payload = UpdateUserRolesSchema.parse(body);
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const userRes = await client.query(
        `
        SELECT id, tenant_id
        FROM public.users
        WHERE id = $1
          AND tenant_id = $2
          AND deleted_at IS NULL
        `,
        [userId, tenantId],
      );

      if (!userRes.rows[0]) {
        const err: any = new Error("User not found");
        err.statusCode = 404;
        throw err;
      }

      if (payload.role_ids.length > 0) {
        const roleCheckRes = await client.query(
          `
          SELECT id
          FROM roles
          WHERE tenant_id = $1
            AND id = ANY($2::uuid[])
            AND deleted_at IS NULL
          `,
          [tenantId, payload.role_ids],
        );

        if (roleCheckRes.rows.length !== payload.role_ids.length) {
          const err: any = new Error("One or more roles are invalid");
          err.statusCode = 400;
          throw err;
        }
      }

      await client.query(
        `
        DELETE FROM user_roles
        WHERE user_id = $1
          AND tenant_id = $2
        `,
        [userId, tenantId],
      );

      if (payload.role_ids.length > 0) {
        const valuesSql: string[] = [];
        const values: any[] = [];

        payload.role_ids.forEach((roleId, index) => {
          const base = index * 3;
          valuesSql.push(`($${base + 1}, $${base + 2}, $${base + 3})`);
          values.push(userId, roleId, tenantId);
        });

        await client.query(
          `
          INSERT INTO user_roles (
            user_id,
            role_id,
            tenant_id
          )
          VALUES ${valuesSql.join(", ")}
          `,
          values,
        );
      }

      await client.query("COMMIT");

      return { success: true };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  },
};

export async function assignUsersToRoleHandler(
  req: any,
  res: Response,
  next: NextFunction,
) {
  try {
    const tenantId = getTenantId(req);
    const userId = req.user?.id || req.user?.sub || null;

    const data = await rbacService.assignUsersToRole(
      tenantId,
      req.params.id,
      userId,
      req.body,
    );

    return res.json({ data });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        message: "Validation failed",
        errors: error.flatten(),
      });
    }

    if (error?.statusCode) {
      return res.status(error.statusCode).json({
        message: error.message,
        details: error.details || null,
      });
    }

    next(error);
  }
}

export async function getPermissionGroupsHandler(
  req: any,
  res: Response,
  next: NextFunction,
) {
  try {
    const tenantId = getTenantId(req);
    const data = await rbacService.getPermissionGroups(tenantId);
    return res.json({ data });
  } catch (error) {
    next(error);
  }
}

export async function listRolesHandler(
  req: any,
  res: Response,
  next: NextFunction,
) {
  try {
    const tenantId = getTenantId(req);
    const result = await rbacService.listRoles(tenantId, req.query);
    return res.json(result);
  } catch (error) {
    next(error);
  }
}

export async function createRoleHandler(
  req: any,
  res: Response,
  next: NextFunction,
) {
  try {
    const tenantId = getTenantId(req);
    const userId = req.user?.id || req.user?.sub || null;

    const data = await rbacService.createRole(tenantId, userId, req.body);
    return res.status(201).json({ data });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        message: "Validation failed",
        errors: error.flatten(),
      });
    }

    if (error?.statusCode) {
      return res.status(error.statusCode).json({
        message: error.message,
        details: error.details || null,
      });
    }

    next(error);
  }
}

export async function getRoleByIdHandler(
  req: any,
  res: Response,
  next: NextFunction,
) {
  try {
    const tenantId = getTenantId(req);
    const data = await rbacService.getRoleById(tenantId, req.params.id);

    if (!data) {
      return res.status(404).json({ message: "Role not found" });
    }

    return res.json({ data });
  } catch (error) {
    next(error);
  }
}

export async function updateRoleHandler(
  req: any,
  res: Response,
  next: NextFunction,
) {
  try {
    const tenantId = getTenantId(req);
    const userId = req.user?.id || req.user?.sub || null;

    const data = await rbacService.updateRole(
      tenantId,
      req.params.id,
      userId,
      req.body,
    );

    return res.json({ data });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        message: "Validation failed",
        errors: error.flatten(),
      });
    }

    if (error?.statusCode) {
      return res.status(error.statusCode).json({
        message: error.message,
        details: error.details || null,
      });
    }

    next(error);
  }
}

export async function cloneRoleHandler(
  req: any,
  res: Response,
  next: NextFunction,
) {
  try {
    const tenantId = getTenantId(req);
    const userId = req.user?.id || req.user?.sub || null;

    const data = await rbacService.cloneRole(
      tenantId,
      req.params.id,
      userId,
      req.body,
    );

    return res.status(201).json({ data });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        message: "Validation failed",
        errors: error.flatten(),
      });
    }

    if (error?.statusCode) {
      return res.status(error.statusCode).json({
        message: error.message,
        details: error.details || null,
      });
    }

    next(error);
  }
}

export async function updateUserRolesHandler(
  req: any,
  res: Response,
  next: NextFunction,
) {
  try {
    const tenantId = getTenantId(req);
    const data = await rbacService.updateUserRoles(
      tenantId,
      req.params.userId,
      req.body,
    );

    return res.json({ data });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        message: "Validation failed",
        errors: error.flatten(),
      });
    }

    if (error?.statusCode) {
      return res.status(error.statusCode).json({
        message: error.message,
        details: error.details || null,
      });
    }

    next(error);
  }
}
