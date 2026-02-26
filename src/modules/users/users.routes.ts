import { Router } from "express";
import { z } from "zod";
import { getPagination } from "../../common/pagination";
import { requireRoles } from "../../common/rbac";
import { getTenantId } from "../../common/tenant";
import { usersService } from "./users.service";

// ---------- Validators ----------
const RoleEnum = z.enum(["ADMIN", "MANAGER", "AGENT"]);

const CreateUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(2),
  role: RoleEnum.default("AGENT"),

  // optional extras
  phone_country_code: z.string().optional(),
  phone: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  country: z.string().optional(),
  postal_code: z.string().optional(),
  designation: z.string().optional(),
  department: z.string().optional(),
  employee_code: z.string().optional(),

  tempPassword: z.string().min(6).optional(),
  metadata: z.record(z.any()).optional(),

  // if you want username later:
  // username: z.string().min(3).optional(),
});

const UpdateUserSchema = z.object({
  name: z.string().min(2).optional(),
  display_name: z.string().optional(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),

  phone_country_code: z.string().optional(),
  phone: z.string().optional(),
  alt_phone_country_code: z.string().optional(),
  alt_phone: z.string().optional(),
  whatsapp_country_code: z.string().optional(),
  whatsapp_number: z.string().optional(),

  address_line_1: z.string().optional(),
  address_line_2: z.string().optional(),
  landmark: z.string().optional(),
  city: z.string().optional(),
  district: z.string().optional(),
  state: z.string().optional(),
  country: z.string().optional(),
  postal_code: z.string().optional(),

  designation: z.string().optional(),
  department: z.string().optional(),
  employee_code: z.string().optional(),

  timezone: z.string().optional(),
  language: z.string().optional(),

  avatar_url: z.string().url().optional(),

  metadata: z.record(z.any()).optional(),
});

const UpdateRoleSchema = z.object({
  role: RoleEnum,
});

const UpdateStatusSchema = z.object({
  is_active: z.boolean(),
});

// ---------- Router ----------
export function usersRouter() {
  const router = Router();

  router.get(
    "/",
    requireRoles(["ADMIN", "MANAGER"]),
    async (req: any, res, next) => {
      try {
        const tenantId = getTenantId(req);

        const search = (req.query.search as string | undefined)?.trim();
        const role = (req.query.role as string | undefined)?.trim();
        const active = req.query.active as string | undefined;

        const { page, limit, offset } = getPagination(req.query);

        const { rows, total } = await usersService.listUsers({
          tenantId,
          search,
          role,
          active: active as any,
          limit,
          offset,
        });

        return res.json({
          data: rows,
          meta: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
            hasNext: page * limit < total,
            hasPrev: page > 1,
          },
        });
      } catch (err) {
        next(err);
      }
    },
  );

  router.get(
    "/:id",
    requireRoles(["ADMIN", "MANAGER"]),
    async (req: any, res, next) => {
      try {
        const tenantId = getTenantId(req);
        const userId = req.params.id;

        const user = await usersService.getUserById(tenantId, userId);
        if (!user) return res.status(404).json({ message: "User not found" });

        res.json({ data: user });
      } catch (err) {
        next(err);
      }
    },
  );

  router.post("/", requireRoles(["ADMIN"]), async (req: any, res, next) => {
    try {
      const tenantId = getTenantId(req);
      const body = CreateUserSchema.parse(req.body);

      const { user, tempPassword } = await usersService.createUser({
        tenantId,
        email: body.email,
        name: body.name,
        role: body.role,

        // username: body.username ?? null, // when schema enabled

        tempPassword: body.tempPassword,

        phone_country_code: body.phone_country_code ?? null,
        phone: body.phone ?? null,
        city: body.city ?? null,
        state: body.state ?? null,
        country: body.country ?? null,
        postal_code: body.postal_code ?? null,

        designation: body.designation ?? null,
        department: body.department ?? null,
        employee_code: body.employee_code ?? null,

        metadata: body.metadata ?? null,
      });

      return res.status(201).json({
        data: user,
        tempPassword, // ✅ HR flow
      });
    } catch (err: any) {
      if (err?.statusCode)
        return res.status(err.statusCode).json({ message: err.message });
      if (err?.code === "23505")
        return res.status(409).json({ message: "User already exists" });
      next(err);
    }
  });

  router.patch("/:id", requireRoles(["ADMIN"]), async (req: any, res, next) => {
    try {
      const tenantId = getTenantId(req);
      const userId = req.params.id;
      const body = UpdateUserSchema.parse(req.body);

      const user = await usersService.updateUser({
        tenantId,
        userId,
        patch: body,
      });

      if (!user) return res.status(404).json({ message: "User not found" });
      res.json({ data: user });
    } catch (err: any) {
      if (err?.statusCode)
        return res.status(err.statusCode).json({ message: err.message });
      next(err);
    }
  });

  router.patch(
    "/:id/role",
    requireRoles(["ADMIN"]),
    async (req: any, res, next) => {
      try {
        const tenantId = getTenantId(req);
        const userId = req.params.id;
        const body = UpdateRoleSchema.parse(req.body);

        const user = await usersService.updateRole(tenantId, userId, body.role);
        if (!user) return res.status(404).json({ message: "User not found" });

        res.json({ data: user });
      } catch (err) {
        next(err);
      }
    },
  );

  router.patch(
    "/:id/status",
    requireRoles(["ADMIN"]),
    async (req: any, res, next) => {
      try {
        const tenantId = getTenantId(req);
        const userId = req.params.id;
        const body = UpdateStatusSchema.parse(req.body);

        const user = await usersService.updateStatus(
          tenantId,
          userId,
          body.is_active,
        );
        if (!user) return res.status(404).json({ message: "User not found" });

        res.json({ data: user });
      } catch (err) {
        next(err);
      }
    },
  );

  router.delete(
    "/:id",
    requireRoles(["ADMIN"]),
    async (req: any, res, next) => {
      try {
        const tenantId = getTenantId(req);
        const userId = req.params.id;

        const user = await usersService.deactivateUser(tenantId, userId);
        if (!user) return res.status(404).json({ message: "User not found" });

        res.json({ data: user });
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
