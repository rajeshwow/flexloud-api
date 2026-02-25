import crypto from "node:crypto";
import { PoolClient } from "pg";
import { insertOutbox } from "../../outbox/outboxRepo";
import { getDefaultStageId, getLead } from "./leadsRepo";

function uuid() {
  return crypto.randomUUID();
}

export async function createLead(
  c: PoolClient,
  input: {
    tenantId: string;
    actorUserId: string;
    title: string;
    source?: string;
    ownerUserId?: string;
    initialStageId?: string;
  },
) {
  const id = uuid();
  const stageId =
    input.initialStageId ?? (await getDefaultStageId(c, input.tenantId));
  const owner = input.ownerUserId ?? input.actorUserId;

  await c.query(
    `insert into leads (id, tenant_id, title, source, status, owner_user_id, current_stage_id, created_at, updated_at)
     values ($1,$2,$3,$4,'OPEN',$5,$6,now(),now())`,
    [id, input.tenantId, input.title, input.source ?? null, owner, stageId],
  );

  if (stageId) {
    await c.query(
      `insert into lead_stage_history (id, tenant_id, lead_id, from_stage_id, to_stage_id, changed_by, note, changed_at)
       values ($1,$2,$3,null,$4,$5,null,now())`,
      [uuid(), input.tenantId, id, stageId, input.actorUserId],
    );
  }

  await c.query(
    `insert into lead_assignments (id, tenant_id, lead_id, assigned_to, assigned_by, assigned_at)
     values ($1,$2,$3,$4,$5,now())`,
    [uuid(), input.tenantId, id, owner, input.actorUserId],
  );

  await c.query(
    `insert into notifications (id, tenant_id, user_id, title, body, read, created_at)
     values ($1,$2,$3,$4,$5,false,now())`,
    [uuid(), input.tenantId, owner, "New lead assigned", input.title],
  );

  await insertOutbox(c, {
    id: uuid(),
    tenantId: input.tenantId,
    type: "lead.created",
    payload: { leadId: id, ownerUserId: owner },
  });

  return { id };
}

export async function assignLead(
  c: PoolClient,
  input: {
    tenantId: string;
    actorUserId: string;
    leadId: string;
    newOwnerUserId: string;
  },
) {
  const lead = await getLead(c, input.tenantId, input.leadId);
  if (!lead)
    throw Object.assign(new Error("Lead not found"), { statusCode: 404 });

  await c.query(
    `update leads set owner_user_id=$1, updated_at=now() where tenant_id=$2 and id=$3`,
    [input.newOwnerUserId, input.tenantId, input.leadId],
  );

  await c.query(
    `insert into lead_assignments (id, tenant_id, lead_id, assigned_to, assigned_by, assigned_at)
     values ($1,$2,$3,$4,$5,now())`,
    [
      uuid(),
      input.tenantId,
      input.leadId,
      input.newOwnerUserId,
      input.actorUserId,
    ],
  );

  await c.query(
    `insert into notifications (id, tenant_id, user_id, title, body, read, created_at)
     values ($1,$2,$3,$4,$5,false,now())`,
    [
      uuid(),
      input.tenantId,
      input.newOwnerUserId,
      "Lead assigned to you",
      lead.title,
    ],
  );

  await insertOutbox(c, {
    id: uuid(),
    tenantId: input.tenantId,
    type: "lead.assigned",
    payload: { leadId: input.leadId, ownerUserId: input.newOwnerUserId },
  });
}

export async function transitionLeadStage(
  c: PoolClient,
  input: {
    tenantId: string;
    actorUserId: string;
    leadId: string;
    toStageId: string;
    note?: string;
  },
) {
  const lead = await getLead(c, input.tenantId, input.leadId);
  if (!lead)
    throw Object.assign(new Error("Lead not found"), { statusCode: 404 });

  const fromStageId = lead.currentStageId;

  await c.query(
    `update leads set current_stage_id=$1, updated_at=now() where tenant_id=$2 and id=$3`,
    [input.toStageId, input.tenantId, input.leadId],
  );

  await c.query(
    `insert into lead_stage_history (id, tenant_id, lead_id, from_stage_id, to_stage_id, changed_by, note, changed_at)
     values ($1,$2,$3,$4,$5,$6,$7,now())`,
    [
      uuid(),
      input.tenantId,
      input.leadId,
      fromStageId,
      input.toStageId,
      input.actorUserId,
      input.note ?? null,
    ],
  );

  await insertOutbox(c, {
    id: uuid(),
    tenantId: input.tenantId,
    type: "lead.stage_changed",
    payload: { leadId: input.leadId, fromStageId, toStageId: input.toStageId },
  });
}

export async function addLeadActivity(
  c: PoolClient,
  input: {
    tenantId: string;
    actorUserId: string;
    leadId: string;
    type: string;
    body: string;
  },
) {
  const lead = await getLead(c, input.tenantId, input.leadId);
  if (!lead)
    throw Object.assign(new Error("Lead not found"), { statusCode: 404 });

  await c.query(
    `insert into lead_activities (id, tenant_id, lead_id, type, body, created_by, created_at)
     values ($1,$2,$3,$4,$5,$6,now())`,
    [
      uuid(),
      input.tenantId,
      input.leadId,
      input.type,
      input.body,
      input.actorUserId,
    ],
  );

  await c.query(
    `update leads set updated_at=now() where tenant_id=$1 and id=$2`,
    [input.tenantId, input.leadId],
  );

  await insertOutbox(c, {
    id: uuid(),
    tenantId: input.tenantId,
    type: "lead.activity_added",
    payload: { leadId: input.leadId, type: input.type },
  });
}
