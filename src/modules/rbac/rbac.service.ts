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

export const rbacService = {
  async getPermissionGroups() {
    const { rows } = await pool.query(
      `
      SELECT
        code,
        description,
        module_key,
        action_key,
        is_active
      FROM permissions
      WHERE is_active = true
      ORDER BY module_key ASC, action_key ASC, code ASC
      `,
    );

    const map = new Map<string, any>();

    for (const row of rows) {
      if (!map.has(row.module_key)) {
        map.set(row.module_key, {
          module_key: row.module_key,
          module_label: row.module_key,
          permissions: [],
        });
      }

      map.get(row.module_key).permissions.push({
        code: row.code,
        label: row.action_key,
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

    const where: string[] = ["r.tenant_id = $1"];
    const values: any[] = [tenantId];
    let i = 2;

    if (search) {
      where.push(`(
        r.name ILIKE $${i}
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
      `SELECT COUNT(*)::int AS total FROM roles r WHERE ${where.join(" AND ")}`,
      values,
    );

    const dataRes = await pool.query(
      `
      SELECT
        r.id,
        r.tenant_id,
        r.name,
        r.description,
        r.is_system,
        r.is_active,
        r.created_by_id,
        r.updated_by_id,
        r.created_at,
        r.updated_at,
        COALESCE(urc.user_count, 0)::int AS user_count,
        COALESCE(rpc.permission_count, 0)::int AS permission_count
      FROM roles r
      LEFT JOIN (
        SELECT role_id, COUNT(*) AS user_count
        FROM user_roles
        GROUP BY role_id
      ) urc ON urc.role_id = r.id
      LEFT JOIN (
        SELECT role_id, COUNT(*) AS permission_count
        FROM role_permissions
        GROUP BY role_id
      ) rpc ON rpc.role_id = r.id
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

  async createRole(tenantId: string, userId: string, body: unknown) {
    const payload = CreateRoleSchema.parse(body);
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const roleRes = await client.query(
        `
        INSERT INTO roles (
          tenant_id,
          name,
          description,
          is_system,
          is_active,
          created_by_id,
          updated_by_id
        )
        VALUES ($1, $2, $3, false, $4, $5, $5)
        RETURNING *
        `,
        [
          tenantId,
          payload.name.trim(),
          payload.description ?? null,
          payload.is_active ?? true,
          userId,
        ],
      );

      const role = roleRes.rows[0];

      if (payload.permissions.length > 0) {
        const valuesSql: string[] = [];
        const values: any[] = [];

        payload.permissions.forEach((permissionCode, index) => {
          const base = index * 2;
          valuesSql.push(`($${base + 1}, $${base + 2})`);
          values.push(role.id, permissionCode);
        });

        await client.query(
          `
          INSERT INTO role_permissions (role_id, permission_code)
          VALUES ${valuesSql.join(", ")}
          ON CONFLICT (role_id, permission_code) DO NOTHING
          `,
          values,
        );
      }

      await client.query("COMMIT");
      return role;
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
      WHERE id = $1 AND tenant_id = $2
      `,
      [roleId, tenantId],
    );

    const role = roleRes.rows[0];
    if (!role) return null;

    const permissionRes = await pool.query<{ permission_code: string }>(
      `
      SELECT permission_code
      FROM role_permissions
      WHERE role_id = $1
      ORDER BY permission_code ASC
      `,
      [roleId],
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
      INNER JOIN users u ON u.id = ur.user_id
      WHERE ur.role_id = $1
        AND ur.tenant_id = $2
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
    userId: string,
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
        WHERE id = $1 AND tenant_id = $2
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
        values.push(roleId);
        values.push(tenantId);

        await client.query(
          `
          UPDATE roles
          SET ${updates.join(", ")}, updated_at = now()
          WHERE id = $${i++} AND tenant_id = $${i}
          `,
          values,
        );
      }

      if (payload.permissions !== undefined) {
        await client.query(`DELETE FROM role_permissions WHERE role_id = $1`, [
          roleId,
        ]);

        if (payload.permissions.length > 0) {
          const valuesSql: string[] = [];
          const rpValues: any[] = [];

          payload.permissions.forEach((permissionCode, index) => {
            const base = index * 2;
            valuesSql.push(`($${base + 1}, $${base + 2})`);
            rpValues.push(roleId, permissionCode);
          });

          await client.query(
            `
            INSERT INTO role_permissions (role_id, permission_code)
            VALUES ${valuesSql.join(", ")}
            ON CONFLICT (role_id, permission_code) DO NOTHING
            `,
            rpValues,
          );
        }
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
    userId: string,
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
        WHERE id = $1 AND tenant_id = $2
        `,
        [sourceRoleId, tenantId],
      );

      const sourceRole = sourceRoleRes.rows[0];
      if (!sourceRole) {
        const err: any = new Error("Source role not found");
        err.statusCode = 404;
        throw err;
      }

      const newRoleRes = await client.query(
        `
        INSERT INTO roles (
          tenant_id,
          name,
          description,
          is_system,
          is_active,
          created_by_id,
          updated_by_id
        )
        VALUES ($1, $2, $3, false, true, $4, $4)
        RETURNING *
        `,
        [tenantId, payload.name.trim(), payload.description ?? null, userId],
      );

      const newRole = newRoleRes.rows[0];

      await client.query(
        `
        INSERT INTO role_permissions (role_id, permission_code)
        SELECT $1, rp.permission_code
        FROM role_permissions rp
        WHERE rp.role_id = $2
        ON CONFLICT (role_id, permission_code) DO NOTHING
        `,
        [newRole.id, sourceRoleId],
      );

      await client.query("COMMIT");
      return newRole;
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
    actorUserId: string,
    body: unknown,
  ) {
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
      WHERE id = $1 AND tenant_id = $2
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
        FROM users
        WHERE tenant_id = $1
          AND id = ANY($2::uuid[])
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
        FROM users
        WHERE id = $1 AND tenant_id = $2
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
          INSERT INTO user_roles (user_id, role_id, tenant_id)
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
    const userId = req.user?.sub;

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
      return res.status(error.statusCode).json({ message: error.message });
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
    const data = await rbacService.getPermissionGroups();
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
    const userId = req.user?.sub;

    const data = await rbacService.createRole(tenantId, userId, req.body);
    return res.status(201).json({ data });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        message: "Validation failed",
        errors: error.flatten(),
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
    const userId = req.user?.sub;

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
      return res.status(error.statusCode).json({ message: error.message });
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
    const userId = req.user?.sub;

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
      return res.status(error.statusCode).json({ message: error.message });
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
      return res.status(error.statusCode).json({ message: error.message });
    }

    next(error);
  }
}
