import { Router } from "express";
import { requireAuth } from "../auth/requireAuth";
import { db } from "../db/pool";
import { resolveTenant } from "../tenancy/tenantContext";

export function notificationsRouter() {
  const r = Router();

  r.get("/", requireAuth, async (req, res) => {
    const { tenantId } = await resolveTenant(req);
    const userId = req.user!.sub;

    const out = await db.query(
      `select id, title, body, read, created_at as "createdAt"
       from notifications
       where tenant_id=$1 and user_id=$2
       order by created_at desc
       limit 200`,
      [tenantId, userId],
    );

    res.json(out.rows);
  });

  r.post("/:id/read", requireAuth, async (req, res) => {
    const { tenantId } = await resolveTenant(req);
    const userId = req.user!.sub;
    const id = req.params.id;

    await db.query(
      `update notifications set read=true
       where tenant_id=$1 and user_id=$2 and id=$3`,
      [tenantId, userId, id],
    );

    res.status(204).send();
  });

  return r;
}
