import { NextFunction, Request, Response } from "express";
import { requestContext } from "../observability/requestContext";
import { Role, hasRole } from "./roles";

export function requireRole(...allowed: Role[]) {
  return (_req: Request, _res: Response, next: NextFunction) => {
    const roles = requestContext.getStore()?.roles ?? [];
    const ok = allowed.some((r) => hasRole(roles, r));
    if (!ok)
      return next(Object.assign(new Error("Forbidden"), { statusCode: 403 }));
    next();
  };
}
