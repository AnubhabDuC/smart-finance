import type { Money } from "./types";

export function formatMoney(m?: Money | null) {
  if (!m) return "—";
  return `${m.currency} ${m.value.toLocaleString()}`;
}

export function formatMonth(key: string) {
  if (!key) return "Unknown";
  if (/^\d{4}-\d{2}$/.test(key)) {
    const [y, m] = key.split("-");
    const date = new Date(Number(y), Number(m) - 1, 1);
    return date.toLocaleString("en-US", { month: "short", year: "numeric" });
  }
  const parsed = new Date(key);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toLocaleString("en-US", { month: "short", year: "numeric" });
  }
  return key;
}

export function formatRange(months: string[], fallback: string) {
  if (!months.length) return fallback;
  const sorted = [...months].sort();
  const start = formatMonth(sorted[0]);
  const end = formatMonth(sorted[sorted.length - 1]);
  return start === end ? start : `${start}–${end}`;
}
