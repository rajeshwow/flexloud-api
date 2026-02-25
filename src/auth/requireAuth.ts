import { NextFunction, Request, Response } from "express";
import { requestContext } from "../observability/requestContext";
import { verifyIdToken } from "./jwks";
import type { AuthUser } from "./types";

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export async function requireAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
) {
  try {
    const h = req.header("Authorization");
    if (!h?.startsWith("Bearer "))
      throw Object.assign(new Error("Unauthorized"), { statusCode: 401 });

    const token = h.slice("Bearer ".length).trim();
    const payload = await verifyIdToken(token);

    const user: AuthUser = {
      sub: String(payload.sub),
      email: payload.email ? String(payload.email) : undefined,
      name: payload.name ? String(payload.name) : undefined,
    };

    req.user = user;

    const ctx = requestContext.getStore();
    if (ctx) ctx.userId = user.sub;

    next();
  } catch {
    next(Object.assign(new Error("Unauthorized"), { statusCode: 401 }));
  }
}
