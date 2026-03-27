import { randomUUID } from "crypto";
import { NextFunction, Request, Response } from "express";
import { PoolClient } from "pg";
import { getTenantId } from "../../common/tenant";
import { pool } from "../../db/pool";

function buildInteractionNumber() {
  return `INT-${Date.now()}`;
}

function getDurationMinutes(startAt: string, endAt: string) {
  const start = new Date(startAt).getTime();
  const end = new Date(endAt).getTime();

  if (Number.isNaN(start) || Number.isNaN(end) || end < start) {
    return 0;
  }

  return Math.round((end - start) / (1000 * 60));
}

function formatValue(value: any) {
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
}

function getInteractionLabel(type?: string | null) {
  if (type === "meeting") return "Meeting";
  if (type === "call") return "Call";
  return "Activity";
}

function formatActivityDate(value: any) {
  if (!value) return "—";

  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);

  return d.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function formatActivityFieldValue(key: string, value: any) {
  if (value === null || value === undefined || value === "") return "—";

  if (["start_at", "end_at", "created_at", "updated_at"].includes(key)) {
    return formatActivityDate(value);
  }

  if (key === "duration_minutes") {
    return `${value} min`;
  }

  if (key === "type") {
    return getInteractionLabel(value);
  }

  if (typeof value === "string") {
    return value
      .replace(/_/g, " ")
      .replace(/\b\w/g, (char) => char.toUpperCase());
  }

  return String(value);
}

function buildCreateActivityBody(input: {
  type: string;
  subject: string;
  status: string;
  related_to_type?: string | null;
  start_at: string;
  end_at: string;
}) {
  return [
    `${getInteractionLabel(input.type)} created`,
    `Subject: ${formatValue(input.subject)}`,
    `Status: ${formatActivityFieldValue("status", input.status)}`,
    `Related Type: ${formatActivityFieldValue("related_to_type", input.related_to_type)}`,
    `Start: ${formatActivityDate(input.start_at)}`,
    `End: ${formatActivityDate(input.end_at)}`,
  ].join(" | ");
}

function buildUpdateActivityBody(
  previous: Record<string, any>,
  next: Record<string, any>,
) {
  const fields = [
    { key: "type", label: "Type" },
    { key: "subject", label: "Subject" },
    { key: "status", label: "Status" },
    { key: "related_to_type", label: "Related Type" },
    { key: "start_at", label: "Start Time" },
    { key: "end_at", label: "End Time" },
    { key: "duration_minutes", label: "Duration" },
    { key: "location", label: "Location" },
    { key: "description", label: "Description" },
    { key: "call_purpose", label: "Call Purpose" },
    { key: "call_outcome", label: "Call Outcome" },
  ];

  const changes: string[] = [];

  for (const field of fields) {
    const oldValue = previous[field.key];
    const newValue = next[field.key];

    const oldFormatted = formatActivityFieldValue(field.key, oldValue);
    const newFormatted = formatActivityFieldValue(field.key, newValue);

    if (oldFormatted !== newFormatted) {
      changes.push(`${field.label}: ${oldFormatted} → ${newFormatted}`);
    }
  }

  if (!changes.length) {
    return `${getInteractionLabel(next.type)} updated`;
  }

  return `${getInteractionLabel(next.type)} updated | ${changes.join(" | ")}`;
}

async function addInteractionActivity(
  client: PoolClient,
  input: {
    tenantId: string;
    interactionId: string;
    actorUserId: string | null;
    type: string;
    body: string;
  },
) {
  await client.query(
    `
    INSERT INTO interaction_activities (
      id,
      tenant_id,
      interaction_id,
      type,
      body,
      created_by,
      created_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, NOW())
    `,
    [
      randomUUID(),
      input.tenantId,
      input.interactionId,
      input.type,
      input.body,
      input.actorUserId,
    ],
  );
}

