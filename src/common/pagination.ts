export function getPagination(query: any) {
  const page = Math.max(parseInt(String(query.page ?? "1"), 10) || 1, 1);
  const limitRaw = parseInt(String(query.limit ?? "20"), 10) || 20;
  const limit = Math.min(Math.max(limitRaw, 1), 100);
  const offset = (page - 1) * limit;

  return { page, limit, offset };
}
