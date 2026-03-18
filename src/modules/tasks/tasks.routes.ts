import { Router } from "express";
import { requireAuth } from "../../common/auth";
import {
  createTaskHandler,
  deleteTaskHandler,
  getTaskByIdHandler,
  getTasksHandler,
  updateTaskHandler,
} from "./tasks.service";

const tasksRouter = Router();

tasksRouter.use(requireAuth);

tasksRouter.get("/", getTasksHandler);
tasksRouter.get("/:id", getTaskByIdHandler);
tasksRouter.post("/", createTaskHandler);
tasksRouter.patch("/:id", updateTaskHandler);
tasksRouter.delete("/:id", deleteTaskHandler);

export default tasksRouter;
