import { Router } from "express";
import {
  createUserHandler,
  deactivateUserHandler,
  getMyTargetProgressHandler,
  getUserByIdHandler,
  listUsersHandler,
  setUserTargetHandler,
  updateRoleHandler,
  updateStatusHandler,
  updateUserHandler,
  updateUserStatusHandler,
} from "./users.service";

const router = Router();

router.get("/", listUsersHandler);
router.get("/:id", getUserByIdHandler);
router.post("/", createUserHandler);
router.patch("/:id", updateUserHandler);
router.patch("/:id/role", updateRoleHandler);
router.patch("/:id/status", updateStatusHandler);
router.delete("/:id", deactivateUserHandler);
router.patch("/:id/target", setUserTargetHandler);
router.patch("/:id/status", updateUserStatusHandler);
router.get("/me/target-progress", getMyTargetProgressHandler);

export default router;
