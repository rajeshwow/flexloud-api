import { Router } from "express";
import { attachUserContext } from "../../auth/attachUserContext";
import { requireAuth } from "../../common/auth";
import { getMyPermissions } from "./me.service";

const router = Router();
router.get("/me/permissions", requireAuth, attachUserContext, getMyPermissions);
export default router;
