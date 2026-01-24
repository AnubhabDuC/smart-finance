"use client";

import { useEffect, useMemo, useState } from "react";

type Money = { value: number; currency: string };
type Totals = {
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

type MonthlyTotals = {
  month: string;
  total_due?: Money | null;
  minimum_due?: Money | null;
  total_credits?: Money | null;
  total_debits?: Money | null;
  finance_charges?: Money | null;
  statement_count: number;
  transaction_count: number;
};

type MerchantRow = { merchant: string; total: Money; transaction_count: number };
type MonthlyMerchants = { month: string; top_merchants: MerchantRow[] };
type MonthlyCategories = { month: string; categories: { category: string; total: Money; transaction_count: number }[] };
type MonthlyCreditsDebits = { month: string; debit_total?: Money | null; credit_total?: Money | null; transaction_count: number };
type TxRow = {
  id: string;
  ts: string;
  amount: number;
  currency: string;
  merchant_raw?: string | null;
  statement_issuer?: string | null;
  statement_instrument?: string | null;
};
type IngestEvent = {
  id: string;
  event_type: string;
  message?: string | null;
  created_at: string;
  object_key?: string | null;
  artifact_id?: string | null;
};

type IngestDetail = {
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

const API_BASE = "http://127.0.0.1:8000/v1";

function formatMoney(m?: Money | null) {
  if (!m) return "—";
  return `${m.currency} ${m.value.toLocaleString()}`;
}

function formatMonth(key: string) {
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

function formatRange(months: string[], fallback: string) {
  if (!months.length) return fallback;
  const sorted = [...months].sort();
  const start = formatMonth(sorted[0]);
  const end = formatMonth(sorted[sorted.length - 1]);
  return start === end ? start : `${start}–${end}`;
}

function resolveIssuer(input: string): string {
  const value = input.trim().toLowerCase();
  if (!value) return "";

  const rules: Array<{ canonical: string; aliases: string[] }> = [
    { canonical: "American Express Banking", aliases: ["amex", "american express", "americanexpress"] },
    { canonical: "ICICI Bank", aliases: ["icici", "icic"] },
    { canonical: "HDFC Bank", aliases: ["hdfc"] },
    { canonical: "SBI", aliases: ["sbi", "state bank"] },
    { canonical: "Axis Bank", aliases: ["axis"] },
    { canonical: "Kotak", aliases: ["kotak"] },
  ];

  for (const rule of rules) {
    if (rule.aliases.some((alias) => value.includes(alias))) {
      return rule.canonical;
    }
  }
  return input.trim();
}

function mapEventToStatus(eventType: string, message?: string | null) {
  const normalized = eventType.toLowerCase();
  if (normalized === "ingest_enqueued") {
    return { stage: 40, label: "Queued for extraction…" };
  }
  if (normalized === "ingest_received") {
    return { stage: 45, label: "Received by processor…" };
  }
  if (normalized === "reupload_reset") {
    return { stage: 55, label: "Correction detected — recalculating…" };
  }
  if (normalized === "dedup_skip") {
    return { stage: 65, label: "Duplicate transactions skipped." };
  }
  if (normalized === "ingest_complete") {
    return {
      stage: 100,
      label: message
        ? `Done — ${message.replace("transactions", "txns")}`
        : "Extraction complete.",
    };
  }
  return null;
}

function polarToCartesian(cx: number, cy: number, radius: number, angleInDegrees: number) {
  const angleInRadians = (angleInDegrees - 90) * (Math.PI / 180);
  return {
    x: cx + radius * Math.cos(angleInRadians),
    y: cy + radius * Math.sin(angleInRadians),
  };
}

function describeArc(
  cx: number,
  cy: number,
  radius: number,
  startAngle: number,
  endAngle: number
) {
  const start = polarToCartesian(cx, cy, radius, endAngle);
  const end = polarToCartesian(cx, cy, radius, startAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1";
  return [
    "M",
    cx,
    cy,
    "L",
    start.x,
    start.y,
    "A",
    radius,
    radius,
    0,
    largeArcFlag,
    0,
    end.x,
    end.y,
    "Z",
  ].join(" ");
}

export default function Page() {
  const [darkMode, setDarkMode] = useState(true);
  const [issuer, setIssuer] = useState("");
  const [loading, setLoading] = useState(false);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [monthly, setMonthly] = useState<MonthlyTotals[]>([]);
  const [creditsDebits, setCreditsDebits] = useState<MonthlyCreditsDebits[]>([]);
  const [topMerchants, setTopMerchants] = useState<MonthlyMerchants[]>([]);
  const [categories, setCategories] = useState<MonthlyCategories[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const [monthTransactions, setMonthTransactions] = useState<TxRow[]>([]);
  const [txLoading, setTxLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadStage, setUploadStage] = useState(0);
  const [friendlyStatus, setFriendlyStatus] = useState<string | null>(null);
  const [events, setEvents] = useState<IngestEvent[]>([]);
  const [lastObjectKey, setLastObjectKey] = useState<string | null>(null);
  const [selectedIngestId, setSelectedIngestId] = useState<string | null>(null);
  const [ingestDetail, setIngestDetail] = useState<IngestDetail | null>(null);
  const [ingestLoading, setIngestLoading] = useState(false);
  const [rollbackIds, setRollbackIds] = useState<string[]>([]);
  const [rollbackLoading, setRollbackLoading] = useState(false);
  const [rollbackError, setRollbackError] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [categoryTransactions, setCategoryTransactions] = useState<TxRow[]>([]);
  const [categoryLoading, setCategoryLoading] = useState(false);
  const [hoveredCategory, setHoveredCategory] = useState<string | null>(null);

  const statementRange = useMemo(
    () => formatRange(monthly.map((m) => m.month), "All time"),
    [monthly]
  );
  const transactionRange = useMemo(() => {
    const months = new Set<string>();
    creditsDebits.forEach((m) => months.add(m.month));
    topMerchants.forEach((m) => months.add(m.month));
    categories.forEach((m) => months.add(m.month));
    return formatRange(Array.from(months), "All time");
  }, [creditsDebits, topMerchants, categories]);

  const resolvedIssuer = useMemo(() => resolveIssuer(issuer), [issuer]);

  const categorySummary = useMemo(() => {
    const totals = new Map<string, number>();
    categories.forEach((month) => {
      month.categories.forEach((item) => {
        const current = totals.get(item.category) || 0;
        totals.set(item.category, current + (item.total?.value || 0));
      });
    });
    const entries = Array.from(totals.entries())
      .map(([category, value]) => ({ category, value }))
      .filter((item) => item.value > 0)
      .sort((a, b) => b.value - a.value);
    return entries;
  }, [categories]);

  const piePalette = useMemo(() => {
    return darkMode
      ? [
          "#ff8a3d",
          "#ff6f3d",
          "#f2a65a",
          "#ffb27c",
          "#ff7a9e",
          "#c84628",
          "#ffa64d",
          "#f26d5b",
          "#ffcc66",
          "#c95d8b",
        ]
      : [
          "#ff8a3d",
          "#ff6f3d",
          "#f2a65a",
          "#ffb27c",
          "#ff7a9e",
          "#c84628",
          "#ffa64d",
          "#f26d5b",
          "#ffcc66",
          "#c95d8b",
        ];
  }, [darkMode]);

  const categoryColorMap = useMemo(() => {
    const map = new Map<string, string>();
    const palette = piePalette;
    const sorted = [...categorySummary].sort((a, b) =>
      a.category.localeCompare(b.category)
    );
    sorted.forEach((item, idx) => {
      map.set(item.category, palette[idx % palette.length]);
    });
    return map;
  }, [categorySummary, piePalette]);

  const pieSlices = useMemo(() => {
    const total = categorySummary.reduce((sum, item) => sum + item.value, 0);
    if (total <= 0) return [];
    let acc = 0;
    return categorySummary.map((item) => {
      const start = (acc / total) * 360;
      acc += item.value;
      const end = (acc / total) * 360;
      return {
        category: item.category,
        value: item.value,
        startAngle: start,
        endAngle: end,
        color: categoryColorMap.get(item.category) || "#ff8a3d",
      };
    });
  }, [categorySummary, categoryColorMap]);

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (resolvedIssuer) params.set("issuer", resolvedIssuer);
    return params.toString() ? `?${params.toString()}` : "";
  }, [resolvedIssuer]);

  const fetchDashboardData = async (opts?: {
    silent?: boolean;
    isActive?: () => boolean;
  }) => {
    const canSet = () => (opts?.isActive ? opts.isActive() : true);
    if (!opts?.silent) {
      setLoading(true);
    }
    setError(null);
    try {
      const [
        totalsRes,
        monthlyRes,
        creditsRes,
        merchantsRes,
        categoriesRes,
        eventsRes,
      ] = await Promise.all([
        fetch(`${API_BASE}/statements/summary/totals${query}`),
        fetch(`${API_BASE}/statements/summary/by-month${query}`),
        fetch(`${API_BASE}/statements/summary/credits-debits-by-month${query}`),
        fetch(`${API_BASE}/statements/summary/top-merchants-by-month${query}`),
        fetch(`${API_BASE}/statements/summary/categories-by-month${query}`),
        fetch(`${API_BASE}/ingest-events?limit=20`),
      ]);

      if (!totalsRes.ok) throw new Error("Failed to load totals");
      const totalsJson = await totalsRes.json();
      const monthlyJson = await monthlyRes.json();
      const creditsJson = await creditsRes.json();
      const merchantsJson = await merchantsRes.json();
      const categoriesJson = await categoriesRes.json();
      const eventsJson = await eventsRes.json();

      if (!canSet()) return;
      setTotals(totalsJson);
      setMonthly(monthlyJson);
      setCreditsDebits(creditsJson);
      setTopMerchants(merchantsJson);
      setCategories(categoriesJson);
      setEvents(eventsJson);
    } catch (err) {
      if (!canSet()) return;
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      if (!opts?.silent && canSet()) setLoading(false);
    }
  };

  const fetchMonthTransactions = async (
    monthKey: string,
    opts?: { isActive?: () => boolean }
  ) => {
    const canSet = () => (opts?.isActive ? opts.isActive() : true);
    const [year, month] = monthKey.split("-");
    if (!year || !month) {
      if (canSet()) setMonthTransactions([]);
      return;
    }
    if (canSet()) setTxLoading(true);
    const start = new Date(Number(year), Number(month) - 1, 1);
    const end = new Date(Number(year), Number(month), 0, 23, 59, 59);
    const params = new URLSearchParams();
    params.set("start", start.toISOString());
    params.set("end", end.toISOString());
    if (resolvedIssuer) params.set("issuer", resolvedIssuer);
    try {
      const res = await fetch(`${API_BASE}/transactions?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to load transactions");
      const json = await res.json();
      if (canSet()) setMonthTransactions(json);
    } catch {
      if (canSet()) setMonthTransactions([]);
    } finally {
      if (canSet()) setTxLoading(false);
    }
  };

  const fetchCategoryTransactions = async (
    category: string,
    opts?: { isActive?: () => boolean }
  ) => {
    const canSet = () => (opts?.isActive ? opts.isActive() : true);
    if (canSet()) setCategoryLoading(true);
    const params = new URLSearchParams();
    if (resolvedIssuer) params.set("issuer", resolvedIssuer);
    params.set("category", category);
    try {
      const res = await fetch(`${API_BASE}/transactions?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to load category transactions");
      const json = await res.json();
      if (canSet()) setCategoryTransactions(json);
    } catch {
      if (canSet()) setCategoryTransactions([]);
    } finally {
      if (canSet()) setCategoryLoading(false);
    }
  };

  useEffect(() => {
    let mounted = true;
    fetchDashboardData({ isActive: () => mounted });
    return () => {
      mounted = false;
    };
  }, [query]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.body.classList.toggle("dark-mode", darkMode);
  }, [darkMode]);

  const loadIngestDetail = async (artifactId: string) => {
    setIngestLoading(true);
    setRollbackError(null);
    try {
      const res = await fetch(`${API_BASE}/ingest-events/${artifactId}/details`);
      if (!res.ok) throw new Error("Failed to load ingestion details");
      const json = await res.json();
      setIngestDetail(json);
      setRollbackIds([]);
    } catch (err) {
      setRollbackError(err instanceof Error ? err.message : "Failed to load details");
      setIngestDetail(null);
    } finally {
      setIngestLoading(false);
    }
  };

  useEffect(() => {
    if (!uploadStatus || !events.length || !lastObjectKey) return;
    const relevant = events.filter((event) => {
      if (event.object_key && event.object_key === lastObjectKey) return true;
      if (event.message && event.message.includes(lastObjectKey)) return true;
      return false;
    });
    if (!relevant.length) return;
    const statuses = relevant
      .map((event) => mapEventToStatus(event.event_type, event.message))
      .filter((value): value is { stage: number; label: string } => Boolean(value));
    if (!statuses.length) return;
    const best = statuses.sort((a, b) => b.stage - a.stage)[0];
    setFriendlyStatus(best.label);
    setUploadStage(best.stage);
  }, [events, uploadStatus, lastObjectKey]);

  useEffect(() => {
    if (!uploadStatus || uploadStage >= 100) return;
    let active = true;
    const poll = async () => {
      try {
        const res = await fetch(`${API_BASE}/ingest-events?limit=20`);
        if (!res.ok) return;
        const json = await res.json();
        if (active) setEvents(json);
      } catch {
        // ignore polling errors
      }
    };
    const id = setInterval(poll, 4000);
    poll();
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [uploadStatus, uploadStage]);

  useEffect(() => {
    if (!selectedMonth) return;
    let mounted = true;
    fetchMonthTransactions(selectedMonth, { isActive: () => mounted });
    return () => {
      mounted = false;
    };
  }, [selectedMonth, resolvedIssuer]);

  useEffect(() => {
    if (!selectedCategory) return;
    let mounted = true;
    fetchCategoryTransactions(selectedCategory, { isActive: () => mounted });
    return () => {
      mounted = false;
    };
  }, [selectedCategory, resolvedIssuer]);

  const handleUpload = async (file: File | null) => {
    if (!file) return;
    setUploading(true);
    setUploadStatus(null);
    setUploadError(null);
    setUploadStage(10);
    setFriendlyStatus("Uploading statement…");
    setLastObjectKey(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("source", "manual");
      form.append("external_id", `manual-${file.name}`);
      const res = await fetch(`${API_BASE}/ingest/upload`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) throw new Error("Upload failed");
      const json = await res.json();
      setLastObjectKey(json.object_key ?? null);
      setUploadStatus(`Uploaded. Job ${json.job_id} • Queue ${json.queue_length}`);
      setUploadStage(40);
      setFriendlyStatus("Queued for extraction…");
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
      setFriendlyStatus(null);
    } finally {
      setUploading(false);
    }
  };

  const handleIngestClick = (event: IngestEvent) => {
    if (!event.artifact_id) return;
    setSelectedIngestId(event.artifact_id);
    loadIngestDetail(event.artifact_id);
  };

  const toggleRollbackId = (txnId: string) => {
    setRollbackIds((prev) =>
      prev.includes(txnId) ? prev.filter((id) => id !== txnId) : [...prev, txnId]
    );
  };

  const handleRollback = async (mode: "all" | "partial") => {
    if (!selectedIngestId) return;
    if (mode === "partial" && rollbackIds.length === 0) return;
    setRollbackLoading(true);
    setRollbackError(null);
    try {
      const res = await fetch(`${API_BASE}/ingest-events/${selectedIngestId}/rollback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          mode === "partial" ? { transaction_ids: rollbackIds } : {}
        ),
      });
      if (!res.ok) throw new Error("Rollback failed");
      await loadIngestDetail(selectedIngestId);
      await fetchDashboardData({ silent: true });
      if (selectedMonth) {
        await fetchMonthTransactions(selectedMonth);
      }
      if (selectedCategory) {
        await fetchCategoryTransactions(selectedCategory);
      }
    } catch (err) {
      setRollbackError(err instanceof Error ? err.message : "Rollback failed");
    } finally {
      setRollbackLoading(false);
    }
  };

  return (
    <main className={`page ${darkMode ? "dark" : ""}`}>
      <div className="orb orb-one" />
      <div className="orb orb-two" />
      <header className="hero">
        <div>
          <p className="kicker">Finance Intelligence Dashboard</p>
          <h1>Statements, spend, and signals in one view.</h1>
          <p className="subtitle">
            Powered by your ingestion pipeline. Filter by issuer to slice statement insights,
            monthly totals, and category intelligence.
          </p>
        </div>
        <div className="side-stack">
          <div className="theme-toggle">
            <span>Theme</span>
            <button
              type="button"
              className={`toggle ${darkMode ? "on" : "off"}`}
              onClick={() => setDarkMode((prev) => !prev)}
            >
              <span className="knob" />
              <span className="label">{darkMode ? "Dark" : "Light"}</span>
            </button>
          </div>
          <div className="issuer-card">
            <label htmlFor="issuer">Issuer filter</label>
            <input
              id="issuer"
              value={issuer}
              onChange={(e) => setIssuer(e.target.value)}
              placeholder="AMEX, ICICI, HDFC"
            />
            <div className="hint">
              {loading
                ? "Refreshing…"
                : resolvedIssuer
                ? `Resolved to: ${resolvedIssuer}`
                : "Applies to all charts below"}
            </div>
          </div>
          <div className="upload-card">
            <label htmlFor="upload">Manual upload</label>
            <input
              id="upload"
              type="file"
              accept=".pdf"
              onChange={(e) => handleUpload(e.target.files?.[0] || null)}
            />
            <div className="hint">
              {uploading ? "Uploading…" : "PDF statements only"}
            </div>
            {friendlyStatus && (
              <div className="upload-progress">
                <div className="progress-bar">
                  <div className="progress-fill" style={{ width: `${uploadStage}%` }} />
                </div>
                <span>{friendlyStatus}</span>
              </div>
            )}
            {uploadStatus && <div className="upload-status">{uploadStatus}</div>}
            {uploadError && <div className="upload-error">{uploadError}</div>}
          </div>
        </div>
      </header>

      {error && (
        <section className="error-card">
          <strong>API error</strong> — {error}
        </section>
      )}

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Ingestion history</h2>
            <span className="subtle">Dedup, reuploads, and processing events</span>
          </div>
          <span className="pill">Recent 20</span>
        </div>
        <div className="rows">
          {events.map((event) => (
            <div
              key={event.id}
              className={`row clickable ${event.artifact_id ? "" : "disabled"}`}
              onClick={() => handleIngestClick(event)}
            >
              <div className="month">
                {new Date(event.created_at).toLocaleString("en-US", {
                  day: "2-digit",
                  month: "short",
                  year: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </div>
              <div className="row-item">
                <span>Event</span>
                <strong>{event.event_type}</strong>
              </div>
              <div className="row-item">
                <span>Details</span>
                <strong>{event.message || "—"}</strong>
              </div>
            </div>
          ))}
          {!events.length && <p className="empty">No ingest events yet.</p>}
        </div>
      </section>

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

      <section className="panel split">
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
                  onClick={() => setSelectedMonth(row.month)}
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
      </section>

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
                    d={describeArc(100, 100, 80, slice.startAngle, slice.endAngle)}
                    fill={slice.color}
                    className={`pie-slice ${hoveredCategory === slice.category ? "active" : ""}`}
                    onMouseEnter={() => setHoveredCategory(slice.category)}
                    onMouseLeave={() => setHoveredCategory(null)}
                    onClick={() => setSelectedCategory(slice.category)}
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
                onClick={() => setSelectedCategory(item.category)}
                onMouseEnter={() => setHoveredCategory(item.category)}
                onMouseLeave={() => setHoveredCategory(null)}
              >
                <span
                  className="legend-swatch"
                  style={{ background: categoryColorMap.get(item.category) || "#ff8a3d" }}
                />
                <span className="legend-label">{item.category}</span>
                <span className="legend-value">{formatMoney({ value: item.value, currency: "INR" })}</span>
              </button>
            ))}
            {!categorySummary.length && <p className="empty">No categories yet.</p>}
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

      {selectedMonth && (
        <div className="modal-overlay" onClick={() => setSelectedMonth(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h3>{formatMonth(selectedMonth)}</h3>
                <p>Credit card transactions</p>
              </div>
              <button className="close" onClick={() => setSelectedMonth(null)}>
                ×
              </button>
            </div>
            <div className="modal-body">
              {txLoading && <p className="empty">Loading transactions…</p>}
              {!txLoading && !monthTransactions.length && (
                <p className="empty">No transactions found.</p>
              )}
              {!txLoading && monthTransactions.length > 0 && (
                <div className="rows">
                  {monthTransactions.map((tx) => (
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
      )}

      {selectedIngestId && (
        <div className="modal-overlay" onClick={() => setSelectedIngestId(null)}>
          <div className="modal ingest-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h3>Ingestion details</h3>
                <p>{ingestDetail?.object_key || selectedIngestId}</p>
              </div>
              <button className="close" onClick={() => setSelectedIngestId(null)}>
                ×
              </button>
            </div>
            <div className="modal-body">
              {ingestLoading && <p className="empty">Loading details…</p>}
              {!ingestLoading && ingestDetail && (
                <>
                  <div className="detail-grid">
                    <div>
                      <span>Status</span>
                      <strong>{ingestDetail.status || "unknown"}</strong>
                    </div>
                    <div>
                      <span>Source</span>
                      <strong>{ingestDetail.source || "—"}</strong>
                    </div>
                    <div>
                      <span>Added</span>
                      <strong>{ingestDetail.transactions_added} txns</strong>
                    </div>
                    <div>
                      <span>Skipped</span>
                      <strong>{ingestDetail.transactions_skipped} txns</strong>
                    </div>
                  </div>
                  {ingestDetail.statement && (
                    <div className="detail-block">
                      <h4>Statement summary</h4>
                      <p>
                        {ingestDetail.statement.issuer || "Issuer"} ·{" "}
                        {ingestDetail.statement.instrument || "Card"}
                      </p>
                      <p>
                        Statement date{" "}
                        {ingestDetail.statement.statement_date
                          ? new Date(ingestDetail.statement.statement_date).toLocaleDateString("en-US")
                          : "—"}{" "}
                        · Due{" "}
                        {ingestDetail.statement.due_date
                          ? new Date(ingestDetail.statement.due_date).toLocaleDateString("en-US")
                          : "—"}
                      </p>
                    </div>
                  )}
                  <div className="detail-block">
                    <h4>Transactions</h4>
                    {!ingestDetail.transactions.length && (
                      <p className="empty">No transactions saved for this ingestion.</p>
                    )}
                    {ingestDetail.transactions.length > 0 && (
                      <div className="rows">
                        {ingestDetail.transactions.map((txn) => (
                          <div key={txn.id} className="row ingest-row">
                            <label className="checkbox">
                              <input
                                type="checkbox"
                                checked={rollbackIds.includes(txn.id)}
                                onChange={() => toggleRollbackId(txn.id)}
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
                    <button
                      className="danger"
                      disabled={rollbackLoading}
                      onClick={() => handleRollback("all")}
                    >
                      Rollback ingestion
                    </button>
                    <button
                      className="ghost"
                      disabled={rollbackLoading || rollbackIds.length === 0}
                      onClick={() => handleRollback("partial")}
                    >
                      Rollback selected
                    </button>
                    {rollbackError && <span className="error-text">{rollbackError}</span>}
                  </div>
                </>
              )}
              {!ingestLoading && !ingestDetail && (
                <p className="empty">No details found for this ingestion.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {selectedCategory && (
        <div className="modal-overlay" onClick={() => setSelectedCategory(null)}>
          <div className="modal category-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h3>{selectedCategory}</h3>
                <p>Category transactions</p>
              </div>
              <button className="close" onClick={() => setSelectedCategory(null)}>
                ×
              </button>
            </div>
            <div className="modal-body">
              {categoryLoading && <p className="empty">Loading transactions…</p>}
              {!categoryLoading && !categoryTransactions.length && (
                <p className="empty">No transactions found.</p>
              )}
              {!categoryLoading && categoryTransactions.length > 0 && (
                <div className="rows">
                  {categoryTransactions.map((tx) => (
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
      )}

      <style jsx global>{`
        html,
        body {
          margin: 0;
          min-height: 100%;
          background: radial-gradient(circle at 12% 14%, #fff4ea 0%, #f7f1eb 40%, #f1f3f9 100%);
          background-image: radial-gradient(circle at 12% 14%, #fff4ea 0%, #f7f1eb 40%, #f1f3f9 100%),
            radial-gradient(rgba(28, 16, 8, 0.06) 1px, transparent 1px);
          background-size: auto, 18px 18px;
        }
        #__next {
          min-height: 100%;
          background: radial-gradient(circle at 12% 14%, #fff4ea 0%, #f7f1eb 40%, #f1f3f9 100%);
          background-image: radial-gradient(circle at 12% 14%, #fff4ea 0%, #f7f1eb 40%, #f1f3f9 100%),
            radial-gradient(rgba(28, 16, 8, 0.06) 1px, transparent 1px);
          background-size: auto, 18px 18px;
        }
        body.dark-mode,
        body.dark-mode #__next {
          background: radial-gradient(circle at 10% 10%, #191a22 0%, #0b0c12 45%, #1a0f08 100%);
          background-image: radial-gradient(circle at 10% 10%, #191a22 0%, #0b0c12 45%, #1a0f08 100%),
            radial-gradient(rgba(255, 138, 61, 0.16) 1px, transparent 1px);
          background-size: auto, 18px 18px;
        }
        * {
          scrollbar-width: thin;
          scrollbar-color: #ff8a3d transparent;
        }
        html::-webkit-scrollbar,
        body::-webkit-scrollbar {
          width: 10px;
          height: 10px;
        }
        html::-webkit-scrollbar-track,
        body::-webkit-scrollbar-track,
        html::-webkit-scrollbar-track-piece,
        body::-webkit-scrollbar-track-piece {
          background: transparent;
        }
        html::-webkit-scrollbar-thumb,
        body::-webkit-scrollbar-thumb {
          background: linear-gradient(180deg, #ff8a3d, #c84628);
          border-radius: 999px;
          border: 2px solid transparent;
          background-clip: padding-box;
        }
        body.dark-mode::-webkit-scrollbar-thumb {
          background: linear-gradient(180deg, #ff8a3d, #ff7a2f);
        }
      `}</style>
      <style jsx>{`
        .page {
          min-height: 100vh;
          padding: 52px clamp(20px, 4vw, 72px) 110px;
          color: #14141a;
          font-family: "Space Grotesk", "Manrope", "IBM Plex Sans", sans-serif;
          background: radial-gradient(circle at 12% 14%, #fff4ea 0%, #f7f1eb 40%, #f1f3f9 100%);
          position: relative;
          overflow: hidden;
        }
        .page::after {
          content: "";
          position: absolute;
          inset: 0;
          background-image: radial-gradient(rgba(28, 16, 8, 0.06) 1px, transparent 1px);
          background-size: 18px 18px;
          opacity: 0.35;
          pointer-events: none;
        }
        .page.dark {
          color: #f7f4ef;
          background: radial-gradient(circle at 10% 10%, #191a22 0%, #0b0c12 45%, #1a0f08 100%);
        }
        .page.dark::after {
          background-image: radial-gradient(rgba(255, 138, 61, 0.16) 1px, transparent 1px);
          opacity: 0.25;
        }
        .orb {
          position: absolute;
          border-radius: 999px;
          filter: blur(0px);
          opacity: 0.45;
          z-index: 0;
        }
        .orb-one {
          width: 420px;
          height: 420px;
          background: radial-gradient(circle, rgba(255, 158, 94, 0.55) 0%, rgba(255, 122, 46, 0.2) 55%, transparent 100%);
          top: -160px;
          right: -120px;
        }
        .orb-two {
          width: 520px;
          height: 520px;
          background: radial-gradient(circle, rgba(46, 53, 75, 0.45) 0%, rgba(6, 10, 16, 0.1) 60%, transparent 100%);
          bottom: -240px;
          left: -180px;
        }
        .hero,
        .grid,
        .panel,
        .error-card {
          position: relative;
          z-index: 1;
        }
        .hero {
          display: grid;
          grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
          gap: 32px;
          align-items: center;
          margin-bottom: 36px;
        }
        .kicker {
          text-transform: uppercase;
          letter-spacing: 0.32em;
          font-size: 11px;
          color: #ff8a3d;
        }
        h1 {
          font-size: clamp(34px, 4vw, 58px);
          margin: 10px 0 18px;
          line-height: 1.02;
          font-weight: 600;
          color: #14141a;
          background: linear-gradient(120deg, #0b0d14 0%, #ff7a2f 55%, #ffba7b 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }
        .page.dark h1 {
          color: #fff2e7;
          background: linear-gradient(120deg, #fff6ef 0%, #ff8a3d 55%, #ffcf9e 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }
        .subtitle {
          font-size: 17px;
          max-width: 560px;
          color: #2b2b35;
        }
        .page.dark .subtitle {
          color: #c9c3bb;
        }
        .issuer-card {
          background: linear-gradient(145deg, #0b0c12 0%, #171a24 100%);
          color: #fff2e7;
          padding: 22px;
          border-radius: 20px;
          display: grid;
          gap: 12px;
          border: 1px solid rgba(255, 138, 61, 0.25);
          box-shadow: 0 20px 50px rgba(7, 9, 14, 0.4);
        }
        .side-stack {
          display: grid;
          gap: 16px;
        }
        .theme-toggle {
          background: #ffffff;
          padding: 14px 18px;
          border-radius: 16px;
          border: 1px solid rgba(16, 20, 35, 0.08);
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
        }
        .page.dark .theme-toggle {
          background: linear-gradient(140deg, rgba(6, 6, 8, 0.75) 0%, rgba(6, 6, 8, 0.45) 40%, #c84628 70%, #ff8a3d 100%);
          border-color: rgba(255, 154, 87, 0.5);
        }
        .theme-toggle span {
          font-size: 12px;
          text-transform: uppercase;
          letter-spacing: 0.12em;
          color: #2a2f48;
        }
        .page.dark .theme-toggle span {
          color: #f7e6d6;
          text-shadow: 0 1px 2px rgba(6, 6, 8, 0.4);
        }
        .toggle {
          position: relative;
          width: 92px;
          height: 32px;
          border-radius: 999px;
          border: none;
          display: inline-flex;
          align-items: center;
          justify-content: space-between;
          padding: 4px 10px;
          cursor: pointer;
          background: #0c0e14;
          color: #ff9a57;
          font-size: 12px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }
        .page.dark .toggle {
          background: linear-gradient(135deg, #ff8a3d 0%, #ffba7b 100%);
          color: #1c130c;
          border: 1px solid rgba(255, 210, 168, 0.6);
          box-shadow: 0 10px 24px rgba(255, 122, 46, 0.2);
        }
        .toggle.off {
          background: #fff1e6;
          color: #0b0d14;
        }
        .page.dark .toggle.off {
          background: #0c0e14;
          color: #ffb27c;
          border: 1px solid rgba(255, 146, 68, 0.3);
          box-shadow: none;
        }
        .toggle .knob {
          position: absolute;
          width: 22px;
          height: 22px;
          border-radius: 50%;
          background: #ff9a57;
          left: 6px;
          transition: transform 0.2s ease;
        }
        .toggle.on .knob {
          transform: translateX(48px);
          background: #ffd1a8;
        }
        .page.dark .toggle.on .knob {
          background: #1c130c;
          box-shadow: 0 0 0 2px rgba(255, 236, 218, 0.8);
        }
        .page.dark .toggle.off .knob {
          background: #ff9a57;
        }
        .toggle .label {
          margin-left: auto;
          z-index: 1;
          font-size: 11px;
        }
        .page.dark .toggle.on .label {
          margin-left: 0;
          margin-right: auto;
          color: #1a0f08;
        }
        .upload-card {
          background: linear-gradient(160deg, rgba(255, 255, 255, 0.92) 0%, rgba(255, 242, 231, 0.9) 100%);
          padding: 18px;
          border-radius: 18px;
          border: 1px solid rgba(255, 138, 61, 0.18);
          box-shadow: 0 20px 40px rgba(15, 12, 8, 0.15);
          display: grid;
          gap: 10px;
        }
        .page.dark .upload-card {
          background: linear-gradient(150deg, rgba(6, 6, 8, 0.75) 0%, rgba(6, 6, 8, 0.45) 40%, #c84628 70%, #ff8a3d 100%);
          color: #f7e6d6;
          border-color: rgba(255, 154, 87, 0.5);
          box-shadow: 0 26px 50px rgba(255, 122, 46, 0.28);
        }
        .upload-card label {
          font-size: 12px;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: #5b5b74;
        }
        .page.dark .upload-card label {
          color: #f7e6d6;
          text-shadow: 0 1px 2px rgba(6, 6, 8, 0.4);
        }
        .upload-card input[type="file"] {
          background: #f6f7fb;
          border: 1px dashed #cdd1e4;
          border-radius: 12px;
          padding: 10px;
          font-size: 12px;
        }
        .page.dark .upload-card input[type="file"] {
          background: rgba(255, 255, 255, 0.15);
          border-color: rgba(255, 214, 184, 0.6);
          color: #1a0d08;
        }
        .upload-progress {
          display: grid;
          gap: 6px;
          font-size: 12px;
          color: #3b3f5c;
        }
        .page.dark .upload-progress {
          color: #cbb8a2;
        }
        .progress-bar {
          width: 100%;
          height: 8px;
          border-radius: 999px;
          background: #edf0fb;
          overflow: hidden;
        }
        .page.dark .progress-bar {
          background: rgba(255, 255, 255, 0.12);
        }
        .progress-fill {
          height: 100%;
          background: linear-gradient(90deg, #ff7a2f, #ffb677);
          transition: width 0.3s ease;
        }
        .upload-status {
          font-size: 12px;
          color: #2f7a46;
        }
        .upload-error {
          font-size: 12px;
          color: #b42318;
        }
        .issuer-card label {
          font-size: 12px;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: #ff9a57;
        }
        .issuer-card input {
          background: #15171f;
          border: 1px solid #2b2f3c;
          color: #fff8f1;
          font-size: 16px;
          padding: 10px 12px;
          border-radius: 10px;
          outline: none;
        }
        .issuer-card input::placeholder {
          color: rgba(255, 224, 198, 0.6);
        }
        .issuer-card input:focus {
          border-color: #ff9a57;
          box-shadow: 0 0 0 2px rgba(255, 154, 87, 0.3);
        }
        .hint {
          font-size: 12px;
          color: #5c5166;
        }
        .page.dark .hint {
          color: #cbb8a2;
        }
        .page.dark .upload-card .hint {
          color: #f7e6d6;
          text-shadow: 0 1px 2px rgba(6, 6, 8, 0.4);
        }
        .error-card {
          background: #ffebe8;
          border: 1px solid #ffb4a2;
          padding: 14px 18px;
          border-radius: 14px;
          margin-bottom: 18px;
        }
        .page.dark .error-card {
          background: rgba(255, 138, 61, 0.12);
          border-color: rgba(255, 138, 61, 0.35);
          color: #ffd6b3;
        }
        .grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
          gap: 16px;
          margin-bottom: 28px;
        }
        .card {
          background: rgba(255, 255, 255, 0.86);
          border-radius: 20px;
          padding: 18px;
          border: 1px solid rgba(255, 146, 68, 0.18);
          box-shadow: 0 18px 40px rgba(19, 15, 10, 0.12);
          min-height: 130px;
        }
        .page.dark .card {
          background: linear-gradient(160deg, rgba(16, 18, 26, 0.96), rgba(34, 24, 18, 0.88));
          color: #f7f1e9;
          border-color: rgba(255, 146, 68, 0.28);
          box-shadow: 0 24px 50px rgba(3, 4, 6, 0.55);
        }
        .card.highlight {
          background: linear-gradient(135deg, #0b0d14 0%, #1b1410 100%);
          color: #f6f7ff;
        }
        .page.dark .card.highlight {
          background: linear-gradient(135deg, rgba(6, 6, 8, 0.85) 0%, rgba(6, 6, 8, 0.85) 32%, #c84628 58%, #e06a3e 76%, #ff8a3d 100%);
          color: #fff1e4;
          border-color: rgba(255, 154, 87, 0.5);
          box-shadow: 0 28px 60px rgba(255, 122, 46, 0.25);
        }
        .card h3 {
          font-size: 14px;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          margin-bottom: 10px;
          color: inherit;
        }
        .value {
          font-size: 26px;
          font-weight: 600;
          margin-bottom: 8px;
        }
        .value.small {
          font-size: 18px;
        }
        .meta {
          font-size: 12px;
          color: inherit;
          opacity: 0.7;
        }
        .panel {
          background: rgba(255, 255, 255, 0.92);
          border-radius: 24px;
          padding: 22px 24px;
          border: 1px solid rgba(255, 146, 68, 0.15);
          box-shadow: 0 24px 60px rgba(19, 15, 10, 0.14);
          margin-bottom: 24px;
        }
        .page.dark .panel {
          background: linear-gradient(150deg, rgba(20, 22, 30, 0.98), rgba(40, 26, 20, 0.92));
          color: #f7f1e9;
          border-color: rgba(255, 146, 68, 0.28);
          box-shadow: 0 28px 60px rgba(3, 4, 6, 0.7);
        }
        .panel.split {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
          gap: 24px;
        }
        .panel-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 14px;
        }
        .panel-header h2 {
          font-size: 20px;
          margin: 0;
        }
        .subtle {
          display: block;
          font-size: 12px;
          color: #6b6f86;
          margin-top: 4px;
        }
        .page.dark .subtle {
          color: #c9b6a1;
        }
        .pill {
          background: linear-gradient(135deg, #0b0d14 0%, #2a1a12 100%);
          color: #ffb27c;
          padding: 6px 12px;
          border-radius: 999px;
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.18em;
          border: 1px solid rgba(255, 146, 68, 0.3);
        }
        .page.dark .pill {
          background: linear-gradient(135deg, #ff8a3d 0%, #ffd2a8 100%);
          color: #1b120c;
          border-color: rgba(255, 210, 168, 0.6);
        }
        .rows {
          display: grid;
          gap: 14px;
        }
        .row {
          display: grid;
          grid-template-columns: 140px repeat(auto-fit, minmax(140px, 1fr));
          gap: 12px;
          padding: 12px 14px;
          background: rgba(255, 255, 255, 0.86);
          border-radius: 16px;
          border: 1px solid rgba(16, 18, 25, 0.08);
        }
        .page.dark .row {
          background: linear-gradient(145deg, rgba(18, 20, 28, 0.96), rgba(34, 24, 18, 0.92));
          border-color: rgba(255, 146, 68, 0.22);
        }
        .ingest-row {
          grid-template-columns: 24px 120px repeat(auto-fit, minmax(140px, 1fr));
        }
        .clickable {
          cursor: pointer;
          transition: transform 0.2s ease, box-shadow 0.2s ease;
        }
        .clickable:hover {
          transform: translateY(-1px);
          box-shadow: 0 8px 20px rgba(12, 16, 30, 0.12);
        }
        .page.dark .clickable:hover {
          box-shadow: 0 10px 28px rgba(255, 122, 46, 0.18);
          border-color: rgba(255, 146, 68, 0.3);
        }
        .clickable.disabled {
          opacity: 0.5;
          cursor: not-allowed;
          transform: none;
          box-shadow: none;
        }
        .month {
          font-weight: 600;
        }
        .page.dark .month {
          color: #ffe0c6;
        }
        .month-btn {
          border: none;
          background: transparent;
          text-align: left;
          padding: 0;
          cursor: pointer;
        }
        .month-btn:hover {
          color: #ff7a2f;
        }
        .page.dark .month-btn:hover {
          color: #ffb27c;
        }
        .month-btn.active {
          color: #1b3dd6;
        }
        .page.dark .month-btn.active {
          color: #ffb27c;
        }
        .modal-overlay {
          position: fixed;
          inset: 0;
          background: rgba(16, 20, 35, 0.45);
          backdrop-filter: blur(4px);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 10;
          animation: fadeIn 0.2s ease-out;
        }
        .modal {
          width: min(880px, 92vw);
          background: #ffffff;
          border-radius: 20px;
          box-shadow: 0 30px 90px rgba(8, 12, 28, 0.35);
          overflow: hidden;
          animation: floatIn 0.25s ease-out;
        }
        .page.dark .modal {
          background: linear-gradient(160deg, #141720 0%, #1f1813 100%);
          color: #f7f1e9;
          box-shadow: 0 40px 110px rgba(0, 0, 0, 0.7);
          border: 1px solid rgba(255, 146, 68, 0.25);
        }
        .ingest-modal {
          width: min(980px, 92vw);
        }
        .modal-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 18px 22px;
          border-bottom: 1px solid #e6e8f2;
          background: linear-gradient(120deg, #f2f4ff 0%, #fff3e8 100%);
        }
        .page.dark .modal-header {
          border-bottom: 1px solid rgba(255, 146, 68, 0.2);
          background: linear-gradient(120deg, rgba(22, 24, 34, 0.96), rgba(46, 28, 18, 0.9));
        }
        .modal-header h3 {
          margin: 0;
          font-size: 20px;
        }
        .modal-header p {
          margin: 4px 0 0;
          font-size: 12px;
          color: #5c6075;
        }
        .page.dark .modal-header p {
          color: #d0b7a1;
        }
        .close {
          border: none;
          background: #0f1322;
          color: #fff;
          width: 32px;
          height: 32px;
          border-radius: 999px;
          cursor: pointer;
          font-size: 18px;
          line-height: 1;
        }
        .modal-body {
          max-height: 60vh;
          overflow-y: auto;
          padding: 18px 22px 22px;
        }
        .modal-body::-webkit-scrollbar-track {
          background: transparent;
        }
        .detail-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
          gap: 12px;
          margin-bottom: 16px;
        }
        .detail-grid span {
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: #6a6f89;
        }
        .detail-grid strong {
          font-size: 14px;
          color: #111526;
        }
        .page.dark .detail-grid span {
          color: #cbb8a2;
        }
        .page.dark .detail-grid strong {
          color: #f7f1e9;
        }
        .detail-block {
          background: #f6f7fb;
          border-radius: 14px;
          padding: 14px;
          margin-bottom: 14px;
        }
        .page.dark .detail-block {
          background: rgba(17, 20, 28, 0.9);
          border: 1px solid rgba(255, 146, 68, 0.15);
        }
        .detail-block h4 {
          margin: 0 0 8px;
          font-size: 14px;
        }
        .detail-actions {
          display: flex;
          gap: 12px;
          align-items: center;
        }
        .detail-actions .danger,
        .detail-actions .ghost {
          padding: 10px 16px;
          border-radius: 10px;
          border: none;
          font-size: 12px;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          cursor: pointer;
        }
        .detail-actions .danger {
          background: #b42318;
          color: #fff;
        }
        .detail-actions .ghost {
          background: #eef1ff;
          color: #1c2557;
        }
        .detail-actions button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .checkbox {
          display: inline-flex;
          align-items: center;
          margin-right: 6px;
        }
        .checkbox input {
          accent-color: #5b7cff;
        }
        .error-text {
          font-size: 12px;
          color: #b42318;
        }
        .category-analytics {
          display: grid;
          grid-template-columns: minmax(160px, 220px) minmax(0, 1fr);
          gap: 18px;
          align-items: center;
          margin-bottom: 18px;
        }
        .pie {
          width: 200px;
          height: 200px;
          border-radius: 50%;
          background: #f3f3f6;
          box-shadow: inset 0 0 0 12px rgba(255, 255, 255, 0.7);
          display: grid;
          place-items: center;
          font-size: 12px;
          color: #6b6f86;
          position: relative;
        }
        .page.dark .pie {
          background: #1a1c24;
          box-shadow: inset 0 0 0 12px rgba(10, 10, 14, 0.6);
          color: #cbb8a2;
        }
        .pie-svg {
          width: 200px;
          height: 200px;
        }
        .pie-slice {
          cursor: pointer;
          transition: transform 0.2s ease, filter 0.2s ease;
          transform-origin: 100px 100px;
        }
        .pie-slice:hover,
        .pie-slice.active {
          filter: brightness(1.08);
          transform: scale(1.02);
        }
        .legend {
          display: grid;
          gap: 10px;
        }
        .legend-item {
          display: grid;
          grid-template-columns: 12px minmax(0, 1fr) auto;
          align-items: center;
          gap: 10px;
          font-size: 12px;
          color: #2b2b35;
        }
        .legend-button {
          width: 100%;
          text-align: left;
          padding: 8px 10px;
          border-radius: 12px;
          border: 1px solid transparent;
          background: transparent;
          cursor: pointer;
          transition: transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease;
        }
        .legend-button:hover {
          transform: translateY(-1px);
          border-color: rgba(255, 138, 61, 0.35);
          box-shadow: 0 10px 18px rgba(18, 12, 8, 0.12);
        }
        .page.dark .legend-button:hover {
          border-color: rgba(255, 138, 61, 0.45);
          box-shadow: 0 12px 24px rgba(255, 122, 46, 0.18);
        }
        .page.dark .legend-item {
          color: #f3e6d9;
        }
        .legend-swatch {
          width: 10px;
          height: 10px;
          border-radius: 50%;
          background: #ff8a3d;
          box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.1);
        }
        .category-modal {
          width: min(900px, 92vw);
        }
        .page.dark .category-modal {
          background: linear-gradient(160deg, #161823 0%, #221710 100%);
        }
        .legend-label {
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .legend-value {
          font-weight: 600;
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes floatIn {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .row-item span {
          display: block;
          font-size: 12px;
          color: #5c5e75;
        }
        .row-item strong {
          font-size: 14px;
        }
        .page.dark .row-item span {
          color: #cbb8a2;
        }
        .tag-list {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }
        .tag {
          background: #0b0d14;
          color: #ffad73;
          padding: 8px 12px;
          border-radius: 12px;
          min-width: 140px;
          display: grid;
          gap: 4px;
          font-size: 12px;
          border: 1px solid rgba(255, 146, 68, 0.2);
        }
        .tag.muted {
          background: #1b1a1a;
          color: #ffd6b3;
        }
        .empty {
          font-size: 13px;
          color: #6b6f86;
        }
        .page.dark .empty {
          color: #cbb8a2;
        }
        .reveal {
          animation: rise 0.6s ease-out forwards;
          opacity: 0;
          transform: translateY(12px);
        }
        .delay-1 {
          animation-delay: 0.1s;
        }
        .delay-2 {
          animation-delay: 0.2s;
        }
        .delay-3 {
          animation-delay: 0.3s;
        }
        @keyframes rise {
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        @media (max-width: 900px) {
          .hero {
            grid-template-columns: 1fr;
          }
          .row {
            grid-template-columns: 1fr;
          }
        }
        @import url("https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600&display=swap");
      `}</style>
    </main>
  );
}
