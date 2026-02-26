import { formatMoney, formatMonth } from "../lib/formatters";
import { describeArc } from "../lib/pie";
import type {
  CategorySummaryItem,
  MonthlyCategories,
  PieSlice,
} from "../lib/types";

type CategoryBreakdownPanelProps = {
  categories: MonthlyCategories[];
  transactionRange: string;
  categorySummary: CategorySummaryItem[];
  categoryColorMap: Map<string, string>;
  pieSlices: PieSlice[];
  hoveredCategory: string | null;
  onHoverCategory: (category: string | null) => void;
  onSelectCategory: (category: string) => void;
};

export function CategoryBreakdownPanel({
  categories,
  transactionRange,
  categorySummary,
  categoryColorMap,
  pieSlices,
  hoveredCategory,
  onHoverCategory,
  onSelectCategory,
}: CategoryBreakdownPanelProps) {
  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h2>Category breakdown</h2>
          <span className="subtle">Credit card transactions</span>
        </div>
        <span className="pill">{transactionRange}</span>
      </div>
      <div className="category-analytics">
        <div className="pie">
          {!pieSlices.length && <span>No data</span>}
          {pieSlices.length > 0 && (
            <svg className="pie-svg" viewBox="0 0 200 200">
              {pieSlices.map((slice) => (
                <path
                  key={slice.category}
                  d={describeArc(
                    100,
                    100,
                    80,
                    slice.startAngle,
                    slice.endAngle,
                  )}
                  fill={slice.color}
                  className={`pie-slice ${hoveredCategory === slice.category ? "active" : ""}`}
                  onMouseEnter={() => onHoverCategory(slice.category)}
                  onMouseLeave={() => onHoverCategory(null)}
                  onClick={() => onSelectCategory(slice.category)}
                />
              ))}
            </svg>
          )}
        </div>
        <div className="legend">
          {categorySummary.slice(0, 8).map((item) => (
            <button
              key={item.category}
              className="legend-item legend-button"
              onClick={() => onSelectCategory(item.category)}
              onMouseEnter={() => onHoverCategory(item.category)}
              onMouseLeave={() => onHoverCategory(null)}
            >
              <span
                className="legend-swatch"
                style={{
                  background: categoryColorMap.get(item.category) || "#ff8a3d",
                }}
              />
              <span className="legend-label">{item.category}</span>
              <span className="legend-value">
                {formatMoney({ value: item.value, currency: "INR" })}
              </span>
            </button>
          ))}
          {!categorySummary.length && (
            <p className="empty">No categories yet.</p>
          )}
        </div>
      </div>
      <div className="rows">
        {categories.map((row) => (
          <div key={row.month} className="row">
            <div className="month">{formatMonth(row.month)}</div>
            <div className="tag-list">
              {row.categories.map((item) => (
                <div key={item.category} className="tag muted">
                  <span>{item.category}</span>
                  <strong>{formatMoney(item.total)}</strong>
                </div>
              ))}
            </div>
          </div>
        ))}
        {!categories.length && <p className="empty">No categories yet.</p>}
      </div>
    </section>
  );
}
