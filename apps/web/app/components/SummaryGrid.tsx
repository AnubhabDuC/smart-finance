import { formatMoney } from "../lib/formatters";
import type { Totals } from "../lib/types";

type SummaryGridProps = {
  totals: Totals | null;
};

export function SummaryGrid({ totals }: SummaryGridProps) {
  return (
    <section className="grid">
      <article className="card reveal">
        <h3>Total due</h3>
        <p className="value">{formatMoney(totals?.total_due)}</p>
        <span className="meta">Min due: {formatMoney(totals?.minimum_due)}</span>
      </article>
      <article className="card reveal delay-1">
        <h3>Statement count</h3>
        <p className="value">{totals?.statement_count ?? 0}</p>
        <span className="meta">Transactions: {totals?.transaction_count ?? 0}</span>
      </article>
      <article className="card reveal delay-2">
        <h3>Balances</h3>
        <p className="value small">
          {formatMoney(totals?.opening_balance)} → {formatMoney(totals?.closing_balance)}
        </p>
        <span className="meta">Finance charges: {formatMoney(totals?.finance_charges)}</span>
      </article>
      <article className="card highlight reveal delay-3">
        <h3>Credits vs debits</h3>
        <p className="value small">
          Credits {formatMoney(totals?.total_credits)} · Debits {formatMoney(totals?.total_debits)}
        </p>
        <span className="meta">Across all statements</span>
      </article>
    </section>
  );
}
