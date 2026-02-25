import { Router } from "express";
import { requireAuth } from "../auth/requireAuth";
import { db } from "../db/pool";
import { withTx } from "../db/tx";
import { hasRole } from "../rbac/roles";
import { resolveTenant } from "../tenancy/tenantContext";

import { getLead, listLeadsForOwnerOrTeam } from "../domain/leads/leadsRepo";
import {
  addLeadActivity,
  assignLead,
  createLead,
  transitionLeadStage,
} from "../domain/leads/leadsService";
import {
  activitySchema,
  assignLeadSchema,
  createLeadSchema,
  patchLeadSchema,
  transitionSchema,
} from "../domain/leads/validation";

export function leadsRouter() {
  const r = Router();

  r.get("/", requireAuth, async (req, res) => {
    const { tenantId, roles } = await resolveTenant(req);
    const userId = req.user!.sub;
    const canSeeTeam = hasRole(roles, "MANAGER") || hasRole(roles, "ADMIN");

    const rows = await db.connect().then(async (c) => {
      try {
        return await listLeadsForOwnerOrTeam(c, tenantId, userId, canSeeTeam);
      } finally {
        c.release();
      }
    });

    res.json(rows);
  });

  r.get("/:id", requireAuth, async (req, res) => {
    const { tenantId, roles } = await resolveTenant(req);
    const userId = req.user!.sub;
    const leadId = req.params.id;

    const lead = await db.connect().then(async (c) => {
      try {
        return await getLead(c, tenantId, leadId);
      } finally {
        c.release();
      }
    });

    if (!lead) return res.status(404).json({ error: "Lead not found" });

    if (
      hasRole(roles, "AGENT") &&
      !hasRole(roles, "MANAGER") &&
      !hasRole(roles, "ADMIN")
    ) {
      if (lead.ownerUserId !== userId)
        return res.status(403).json({ error: "Forbidden" });
    }

    res.json(lead);
  });

  r.post("/", requireAuth, async (req, res) => {
    const { tenantId, roles } = await resolveTenant(req);
    const body = createLeadSchema.parse(req.body);

    const ownerUserId =
      hasRole(roles, "MANAGER") || hasRole(roles, "ADMIN")
        ? body.ownerUserId
        : undefined;

    const out = await withTx(async (c) => {
      return await createLead(c, {
        tenantId,
        actorUserId: req.user!.sub,
        title: body.title,
        source: body.source,
        ownerUserId,
        initialStageId: body.initialStageId,
      });
    });

    res.status(201).json(out);
  });

  r.patch("/:id", requireAuth, async (req, res) => {
    const { tenantId, roles } = await resolveTenant(req);
    const leadId = req.params.id;
    const patch = patchLeadSchema.parse(req.body);

    await withTx(async (c) => {
      const lead = await getLead(c, tenantId, leadId);
      if (!lead)
        throw Object.assign(new Error("Lead not found"), { statusCode: 404 });

      if (
        hasRole(roles, "AGENT") &&
        !hasRole(roles, "MANAGER") &&
        !hasRole(roles, "ADMIN")
      ) {
        if (lead.ownerUserId !== req.user!.sub)
          throw Object.assign(new Error("Forbidden"), { statusCode: 403 });
      }

      await c.query(
        `update leads set
           title = coalesce($1, title),
           source = coalesce($2, source),
           status = coalesce($3, status),
           updated_at = now()
         where tenant_id=$4 and id=$5`,
        [
          patch.title ?? null,
          patch.source ?? null,
          patch.status ?? null,
          tenantId,
          leadId,
        ],
      );
    });

    res.status(204).send();
  });

  r.post("/:id/assign", requireAuth, async (req, res) => {
    const { tenantId, roles } = await resolveTenant(req);
    if (!(hasRole(roles, "MANAGER") || hasRole(roles, "ADMIN")))
      return res.status(403).json({ error: "Forbidden" });

    const leadId = req.params.id;
    const body = assignLeadSchema.parse(req.body);

    await withTx(async (c) => {
      await assignLead(c, {
        tenantId,
        actorUserId: req.user!.sub,
        leadId,
        newOwnerUserId: body.ownerUserId,
      });
    });

    res.status(204).send();
  });

  r.post("/:id/transition", requireAuth, async (req, res) => {
    const { tenantId, roles } = await resolveTenant(req);
    const leadId = req.params.id;
    const body = transitionSchema.parse(req.body);

    await withTx(async (c) => {
      const lead = await getLead(c, tenantId, leadId);
      if (!lead)
        throw Object.assign(new Error("Lead not found"), { statusCode: 404 });

      if (
        hasRole(roles, "AGENT") &&
        !hasRole(roles, "MANAGER") &&
        !hasRole(roles, "ADMIN")
      ) {
        if (lead.ownerUserId !== req.user!.sub)
          throw Object.assign(new Error("Forbidden"), { statusCode: 403 });
      }

      await transitionLeadStage(c, {
        tenantId,
        actorUserId: req.user!.sub,
        leadId,
        toStageId: body.toStageId,
        note: body.note,
      });
    });

    res.status(204).send();
  });

  r.post("/:id/activities", requireAuth, async (req, res) => {
    const { tenantId, roles } = await resolveTenant(req);
    const leadId = req.params.id;
    const body = activitySchema.parse(req.body);

    await withTx(async (c) => {
      const lead = await getLead(c, tenantId, leadId);
      if (!lead)
        throw Object.assign(new Error("Lead not found"), { statusCode: 404 });

      if (
        hasRole(roles, "AGENT") &&
        !hasRole(roles, "MANAGER") &&
        !hasRole(roles, "ADMIN")
      ) {
        if (lead.ownerUserId !== req.user!.sub)
          throw Object.assign(new Error("Forbidden"), { statusCode: 403 });
      }

      await addLeadActivity(c, {
        tenantId,
        actorUserId: req.user!.sub,
        leadId,
        type: body.type,
        body: body.body,
      });
    });

    res.status(204).send();
  });

  return r;
}
