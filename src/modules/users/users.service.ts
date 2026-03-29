import bcrypt from "bcryptjs";
import { NextFunction, Response } from "express";
import { z } from "zod";
import { getPagination } from "../../common/pagination";
import { getTenantId } from "../../common/tenant";
import { pool } from "../../db/pool";

export type Role = "ADMIN" | "MANAGER" | "AGENT";

const RoleEnum = z.enum(["ADMIN", "MANAGER", "AGENT"]);

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
  role: Role;

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
  role: RoleEnum.default("AGENT"),

  display_name: z.string().optional(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),

  phone_country_code: z.string().optional(),
  phone: z.string().optional(),

  city: z.string().optional(),
  district: z.string().optional(),
  state: z.string().optional(),
  country: z.string().optional(),
  postal_code: z.string().optional(),

  address_line_1: z.string().optional(),
  address_line_2: z.string().optional(),
  landmark: z.string().optional(),

  designation: z.string().optional(),
  department: z.string().optional(),
  employee_code: z.string().optional(),

  timezone: z.string().optional(),
  language: z.string().optional(),

  tempPassword: z.string().min(6).optional(),
  metadata: z.record(z.any()).optional(),
});

const UpdateUserSchema = z.object({
  name: z.string().min(2).optional(),
  display_name: z.string().optional(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),

  phone_country_code: z.string().optional(),
  phone: z.string().optional(),

  city: z.string().optional(),
  district: z.string().optional(),
  state: z.string().optional(),
  country: z.string().optional(),
  postal_code: z.string().optional(),

  address_line_1: z.string().optional(),
  address_line_2: z.string().optional(),
  landmark: z.string().optional(),

  designation: z.string().optional(),
  department: z.string().optional(),
  employee_code: z.string().optional(),

  timezone: z.string().optional(),
  language: z.string().optional(),

  metadata: z.record(z.any()).optional(),
});

const UpdateRoleSchema = z.object({
  role: RoleEnum,
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

    const r = role?.trim();
    if (r) {
      where.push(`u.role = $${i}`);
      values.push(r);
      i++;
    }

    if (active === "true" || active === "false") {
      where.push(`u.is_active = $${i}`);
      values.push(active === "true");
      i++;
    }

    const countQ = `
    SELECT COUNT(1)::int AS total
    FROM users u
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
      u.is_active,
      u.display_name,
      u.first_name,
      u.last_name,
      u.phone_country_code,
      u.phone,
      u.city,
      u.district,
      u.state,
      u.country,
      u.postal_code,
      u.designation,
      u.department,
      u.employee_code,
      u.timezone,
      u.language,
      u.created_at,
      u.updated_at,
      u.is_owner
    FROM users u
    LEFT JOIN user_roles ur
      ON ur.user_id = u.id
     AND ur.tenant_id = u.tenant_id
    LEFT JOIN roles r
      ON r.id = ur.role_id
     AND r.tenant_id = u.tenant_id
    WHERE ${where.join(" AND ")}
    GROUP BY u.id
    ORDER BY u.created_at DESC
    LIMIT $${i} OFFSET $${i + 1}
  `;

    const dataRes = await pool.query(dataQ, [...values, limit, offset]);

    return { rows: dataRes.rows, total };
  },

  async getUserById(tenantId: string, userId: string) {
    const { rows } = await pool.query(
      `
      SELECT *
      FROM users
      WHERE id = $1 AND tenant_id = $2
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

    try {
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
        RETURNING
          id,
          tenant_id,
          email,
          name,
          role,
          username,
          is_owner,
          is_active,
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
          created_at,
          updated_at
      `;

      const isOwner = input.is_owner === true;

      const { rows } = await pool.query(q, [
        input.tenantId, // 1
        email, // 2
        input.name, // 3
        input.role, // 4
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

      return { user: rows[0], tempPassword };
    } catch (e: any) {
      if (e?.code === "23505") {
        const err: any = new Error("User already exists");
        err.statusCode = 409;
        throw err;
      }
      throw e;
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

    const q = `
      UPDATE users
      SET ${setParts.join(", ")}
      WHERE id = $${i} AND tenant_id = $${i + 1}
      RETURNING
        id,
        email,
        name,
        role,
        is_active,
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
        created_at,
        updated_at
    `;

    const { rows } = await pool.query(q, params);
    return rows[0] || null;
  },

  async updateRole(tenantId: string, userId: string, role: Role) {
    const { rows } = await pool.query(
      `
      UPDATE users
      SET role = $1
      WHERE id = $2 AND tenant_id = $3
      RETURNING id, email, name, role, is_active, updated_at
      `,
      [role, userId, tenantId],
    );
    return rows[0] || null;
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
      role: body.role,

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

    const user = await usersService.updateRole(tenantId, userId, body.role);
    if (!user) return res.status(404).json({ message: "User not found" });

    res.json({ data: user });
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

    res.json({ data: user });
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
