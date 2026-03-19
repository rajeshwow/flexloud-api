import { Router } from "express";
import { requireAuth } from "../../common/auth";
import {
  clockInHandler,
  clockOutHandler,
  createAttendanceRequestHandler,
  getAttendanceCalendarHandler,
  getAttendanceMetricsHandler,
  getMyAttendanceHistoryHandler,
  getMyTodayAttendanceHandler,
} from "./attendance.service";

const attendanceRouter = Router();

attendanceRouter.use(requireAuth);

attendanceRouter.get("/me/today", getMyTodayAttendanceHandler);
attendanceRouter.post("/me/clock-in", clockInHandler);
attendanceRouter.post("/me/clock-out", clockOutHandler);
attendanceRouter.get("/me/history", getMyAttendanceHistoryHandler);

/* new */
attendanceRouter.get("/me/calendar", getAttendanceCalendarHandler);
attendanceRouter.get("/me/metrics", getAttendanceMetricsHandler);
attendanceRouter.post("/me/requests", createAttendanceRequestHandler);

export default attendanceRouter;