async function replaceReminders(
  client: PoolClient,
  tenantId: string,
  interactionId: string,
  reminders: Array<{ minutes_before: number }> = [],
) {
  await client.query(
    `
    DELETE FROM interaction_reminders
    WHERE tenant_id = $1
      AND interaction_id = $2
    `,
    [tenantId, interactionId],
  );

  for (const reminder of reminders) {
    await client.query(
      `
      INSERT INTO interaction_reminders (
        id,
        tenant_id,
        interaction_id,
        minutes_before
      )
      VALUES ($1, $2, $3, $4)
      `,
      [randomUUID(), tenantId, interactionId, reminder.minutes_before],
    );
  }
}

async function replaceInvitees(
  client: PoolClient,
  tenantId: string,
  interactionId: string,
  invitees: Array<{
    first_name?: string;
    last_name?: string;
    email?: string;
    linked_contact_id?: string;
    linked_lead_id?: string;
  }> = [],
) {
  await client.query(
    `
    DELETE FROM interaction_invitees
    WHERE tenant_id = $1
      AND interaction_id = $2
    `,
    [tenantId, interactionId],
  );

  for (const invitee of invitees) {
    await client.query(
      `
      INSERT INTO interaction_invitees (
        id,
        tenant_id,
        interaction_id,
        first_name,
        last_name,
        email,
        linked_contact_id,
        linked_lead_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `,
      [
        randomUUID(),
        tenantId,
        interactionId,
        invitee.first_name || null,
        invitee.last_name || null,
        invitee.email || null,
        invitee.linked_contact_id || null,
        invitee.linked_lead_id || null,
      ],
    );
  }
}

export async function createInteractionHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const client = await pool.connect();

  try {
    const tenantId = getTenantId(req);
    const userId = req.user?.sub || null;

    const {
      type,
      subject,
      status,
      related_to_type,
      related_to_id,
      start_at,
      end_at,
      duration_minutes,
      location,
      description,
      assigned_to,
      call_purpose,
      call_outcome,
      reminders = [],
      invitees = [],
    } = req.body;

    const computedDuration =
      typeof duration_minutes === "number"
        ? duration_minutes
        : getDurationMinutes(start_at, end_at);

    await client.query("BEGIN");

    const interactionId = randomUUID();
    const interactionNumber = buildInteractionNumber();
    const finalStatus = status || "planned";
    const finalLocation = type === "meeting" ? location || null : null;
    const finalCallPurpose = type === "call" ? call_purpose || null : null;
    const finalCallOutcome = type === "call" ? call_outcome || null : null;

    await client.query(
      `
      INSERT INTO interactions (
        id,
        tenant_id,
        interaction_number,
        type,
        subject,
        status,
        related_to_type,
        related_to_id,
        start_at,
        end_at,
        duration_minutes,
        location,
        description,
        assigned_to,
        call_purpose,
        call_outcome,
        created_by_id,
        updated_by_id
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15, $16, $17, $18
      )
      `,
      [
        interactionId,
        tenantId,
        interactionNumber,
        type,
        subject,
        finalStatus,
        related_to_type || null,
        related_to_id || null,
        start_at,
        end_at,
        computedDuration,
        finalLocation,
        description || null,
        assigned_to || null,
        finalCallPurpose,
        finalCallOutcome,
        userId,
        userId,
      ],
    );

    await replaceReminders(client, tenantId, interactionId, reminders);
    await replaceInvitees(
      client,
      tenantId,
      interactionId,
      type === "meeting" ? invitees : [],
    );

    await addInteractionActivity(client, {
      tenantId,
      interactionId,
      actorUserId: userId,
      type: "created",
      body: buildCreateActivityBody({
        type,
        subject,
        status: finalStatus,
        related_to_type: related_to_type || null,
        start_at,
        end_at,
      }),
    });

    await client.query("COMMIT");

    return res.json({
      success: true,
      id: interactionId,
      message: "Interaction created successfully",
    });
  } catch (error) {
    await client.query("ROLLBACK");
    return next(error);
  } finally {
    client.release();
  }
}

