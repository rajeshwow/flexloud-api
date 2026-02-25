import pino from "pino";
import { env } from "./env";

export const logger = pino({
  level: env.LOG_LEVEL,
  base: undefined,
  messageKey: "message",
  timestamp: () => `,"ts":"${new Date().toISOString()}"`,
});
