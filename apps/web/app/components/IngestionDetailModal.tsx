import { formatMoney } from "../lib/formatters";
import type { IngestDetail } from "../lib/types";

type IngestionDetailModalProps = {
  artifactId: string;
  detail: IngestDetail | null;
  loading: boolean;
  rollbackIds: string[];
  rollbackLoading: boolean;
  rollbackError: string | null;
  onToggleRollbackId: (id: string) => void;
  onRollbackAll: () => void;
  onRollbackPartial: () => void;
  onClose: () => void;
};

export function IngestionDetailModal({
  artifactId,
  detail,
  loading,
  rollbackIds,
  rollbackLoading,
  rollbackError,
  onToggleRollbackId,
  onRollbackAll,
  onRollbackPartial,
  onClose,
}: IngestionDetailModalProps) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal ingest-modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h3>Ingestion details</h3>
            <p>{detail?.object_key || artifactId}</p>
          </div>
          <button className="close" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="modal-body">
          {loading && <p className="empty">Loading details…</p>}
          {!loading && detail && (
            <>
              <div className="detail-grid">
                <div>
                  <span>Status</span>
                  <strong>{detail.status || "unknown"}</strong>
                </div>
                <div>
                  <span>Source</span>
                  <strong>{detail.source || "—"}</strong>
                </div>
                <div>
                  <span>Added</span>
                  <strong>{detail.transactions_added} txns</strong>
                </div>
                <div>
                  <span>Skipped</span>
                  <strong>{detail.transactions_skipped} txns</strong>
                </div>
              </div>
              {detail.statement && (
                <div className="detail-block">
                  <h4>Statement summary</h4>
                  <p>
                    {detail.statement.issuer || "Issuer"} ·{" "}
                    {detail.statement.instrument || "Card"}
                  </p>
                  <p>
                    Statement date{" "}
                    {detail.statement.statement_date
                      ? new Date(detail.statement.statement_date).toLocaleDateString("en-US")
                      : "—"}{" "}
                    · Due{" "}
                    {detail.statement.due_date
                      ? new Date(detail.statement.due_date).toLocaleDateString("en-US")
                      : "—"}
                  </p>
                </div>
              )}
              <div className="detail-block">
                <h4>Transactions</h4>
                {!detail.transactions.length && (
                  <p className="empty">No transactions saved for this ingestion.</p>
                )}
                {detail.transactions.length > 0 && (
                  <div className="rows">
                    {detail.transactions.map((txn) => (
                      <div key={txn.id} className="row ingest-row">
                        <label className="checkbox">
                          <input
                            type="checkbox"
                            checked={rollbackIds.includes(txn.id)}
                            onChange={() => onToggleRollbackId(txn.id)}
                          />
                          <span />
                        </label>
                        <div className="month">
                          {new Date(txn.ts).toLocaleDateString("en-US", {
                            day: "2-digit",
                            month: "short",
                            year: "numeric",
                          })}
                        </div>
                        <div className="row-item">
                          <span>Merchant</span>
                          <strong>{txn.merchant_raw || "Unknown"}</strong>
                        </div>
                        <div className="row-item">
                          <span>Amount</span>
                          <strong>
                            {formatMoney({
                              value: txn.amount_value,
                              currency: txn.amount_currency,
                            })}
                          </strong>
                        </div>
                        <div className="row-item">
                          <span>Type</span>
                          <strong>{txn.txn_type}</strong>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="detail-actions">
                <button className="danger" disabled={rollbackLoading} onClick={onRollbackAll}>
                  Rollback ingestion
                </button>
                <button
                  className="ghost"
                  disabled={rollbackLoading || rollbackIds.length === 0}
                  onClick={onRollbackPartial}
                >
                  Rollback selected
                </button>
                {rollbackError && <span className="error-text">{rollbackError}</span>}
              </div>
            </>
          )}
          {!loading && !detail && <p className="empty">No details found for this ingestion.</p>}
        </div>
      </div>
    </div>
  );
}
