import bcrypt from "bcryptjs";
import { NextFunction, Response } from "express";
import { z } from "zod";
import { getPagination } from "../../common/pagination";
import { getTenantId } from "../../common/tenant";
import { pool } from "../../db/pool";

export type RoleId = string;

const RoleIdSchema = z.string().uuid("Valid role id is required");

export const SetUserTargetSchema = z.object({
  target_amount: z.coerce
    .number()
    .min(0, "Target amount must be 0 or greater")
    .max(999999999999.99, "Target amount is too large"),
});

export const UpdateUserStatusSchema = z.object({
  is_active: z.boolean(),
});

export type ListUsersParams = {
  tenantId: string;
  search?: string;
  role?: string;
  active?: "true" | "false" | undefined;
  limit: number;
  offset: number;
};

export type CreateUserInput = {
  tenantId: string;
  email: string;
  name: string;
  role_id: string;

  display_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;

  phone_country_code?: string | null;
  phone?: string | null;
  city?: string | null;
  district?: string | null;
  state?: string | null;
  country?: string | null;
  postal_code?: string | null;

  address_line_1?: string | null;
  address_line_2?: string | null;
  landmark?: string | null;

  designation?: string | null;
  department?: string | null;
  employee_code?: string | null;

  timezone?: string | null;
  language?: string | null;

  tempPassword?: string;
  metadata?: Record<string, any> | null;

  username?: string | null;
  is_owner?: boolean;
};

export type UpdateUserInput = {
  tenantId: string;
  userId: string;
  patch: Record<string, any>;
};

const CreateUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(2),
  role_id: RoleIdSchema,

  display_name: z.string().nullish(),
  first_name: z.string().nullish(),
  last_name: z.string().nullish(),

  phone_country_code: z.string().nullish(),
  phone: z.string().nullish(),

  city: z.string().nullish(),
  district: z.string().nullish(),
  state: z.string().nullish(),
  country: z.string().nullish(),
  postal_code: z.string().nullish(),

  address_line_1: z.string().nullish(),
  address_line_2: z.string().nullish(),
  landmark: z.string().nullish(),

  designation: z.string().nullish(),
  department: z.string().nullish(),
  employee_code: z.string().nullish(),

  timezone: z.string().nullish(),
  language: z.string().nullish(),

  tempPassword: z.string().min(6).optional(),
  metadata: z.record(z.any()).nullish(),
});

const UpdateUserSchema = z.object({
  name: z.string().min(2).optional(),
  display_name: z.string().nullish(),
  first_name: z.string().nullish(),
  last_name: z.string().nullish(),

  phone_country_code: z.string().nullish(),
  phone: z.string().nullish(),

  city: z.string().nullish(),
  district: z.string().nullish(),
  state: z.string().nullish(),
  country: z.string().nullish(),
  postal_code: z.string().nullish(),

  address_line_1: z.string().nullish(),
  address_line_2: z.string().nullish(),
  landmark: z.string().nullish(),

  designation: z.string().nullish(),
  department: z.string().nullish(),
  employee_code: z.string().nullish(),

  timezone: z.string().nullish(),
  language: z.string().nullish(),

  metadata: z.record(z.any()).nullish(),
});

const UpdateRoleSchema = z.object({
  role_id: RoleIdSchema,
});

const UpdateStatusSchema = z.object({
  is_active: z.boolean(),
});

