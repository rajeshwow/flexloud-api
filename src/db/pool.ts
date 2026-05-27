import { Pool } from "pg";
import { env } from "../config/env";

export const pool = new Pool({
  host: env.PG_HOST,
  port: env.PG_PORT,
  database: env.PG_DATABASE,
  user: env.PG_USER,
  password: env.PG_PASSWORD,
  ssl: env.PG_SSLMODE === "require" ? { rejectUnauthorized: false } : undefined,
  max: 15,
  options: "-c search_path=public",
});
pool.on("connect", () => {
  console.log("✅ PostgreSQL connected");
});
pool.on("error", (err) => {
  console.error("❌ PostgreSQL error", err);
});
