import { formatMoney, formatMonth } from "../lib/formatters";
import type { MonthlyCreditsDebits } from "../lib/types";

type CreditActivityPanelProps = {
  creditsDebits: MonthlyCreditsDebits[];
  transactionRange: string;
  selectedMonth: string | null;
  onSelectMonth: (month: string) => void;
};

export function CreditActivityPanel({
  creditsDebits,
  transactionRange,
  selectedMonth,
  onSelectMonth,
}: CreditActivityPanelProps) {
  return (
    <div>
      <div className="panel-header">
        <div>
          <h2>Credit card activity</h2>
          <span className="subtle">Credits & debits · statement transactions</span>
        </div>
        <span className="pill">{transactionRange}</span>
      </div>
      <div className="rows">
        {creditsDebits.map((row) => (
          <div key={row.month} className="row">
            <button
              className={`month month-btn ${selectedMonth === row.month ? "active" : ""}`}
              onClick={() => onSelectMonth(row.month)}
            >
              {formatMonth(row.month)}
            </button>
            <div className="row-item">
              <span>Debits</span>
              <strong>{formatMoney(row.debit_total)}</strong>
            </div>
            <div className="row-item">
              <span>Credits</span>
              <strong>{formatMoney(row.credit_total)}</strong>
            </div>
            <div className="row-item">
              <span>Count</span>
              <strong>{row.transaction_count}</strong>
            </div>
          </div>
        ))}
        {!creditsDebits.length && <p className="empty">No transaction totals yet.</p>}
      </div>
    </div>
  );
}
