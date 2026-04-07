import { Router } from "express";
import {
  getTaskPerformanceSummaryHandler,
  recalculateTaskPerformanceHandler,
} from "./task-performance.service";

export function taskPerformanceRouter() {
  const r = Router();

  r.get("/performance-summary", getTaskPerformanceSummaryHandler);
  r.post("/recalculate-performance", recalculateTaskPerformanceHandler);

  return r;
}
