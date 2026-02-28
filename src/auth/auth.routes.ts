import { Router } from "express";
import { z } from "zod";
import { getTenantId } from "../common/tenant";
import { authService } from "./auth.service";

export const authRouter = Router();

const LoginSchema = z
  .object({
    identifier: z.string().min(2).optional(),
    email: z.string().email().optional(),
    password: z.string().min(6),
  })
  .refine((d) => d.identifier || d.email, {
    message: "identifier or email is required",
    path: ["identifier"],
  });

authRouter.post("/login", async (req, res, next) => {
  try {
    const tenantId = getTenantId(req); // from slug middleware/header
    const body = LoginSchema.parse(req.body);
    const id = (body.identifier || body.email)!.trim().toLowerCase();

    const result = await authService.login({
      tenantId,
      identifier: id,
      password: body.password,
      ip: req.ip,
      userAgent: req.headers["user-agent"] || "",
    });

    return res.json({
      statusCode: 200,
      message: "Login successful",
      data: result,
    });
  } catch (err) {
    next(err);
  }
});
