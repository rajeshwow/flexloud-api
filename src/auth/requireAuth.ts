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

function sendAuthError(
  res: Response,
  message: string,
  code: string,
  statusCode = 401,
) {
  return res.status(statusCode).json({
    statusCode,
    message,
    data: {
      code,
    },
  });
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const h = req.header("Authorization");

    if (!h?.startsWith("Bearer ")) {
      return sendAuthError(res, "Unauthorized", "AUTH_REQUIRED", 401);
    }

    const token = h.slice("Bearer ".length).trim();

    if (!token) {
      return sendAuthError(res, "Unauthorized", "AUTH_REQUIRED", 401);
    }

    const payload = jwt.verify(token, JWT_SECRET) as any;

    if (!isRole(payload.role)) {
      return sendAuthError(res, "Invalid token", "INVALID_TOKEN", 401);
    }

    req.user = {
      sub: String(payload.sub),
      email: payload.email ? String(payload.email) : undefined,
      name: payload.name ? String(payload.name) : undefined,
      tenantId: payload.tenantId ? String(payload.tenantId) : undefined,
      role: payload.role,
    } as any;

    next();
  } catch (e: any) {
    const errorName = e?.name || "";

    if (errorName === "TokenExpiredError") {
      return sendAuthError(
        res,
        "Token expired. Please login again.",
        "TOKEN_EXPIRED",
        401,
      );
    }

    if (errorName === "JsonWebTokenError") {
      return sendAuthError(res, "Invalid token", "INVALID_TOKEN", 401);
    }

    return sendAuthError(res, "Unauthorized", "UNAUTHORIZED", 401);
  }
}
