import jwt from "jsonwebtoken";

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

const JWT_SECRET = mustEnv("JWT_SECRET");

export type AuthUser = {
  sub: string;
  tenantId: string;
  role: "ADMIN" | "MANAGER" | "AGENT";
  email?: string;
  username?: string;
  name?: string;
};

// declare global {
//   namespace Express {
//     interface Request {
//       user?: AuthUser;
//     }
//   }
// }

export function requireAuth(req: any, res: any, next: any) {
  try {
    const header = req.headers.authorization || "";
    const [type, token] = header.split(" ");
    if (type !== "Bearer" || !token) {
      return res.status(401).json({ statusCode: 401, message: "Unauthorized" });
    }

    const payload = jwt.verify(token, JWT_SECRET) as AuthUser;
    req.user = payload;
    return next();
  } catch {
    return res.status(401).json({ statusCode: 401, message: "Unauthorized" });
  }
}
