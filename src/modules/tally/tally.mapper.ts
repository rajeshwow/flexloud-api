import type { TallyLedgerPayload, TallyStockItemPayload } from "./tally.types";

function toNumber(value?: string) {
  if (!value) return 0;
  const cleaned = String(value).replace(/[^\d.-]/g, "");
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : 0;
}

export function mapTallyLedgerToOrganization(row: TallyLedgerPayload) {
  return {
    name: row.name,
    gst_number: row.gstin || null,
    email: row.email || null,
    type: "customer",
    industry: null,
    registered_street: row.address || null,
    registered_area: null,
    registered_postal_code: null,
    registered_city: row.state || null,
    registered_state: row.state || null,
    registered_country: row.country || "India",
  };
}

export function mapTallyStockItemToProduct(row: TallyStockItemPayload) {
  const openingStock = toNumber(row.openingBalance);
  const openingRate = toNumber(row.openingRate);
  const openingValue = toNumber(row.openingValue) || openingStock * openingRate;

  return {
    name: row.name,
    part_number: row.masterId || row.guid || row.name,
    hsn_code: null,
    unit_uqc: row.baseUnit || null,
    category: row.parent || null,
    manufacturer: null,
    description: row.parent ? `Tally Group: ${row.parent}` : null,
    status: "active",
    cost_price_currency: "INR",
    cost_price: openingRate || 0,
    msp_currency: "INR",
    msp: openingRate || 0,
    selling_price_currency: "INR",
    selling_price: openingRate || 0,
    tax: 0,
    opening_stock: openingStock,
    opening_stock_value: openingValue,
    stock_on_hand: openingStock,
    committed_stock: 0,
    available_for_sale: openingStock,
    qty_to_be_invoiced_shipped: 0,
    qty_to_be_received_billed: 0,
  };
}
