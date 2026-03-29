import { Router } from "express";
import {
  assignUsersToRoleHandler,
  cloneRoleHandler,
  createRoleHandler,
  getPermissionGroupsHandler,
  getRoleByIdHandler,
  listRolesHandler,
  updateRoleHandler,
  updateUserRolesHandler,
} from "./rbac.service";

const rbacRouter = Router();

rbacRouter.get("/permission-groups", getPermissionGroupsHandler);

rbacRouter.get("/roles", listRolesHandler);
rbacRouter.post("/roles", createRoleHandler);
rbacRouter.get("/roles/:id", getRoleByIdHandler);
rbacRouter.patch("/roles/:id", updateRoleHandler);
rbacRouter.post("/roles/:id/clone", cloneRoleHandler);
rbacRouter.put("/roles/:id/users", assignUsersToRoleHandler);

rbacRouter.patch("/users/:userId/roles", updateUserRolesHandler);

export default rbacRouter;
