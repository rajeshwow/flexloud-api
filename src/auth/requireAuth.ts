import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import type { AuthUser } from "./types";

const JWT_SECRET = process.env.JWT_SECRET!;
if (!JWT_SECRET) throw new Error("Missing env: JWT_SECRET");

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser & { tenantId?: string; role?: string };
    }
  }
}

type Role = "ADMIN" | "MANAGER" | "AGENT";
const Roles: Role[] = ["ADMIN", "MANAGER", "AGENT"];

function isRole(x: any): x is Role {
  return Roles.includes(x);
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const h = req.header("Authorization");
    if (!h?.startsWith("Bearer "))
      throw Object.assign(new Error("Unauthorized"), { statusCode: 401 });

    const token = h.slice("Bearer ".length).trim();
    const payload = jwt.verify(token, JWT_SECRET) as any;

    // ✅ must have role
    if (!isRole(payload.role)) {
      throw Object.assign(new Error("Unauthorized"), { statusCode: 401 });
    }

    req.user = {
      sub: String(payload.sub),
      email: payload.email ? String(payload.email) : undefined,
      name: payload.name ? String(payload.name) : undefined,
      tenantId: payload.tenantId ? String(payload.tenantId) : undefined,
      role: payload.role, // ✅ typed Role now
    } as any;

    next();
  } catch (e) {
    next(Object.assign(new Error("Unauthorized"), { statusCode: 401 }));
  }
}
