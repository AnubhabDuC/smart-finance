import { formatMoney, formatMonth } from "../lib/formatters";
import type { MonthlyTotals } from "../lib/types";

type MonthlyTotalsPanelProps = {
  monthly: MonthlyTotals[];
  statementRange: string;
};

export function MonthlyTotalsPanel({
  monthly,
  statementRange,
}: MonthlyTotalsPanelProps) {
  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h2>Monthly statement totals</h2>
          <span className="subtle">Grouped by statement date</span>
        </div>
        <span className="pill">{statementRange}</span>
      </div>
      <div className="rows">
        {monthly.map((row) => (
          <div key={row.month} className="row">
            <div className="month">{formatMonth(row.month)}</div>
            <div className="row-item">
              <span>Total due</span>
              <strong>{formatMoney(row.total_due)}</strong>
            </div>
            <div className="row-item">
              <span>Min due</span>
              <strong>{formatMoney(row.minimum_due)}</strong>
            </div>
            <div className="row-item">
              <span>Statements</span>
              <strong>{row.statement_count}</strong>
            </div>
            <div className="row-item">
              <span>Transactions</span>
              <strong>{row.transaction_count}</strong>
            </div>
          </div>
        ))}
        {!monthly.length && <p className="empty">No statement totals yet.</p>}
      </div>
    </section>
  );
}
