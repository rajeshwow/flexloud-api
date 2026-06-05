import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  PORT: z.coerce.number().default(8080),
  NODE_ENV: z.string().default("production"),

  CORS_ORIGINS: z
    .string()
    .default(
      "http://localhost:5173,http://127.0.0.1:5173,http://localhost:3000,http://127.0.0.1:3000",
    )
    .transform((s) =>
      s
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean),
    ),

  PG_HOST: z.string(),
  PG_PORT: z.coerce.number().default(5432),
  PG_DATABASE: z.string(),
  PG_USER: z.string(),
  PG_PASSWORD: z.string(),
  PG_SSLMODE: z.string().default("disable"),

  JWT_ISSUER: z.string(),
  JWT_AUDIENCE: z.string(),

  ATTENDANCE_DISTANCE_THRESHOLD_KM: z.coerce.number().positive().default(5),
  ATTENDANCE_DISTANCE_REPORT_CRON: z.string().default("0 9 * * 1"),
  ATTENDANCE_DISTANCE_REPORT_TIMEZONE: z
    .string()
    .default("Asia/Kolkata"),

  LOG_LEVEL: z.string().default("info"),
});

export const env = schema.parse(process.env);
