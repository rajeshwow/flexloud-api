import type { TallyLedgerPayload, TallyStockItemPayload } from "./tally.types";

function toNumber(value?: string | number | null) {
  if (value === undefined || value === null || value === "") return 0;

  const cleaned = String(value)
    .replace(/,/g, "")
    .replace(/[^\d.-]/g, "");

  const num = Number(cleaned);
  return Number.isFinite(num) ? num : 0;
}

function toPositiveNumber(value?: string | number | null) {
  return Math.abs(toNumber(value));
}

function cleanText(value: any) {
  if (value === undefined || value === null) return null;
  const v = String(value).trim();
  return v || null;
}

function getQtyFromValue(value: any) {
  const cleaned = String(value ?? "").replace(/,/g, "");
  const match = cleaned.match(/-?\d+(\.\d+)?/);
  return match ? Math.abs(Number(match[0])) : 0;
}

function firstPositive(...values: any[]) {
  for (const value of values) {
    const num = toPositiveNumber(value);
    if (num > 0) return num;
  }

  return 0;
}

function getOpeningStock(row: any) {
  return firstPositive(
    row.openingQty,
    row.openingStock,
    row.opening_stock,
    getQtyFromValue(row.openingBalance),
    getQtyFromValue(row.opening_balance),
  );
}

function getClosingStock(row: any) {
  return firstPositive(
    row.closingQty,
    row.closingStock,
    row.closing_stock,
    row.stockOnHand,
    row.stock_on_hand,
    getQtyFromValue(row.closingBalance),
    getQtyFromValue(row.closing_balance),
  );
}

function getBaseQty(row: any) {
  return firstPositive(
    row.baseQtyNumber,
    row.actualQtyNumber,
    row.billedQtyNumber,
    row.baseQty,
    row.actualQty,
    row.billedQty,
    getQtyFromValue(row.baseQty),
    getQtyFromValue(row.actualQty),
    getQtyFromValue(row.billedQty),
  );
}

function getStockOnHand(row: any) {
  const closingStock = getClosingStock(row);
  const openingStock = getOpeningStock(row);
  const baseQty = getBaseQty(row);

  return closingStock || openingStock || baseQty || 0;
}

function getOpeningValue(row: any) {
  return firstPositive(
    row.openingValueNumber,
    row.openingValue,
    row.opening_value,
  );
}

function getClosingValue(row: any) {
  return firstPositive(
    row.closingValueNumber,
    row.closingValue,
    row.closing_value,
  );
}

function getStockItemPrice(row: any) {
  const openingStock = getOpeningStock(row);
  const closingStock = getClosingStock(row);

  const openingValue = getOpeningValue(row);
  const closingValue = getClosingValue(row);

  const directPrice = firstPositive(
    row.price,
    row.sellingPrice,
    row.selling_price,
    row.costPrice,
    row.cost_price,
    row.msp,
    row.standardPrice,
    row.standard_price,
    row.mrp,
  );

  const openingRate = firstPositive(row.openingRateNumber, row.openingRate);
  const closingRate = firstPositive(row.closingRateNumber, row.closingRate);

  return (
    directPrice ||
    openingRate ||
    closingRate ||
    (openingStock > 0 && openingValue > 0 ? openingValue / openingStock : 0) ||
    (closingStock > 0 && closingValue > 0 ? closingValue / closingStock : 0) ||
    openingValue ||
    closingValue ||
    0
  );
}

export function mapTallyLedgerToOrganization(row: TallyLedgerPayload) {
  const parent = String(row.parent || "").toLowerCase();

  let type: "customer" | "vendor" | null = null;

  if (parent.includes("sundry debtors")) {
    type = "customer";
  }

  if (parent.includes("sundry creditors")) {
    type = "vendor";
  }

  // Important: non-party ledgers should not become organizations
  if (!type) {
    return null;
  }

  return {
    name: row.name,
    gst_number: row.gstin || null,
    email: row.email || null,
    type,
    industry: null,
    registered_street: row.address || null,
    registered_area: null,
    registered_postal_code: null,
    registered_city: (row as any).city || row.state || null,
    registered_state: row.state || null,
    registered_country: row.country || "India",
  };
}

export function mapTallyStockItemToProduct(row: TallyStockItemPayload) {
  const anyRow = row as any;

  const openingStock = getOpeningStock(anyRow);
  const stockOnHand = getStockOnHand(anyRow);
  const availableForSale = firstPositive(
    anyRow.availableForSale,
    anyRow.available_for_sale,
    stockOnHand,
  );

  const openingValue = getOpeningValue(anyRow);
  const closingValue = getClosingValue(anyRow);
  const price = getStockItemPrice(anyRow);

  const partNumber =
    cleanText(anyRow.partNumber) ||
    cleanText(anyRow.part_number) ||
    cleanText(anyRow.partNo) ||
    cleanText(anyRow.part_no) ||
    cleanText(row.masterId) ||
    cleanText(row.guid) ||
    cleanText(row.name);

  const hsnCode =
    cleanText(row.hsnCode) ||
    cleanText(anyRow.hsn_code) ||
    cleanText(anyRow.hsn) ||
    "NA";

  const unit =
    cleanText(row.baseUnit) ||
    cleanText(anyRow.unit) ||
    cleanText(anyRow.unit_uqc);

  const category =
    cleanText(row.parent) || cleanText(anyRow.category) || "Uncategorized";

  const manufacturer =
    cleanText(anyRow.manufacturer) || cleanText(anyRow.brand);

  const description =
    cleanText(anyRow.description) ||
    (category ? `Tally Group: ${category}` : null);

  return {
    name: row.name,
    part_number: partNumber,

    // products.hsn_code is NOT NULL, so never pass null
    hsn_code: hsnCode,

    unit_uqc: unit,
    category,
    manufacturer,
    description,

    status: cleanText(anyRow.status) || "active",

    cost_price_currency: "INR",
    cost_price: price,

    msp_currency: "INR",
    msp: firstPositive(anyRow.msp, price),

    selling_price_currency: "INR",
    selling_price: firstPositive(
      anyRow.sellingPrice,
      anyRow.selling_price,
      price,
    ),

    tax: String(anyRow.gstRate || anyRow.tax || 0),

    opening_stock: openingStock,
    opening_stock_value: openingValue || closingValue || price,

    stock_on_hand: stockOnHand,
    committed_stock: firstPositive(
      anyRow.committedStock,
      anyRow.committed_stock,
    ),
    available_for_sale: availableForSale,

    qty_to_be_invoiced_shipped: firstPositive(
      anyRow.qtyToBeInvoicedShipped,
      anyRow.qty_to_be_invoiced_shipped,
    ),

    qty_to_be_received_billed: firstPositive(
      anyRow.qtyToBeReceivedBilled,
      anyRow.qty_to_be_received_billed,
    ),
  };
}
