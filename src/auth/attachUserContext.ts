import { NextFunction, Request, Response } from "express";
import { getTenantId } from "../common/tenant";
import { pool } from "../db/pool";

type Role = "ADMIN" | "MANAGER" | "AGENT";
const Roles: Role[] = ["ADMIN", "MANAGER", "AGENT"];
const isRole = (v: any): v is Role => Roles.includes(v);

export async function attachUserContext(
  req: Request,
  _res: Response,
  next: NextFunction,
) {
  try {
    const userId = (req.user as any)?.sub;
    const tenantId = getTenantId(req);

    if (!userId || !tenantId) {
      throw Object.assign(new Error("Unauthorized"), { statusCode: 401 });
    }

    const { rows } = await pool.query(
      `
      SELECT id, tenant_id, role, is_active, email, name, username
      FROM users
      WHERE id = $1 AND tenant_id = $2
      LIMIT 1
      `,
      [String(userId), String(tenantId)],
    );

    const u = rows[0];

    if (!u) {
      throw Object.assign(new Error("User not registered"), {
        statusCode: 401,
      });
    }

    if (!u.is_active) {
      throw Object.assign(new Error("User inactive"), { statusCode: 403 });
    }

    if (!isRole(u.role)) {
      throw Object.assign(new Error("Invalid role"), { statusCode: 500 });
    }

    req.user = {
      ...(req.user as any),
      id: String(u.id),
      tenantId: String(u.tenant_id),
      role: u.role as Role,
      isActive: Boolean(u.is_active),
      email: u.email ?? undefined,
      name: u.name ?? undefined,
      username: u.username ?? undefined,
    } as any;

    (req as any).tenantId = String(u.tenant_id);

    next();
  } catch (e) {
    next(e);
  }
}
