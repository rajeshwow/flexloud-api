import { Router } from "express";
import { z } from "zod";
import { getPagination } from "../../common/pagination";
import { requireRoles } from "../../common/rbac";
import { getTenantId } from "../../common/tenant";
import { pool } from "../../db/pool";

// ---------- Validators ----------
const RoleEnum = z.enum(["ADMIN", "MANAGER", "AGENT"]);

const CreateUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(2),
  role: RoleEnum.default("AGENT"),

  // optional extras
  phone_country_code: z.string().optional(),
  phone: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  country: z.string().optional(),
  postal_code: z.string().optional(),
  designation: z.string().optional(),
  department: z.string().optional(),
  employee_code: z.string().optional(),

  metadata: z.record(z.any()).optional(),
});

const UpdateUserSchema = z.object({
  // you can update these
  name: z.string().min(2).optional(),
  display_name: z.string().optional(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),

  phone_country_code: z.string().optional(),
  phone: z.string().optional(),
  alt_phone_country_code: z.string().optional(),
  alt_phone: z.string().optional(),
  whatsapp_country_code: z.string().optional(),
  whatsapp_number: z.string().optional(),

  address_line_1: z.string().optional(),
  address_line_2: z.string().optional(),
  landmark: z.string().optional(),
  city: z.string().optional(),
  district: z.string().optional(),
  state: z.string().optional(),
  country: z.string().optional(),
  postal_code: z.string().optional(),

  designation: z.string().optional(),
  department: z.string().optional(),
  employee_code: z.string().optional(),

  timezone: z.string().optional(),
  language: z.string().optional(),

  avatar_url: z.string().url().optional(),

  metadata: z.record(z.any()).optional(),
});

const UpdateRoleSchema = z.object({
  role: RoleEnum,
});

const UpdateStatusSchema = z.object({
  is_active: z.boolean(),
});