export async function getInteractionsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const tenantId = getTenantId(req);

    const {
      search,
      page = "1",
      limit = "10",
      type,
      status,
      assigned_to,
      related_to_type,
      related_to_id,
    } = req.query as Record<string, string>;

    const pageNumber = Math.max(Number(page) || 1, 1);
    const limitNumber = Math.max(Number(limit) || 10, 1);
    const offset = (pageNumber - 1) * limitNumber;

    const values: any[] = [tenantId];
    let whereClause = `
      WHERE i.tenant_id = $1
        AND i.deleted_at IS NULL
    `;

    if (search) {
      values.push(`%${search}%`);
      whereClause += `
        AND (
          i.subject ILIKE $${values.length}
          OR i.interaction_number ILIKE $${values.length}
          OR COALESCE(i.description, '') ILIKE $${values.length}
        )
      `;
    }

    if (type) {
      values.push(type);
      whereClause += ` AND i.type = $${values.length}`;
    }

    if (status) {
      values.push(status);
      whereClause += ` AND i.status = $${values.length}`;
    }

    if (assigned_to) {
      values.push(assigned_to);
      whereClause += ` AND i.assigned_to = $${values.length}`;
    }

    if (related_to_type) {
      values.push(related_to_type);
      whereClause += ` AND i.related_to_type = $${values.length}`;
    }

    if (related_to_id) {
      values.push(related_to_id);
      whereClause += ` AND i.related_to_id = $${values.length}`;
    }

    const countQuery = `
      SELECT COUNT(*)::int AS total
      FROM interactions i
      ${whereClause}
    `;

    const listQuery = `
      SELECT
        i.*,
        COALESCE(ia.activity_count, 0)::int AS activity_count,
        ia.last_activity_at
      FROM interactions i
      LEFT JOIN (
        SELECT
          interaction_id,
          COUNT(*) AS activity_count,
          MAX(created_at) AS last_activity_at
        FROM interaction_activities
        WHERE tenant_id = $1
          AND deleted_at IS NULL
        GROUP BY interaction_id
      ) ia ON ia.interaction_id = i.id
      ${whereClause}
      ORDER BY i.start_at DESC, i.created_at DESC
      LIMIT $${values.length + 1}
      OFFSET $${values.length + 2}
    `;

    const countResult = await pool.query(countQuery, values);
    const listResult = await pool.query(listQuery, [
      ...values,
      limitNumber,
      offset,
    ]);

    return res.json({
      data: listResult.rows,
      total: countResult.rows[0]?.total || 0,
      page: pageNumber,
      limit: limitNumber,
    });
  } catch (error) {
    return next(error);
  }
}

export async function getInteractionByIdHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const tenantId = getTenantId(req);
    const { id } = req.params;

    const interactionResult = await pool.query(
      `
      SELECT *
      FROM interactions
      WHERE id = $1
        AND tenant_id = $2
        AND deleted_at IS NULL
      LIMIT 1
      `,
      [id, tenantId],
    );

    if (!interactionResult.rowCount) {
      return res.status(404).json({
        message: "Interaction not found",
      });
    }

    const remindersResult = await pool.query(
      `
      SELECT
        id,
        interaction_id,
        minutes_before
      FROM interaction_reminders
      WHERE interaction_id = $1
        AND tenant_id = $2
        AND deleted_at IS NULL
      ORDER BY created_at ASC
      `,
      [id, tenantId],
    );

    const inviteesResult = await pool.query(
      `
      SELECT
        id,
        interaction_id,
        first_name,
        last_name,
        email,
        linked_contact_id,
        linked_lead_id
      FROM interaction_invitees
      WHERE interaction_id = $1
        AND tenant_id = $2
        AND deleted_at IS NULL
      ORDER BY created_at ASC
      `,
      [id, tenantId],
    );

    const activitiesResult = await pool.query(
      `
  SELECT
    ia.id,
    ia.interaction_id,
    ia.type,
    ia.body,
    ia.created_by,
    ia.created_at,
    u.name AS created_by_name,
    u.email AS created_by_email
  FROM interaction_activities ia
  LEFT JOIN users u
    ON u.id = ia.created_by
  WHERE ia.interaction_id = $1
    AND ia.tenant_id = $2
    AND ia.deleted_at IS NULL
  ORDER BY ia.created_at DESC
  `,
      [id, tenantId],
    );

    return res.json({
      ...interactionResult.rows[0],
      reminders: remindersResult.rows,
      invitees: inviteesResult.rows,
      activities: activitiesResult.rows,
    });
  } catch (error) {
    return next(error);
  }
}

