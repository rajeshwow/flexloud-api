import { randomUUID } from "crypto";
import { NextFunction, Request, Response } from "express";
import { getTenantId } from "../../common/tenant";
import { pool } from "../../db/pool";
import { CreateProductSchema, GetProductsSchema } from "./products.schema";

type CreateProductInput = {
  tenantId: string;
  createdBy: string | null;
  updatedBy: string | null;

  name: string;
  part_number?: string | null;
  hsn_code: string;
  unit_uqc?: string | null;
  category?: string | null;
  manufacturer?: string | null;
  description?: string | null;

  assigned_to?: string | null;
  status?: string;

  cost_price_currency?: string;
  cost_price?: number;
  msp_currency?: string;
  msp?: number;
  selling_price_currency?: string;
  selling_price?: number;
  tax?: string | null;

  opening_stock?: number;
  opening_stock_value?: number;
  stock_on_hand?: number;
  committed_stock?: number;
  available_for_sale?: number;
  qty_to_be_invoiced_shipped?: number;
  qty_to_be_received_billed?: number;
};

type GetProductsInput = {
  tenantId: string;
  page: number;
  limit: number;
  search?: string;
  status?: string;
  category?: string;
  manufacturer?: string;
  assigned_to?: string;
};

class ProductsService {
  async create(input: CreateProductInput) {
    const id = randomUUID();

    const query = `
      INSERT INTO products (
        id, tenant_id,
        name, part_number, hsn_code, unit_uqc, category, manufacturer, description,
        assigned_to, status,
        cost_price_currency, cost_price,
        msp_currency, msp,
        selling_price_currency, selling_price,
        tax,
        opening_stock, opening_stock_value, stock_on_hand, committed_stock,
        available_for_sale, qty_to_be_invoiced_shipped, qty_to_be_received_billed,
        created_by, updated_by
      )
      VALUES (
        $1, $2,
        $3, $4, $5, $6, $7, $8, $9,
        $10, $11,
        $12, $13,
        $14, $15,
        $16, $17,
        $18,
        $19, $20, $21, $22,
        $23, $24, $25,
        $26, $27
      )
      RETURNING *;
    `;

    const values = [
      id,
      input.tenantId,

      input.name,
      input.part_number ?? null,
      input.hsn_code,
      input.unit_uqc ?? null,
      input.category ?? null,
      input.manufacturer ?? null,
      input.description ?? null,

      input.assigned_to ?? null,
      input.status ?? "active",

      input.cost_price_currency ?? "INR",
      input.cost_price ?? 0,

      input.msp_currency ?? "INR",
      input.msp ?? 0,

      input.selling_price_currency ?? "INR",
      input.selling_price ?? 0,

      input.tax ?? null,

      input.opening_stock ?? 0,
      input.opening_stock_value ?? 0,
      input.stock_on_hand ?? 0,
      input.committed_stock ?? 0,
      input.available_for_sale ?? 0,
      input.qty_to_be_invoiced_shipped ?? 0,
      input.qty_to_be_received_billed ?? 0,

      input.createdBy,
      input.updatedBy,
    ];

    const result = await pool.query(query, values);
    return result.rows[0];
  }

  async getAll(input: GetProductsInput) {
    const page = input.page > 0 ? input.page : 1;
    const limit = input.limit > 0 ? input.limit : 10;
    const offset = (page - 1) * limit;

    let whereClause = `WHERE p.tenant_id = $1`;
    const values: Array<string | number> = [input.tenantId];
    let idx = 2;

    if (input.search?.trim()) {
      whereClause += `
        AND (
          p.name ILIKE $${idx}
          OR p.hsn_code ILIKE $${idx}
          OR COALESCE(p.category, '') ILIKE $${idx}
          OR COALESCE(p.manufacturer, '') ILIKE $${idx}
          OR COALESCE(p.part_number, '') ILIKE $${idx}
        )
      `;
      values.push(`%${input.search.trim()}%`);
      idx++;
    }

    if (input.status?.trim()) {
      whereClause += ` AND p.status = $${idx}`;
      values.push(input.status.trim());
      idx++;
    }

    if (input.category?.trim()) {
      whereClause += ` AND p.category = $${idx}`;
      values.push(input.category.trim());
      idx++;
    }

    if (input.manufacturer?.trim()) {
      whereClause += ` AND p.manufacturer = $${idx}`;
      values.push(input.manufacturer.trim());
      idx++;
    }

    if (input.assigned_to?.trim()) {
      whereClause += ` AND p.assigned_to = $${idx}`;
      values.push(input.assigned_to.trim());
      idx++;
    }

    const dataQuery = `
      SELECT
        p.*,
        u.name AS assigned_to_name
      FROM products p
      LEFT JOIN users u ON u.id = p.assigned_to
      ${whereClause}
      ORDER BY p.created_at DESC
      LIMIT $${idx} OFFSET $${idx + 1};
    `;

    const countQuery = `
      SELECT COUNT(*)::int AS total
      FROM products p
      ${whereClause};
    `;

    const dataValues = [...values, limit, offset];

    const [dataResult, countResult] = await Promise.all([
      pool.query(dataQuery, dataValues),
      pool.query(countQuery, values),
    ]);

    return {
      data: dataResult.rows,
      pagination: {
        page,
        limit,
        total: countResult.rows[0]?.total ?? 0,
      },
    };
  }
}

export const productsService = new ProductsService();

export async function createProductHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const parsed = CreateProductSchema.parse({ body: req.body });
    const tenantId = getTenantId(req);
    const userId = req.user?.id ?? null;

    const product = await productsService.create({
      tenantId,
      createdBy: userId,
      updatedBy: userId,
      ...parsed.body,
    });

    return res.status(201).json({
      statusCode: 201,
      message: "Product created successfully",
      data: product,
    });
  } catch (error) {
    next(error);
  }
}

export async function getProductsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const parsed = GetProductsSchema.parse({ query: req.query });
    const tenantId = getTenantId(req);

    const result = await productsService.getAll({
      tenantId,
      ...parsed.query,
    });

    return res.status(200).json({
      statusCode: 200,
      message: "Products fetched successfully",
      data: result.data,
      pagination: result.pagination,
    });
  } catch (error) {
    next(error);
  }
}