function generateTempPassword() {
  return (
    Math.random().toString(36).slice(-6) +
    Math.random().toString(36).slice(-6) +
    "A1!"
  ).slice(0, 12);
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function normalizeUsername(username?: string | null) {
  const u = username?.trim()?.toLowerCase();
  return u ? u : null;
}

export const usersService = {
  async listUsers(params: ListUsersParams) {
    const { tenantId, search, role, active, limit, offset } = params;

    const where: string[] = ["u.tenant_id = $1"];
    const values: any[] = [tenantId];
    let i = 2;

    const s = search?.trim();
    if (s) {
      where.push(`(
        u.email ILIKE $${i}
        OR u.name ILIKE $${i}
        OR COALESCE(u.phone, '') ILIKE $${i}
        OR COALESCE(u.department, '') ILIKE $${i}
        OR COALESCE(u.designation, '') ILIKE $${i}
      )`);
      values.push(`%${s}%`);
      i++;
    }

    const roleId = role?.trim();
    if (roleId) {
      where.push(`ur.role_id = $${i}`);
      values.push(roleId);
      i++;
    }

    if (active === "true" || active === "false") {
      where.push(`u.is_active = $${i}`);
      values.push(active === "true");
      i++;
    }

    const countQ = `
      SELECT COUNT(DISTINCT u.id)::int AS total
      FROM public.users u
      LEFT JOIN user_roles ur
        ON ur.user_id = u.id
       AND ur.tenant_id = u.tenant_id
      WHERE ${where.join(" AND ")}
    `;
    const totalRes = await pool.query(countQ, values);
    const total = totalRes.rows[0]?.total ?? 0;

    const dataQ = `
      SELECT
        u.id,
        u.email,
        u.name,
        COALESCE(
          STRING_AGG(DISTINCT r.name, ', ' ORDER BY r.name),
          '-'
        ) AS role,
        COALESCE(
          STRING_AGG(DISTINCT r.id::text, ', ' ORDER BY r.id::text),
          ''
        ) AS role_ids,
        u.is_active,
        u.display_name,
        u.first_name,
        u.last_name,
        u.phone_country_code,
        u.phone,
u.target_amount,
        u.city AS city_id,
        u.state AS state_id,
        u.country AS country_id,

        city_mv.label AS city,
        u.district,
        state_mv.label AS state,
        country_mv.label AS country,
        u.postal_code,

        u.designation,
        u.department,
        u.employee_code,
        u.timezone,
        u.language,
        u.created_at,
        u.updated_at,
        u.is_owner
      FROM public.users u
      LEFT JOIN user_roles ur
        ON ur.user_id = u.id
       AND ur.tenant_id = u.tenant_id
      LEFT JOIN roles r
        ON r.id = ur.role_id
       AND r.tenant_id = u.tenant_id

      LEFT JOIN master_values city_mv
        ON city_mv.id::text = u.city
       AND city_mv.tenant_id = u.tenant_id

      LEFT JOIN master_values state_mv
        ON state_mv.id::text = u.state
       AND state_mv.tenant_id = u.tenant_id

      LEFT JOIN master_values country_mv
        ON country_mv.id::text = u.country
       AND country_mv.tenant_id = u.tenant_id

      WHERE ${where.join(" AND ")}
      GROUP BY
        u.id,
        city_mv.label,
        state_mv.label,
        country_mv.label
      ORDER BY u.created_at DESC
      LIMIT $${i} OFFSET $${i + 1}
    `;

    const dataRes = await pool.query(dataQ, [...values, limit, offset]);

    return { rows: dataRes.rows, total };
  },

  async getUserById(tenantId: string, userId: string) {
    const { rows } = await pool.query(
      `
      SELECT
        u.id,
        u.tenant_id,
        u.email,
        u.target_amount,
        u.name,
        COALESCE(
          STRING_AGG(DISTINCT r.name, ', ' ORDER BY r.name),
          '-'
        ) AS role,
        COALESCE(
          STRING_AGG(DISTINCT r.id::text, ', ' ORDER BY r.id::text),
          ''
        ) AS role_ids,
        u.username,
        u.is_owner,
        u.is_active,

        u.display_name,
        u.first_name,
        u.last_name,

        u.phone_country_code,
        u.phone,

        u.city AS city_id,
        u.state AS state_id,
        u.country AS country_id,

        city_mv.label AS city,
        u.district,
        state_mv.label AS state,
        country_mv.label AS country,
        u.postal_code,

        u.address_line_1,
        u.address_line_2,
        u.landmark,

        u.designation,
        u.department,
        u.employee_code,

        u.timezone,
        u.language,
        u.metadata,
        u.created_at,
        u.updated_at
      FROM public.users u
      LEFT JOIN user_roles ur
        ON ur.user_id = u.id
       AND ur.tenant_id = u.tenant_id
      LEFT JOIN roles r
        ON r.id = ur.role_id
       AND r.tenant_id = u.tenant_id
      LEFT JOIN master_values city_mv
        ON city_mv.id::text = u.city
       AND city_mv.tenant_id = u.tenant_id
      LEFT JOIN master_values state_mv
        ON state_mv.id::text = u.state
       AND state_mv.tenant_id = u.tenant_id
      LEFT JOIN master_values country_mv
        ON country_mv.id::text = u.country
       AND country_mv.tenant_id = u.tenant_id
      WHERE u.id = $1
        AND u.tenant_id = $2
      GROUP BY
        u.id,
        city_mv.label,
        state_mv.label,
        country_mv.label
      `,
      [userId, tenantId],
    );

    return rows[0] || null;
  },

  async createUser(input: CreateUserInput) {
    const email = normalizeEmail(input.email);
    const username = normalizeUsername(input.username);

    const tempPassword = input.tempPassword ?? generateTempPassword();
    const passwordHash = await bcrypt.hash(tempPassword, 10);

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const roleCheck = await client.query(
        `
        SELECT id, name
        FROM roles
        WHERE id = $1 AND tenant_id = $2
        LIMIT 1
        `,
        [input.role_id, input.tenantId],
      );

      if (!roleCheck.rows[0]) {
        const err: any = new Error("Selected role not found");
        err.statusCode = 400;
        throw err;
      }

      const q = `
        INSERT INTO users (
          id,
          tenant_id,
          email,
          name,
          role,
          is_active,
          username,
          password_hash,

          display_name,
          first_name,
          last_name,

          phone_country_code,
          phone,

          city,
          district,
          state,
          country,
          postal_code,

          address_line_1,
          address_line_2,
          landmark,

          designation,
          department,
          employee_code,

          timezone,
          language,

          metadata,
          is_owner
        )
        VALUES (
          gen_random_uuid(),
          $1, $2, $3, $4, TRUE, $5, $6,
          $7, $8, $9,
          $10, $11,
          $12, $13, $14, $15, $16,
          $17, $18, $19,
          $20, $21, $22,
          $23, $24,
          COALESCE($25::jsonb, '{}'::jsonb),
          $26
        )
        RETURNING id
      `;

      const isOwner = input.is_owner === true;
      const fallbackRoleName = roleCheck.rows[0].name;

      const { rows } = await client.query(q, [
        input.tenantId, // 1
        email, // 2
        input.name, // 3
        fallbackRoleName, // 4 legacy users.role support
        username, // 5
        passwordHash, // 6

        input.display_name ?? null, // 7
        input.first_name ?? null, // 8
        input.last_name ?? null, // 9

        input.phone_country_code ?? null, // 10
        input.phone ?? null, // 11

        input.city ?? null, // 12
        input.district ?? null, // 13
        input.state ?? null, // 14
        input.country ?? null, // 15
        input.postal_code ?? null, // 16

        input.address_line_1 ?? null, // 17
        input.address_line_2 ?? null, // 18
        input.landmark ?? null, // 19

        input.designation ?? null, // 20
        input.department ?? null, // 21
        input.employee_code ?? null, // 22

        input.timezone ?? null, // 23
        input.language ?? null, // 24

        input.metadata ? JSON.stringify(input.metadata) : null, // 25
        isOwner, // 26
      ]);

      const createdUserId = rows[0]?.id;

      await client.query(
        `
        DELETE FROM user_roles
        WHERE user_id = $1 AND tenant_id = $2
        `,
        [createdUserId, input.tenantId],
      );

      await client.query(
        `
        INSERT INTO user_roles (user_id, role_id, tenant_id)
        VALUES ($1, $2, $3)
        `,
        [createdUserId, input.role_id, input.tenantId],
      );

      await client.query("COMMIT");

      const user = await this.getUserById(input.tenantId, createdUserId);

      return { user, tempPassword };
    } catch (e: any) {
      await client.query("ROLLBACK");

      if (e?.code === "23505") {
        const err: any = new Error("User already exists");
        err.statusCode = 409;
        throw err;
      }

      throw e;
    } finally {
      client.release();
    }
  },

  async updateUser(input: UpdateUserInput) {
    const { tenantId, userId, patch } = input;

    const allowed = Object.entries(patch).filter(([, v]) => v !== undefined);

    if (allowed.length === 0) {
      const err: any = new Error("No fields to update");
      err.statusCode = 400;
      throw err;
    }

    const setParts: string[] = [];
    const params: any[] = [];
    let i = 1;

    for (const [k, v] of allowed) {
      if (k === "metadata") {
        setParts.push(
          `metadata = COALESCE(metadata, '{}'::jsonb) || $${i}::jsonb`,
        );
        params.push(JSON.stringify(v));
      } else {
        setParts.push(`${k} = $${i}`);
        params.push(v);
      }
      i++;
    }

    params.push(userId);
    params.push(tenantId);

    const updateQ = `
      UPDATE users
      SET ${setParts.join(", ")}
      WHERE id = $${i} AND tenant_id = $${i + 1}
      RETURNING id
    `;

    const updateRes = await pool.query(updateQ, params);
    const updatedId = updateRes.rows[0]?.id;

    if (!updatedId) return null;

    return await this.getUserById(tenantId, updatedId);
  },

  async updateRole(tenantId: string, userId: string, roleId: string) {
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const roleCheck = await client.query(
        `
        SELECT id, name
        FROM roles
        WHERE id = $1 AND tenant_id = $2
        LIMIT 1
        `,
        [roleId, tenantId],
      );

      if (!roleCheck.rows[0]) {
        const err: any = new Error("Selected role not found");
        err.statusCode = 400;
        throw err;
      }

      const existingUser = await client.query(
        `
        SELECT id
        FROM public.users
        WHERE id = $1 AND tenant_id = $2
        LIMIT 1
        `,
        [userId, tenantId],
      );

      if (!existingUser.rows[0]) {
        await client.query("ROLLBACK");
        return null;
      }

      await client.query(
        `
        DELETE FROM user_roles
        WHERE user_id = $1 AND tenant_id = $2
        `,
        [userId, tenantId],
      );

      await client.query(
        `
        INSERT INTO user_roles (user_id, role_id, tenant_id)
        VALUES ($1, $2, $3)
        `,
        [userId, roleId, tenantId],
      );

      await client.query(
        `
        UPDATE users
        SET role = $1
        WHERE id = $2 AND tenant_id = $3
        `,
        [roleCheck.rows[0].name, userId, tenantId],
      );

      await client.query("COMMIT");

      return await this.getUserById(tenantId, userId);
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  },

  async updateStatus(tenantId: string, userId: string, is_active: boolean) {
    const { rows } = await pool.query(
      `
      UPDATE users
      SET is_active = $1
      WHERE id = $2 AND tenant_id = $3
      RETURNING id, email, name, role, is_active, updated_at
      `,
      [is_active, userId, tenantId],
    );
    return rows[0] || null;
  },

  async deactivateUser(tenantId: string, userId: string) {
    const { rows } = await pool.query(
      `
      UPDATE users
      SET is_active = false
      WHERE id = $1 AND tenant_id = $2
      RETURNING id, email, name, role, is_active, updated_at
      `,
      [userId, tenantId],
    );
    return rows[0] || null;
  },
};

