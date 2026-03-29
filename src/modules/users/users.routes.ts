import { Router } from "express";
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

router.get("/", listUsersHandler);
router.get("/:id", getUserByIdHandler);
router.post("/", createUserHandler);
router.patch("/:id", updateUserHandler);
router.patch("/:id/role", updateRoleHandler);
router.patch("/:id/status", updateStatusHandler);
router.delete("/:id", deactivateUserHandler);

export default router;
