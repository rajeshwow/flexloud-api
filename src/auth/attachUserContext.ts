import { NextFunction, Request, Response } from "express";
import { pool } from "../db/pool"; // adjust if needed

export async function attachUserContext(
  req: Request,
  _res: Response,
  next: NextFunction,
) {
  try {
    const sub = req.user?.sub;
    const email = req.user?.email;

    if (!sub && !email) {
      throw Object.assign(new Error("Unauthorized"), { statusCode: 401 });
    }

    const { rows } = await pool.query(
      `
      SELECT id, tenant_id, role, is_active, email, name
      FROM users
      WHERE (identity_sub = $1 OR email = $2)
      LIMIT 1
      `,
      [sub ?? null, email ?? null],
    );

    const u = rows[0];
    if (!u)
      throw Object.assign(new Error("User not registered"), {
        statusCode: 401,
      });
    if (!u.is_active)
      throw Object.assign(new Error("User inactive"), { statusCode: 403 });

    req.user = {
      ...req.user!,
      id: u.id,
      tenantId: u.tenant_id,
      role: u.role,
      isActive: u.is_active,
      email: u.email ?? req.user?.email,
      name: u.name ?? req.user?.name,
    };

    // ✅ now your existing getTenantId(req) can simply use req.user.tenantId
    (req as any).tenantId = u.tenant_id;

    next();
  } catch (e) {
    next(e);
  }
}
