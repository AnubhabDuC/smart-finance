import { formatMoney, formatMonth } from "../lib/formatters";
import type { MonthlyMerchants } from "../lib/types";

type TopMerchantsPanelProps = {
  topMerchants: MonthlyMerchants[];
  transactionRange: string;
};

export function TopMerchantsPanel({
  topMerchants,
  transactionRange,
}: TopMerchantsPanelProps) {
  return (
    <div>
      <div className="panel-header">
        <h2>Top merchants</h2>
        <span className="pill">{transactionRange}</span>
      </div>
      <div className="rows">
        {topMerchants.map((row) => (
          <div key={row.month} className="row">
            <div className="month">{formatMonth(row.month)}</div>
            <div className="tag-list">
              {row.top_merchants.map((item) => (
                <div key={item.merchant} className="tag">
                  <span>{item.merchant}</span>
                  <strong>{formatMoney(item.total)}</strong>
                </div>
              ))}
            </div>
          </div>
        ))}
        {!topMerchants.length && <p className="empty">No merchant data yet.</p>}
      </div>
    </div>
  );
}