// ---------- Router ----------
export function usersRouter() {
  const router = Router();

  /**
   * ✅ LIST users (ADMIN/MANAGER)
   * GET /v1/users?search=&role=&active=
   */
  //   router.get("/", requireRoles(["ADMIN", "MANAGER"]), async (req: any, res) => {
  router.get("/", async (req, res) => {
    const tenantId = getTenantId(req);

    const search = (req.query.search as string | undefined)?.trim();
    const role = (req.query.role as string | undefined)?.trim();
    const active = req.query.active as string | undefined;

    const where: string[] = ["tenant_id = $1"];
    const params: any[] = [tenantId];
    let i = 2;

    if (search) {
      where.push(`(email ILIKE $${i} OR name ILIKE $${i})`);
      params.push(`%${search}%`);
      i++;
    }

    if (role) {
      where.push(`role = $${i}`);
      params.push(role);
      i++;
    }

    if (active === "true" || active === "false") {
      where.push(`is_active = $${i}`);
      params.push(active === "true");
      i++;
    }

    const { page, limit, offset } = getPagination(req.query);

    // total count
    const countQ = `SELECT COUNT(1)::int AS total FROM users WHERE ${where.join(" AND ")}`;
    const totalRes = await pool.query(countQ, params);
    const total = totalRes.rows[0]?.total ?? 0;

    // data
    const dataQ = `
    SELECT id, email, name, role, is_active,
           phone_country_code, phone, city, state, country,
           designation, department, employee_code,
           created_at, updated_at
    FROM users
    WHERE ${where.join(" AND ")}
    ORDER BY created_at DESC
    LIMIT $${i} OFFSET $${i + 1}
  `;
    const dataParams = [...params, limit, offset];
    const { rows } = await pool.query(dataQ, dataParams);

    return res.json({
      data: rows,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasNext: page * limit < total,
        hasPrev: page > 1,
      },
    });
  });

  /**
   * ✅ GET user by id (ADMIN/MANAGER)
   * GET /v1/users/:id
   */
  router.get(
    "/:id",
    requireRoles(["ADMIN", "MANAGER"]),
    async (req: any, res) => {
      const tenantId = getTenantId(req);
      const userId = req.params.id;

      const { rows } = await pool.query(
        `
      SELECT *
      FROM users
      WHERE id = $1 AND tenant_id = $2
      `,
        [userId, tenantId],
      );

      if (!rows[0]) return res.status(404).json({ message: "User not found" });
      res.json({ data: rows[0] });
    },
  );

  /**
   * ✅ CREATE user (ADMIN)
   * POST /v1/users
   * Body: { email, name, role, ... }
   *
   * IMPORTANT: tenant_id is ALWAYS from server context.
   */
  //   router.post("/", requireRoles(["ADMIN"]), async (req: any, res) => {
  router.post("/", async (req, res) => {
    const tenantId = getTenantId(req);
    const body = CreateUserSchema.parse(req.body);

    const q = `
      INSERT INTO users (
        id, tenant_id, email, name, role, is_active,
        phone_country_code, phone, city, state, country, postal_code,
        designation, department, employee_code,
        metadata
      )
      VALUES (
        gen_random_uuid(), $1, $2, $3, $4, true,
        $5, $6, $7, $8, $9, $10,
        $11, $12, $13,
        COALESCE($14::jsonb, '{}'::jsonb)
      )
      ON CONFLICT (tenant_id, email)
      DO UPDATE SET
        name = EXCLUDED.name,
        role = EXCLUDED.role,
        phone_country_code = COALESCE(EXCLUDED.phone_country_code, users.phone_country_code),
        phone = COALESCE(EXCLUDED.phone, users.phone),
        city = COALESCE(EXCLUDED.city, users.city),
        state = COALESCE(EXCLUDED.state, users.state),
        country = COALESCE(EXCLUDED.country, users.country),
        postal_code = COALESCE(EXCLUDED.postal_code, users.postal_code),
        designation = COALESCE(EXCLUDED.designation, users.designation),
        department = COALESCE(EXCLUDED.department, users.department),
        employee_code = COALESCE(EXCLUDED.employee_code, users.employee_code),
        metadata = users.metadata || EXCLUDED.metadata
      RETURNING id, email, name, role, is_active, created_at, updated_at
    `;

    const { rows } = await pool.query(q, [
      tenantId,
      body.email,
      body.name,
      body.role,
      body.phone_country_code ?? null,
      body.phone ?? null,
      body.city ?? null,
      body.state ?? null,
      body.country ?? null,
      body.postal_code ?? null,
      body.designation ?? null,
      body.department ?? null,
      body.employee_code ?? null,
      body.metadata ? JSON.stringify(body.metadata) : null,
    ]);

    res.status(201).json({ data: rows[0] });
  });

  /**
   * ✅ UPDATE user profile (ADMIN) - safe patch
   * PATCH /v1/users/:id
   */
  //   router.patch("/:id", requireRoles(["ADMIN"]), async (req: any, res) => {
  router.patch("/:id", async (req, res) => {
    const tenantId = getTenantId(req);
    const userId = req.params.id;
    const body = UpdateUserSchema.parse(req.body);

    const allowed = Object.entries(body).filter(([, v]) => v !== undefined);
    if (allowed.length === 0) {
      return res.status(400).json({ message: "No fields to update" });
    }

    // build dynamic SET safely
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

    // tenant guard ALWAYS
    params.push(userId);
    params.push(tenantId);

    const q = `
      UPDATE users
      SET ${setParts.join(", ")}
      WHERE id = $${i} AND tenant_id = $${i + 1}
      RETURNING id, email, name, role, is_active, created_at, updated_at
    `;

    const { rows } = await pool.query(q, params);
    if (!rows[0]) return res.status(404).json({ message: "User not found" });
    res.json({ data: rows[0] });
  });

  /**
   * ✅ UPDATE role (ADMIN)
   * PATCH /v1/users/:id/role
   */
  //   router.patch("/:id/role", requireRoles(["ADMIN"]), async (req: any, res) => {
  router.patch("/:id/role", async (req, res) => {
    const tenantId = getTenantId(req);
    const userId = req.params.id;
    const body = UpdateRoleSchema.parse(req.body);

    const { rows } = await pool.query(
      `
      UPDATE users
      SET role = $1
      WHERE id = $2 AND tenant_id = $3
      RETURNING id, email, name, role, is_active, updated_at
      `,
      [body.role, userId, tenantId],
    );

    if (!rows[0]) return res.status(404).json({ message: "User not found" });
    res.json({ data: rows[0] });
  });

  /**
   * ✅ Activate/Deactivate (ADMIN)
   * PATCH /v1/users/:id/status
   */
  //   router.patch(
  //     "/:id/status",
  //     requireRoles(["ADMIN"]),
  //     async (req: any, res) => {
  router.patch("/:id/status", async (req, res) => {
    const tenantId = getTenantId(req);
    const userId = req.params.id;
    const body = UpdateStatusSchema.parse(req.body);

    const { rows } = await pool.query(
      `
      UPDATE users
      SET is_active = $1
      WHERE id = $2 AND tenant_id = $3
      RETURNING id, email, name, role, is_active, updated_at
      `,
      [body.is_active, userId, tenantId],
    );

    if (!rows[0]) return res.status(404).json({ message: "User not found" });
    res.json({ data: rows[0] });
  });

  /**
   * ✅ Soft delete style (ADMIN): same as deactivate
   * DELETE /v1/users/:id
   */
  router.delete("/:id", requireRoles(["ADMIN"]), async (req: any, res) => {
    const tenantId = getTenantId(req);
    const userId = req.params.id;

    const { rows } = await pool.query(
      `
      UPDATE users
      SET is_active = false
      WHERE id = $1 AND tenant_id = $2
      RETURNING id, email, name, role, is_active, updated_at
      `,
      [userId, tenantId],
    );

    if (!rows[0]) return res.status(404).json({ message: "User not found" });
    res.json({ data: rows[0] });
  });

  return router;
}
