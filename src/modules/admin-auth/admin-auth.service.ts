import bcrypt from "bcryptjs";
import type { Request, Response } from "express";
import jwt from "jsonwebtoken";
import { pool } from "../../db/pool";
import { adminLoginSchema } from "./admin-auth.schema";

const response = (
  res: Response,
  statusCode: number,
  message: string,
  data: any = null,
) => {
  return res.status(statusCode).json({
    statusCode,
    message,
    data,
  });
};

export async function adminLogin(req: Request, res: Response) {
  try {
    const parsed = adminLoginSchema.safeParse(req.body);

    if (!parsed.success) {
      return response(res, 400, "Validation failed", parsed.error.flatten());
    }

    const { email, password } = parsed.data;

    const userResult = await pool.query(
      `
      SELECT
        id,
        tenant_id,
        name,
        email,
        password_hash,
        is_super_admin,
        is_active
      FROM users
      WHERE lower(email) = lower($1)
        AND deleted_at IS NULL
      LIMIT 1
      `,
      [email.trim()],
    );

    if (!userResult.rowCount) {
      return response(res, 401, "Invalid email or password", null);
    }

    const user = userResult.rows[0];

    if (!user.is_super_admin) {
      return response(
        res,
        403,
        "Only super admin can access admin panel",
        null,
      );
    }

    if (user.is_active === false) {
      return response(res, 403, "Your account is inactive", null);
    }

    if (!user.password_hash) {
      return response(res, 401, "Password is not configured", null);
    }

    const isPasswordValid = await bcrypt.compare(password, user.password_hash);

    if (!isPasswordValid) {
      return response(res, 401, "Invalid email or password", null);
    }

    const accessToken = jwt.sign(
      {
        id: user.id,
        tenant_id: user.tenant_id,
        email: user.email,
        is_super_admin: user.is_super_admin,
      },
      process.env.JWT_SECRET as string,
      {
        expiresIn: (process.env.JWT_EXPIRES_IN ||
          "7d") as jwt.SignOptions["expiresIn"],
      },
    );

    return response(res, 200, "Super admin login successful", {
      accessToken,
      user: {
        id: user.id,
        tenant_id: user.tenant_id,
        name: user.name,
        email: user.email,
        is_super_admin: user.is_super_admin,
      },
    });
  } catch (error: any) {
    console.error("adminLogin error:", error);

    return response(res, 500, "Failed to login", {
      error: error?.message,
    });
  }
}
