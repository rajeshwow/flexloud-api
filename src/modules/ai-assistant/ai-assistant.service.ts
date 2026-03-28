import crypto from "crypto";
import { NextFunction, Request, Response } from "express";
import { getTenantId } from "../../common/tenant";
import { pool } from "../../db/pool";
import {
  buildActivitySummaryInstructions,
  buildFollowupInstructions,
  buildInsightInstructions,
} from "./ai-assistant.prompts";
import {
  GenerateAIFollowupSchema,
  GetAIInsightsSchema,
  SummarizeActivitiesSchema,
} from "./ai-assistant.schema";
import type {
  AIEntityType,
  AIFollowupResponse,
  AIInsightResponse,
  AISummaryResponse,
} from "./ai-assistant.types";
import { AI_MODEL, openaiClient } from "./openai.client";

const CACHE_TTL_MINUTES = Number(
  process.env.AI_ASSISTANT_CACHE_TTL_MINUTES || 180,
);

function isAIEnabled() {
  return String(process.env.AI_ASSISTANT_ENABLED || "true") === "true";
}

function getUserId(req: Request) {
  return (req as any)?.user?.sub || null;
}

function sha256(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function parseBoolean(value: unknown) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value === "true";
  return false;
}

function safeJson<T>(value: T) {
  return JSON.stringify(value ?? null);
}

async function logAIRequest(params: {
  tenantId: string;
  entityType?: string | null;
  entityId?: string | null;
  promptType: string;
  userQuery?: string | null;
  requestPayload?: any;
  responsePayload?: any;
  status: "success" | "failed";
  errorMessage?: string | null;
  modelName?: string | null;
  createdById?: string | null;
  tokenUsage?: any;
}) {
  await pool.query(
    `
      INSERT INTO ai_assistant_logs (
        tenant_id,
        entity_type,
        entity_id,
        prompt_type,
        user_query,
        request_payload,
        response_payload,
        status,
        error_message,
        model_name,
        token_usage,
        created_by_id
      )
      VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9,$10,$11::jsonb,$12)
    `,
    [
      params.tenantId,
      params.entityType || null,
      params.entityId || null,
      params.promptType,
      params.userQuery || null,
      safeJson(params.requestPayload || {}),
      safeJson(params.responsePayload || null),
      params.status,
      params.errorMessage || null,
      params.modelName || null,
      safeJson(params.tokenUsage || null),
      params.createdById || null,
    ],
  );
}

async function getLeadAIContext(tenantId: string, entityId: string) {
  const leadResult = await pool.query(
    `
      SELECT
        l.id,
        l.tenant_id,
        l.lead_number,
        l.lead_display_id,
        l.first_name,
        l.last_name,
        l.designation,
        l.industry,
        l.mobile,
        l.office_phone,
        l.organization_name,
        l.emails,
        l.dealer_organization,
        l.priority,
        l.status,
        l.product_category,
        l.requirements,
        l.next_followup,
        l.followup,
        l.followup_type,
        l.lead_source,
        l.add_description,
        l.description,
        l.assigned_to,
        l.referred_by,
        l.opportunity_name,
        l.opportunity_amount,
        l.expected_close_date,
        l.sales_stage,
        l.primary_address_street,
        l.primary_address_area,
        l.primary_address_postalcode,
        l.primary_address_city,
        l.primary_address_state,
        l.primary_address_country,
        l.alt_address_street,
        l.alt_address_area,
        l.alt_address_postalcode,
        l.alt_address_city,
        l.alt_address_state,
        l.alt_address_country,
        l.created_at,
        l.updated_at,
        l.status_id,
        l.priority_id,
        CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, '')) AS assigned_to_name
      FROM leads l
      LEFT JOIN users u
        ON u.id = l.assigned_to
       AND u.tenant_id = l.tenant_id
      WHERE l.tenant_id = $1
        AND l.id = $2
        AND l.deleted_at IS NULL
      LIMIT 1
    `,
    [tenantId, entityId],
  );

  if (!leadResult.rowCount) {
    const err = new Error("Lead not found");
    (err as any).statusCode = 404;
    throw err;
  }

  const activitiesResult = await pool.query(
    `
      SELECT
        i.id,
        i.interaction_number,
        i.type,
        i.subject,
        i.status,
        i.related_to_type,
        i.related_to_id,
        i.start_at,
        i.end_at,
        i.duration_minutes,
        i.location,
        i.description,
        i.assigned_to,
        i.call_purpose,
        i.call_outcome,
        i.created_at,
        i.updated_at,
        CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, '')) AS assigned_to_name
      FROM interactions i
      LEFT JOIN users u
        ON u.id = i.assigned_to
       AND u.tenant_id = i.tenant_id
      WHERE i.tenant_id = $1
        AND i.related_to_type = 'lead'
        AND i.related_to_id = $2
        AND i.deleted_at IS NULL
      ORDER BY COALESCE(i.start_at, i.created_at) DESC
      LIMIT 12
    `,
    [tenantId, entityId],
  );

  let tasksResult = { rows: [] as any[] };

  try {
    tasksResult = await pool.query(
      `
        SELECT
          t.id,
          t.title,
          t.description,
          t.status,
          t.priority,
          t.due_date,
          t.created_at,
          t.updated_at
        FROM tasks t
        WHERE t.tenant_id = $1
          AND (
            t.related_to_id = $2
            OR t.entity_id = $2
          )
          AND t.deleted_at IS NULL
        ORDER BY COALESCE(t.due_date, t.created_at) DESC
        LIMIT 10
      `,
      [tenantId, entityId],
    );
  } catch (error) {
    // tasks table/columns may differ in your project, so don't fail AI insight because of tasks
    tasksResult = { rows: [] };
  }

  return {
    lead: leadResult.rows[0],
    recent_activities: activitiesResult.rows,
    recent_tasks: tasksResult.rows,
  };
}

