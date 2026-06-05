import { z } from "zod";

export const globalSearchQuerySchema = z.object({
  q: z
    .string()
    .trim()
    .min(1, "Search text is required")
    .max(100, "Search text is too long"),

  limit: z
    .string()
    .optional()
    .transform((value) => {
      const parsed = Number(value || 8);
      if (Number.isNaN(parsed)) return 8;
      return Math.min(Math.max(parsed, 1), 20);
    }),
});

export type GlobalSearchQuery = z.infer<typeof globalSearchQuerySchema>;

export type GlobalSearchResultType =
  | "sales_order"
  | "purchase_order"
  | "quote"
  | "product"
  | "organization";

export type GlobalSearchResult = {
  id: string;
  type: GlobalSearchResultType;
  module: string;
  title: string;
  subtitle: string | null;
  description: string | null;
  redirectUrl: string;
  score: number;
};
