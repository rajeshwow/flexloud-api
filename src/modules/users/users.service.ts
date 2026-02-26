import bcrypt from "bcryptjs";
import { pool } from "../../db/pool";

export type Role = "ADMIN" | "MANAGER" | "AGENT";

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

  // optional extras
  phone_country_code?: string | null;
  phone?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  postal_code?: string | null;

  designation?: string | null;
  department?: string | null;
  employee_code?: string | null;

  tempPassword?: string;
  metadata?: Record<string, any> | null;

  // if you have username column
  username?: string | null;
  is_owner?: boolean;
};

export type UpdateUserInput = {
  tenantId: string;
  userId: string;
  patch: Record<string, any>; // already validated in router
};

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

    const where: string[] = ["tenant_id = $1"];
    const values: any[] = [tenantId];
    let i = 2;

    const s = search?.trim();
    if (s) {
      where.push(`(email ILIKE $${i} OR name ILIKE $${i})`);
      values.push(`%${s}%`);
      i++;
    }

    const r = role?.trim();
    if (r) {
      where.push(`role = $${i}`);
      values.push(r);
      i++;
    }

    if (active === "true" || active === "false") {
      where.push(`is_active = $${i}`);
      values.push(active === "true");
      i++;
    }

    const countQ = `SELECT COUNT(1)::int AS total FROM users WHERE ${where.join(
      " AND ",
    )}`;
    const totalRes = await pool.query(countQ, values);
    const total = totalRes.rows[0]?.total ?? 0;

    const dataQ = `
      SELECT id, email, name, role, is_active,
             phone_country_code, phone, city, state, country,
             designation, department, employee_code,
             created_at, updated_at, is_owner
      FROM users
      WHERE ${where.join(" AND ")}
      ORDER BY created_at DESC
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
    id, tenant_id, email, name, role, is_active,
    username,
    password_hash,
    phone_country_code, phone, city, state, country, postal_code,
    designation, department, employee_code,
    metadata,
    is_owner
  )
  VALUES (
    gen_random_uuid(), $1, $2, $3, $4, TRUE,
    $5,
    $6,
    $7, $8, $9, $10, $11, $12,
    $13, $14, $15,
    COALESCE($16::jsonb, '{}'::jsonb),
    $17
  )
  RETURNING
    id, tenant_id, email, name, role, username, is_owner, is_active,
    phone_country_code, phone, city, state, country, postal_code,
    designation, department, employee_code,
    created_at, updated_at
`;

      const isOwner = input.is_owner === true;

      const { rows } = await pool.query(q, [
        input.tenantId, // $1
        email, // $2
        input.name, // $3
        input.role, // $4
        username, // $5
        passwordHash, // $6

        input.phone_country_code ?? null, // $7
        input.phone ?? null, // $8
        input.city ?? null, // $9
        input.state ?? null, // $10
        input.country ?? null, // $11
        input.postal_code ?? null, // $12

        input.designation ?? null, // $13
        input.department ?? null, // $14
        input.employee_code ?? null, // $15

        input.metadata ? JSON.stringify(input.metadata) : null, // $16
        isOwner, // $17
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
      RETURNING id, email, name, role, is_active, created_at, updated_at
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

  // soft delete = deactivate
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