async function getEntityContext(
  tenantId: string,
  entityType: AIEntityType,
  entityId: string,
) {
  if (entityType === "lead") {
    return getLeadAIContext(tenantId, entityId);
  }

  const err = new Error(
    `AI context for entity type '${entityType}' is not implemented yet`,
  );
  (err as any).statusCode = 400;
  throw err;
}

function getInsightSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      summary: { type: "string" },
      priority: { type: "string", enum: ["hot", "warm", "cold"] },
      sentiment: { type: "string", enum: ["positive", "neutral", "negative"] },
      confidence: { type: "number" },
      risk_flags: {
        type: "array",
        items: { type: "string" },
      },
      next_best_actions: {
        type: "array",
        items: { type: "string" },
      },
      suggested_task: {
        anyOf: [
          { type: "null" },
          {
            type: "object",
            additionalProperties: false,
            properties: {
              title: { type: "string" },
              due_in_days: { type: "number" },
              note: { type: "string" },
            },
            required: ["title", "due_in_days", "note"],
          },
        ],
      },
    },
    required: [
      "summary",
      "priority",
      "sentiment",
      "confidence",
      "risk_flags",
      "next_best_actions",
      "suggested_task",
    ],
  };
}

function getFollowupSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      subject: { type: "string" },
      message: { type: "string" },
      channel: { type: "string", enum: ["email", "whatsapp"] },
    },
    required: ["subject", "message", "channel"],
  };
}

function getActivitySummarySchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      summary: { type: "string" },
      key_points: {
        type: "array",
        items: { type: "string" },
      },
      recommended_next_step: { type: "string" },
    },
    required: ["summary", "key_points", "recommended_next_step"],
  };
}

async function runStructuredResponse<T>(params: {
  instructions: string;
  input: any;
  schemaName: string;
  schema: any;
}): Promise<{ data: T; raw: any }> {
  const response = await openaiClient.responses.create({
    model: AI_MODEL,
    instructions: params.instructions,
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: JSON.stringify(params.input),
          },
        ],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: params.schemaName,
        strict: true,
        schema: params.schema,
      },
    },
  });

  const parsed = JSON.parse(response.output_text || "{}");
  return { data: parsed as T, raw: response };
}

