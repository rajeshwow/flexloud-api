import { NextFunction, Request, Response } from "express";
import { logger } from "../config/logger";
import { requestContext } from "./requestContext";

export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({ error: "Not Found" });
}

export function errorHandler(
  err: any,
  req: Request,
  res: Response,
  _next: NextFunction,
) {
  const ctx = requestContext.getStore();

  logger.error(
    {
      requestId: ctx?.requestId,
      route: req.originalUrl,
      err: { name: err?.name, message: err?.message },
    },
    "request failed",
  );

  const status = err.statusCode || err.status || 500;
  const safe =
    status === 500 ? "Internal Server Error" : String(err?.message ?? "Error");

  return res.status(status).json({
    statusCode: status,
    message: safe,
    requestId: ctx?.requestId,
  });
}
