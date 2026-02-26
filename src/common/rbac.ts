export function getUserRole(req: any): string | undefined {
  return (
    req?.user?.role ||
    req?.auth?.role ||
    req?.context?.user?.role ||
    req?.context?.role ||
    req?.locals?.role ||
    req?.res?.locals?.user?.role
  );
}

import { NextFunction, Response } from "express";

type Role = "ADMIN" | "MANAGER" | "AGENT";

export function requireRoles(
  allowed: Role[],
  opts?: { message?: string; code?: string },
) {
  return (req: any, res: Response, next: NextFunction) => {
    const userRole: Role | undefined = req.user?.role; // assume requireAuth sets req.user

    // not logged in / role missing
    if (!userRole) {
      return res.status(401).json({
        message: "Unauthorized",
        code: "UNAUTHORIZED",
      });
    }

    if (!allowed.includes(userRole)) {
      return res.status(403).json({
        message:
          opts?.message ?? `Forbidden: ${userRole} cannot access this resource`,
        code: opts?.code ?? "FORBIDDEN",
        allowedRoles: allowed, // optional (frontend helpful)
      });
    }

    next();
  };
}
