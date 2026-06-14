import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { pool } from "../db/pool";

type LoginInput = {
  tenantId: string;
  identifier: string; // username or email
  password: string;
  ip?: string;
  userAgent?: string;
};

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function createHttpError(
  message: string,
  statusCode: number,
  code?: string,
  data: any = null,
) {
  return Object.assign(new Error(message), {
    statusCode,
    code,
    response: {
      statusCode,
      message,
      code,
      data,
    },
  });
}

const JWT_SECRET: jwt.Secret = mustEnv("JWT_SECRET");
const JWT_EXPIRES_IN = (process.env.JWT_EXPIRES_IN ??
  "7d") as jwt.SignOptions["expiresIn"];

export const authService = {
  async login(input: LoginInput) {
    const { tenantId, identifier, password } = input;

    /**
     * Step 1:
     * Tenant must exist, must not be deleted, and must be active.
     * This blocks fresh login for inactive tenants.
     */
    const tenantResult = await pool.query(
      `
      SELECT id, slug, name, COALESCE(status, 'active') AS status
      FROM public.tenants
      WHERE id = $1
        AND deleted_at IS NULL
      LIMIT 1
      `,
      [tenantId],
    );

    const tenant = tenantResult.rows[0];

    if (!tenant) {
      throw createHttpError("Invalid tenant", 404, "TENANT_NOT_FOUND", null);
    }

    if (String(tenant.status || "").toLowerCase() !== "active") {
      throw createHttpError(
        "Tenant is inactive. Please contact administrator.",
        403,
        "TENANT_INACTIVE",
        {
          tenant: {
            id: tenant.id,
            slug: tenant.slug,
            name: tenant.name,
            status: tenant.status,
          },
        },
      );
    }

    /**
     * Step 2:
     * Fetch user only inside this tenant.
     */
    const { rows } = await pool.query(
      `
      SELECT id, tenant_id, email, username, role, password_hash, name
      FROM public.users
      WHERE tenant_id = $1
        AND deleted_at IS NULL
        AND (lower(username) = lower($2) OR lower(email) = lower($2))
      LIMIT 1
      `,
      [tenantId, identifier],
    );

    const user = rows[0];

    if (!user || !user.password_hash) {
      throw createHttpError(
        "Invalid credentials",
        401,
        "INVALID_CREDENTIALS",
        null,
      );
    }

    const ok = await bcrypt.compare(password, user.password_hash);

    if (!ok) {
      throw createHttpError(
        "Invalid credentials",
        401,
        "INVALID_CREDENTIALS",
        null,
      );
    }

    const payload = {
      sub: user.id,
      tenantId: user.tenant_id,
      role: user.role,
      email: user.email,
      username: user.username,
      name: user.name,
    };

    const accessToken = jwt.sign(payload, JWT_SECRET, {
      expiresIn: JWT_EXPIRES_IN,
    });

    return {
      accessToken,
      tokenType: "Bearer",
      expiresIn: JWT_EXPIRES_IN,
      user: {
        id: user.id,
        tenantId: user.tenant_id,
        role: user.role,
        email: user.email,
        username: user.username,
        name: user.name,
      },
      tenant: {
        id: tenant.id,
        slug: tenant.slug,
        name: tenant.name,
        status: tenant.status,
      },
    };
  },
};
