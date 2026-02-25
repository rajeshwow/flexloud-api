export type AuthUser = {
  sub: string;
  email?: string;
  name?: string;

  // ✅ add these for RBAC + multi-tenant
  id?: string; // users table id
  role?: "ADMIN" | "MANAGER" | "AGENT";
  tenantId?: string; // users.tenant_id
  isActive?: boolean;
};
