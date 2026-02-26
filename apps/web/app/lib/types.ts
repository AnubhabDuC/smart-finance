export type Money = { value: number; currency: string };

export type Totals = {
  total_due?: Money | null;
  minimum_due?: Money | null;
  opening_balance?: Money | null;
  closing_balance?: Money | null;
  total_credits?: Money | null;
  total_debits?: Money | null;
  finance_charges?: Money | null;
  statement_count: number;
  transaction_count: number;
};

export type MonthlyTotals = {
  month: string;
  total_due?: Money | null;
  minimum_due?: Money | null;
  total_credits?: Money | null;
  total_debits?: Money | null;
  finance_charges?: Money | null;
  statement_count: number;
  transaction_count: number;
};

export type MerchantRow = {
  merchant: string;
  total: Money;
  transaction_count: number;
};

export type MonthlyMerchants = { month: string; top_merchants: MerchantRow[] };

export type MonthlyCategories = {
  month: string;
  categories: { category: string; total: Money; transaction_count: number }[];
};

export type MonthlyCreditsDebits = {
  month: string;
  debit_total?: Money | null;
  credit_total?: Money | null;
  transaction_count: number;
};

export type TxRow = {
  id: string;
  ts: string;
  amount: number;
  currency: string;
  merchant_raw?: string | null;
  statement_issuer?: string | null;
  statement_instrument?: string | null;
};

export type IngestEvent = {
  id: string;
  event_type: string;
  message?: string | null;
  created_at: string;
  object_key?: string | null;
  artifact_id?: string | null;
};

export type IngestDetail = {
  artifact_id: string;
  object_key?: string | null;
  file_hash?: string | null;
  source?: string | null;
  external_id?: string | null;
  status?: string | null;
  transactions_added: number;
  transactions_skipped: number;
  transactions: Array<{
    id: string;
    ts: string;
    amount_value: number;
    amount_currency: string;
    txn_type: string;
    merchant_raw?: string | null;
    merchant_normalized?: string | null;
    channel?: string | null;
    reference?: string | null;
    location?: string | null;
  }>;
  emi_items: Array<{
    id: string;
    description?: string | null;
    total_amount_value?: number | null;
    total_amount_currency?: string | null;
    monthly_installment_value?: number | null;
    monthly_installment_currency?: string | null;
    tenure_months?: number | null;
    remaining_months?: number | null;
  }>;
  statement?: {
    id: string;
    issuer?: string | null;
    instrument?: string | null;
    statement_date?: string | null;
    due_date?: string | null;
    period_start?: string | null;
    period_end?: string | null;
    total_due_value?: number | null;
    total_due_currency?: string | null;
    minimum_due_value?: number | null;
    minimum_due_currency?: string | null;
  } | null;
  events: IngestEvent[];
};

export type CategorySummaryItem = { category: string; value: number };

export type PieSlice = {
  category: string;
  value: number;
  startAngle: number;
  endAngle: number;
  color: string;
};
