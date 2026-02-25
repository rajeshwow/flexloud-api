export function getUserRole(req: any): string | undefined {
  return (
    req?.user?.role ||
    req?.auth?.role ||
    req?.context?.user?.role ||
    req?.context?.role ||
    req?.locals?.role ||
    req?.res?.locals?.user?.role
  );
}

export function requireRoles(allowed: string[]) {
  return (req: any, res: any, next: any) => {
    const role = getUserRole(req);
    if (!role || !allowed.includes(role)) {
      return res.status(403).json({ message: "Forbidden" });
    }
    next();
  };
}