export const updateUserStatusHandler = async (
  req: any,
  res: Response,
  next: NextFunction,
) => {
  try {
    const tenantId = req.tenant?.id;
    const { id } = req.params;

    if (!tenantId) {
      return res.status(400).json({
        statusCode: 400,
        message: "Tenant not resolved",
        data: null,
      });
    }

    const body = UpdateUserStatusSchema.parse(req.body);

    const result = await pool.query(
      `
      UPDATE users
      SET
        is_active = $1,
        updated_by = $2,
        updated_at = now()
      WHERE tenant_id = $3
        AND id = $4
        AND deleted_at IS NULL
      RETURNING
        id,
        name,
        email,
        is_active,
        updated_at
      `,
      [body.is_active, req.user?.id || null, tenantId, id],
    );

    if (!result.rowCount) {
      return res.status(404).json({
        statusCode: 404,
        message: "User not found",
        data: null,
      });
    }

    return res.status(200).json({
      statusCode: 200,
      message: body.is_active
        ? "User enabled successfully"
        : "User disabled successfully",
      data: result.rows[0],
    });
  } catch (error) {
    next(error);
  }
};

export const getMyTargetProgressHandler = async (
  req: any,
  res: Response,
  next: NextFunction,
) => {
  try {
    const tenantId = getTenantId(req);

    const userId =
      (req as any).user?.id ||
      (req as any).user?.user_id ||
      (req as any).user?.sub ||
      (req as any).userId ||
      (req as any).user_id;

    if (!tenantId || !userId) {
      return res.status(400).json({
        statusCode: 400,
        message: "Tenant or user not resolved",
        data: null,
      });
    }

    const result = await pool.query(
      `
  SELECT
    COALESCE(u.target_amount, 0) AS target_amount,

    COALESCE((
      SELECT
        SUM(
          CASE
            WHEN COALESCE(so.cost_center_amount, 0) > 0
              THEN so.cost_center_amount
            ELSE COALESCE(so.total_amount, 0)
          END
        )
      FROM sales_orders so
      WHERE so.tenant_id = u.tenant_id
        AND so.deleted_at IS NULL
        AND COALESCE(so.status, '') NOT IN ('draft', 'cancelled')
        AND (
          (
            COALESCE(so.source, 'crm') = 'crm'
            AND so.assigned_to = u.id
          )

          OR

          (
            COALESCE(so.source, '') = 'tally'
            AND EXISTS (
              SELECT 1
              FROM user_cost_centers ucc
              INNER JOIN cost_centers cc
                ON cc.tenant_id = ucc.tenant_id
               AND cc.id = ucc.cost_center_id
              WHERE ucc.tenant_id = u.tenant_id
                AND ucc.user_id = u.id
                AND ucc.is_active = true
                AND ucc.deleted_at IS NULL
                AND cc.status = 'active'
                AND (
                  so.cost_center_id = cc.id

                  OR (
                    NULLIF(TRIM(so.cost_center_guid), '') IS NOT NULL
                    AND NULLIF(TRIM(cc.tally_guid), '') IS NOT NULL
                    AND TRIM(so.cost_center_guid) = TRIM(cc.tally_guid)
                  )

                  OR (
                    NULLIF(TRIM(so.cost_center_name), '') IS NOT NULL
                    AND LOWER(TRIM(so.cost_center_name)) = LOWER(TRIM(cc.name))
                  )
                )
            )
          )
        )
    ), 0) AS achieved_amount

  FROM public.users u
  WHERE u.tenant_id = $1
    AND u.id = $2
    AND u.deleted_at IS NULL
  LIMIT 1
  `,
      [tenantId, userId],
    );

    const row = result.rows[0];

    const targetAmount = Number(row?.target_amount || 0);
    const achievedAmount = Number(row?.achieved_amount || 0);
    const remainingAmount = Math.max(targetAmount - achievedAmount, 0);

    const progressPercent =
      targetAmount > 0
        ? Math.min(Math.round((achievedAmount / targetAmount) * 100), 100)
        : 0;

    return res.status(200).json({
      statusCode: 200,
      message: "Target progress fetched successfully",
      data: {
        target_amount: targetAmount,
        achieved_amount: achievedAmount,
        remaining_amount: remainingAmount,
        progress_percent: progressPercent,
      },
    });
  } catch (error) {
    next(error);
  }
};

