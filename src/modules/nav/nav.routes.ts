import { Router } from "express";
import { attachUserContext } from "../../auth/attachUserContext";
import { requireAuth } from "../../common/auth";
import { getMenuForMe } from "./nav.service";

const router = Router();

router.get("/nav/menu", requireAuth, attachUserContext, getMenuForMe);

export default router;
