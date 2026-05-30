import type { NextFunction, Request, Response } from "express";

export function requireSuperAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const user = (req as any).user;

  if (!user?.is_super_admin) {
    return res.status(403).json({
      statusCode: 403,
      message: "Only super admin can access this resource",
      data: null,
    });
  }

  next();
}
