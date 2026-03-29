import { Router } from "express";
import { requirePermissions } from "../../common/requirePermissions";
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

router.get("/", requirePermissions(["USERS.VIEW"]), listUsersHandler);
router.get("/:id", requirePermissions(["USERS.VIEW"]), getUserByIdHandler);
router.post("/", requirePermissions(["USERS.CREATE"]), createUserHandler);
router.patch("/:id", requirePermissions(["USERS.EDIT"]), updateUserHandler);
router.patch(
  "/:id/role",
  requirePermissions(["USERS.EDIT"]),
  updateRoleHandler,
);
router.patch(
  "/:id/status",
  requirePermissions(["USERS.EDIT"]),
  updateStatusHandler,
);
router.delete(
  "/:id",
  requirePermissions(["USERS.DELETE"]),
  deactivateUserHandler,
);

export default router;
