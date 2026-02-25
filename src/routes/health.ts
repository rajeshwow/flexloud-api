import { Router } from "express";

export function healthRouter() {
  const r = Router();
  r.get("/", (_req, res) => res.status(200).send("ok"));
  return r;
}
