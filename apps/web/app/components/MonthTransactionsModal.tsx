import { formatMoney, formatMonth } from "../lib/formatters";
import type { TxRow } from "../lib/types";

type MonthTransactionsModalProps = {
  month: string;
  transactions: TxRow[];
  loading: boolean;
  onClose: () => void;
};

export function MonthTransactionsModal({
  month,
  transactions,
  loading,
  onClose,
}: MonthTransactionsModalProps) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h3>{formatMonth(month)}</h3>
            <p>Credit card transactions</p>
          </div>
          <button className="close" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="modal-body">
          {loading && <p className="empty">Loading transactions…</p>}
          {!loading && !transactions.length && <p className="empty">No transactions found.</p>}
          {!loading && transactions.length > 0 && (
            <div className="rows">
              {transactions.map((tx) => (
                <div key={tx.id} className="row">
                  <div className="month">
                    {new Date(tx.ts).toLocaleDateString("en-US", {
                      day: "2-digit",
                      month: "short",
                      year: "numeric",
                    })}
                  </div>
                  <div className="row-item">
                    <span>Merchant</span>
                    <strong>{tx.merchant_raw || "Unknown"}</strong>
                  </div>
                  <div className="row-item">
                    <span>Amount</span>
                    <strong>{formatMoney({ value: tx.amount, currency: tx.currency })}</strong>
                  </div>
                  <div className="row-item">
                    <span>Card</span>
                    <strong>{tx.statement_instrument || tx.statement_issuer || "Unknown card"}</strong>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
