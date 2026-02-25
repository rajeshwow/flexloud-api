import { NextFunction, Request, Response } from "express";
import crypto from "node:crypto";
import pinoHttp from "pino-http";
import { logger } from "../config/logger";
import { requestContext } from "./requestContext";

function newRequestId() {
  return crypto.randomUUID();
}

export function requestLoggingMiddleware() {
  const httpLogger = pinoHttp({
    logger,
    customProps: (req) => {
      const ctx = requestContext.getStore();
      return {
        requestId: ctx?.requestId,
        tenantId: ctx?.tenantId,
        userId: ctx?.userId,
        roles: ctx?.roles,
        // route: req?.originalUrl,
      };
    },
  });

  return (req: Request, res: Response, next: NextFunction) => {
    const inbound = req.header("X-Request-Id");
    const requestId =
      inbound && inbound.length <= 128 ? inbound : newRequestId();
    res.setHeader("X-Request-Id", requestId);

    requestContext.run({ requestId }, () => {
      httpLogger(req, res);
      next();
    });
  };
}
