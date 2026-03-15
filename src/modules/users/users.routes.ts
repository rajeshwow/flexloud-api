import { Router } from "express";
import { requireRoles } from "../../common/rbac";
import {
  createUserHandler,
  deactivateUserHandler,
  getUserByIdHandler,
  listUsersHandler,
  updateRoleHandler,
  updateStatusHandler,
  updateUserHandler,
} from "./users.service";

const router = Router();

router.get("/", requireRoles(["ADMIN", "MANAGER"]), listUsersHandler);
router.get("/:id", requireRoles(["ADMIN", "MANAGER"]), getUserByIdHandler);
router.post("/", requireRoles(["ADMIN"]), createUserHandler);
router.patch("/:id", requireRoles(["ADMIN"]), updateUserHandler);
router.patch("/:id/role", requireRoles(["ADMIN"]), updateRoleHandler);
router.patch("/:id/status", requireRoles(["ADMIN"]), updateStatusHandler);
router.delete("/:id", requireRoles(["ADMIN"]), deactivateUserHandler);

export default router;
