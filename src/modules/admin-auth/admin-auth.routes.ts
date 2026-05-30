import { Router } from "express";
import { adminLogin } from "./admin-auth.service";

const adminAuthRouter = Router();

adminAuthRouter.post("/login", adminLogin);

export default adminAuthRouter;
