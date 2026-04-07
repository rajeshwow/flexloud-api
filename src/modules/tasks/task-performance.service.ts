import dayjs from "dayjs";
import { NextFunction, Request, Response } from "express";
import { getTenantId } from "../../common/tenant";
import { pool } from "../../db/pool";
import {
  GetTaskPerformanceSummarySchema,
  RecalculateTaskScoreSchema,
} from "./task-performance.schema";

function getPriorityMultiplier(priorityValue?: string | null) {
  switch ((priorityValue || "").toLowerCase()) {
    case "urgent":
      return 1.35;
    case "high":
      return 1.2;
    case "medium":
      return 1.1;
    default:
      return 1;
  }
}

function getCompletionScore(isCompleted: boolean, overdueDays: number) {
  if (!isCompleted) return 0;
  if (overdueDays < 0) return 25;
  if (overdueDays === 0) return 20;
  if (overdueDays === 1) return 12;
  if (overdueDays <= 3) return 6;
  return 0;
}

function getActivityScore(activityCount: number) {
  if (activityCount >= 3) return 10;
  if (activityCount === 2) return 6;
  if (activityCount === 1) return 3;
  return 0;
}

function getResponseScore(firstResponseMinutes: number | null) {
  if (firstResponseMinutes === null) return 0;
  if (firstResponseMinutes <= 120) return 10;
  if (firstResponseMinutes <= 1440) return 7;
  if (firstResponseMinutes <= 2880) return 5;
  return 2;
}

function getOverduePenalty(overdueDays: number) {
  if (overdueDays <= 0) return 0;
  if (overdueDays === 1) return 5;
  if (overdueDays === 2) return 10;
  if (overdueDays === 3) return 15;
  if (overdueDays <= 5) return 20;
  return 30;
}

function getScoreBand(score: number) {
  if (score >= 90) return "Outstanding";
  if (score >= 75) return "Strong Performer";
  if (score >= 60) return "Consistent";
  if (score >= 40) return "Needs Improvement";
  return "At Risk";
}

export async function calculateTaskPerformance(
  taskId: string,
  tenantId: string,
) {
  const taskResult = await pool.query(
    `
    SELECT
      t.*,
      pmv.value AS priority_value
    FROM tasks t
    LEFT JOIN master_values pmv ON pmv.id = t.priority_id
    WHERE t.id = $1
      AND t.tenant_id = $2
      AND t.deleted_at IS NULL
    LIMIT 1;
    `,
    [taskId, tenantId],
  );

  if (!taskResult.rows.length) return null;

  const task = taskResult.rows[0];

  const activityResult = await pool.query(
    `
    SELECT
      COUNT(*)::int AS activity_count,
      MIN(created_at) AS first_activity_at
    FROM task_activities
    WHERE task_id = $1
      AND tenant_id = $2;
    `,
    [taskId, tenantId],
  );

  const activityRow = activityResult.rows[0];
  const activityCount = Number(activityRow?.activity_count || 0);
  const firstActivityAt = activityRow?.first_activity_at
    ? dayjs(activityRow.first_activity_at)
    : null;

  const taskCreatedAt = task?.created_at ? dayjs(task.created_at) : null;
  const endDate = task?.end_date ? dayjs(task.end_date) : null;
  const updatedAt = task?.updated_at ? dayjs(task.updated_at) : null;

  const isCompleted = task?.status === "completed";

  let overdueDays = 0;
  let completionDelayMinutes = 0;

  if (endDate) {
    const compareDate = isCompleted && updatedAt ? updatedAt : dayjs();

    if (compareDate.isAfter(endDate)) {
      completionDelayMinutes = compareDate.diff(endDate, "minute");
      overdueDays = Math.ceil(completionDelayMinutes / (60 * 24));
    } else if (isCompleted && compareDate.isBefore(endDate)) {
      overdueDays = -Math.ceil(endDate.diff(compareDate, "minute") / (60 * 24));
    }
  }

  const firstResponseMinutes =
    firstActivityAt && taskCreatedAt
      ? firstActivityAt.diff(taskCreatedAt, "minute")
      : null;

  const completionScore = getCompletionScore(isCompleted, overdueDays);
  const activityScore = getActivityScore(activityCount);
  const responseScore = getResponseScore(firstResponseMinutes);
  const overduePenalty = getOverduePenalty(Math.max(0, overdueDays));
  const priorityMultiplier = getPriorityMultiplier(task?.priority_value);

  const rawScore =
    (50 + completionScore + activityScore + responseScore - overduePenalty) *
    priorityMultiplier;

  const finalScore = Math.max(0, Math.min(100, Number(rawScore.toFixed(2))));
  const scoreBand = getScoreBand(finalScore);

  await pool.query(
    `
    INSERT INTO task_performance_metrics (
      tenant_id,
      task_id,
      assigned_to,
      is_completed,
      is_overdue,
      completed_on_time,
      overdue_days,
      completion_delay_minutes,
      first_response_minutes,
      activity_count,
      completion_score,
      activity_score,
      response_score,
      overdue_penalty,
      priority_multiplier,
      final_score,
      score_band,
      calculated_at,
      updated_at
    )
    VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
      $11,$12,$13,$14,$15,$16,$17,now(),now()
    )
    ON CONFLICT (task_id)
    DO UPDATE SET
      assigned_to = EXCLUDED.assigned_to,
      is_completed = EXCLUDED.is_completed,
      is_overdue = EXCLUDED.is_overdue,
      completed_on_time = EXCLUDED.completed_on_time,
      overdue_days = EXCLUDED.overdue_days,
      completion_delay_minutes = EXCLUDED.completion_delay_minutes,
      first_response_minutes = EXCLUDED.first_response_minutes,
      activity_count = EXCLUDED.activity_count,
      completion_score = EXCLUDED.completion_score,
      activity_score = EXCLUDED.activity_score,
      response_score = EXCLUDED.response_score,
      overdue_penalty = EXCLUDED.overdue_penalty,
      priority_multiplier = EXCLUDED.priority_multiplier,
      final_score = EXCLUDED.final_score,
      score_band = EXCLUDED.score_band,
      calculated_at = now(),
      updated_at = now();
    `,
    [
      tenantId,
      taskId,
      task.assigned_to ?? null,
      isCompleted,
      overdueDays > 0,
      isCompleted && overdueDays <= 0,
      Math.max(0, overdueDays),
      Math.max(0, completionDelayMinutes),
      firstResponseMinutes,
      activityCount,
      completionScore,
      activityScore,
      responseScore,
      overduePenalty,
      priorityMultiplier,
      finalScore,
      scoreBand,
    ],
  );

  return {
    task_id: taskId,
    final_score: finalScore,
    score_band: scoreBand,
    activity_count: activityCount,
    overdue_days: Math.max(0, overdueDays),
    first_response_minutes: firstResponseMinutes,
    is_completed: isCompleted,
  };
}

export async function recalculateTaskPerformanceHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const tenantId = getTenantId(req);
    const parsed = RecalculateTaskScoreSchema.parse(req.body);

    const data = await calculateTaskPerformance(parsed.task_id, tenantId);

    return res.status(200).json({
      message: "Task performance recalculated successfully",
      data,
      statusCode: 200,
    });
  } catch (error) {
    next(error);
  }
}

export async function getTaskPerformanceSummaryHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const tenantId = getTenantId(req);
    const parsed = GetTaskPerformanceSummarySchema.parse(req.query);

    const fromDate = dayjs(
      `${parsed.year}-${String(parsed.month).padStart(2, "0")}-01`,
    )
      .startOf("month")
      .toISOString();

    const toDate = dayjs(fromDate).endOf("month").toISOString();

    const values: Array<string | number> = [tenantId, fromDate, toDate];
    let idx = 4;

    let extraWhere = "";
    if (parsed.assigned_to) {
      extraWhere += ` AND m.assigned_to = $${idx}`;
      values.push(parsed.assigned_to);
      idx++;
    }

    const summaryQuery = `
      SELECT
        m.assigned_to,
        COALESCE(
          NULLIF(TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))), ''),
          u.name,
          u.email
        ) AS assigned_to_name,
        COUNT(*)::int AS total_tasks,
        COUNT(*) FILTER (WHERE m.is_completed = true)::int AS completed_tasks,
        COUNT(*) FILTER (WHERE m.completed_on_time = true)::int AS on_time_completed_tasks,
        COUNT(*) FILTER (WHERE m.is_overdue = true)::int AS overdue_tasks,
        ROUND(AVG(m.final_score)::numeric, 2) AS avg_score,
        ROUND(
          (
            COUNT(*) FILTER (WHERE m.completed_on_time = true)::numeric
            / NULLIF(COUNT(*) FILTER (WHERE m.is_completed = true), 0)
          ) * 100,
          2
        ) AS on_time_completion_rate
      FROM task_performance_metrics m
      LEFT JOIN users u ON u.id = m.assigned_to
      WHERE m.tenant_id = $1
        AND m.calculated_at >= $2
        AND m.calculated_at <= $3
        ${extraWhere}
      GROUP BY m.assigned_to, u.first_name, u.last_name, u.name, u.email
      ORDER BY avg_score DESC NULLS LAST;
    `;

    const result = await pool.query(summaryQuery, values);

    return res.status(200).json({
      message: "Task performance summary fetched successfully",
      data: result.rows,
      statusCode: 200,
    });
  } catch (error) {
    next(error);
  }
}