export async function updateInteractionHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const client = await pool.connect();

  try {
    const tenantId = getTenantId(req);
    const userId = req.user?.sub || null;
    const { id } = req.params;

    const {
      type,
      subject,
      status,
      related_to_type,
      related_to_id,
      start_at,
      end_at,
      duration_minutes,
      location,
      description,
      assigned_to,
      call_purpose,
      call_outcome,
      reminders = [],
      invitees = [],
    } = req.body;

    const existingResult = await client.query(
      `
      SELECT *
      FROM interactions
      WHERE id = $1
        AND tenant_id = $2
        AND deleted_at IS NULL
      LIMIT 1
      `,
      [id, tenantId],
    );

    if (!existingResult.rowCount) {
      return res.status(404).json({
        message: "Interaction not found",
      });
    }

    const previous = existingResult.rows[0];

    const computedDuration =
      typeof duration_minutes === "number"
        ? duration_minutes
        : getDurationMinutes(start_at, end_at);

    const finalStatus = status || "planned";
    const finalLocation = type === "meeting" ? location || null : null;
    const finalCallPurpose = type === "call" ? call_purpose || null : null;
    const finalCallOutcome = type === "call" ? call_outcome || null : null;

    await client.query("BEGIN");

    await client.query(
      `
      UPDATE interactions
      SET
        type = $1,
        subject = $2,
        status = $3,
        related_to_type = $4,
        related_to_id = $5,
        start_at = $6,
        end_at = $7,
        duration_minutes = $8,
        location = $9,
        description = $10,
        assigned_to = $11,
        call_purpose = $12,
        call_outcome = $13,
        updated_by_id = $14,
        updated_at = NOW()
      WHERE id = $15
        AND tenant_id = $16
      `,
      [
        type,
        subject,
        finalStatus,
        related_to_type || null,
        related_to_id || null,
        start_at,
        end_at,
        computedDuration,
        finalLocation,
        description || null,
        assigned_to || null,
        finalCallPurpose,
        finalCallOutcome,
        userId,
        id,
        tenantId,
      ],
    );

    await replaceReminders(client, tenantId, id, reminders);
    await replaceInvitees(
      client,
      tenantId,
      id,
      type === "meeting" ? invitees : [],
    );

    await addInteractionActivity(client, {
      tenantId,
      interactionId: id,
      actorUserId: userId,
      type: "updated",
      body: buildUpdateActivityBody(previous, {
        ...previous,
        type,
        subject,
        status: finalStatus,
        related_to_type: related_to_type || null,
        related_to_id: related_to_id || null,
        start_at,
        end_at,
        duration_minutes: computedDuration,
        location: finalLocation,
        description: description || null,
        assigned_to: assigned_to || null,
        call_purpose: finalCallPurpose,
        call_outcome: finalCallOutcome,
      }),
    });

    await client.query("COMMIT");

    return res.json({
      success: true,
      message: "Interaction updated successfully",
    });
  } catch (error) {
    await client.query("ROLLBACK");
    return next(error);
  } finally {
    client.release();
  }
}
