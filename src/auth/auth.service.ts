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

const JWT_SECRET: jwt.Secret = mustEnv("JWT_SECRET");
const JWT_EXPIRES_IN = (process.env.JWT_EXPIRES_IN ??
  "7d") as jwt.SignOptions["expiresIn"];

export const authService = {
  async login(input: LoginInput) {
    const { tenantId, identifier, password } = input;

    // fetch user by username OR email in tenant
    const { rows } = await pool.query(
      `
      SELECT id, tenant_id, email, username, role, password_hash, name
      FROM users
      WHERE tenant_id = $1
        AND (lower(username) = lower($2) OR lower(email) = lower($2))
      LIMIT 1
      `,
      [tenantId, identifier],
    );

    const user = rows[0];
    if (!user || !user.password_hash) {
      const e: any = new Error("Invalid credentials");
      e.statusCode = 401;
      throw e;
    }

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      const e: any = new Error("Invalid credentials");
      e.statusCode = 401;
      throw e;
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
    };
  },
};
