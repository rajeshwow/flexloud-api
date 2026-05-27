import { Response } from "express";
import { pool } from "../../db/pool";
import {
  createAllDueNotificationJobs,
  processPendingNotificationJobs,
} from "./notifications.scheduler";

export async function listNotificationJobsHandler(req: any, res: Response) {
  const tenantId = req.tenant?.id;
  const status = String(req.query.status || "");
  const moduleKey = String(req.query.module_key || "");
  const eventKey = String(req.query.event_key || "");
  const limit = Math.min(Number(req.query.limit || 50), 100);

  const params: any[] = [tenantId];
  let where = `WHERE tenant_id = $1`;

  if (status) {
    params.push(status);
    where += ` AND status = $${params.length}`;
  }

  if (moduleKey) {
    params.push(moduleKey);
    where += ` AND module_key = $${params.length}`;
  }

  if (eventKey) {
    params.push(eventKey);
    where += ` AND event_key = $${params.length}`;
  }

  params.push(limit);

  const { rows } = await pool.query(
    `
    SELECT
      id,
      tenant_id,
      module_key,
      event_key,
      entity_type,
      entity_id,
      recipient_user_id,
      recipient_email,
      subject,
      body,
      status,
      scheduled_at,
      sent_at,
      retry_count,
      last_error,
      dedupe_key,
      created_at,
      updated_at
    FROM notification_jobs
    ${where}
    ORDER BY created_at DESC
    LIMIT $${params.length}
    `,
    params,
  );

  return res.json({
    statusCode: 200,
    message: "Notification jobs fetched successfully",
    data: rows,
  });
}

export async function retryNotificationJobHandler(req: any, res: Response) {
  const tenantId = req.tenant?.id;
  const { id } = req.params;

  const { rows } = await pool.query(
    `
    UPDATE notification_jobs
    SET status = 'pending',
        retry_count = 0,
        last_error = NULL,
        scheduled_at = now(),
        updated_at = now()
    WHERE tenant_id = $1
      AND id = $2
      AND status = 'failed'
    RETURNING *
    `,
    [tenantId, id],
  );

  return res.json({
    statusCode: 200,
    message: rows[0]
      ? "Notification job queued for retry"
      : "No failed notification job found",
    data: rows[0] || null,
  });
}

export async function runNotificationSchedulerNowHandler(
  req: any,
  res: Response,
) {
  await createAllDueNotificationJobs();
  await processPendingNotificationJobs();

  return res.json({
    statusCode: 200,
    message: "Notification scheduler executed successfully",
    data: null,
  });
}
