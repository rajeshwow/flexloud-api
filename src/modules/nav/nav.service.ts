import { Request, Response } from "express";
import { pool } from "../../db/pool";

type MenuRow = {
  key: string;
  parent_key: string | null;
  label: string;
  path: string | null;
  icon: string | null;
  sort_order: number;
};

export async function getMenuForMe(req: Request, res: Response) {
  const tenantId = (req.user as any)?.tenantId;
  const role = (req as any).userContext?.role || (req.user as any)?.role; // depending on your attachUserContext

  // NOTE: attachUserContext in your code sets req.user...; if you store role in req.userContext, use that.
  // If not, just read from DB again or ensure attachUserContext sets req.user.role.

  const { rows } = await pool.query<MenuRow>(
    `
    SELECT
      mi.key,
      mi.parent_key,
      COALESCE(tmi.label_override, mi.default_label) AS label,
      COALESCE(tmi.path_override,  mi.default_path)  AS path,
      COALESCE(tmi.icon_override,  mi.default_icon)  AS icon,
      COALESCE(tmi.sort_override,  mi.sort_order)    AS sort_order,
      tmi.allowed_roles
    FROM tenant_menu_items tmi
    JOIN menu_items mi ON mi.key = tmi.menu_key
    WHERE tmi.tenant_id = $1
      AND tmi.enabled = TRUE
      AND (
        tmi.allowed_roles IS NULL
        OR array_length(tmi.allowed_roles, 1) IS NULL
        OR $2 = ANY(tmi.allowed_roles)
      )
    ORDER BY COALESCE(tmi.sort_override, mi.sort_order) ASC
    `,
    [tenantId, role],
  );

  // build tree
  const map = new Map<string, any>();
  const roots: any[] = [];

  rows.forEach((r) => {
    map.set(r.key, {
      key: r.key,
      label: r.label,
      path: r.path,
      icon: r.icon,
      children: [] as any[],
    });
  });

  rows.forEach((r) => {
    const node = map.get(r.key);
    if (!node) return;

    if (r.parent_key && map.has(r.parent_key)) {
      map.get(r.parent_key).children.push(node);
    } else {
      roots.push(node);
    }
  });

  // cleanup empty children for AntD menu
  const prune = (n: any) => {
    if (!n.children?.length) delete n.children;
    else n.children.forEach(prune);
    return n;
  };

  res.json({ items: roots.map(prune) });
}
