export type TallySyncDirection = "pull" | "push" | "both";

export type TallyEntityType =
  | "ledger"
  | "stock_item"
  | "sales_voucher"
  | "receipt_voucher";

export type TallyLedgerPayload = {
  guid?: string;
  masterId?: string;
  alterId?: string;
  name: string;
  parent?: string;
  email?: string;
  phone?: string;
  address?: string;
  gstin?: string;
  state?: string;
  country?: string;
  records?: any[];
};

export type TallyStockItemPayload = {
  guid?: string;
  masterId?: string;
  alterId?: string;
  name: string;
  parent?: string;
  baseUnit?: string;
  openingBalance?: string;
  openingRate?: string;
  openingValue?: string;
  records?: any[];
};