function normalizeInsight(data: AIInsightResponse): AIInsightResponse {
  return {
    summary: String(data.summary || "").trim(),
    priority: data.priority,
    sentiment: data.sentiment,
    confidence: Math.max(0, Math.min(100, Number(data.confidence || 0))),
    risk_flags: Array.isArray(data.risk_flags)
      ? data.risk_flags.slice(0, 6)
      : [],
    next_best_actions: Array.isArray(data.next_best_actions)
      ? data.next_best_actions.slice(0, 5)
      : [],
    suggested_task: data.suggested_task
      ? {
          title: String(data.suggested_task.title || "").trim(),
          due_in_days: Math.max(
            0,
            Math.min(30, Number(data.suggested_task.due_in_days || 0)),
          ),
          note: String(data.suggested_task.note || "").trim(),
        }
      : null,
  };
}

async function loadCachedInsight(
  tenantId: string,
  entityType: string,
  entityId: string,
  sourceHash: string,
) {
  const result = await pool.query(
    `
      SELECT *
      FROM ai_entity_insights
      WHERE tenant_id = $1
        AND entity_type = $2
        AND entity_id = $3
        AND source_hash = $4
        AND deleted_at IS NULL
        AND generated_at >= now() - ($5 || ' minutes')::interval
      LIMIT 1
    `,
    [tenantId, entityType, entityId, sourceHash, CACHE_TTL_MINUTES],
  );

  return result.rows[0] || null;
}

async function upsertInsight(params: {
  tenantId: string;
  entityType: string;
  entityId: string;
  insight: AIInsightResponse;
  sourceHash: string;
}) {
  const { tenantId, entityType, entityId, insight, sourceHash } = params;

  const result = await pool.query(
    `
      INSERT INTO ai_entity_insights (
        tenant_id,
        entity_type,
        entity_id,
        summary,
        priority,
        sentiment,
        confidence,
        risk_flags,
        next_best_actions,
        suggested_task,
        generated_at,
        source_hash,
        model_name
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,now(),$11,$12
      )
      ON CONFLICT (tenant_id, entity_type, entity_id)
      DO UPDATE SET
        summary = EXCLUDED.summary,
        priority = EXCLUDED.priority,
        sentiment = EXCLUDED.sentiment,
        confidence = EXCLUDED.confidence,
        risk_flags = EXCLUDED.risk_flags,
        next_best_actions = EXCLUDED.next_best_actions,
        suggested_task = EXCLUDED.suggested_task,
        generated_at = EXCLUDED.generated_at,
        source_hash = EXCLUDED.source_hash,
        model_name = EXCLUDED.model_name,
        updated_at = now()
      RETURNING *
    `,
    [
      tenantId,
      entityType,
      entityId,
      insight.summary,
      insight.priority,
      insight.sentiment,
      insight.confidence,
      safeJson(insight.risk_flags),
      safeJson(insight.next_best_actions),
      safeJson(insight.suggested_task),
      sourceHash,
      AI_MODEL,
    ],
  );

  return result.rows[0];
}

function mapInsightRow(
  row: any,
): AIInsightResponse & { generated_at?: string } {
  return {
    summary: row.summary,
    priority: row.priority,
    sentiment: row.sentiment,
    confidence: Number(row.confidence || 0),
    risk_flags: row.risk_flags || [],
    next_best_actions: row.next_best_actions || [],
    suggested_task: row.suggested_task || null,
    generated_at: row.generated_at,
  };
}

