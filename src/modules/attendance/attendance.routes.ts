import { Router } from "express";
import { requireAuth } from "../../common/auth";
import {
  clockInHandler,
  clockOutHandler,
  getMyAttendanceHistoryHandler,
  getMyTodayAttendanceHandler,
} from "./attendance.service";

const attendanceRouter = Router();

attendanceRouter.use(requireAuth);

attendanceRouter.get("/me/today", getMyTodayAttendanceHandler);
attendanceRouter.post("/me/clock-in", clockInHandler);
attendanceRouter.post("/me/clock-out", clockOutHandler);
attendanceRouter.get("/me/history", getMyAttendanceHistoryHandler);

export default attendanceRouter;
