export type Role = "ADMIN" | "MANAGER" | "AGENT";
export function hasRole(roles: string[] | undefined, role: Role) {
  return Boolean(roles?.includes(role));
}