export async function getAIInsightsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    if (!isAIEnabled()) {
      return res.status(503).json({ message: "AI assistant is disabled" });
    }

    const tenantId = getTenantId(req);
    const userId = getUserId(req);
    const parsed = GetAIInsightsSchema.parse(req.query);

    const context = await getEntityContext(
      tenantId,
      parsed.entity_type,
      parsed.entity_id,
    );
    const sourceHash = sha256(JSON.stringify(context));

    if (!parsed.force_refresh) {
      const cached = await loadCachedInsight(
        tenantId,
        parsed.entity_type,
        parsed.entity_id,
        sourceHash,
      );

      if (cached) {
        return res.json({
          message: "AI insight fetched successfully",
          data: {
            ...mapInsightRow(cached),
            is_cached: true,
          },
        });
      }
    }

    const { data, raw } = await runStructuredResponse<AIInsightResponse>({
      instructions: buildInsightInstructions(parsed.entity_type),
      input: context,
      schemaName: "crm_entity_insight",
      schema: getInsightSchema(),
    });

    const normalized = normalizeInsight(data);
    const saved = await upsertInsight({
      tenantId,
      entityType: parsed.entity_type,
      entityId: parsed.entity_id,
      insight: normalized,
      sourceHash,
    });

    await logAIRequest({
      tenantId,
      entityType: parsed.entity_type,
      entityId: parsed.entity_id,
      promptType: "insight",
      requestPayload: context,
      responsePayload: normalized,
      status: "success",
      modelName: AI_MODEL,
      createdById: userId,
      tokenUsage: (raw as any)?.usage || null,
    });

    return res.json({
      message: "AI insight generated successfully",
      data: {
        ...mapInsightRow(saved),
        is_cached: false,
      },
    });
  } catch (error: any) {
    try {
      await logAIRequest({
        tenantId: getTenantId(req),
        entityType: String(req.query?.entity_type || ""),
        entityId: String(req.query?.entity_id || ""),
        promptType: "insight",
        requestPayload: req.query,
        responsePayload: null,
        status: "failed",
        errorMessage: error?.message || "Unknown error",
        modelName: AI_MODEL,
        createdById: getUserId(req),
      });
    } catch (_) {}

    next(error);
  }
}

export async function generateFollowupHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    if (!isAIEnabled()) {
      return res.status(503).json({ message: "AI assistant is disabled" });
    }

    const tenantId = getTenantId(req);
    const userId = getUserId(req);
    const parsed = GenerateAIFollowupSchema.parse(req.body);

    const context = await getEntityContext(
      tenantId,
      parsed.entity_type,
      parsed.entity_id,
    );

    const { data, raw } = await runStructuredResponse<AIFollowupResponse>({
      instructions: buildFollowupInstructions(parsed.channel),
      input: {
        channel: parsed.channel,
        context,
      },
      schemaName: "crm_followup_draft",
      schema: getFollowupSchema(),
    });

    await logAIRequest({
      tenantId,
      entityType: parsed.entity_type,
      entityId: parsed.entity_id,
      promptType: "generate_followup",
      requestPayload: { channel: parsed.channel, context },
      responsePayload: data,
      status: "success",
      modelName: AI_MODEL,
      createdById: userId,
      tokenUsage: (raw as any)?.usage || null,
    });

    return res.json({
      message: "Follow-up generated successfully",
      data,
    });
  } catch (error: any) {
    try {
      await logAIRequest({
        tenantId: getTenantId(req),
        entityType: String(req.body?.entity_type || ""),
        entityId: String(req.body?.entity_id || ""),
        promptType: "generate_followup",
        requestPayload: req.body,
        responsePayload: null,
        status: "failed",
        errorMessage: error?.message || "Unknown error",
        modelName: AI_MODEL,
        createdById: getUserId(req),
      });
    } catch (_) {}

    next(error);
  }
}

export async function summarizeActivitiesHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    if (!isAIEnabled()) {
      return res.status(503).json({ message: "AI assistant is disabled" });
    }

    const tenantId = getTenantId(req);
    const userId = getUserId(req);
    const parsed = SummarizeActivitiesSchema.parse(req.body);

    const context = await getEntityContext(
      tenantId,
      parsed.entity_type,
      parsed.entity_id,
    );

    const { data, raw } = await runStructuredResponse<AISummaryResponse>({
      instructions: buildActivitySummaryInstructions(),
      input: {
        entity_type: parsed.entity_type,
        activities: (context as any)?.recent_activities || [],
        tasks: (context as any)?.recent_tasks || [],
      },
      schemaName: "crm_activity_summary",
      schema: getActivitySummarySchema(),
    });

    await logAIRequest({
      tenantId,
      entityType: parsed.entity_type,
      entityId: parsed.entity_id,
      promptType: "summarize_activities",
      requestPayload: context,
      responsePayload: data,
      status: "success",
      modelName: AI_MODEL,
      createdById: userId,
      tokenUsage: (raw as any)?.usage || null,
    });

    return res.json({
      message: "Activities summarized successfully",
      data,
    });
  } catch (error) {
    next(error);
  }
}
