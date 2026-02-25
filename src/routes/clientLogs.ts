import { Router } from "express";
import { z } from "zod";
import { logger } from "../config/logger";

const schema = z.object({
  level: z.string(),
  msg: z.string(),
  ts: z.string(),
  route: z.string().optional(),
  context: z.record(z.any()).optional(),
});

export function clientLogsRouter() {
  const r = Router();
  r.post("/", (req, res) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({ error: "invalid log payload" });
    logger.info({ clientLog: parsed.data }, "client.log");
    res.status(204).send();
  });
  return r;
}