export const setUserTargetHandler = async (
  req: any,
  res: Response,
  next: NextFunction,
) => {
  try {
    const tenantId = req.tenant?.id;
    const { id } = req.params;

    if (!tenantId) {
      return res.status(400).json({
        statusCode: 400,
        message: "Tenant not resolved",
        data: null,
      });
    }

    const body = SetUserTargetSchema.parse(req.body);

    const result = await pool.query(
      `
      UPDATE users
      SET
        target_amount = $1,
        updated_by = $2,
        updated_at = now()
      WHERE tenant_id = $3
        AND id = $4
        AND deleted_at IS NULL
      RETURNING
        id,
        name,
        email,
        target_amount,
        updated_at
      `,
      [body.target_amount, req.user?.id || null, tenantId, id],
    );

    if (!result.rowCount) {
      return res.status(404).json({
        statusCode: 404,
        message: "User not found",
        data: null,
      });
    }

    return res.status(200).json({
      statusCode: 200,
      message: "User target updated successfully",
      data: result.rows[0],
    });
  } catch (error) {
    next(error);
  }
};

export async function listUsersHandler(
  req: any,
  res: Response,
  next: NextFunction,
) {
  try {
    const tenantId = getTenantId(req);

    const search = (req.query.search as string | undefined)?.trim();
    const role = (req.query.role as string | undefined)?.trim();
    const active = req.query.active as string | undefined;

    const { page, limit, offset } = getPagination(req.query);

    const { rows, total } = await usersService.listUsers({
      tenantId,
      search,
      role,
      active: active as any,
      limit,
      offset,
    });

    return res.json({
      data: rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function getUserByIdHandler(
  req: any,
  res: Response,
  next: NextFunction,
) {
  try {
    const tenantId = getTenantId(req);
    const userId = req.params.id;

    const user = await usersService.getUserById(tenantId, userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    res.json({ data: user });
  } catch (err) {
    next(err);
  }
}

export async function createUserHandler(
  req: any,
  res: Response,
  next: NextFunction,
) {
  try {
    const tenantId = getTenantId(req);
    const body = CreateUserSchema.parse(req.body);

    const { user, tempPassword } = await usersService.createUser({
      tenantId,
      email: body.email,
      name: body.name,
      role_id: body.role_id,

      display_name: body.display_name ?? null,
      first_name: body.first_name ?? null,
      last_name: body.last_name ?? null,

      phone_country_code: body.phone_country_code ?? null,
      phone: body.phone ?? null,

      city: body.city ?? null,
      district: body.district ?? null,
      state: body.state ?? null,
      country: body.country ?? null,
      postal_code: body.postal_code ?? null,

      address_line_1: body.address_line_1 ?? null,
      address_line_2: body.address_line_2 ?? null,
      landmark: body.landmark ?? null,

      designation: body.designation ?? null,
      department: body.department ?? null,
      employee_code: body.employee_code ?? null,

      timezone: body.timezone ?? null,
      language: body.language ?? null,

      tempPassword: body.tempPassword,
      metadata: body.metadata ?? null,
    });

    return res.status(201).json({
      data: user,
      tempPassword,
    });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({
        message: "Validation failed",
        errors: err.flatten(),
      });
    }

    if (err?.statusCode) {
      return res.status(err.statusCode).json({ message: err.message });
    }

    if (err?.code === "23505") {
      return res.status(409).json({ message: "User already exists" });
    }

    next(err);
  }
}

export async function updateUserHandler(
  req: any,
  res: Response,
  next: NextFunction,
) {
  try {
    const tenantId = getTenantId(req);
    const userId = req.params.id;
    const body = UpdateUserSchema.parse(req.body);

    const user = await usersService.updateUser({
      tenantId,
      userId,
      patch: body,
    });

    if (!user) return res.status(404).json({ message: "User not found" });

    res.json({ data: user });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({
        message: "Validation failed",
        errors: err.flatten(),
      });
    }

    if (err?.statusCode) {
      return res.status(err.statusCode).json({ message: err.message });
    }

    next(err);
  }
}

export async function updateRoleHandler(
  req: any,
  res: Response,
  next: NextFunction,
) {
  try {
    const tenantId = getTenantId(req);
    const userId = req.params.id;
    const body = UpdateRoleSchema.parse(req.body);

    const user = await usersService.updateRole(tenantId, userId, body.role_id);
    if (!user) return res.status(404).json({ message: "User not found" });

    res.json({ data: user });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({
        message: "Validation failed",
        errors: err.flatten(),
      });
    }

    if (err?.statusCode) {
      return res.status(err.statusCode).json({ message: err.message });
    }

    next(err);
  }
}

export async function updateStatusHandler(
  req: any,
  res: Response,
  next: NextFunction,
) {
  try {
    const tenantId = getTenantId(req);
    const userId = req.params.id;
    const body = UpdateStatusSchema.parse(req.body);

    const user = await usersService.updateStatus(
      tenantId,
      userId,
      body.is_active,
    );
    if (!user) return res.status(404).json({ message: "User not found" });

    res.json({
      data: user,
      message: "User status updated successfully",
      statusCode: 200,
      success: true,
    });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({
        message: "Validation failed",
        errors: err.flatten(),
      });
    }

    next(err);
  }
}

export async function deactivateUserHandler(
  req: any,
  res: Response,
  next: NextFunction,
) {
  try {
    const tenantId = getTenantId(req);
    const userId = req.params.id;

    const user = await usersService.deactivateUser(tenantId, userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    res.json({ data: user });
  } catch (err) {
    next(err);
  }
}
