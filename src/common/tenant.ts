export function getTenantId(req: any): string {
  const tid =
    req.tenantId ||
    req.tenant_id ||
    req?.context?.tenantId ||
    req?.context?.tenant_id ||
    req?.user?.tenantId ||
    req?.user?.tenant_id ||
    req?.auth?.tenantId ||
    req?.auth?.tenant_id ||
    req?.headers?.["x-tenant-id"] ||
    req?.headers?.["x-tenantid"] ||
    req?.headers?.["x-tenant"];

  if (!tid) {
    const err: any = new Error("Tenant context missing");
    err.statusCode = 400;
    throw err;
  }
  return String(tid);
}
