"use client";

import { useEffect, useMemo, useState } from "react";

import { DashboardHeader } from "./components/DashboardHeader";
import { IngestionHistoryPanel } from "./components/IngestionHistoryPanel";
import { SummaryGrid } from "./components/SummaryGrid";
import { MonthlyTotalsPanel } from "./components/MonthlyTotalsPanel";
import { CreditActivityPanel } from "./components/CreditActivityPanel";
import { TopMerchantsPanel } from "./components/TopMerchantsPanel";
import { CategoryBreakdownPanel } from "./components/CategoryBreakdownPanel";
import { MonthTransactionsModal } from "./components/MonthTransactionsModal";
import { IngestionDetailModal } from "./components/IngestionDetailModal";
import { CategoryTransactionsModal } from "./components/CategoryTransactionsModal";
import { API_BASE } from "./lib/api";
import { formatRange } from "./lib/formatters";
import { mapEventToStatus } from "./lib/ingest";
import { resolveIssuer } from "./lib/issuer";
import type {
  IngestDetail,
  IngestEvent,
  MonthlyCategories,
  MonthlyCreditsDebits,
  MonthlyMerchants,
  MonthlyTotals,
  Totals,
  TxRow,
  CategorySummaryItem,
  PieSlice,
} from "./lib/types";

export default function Page() {
  const [darkMode, setDarkMode] = useState(true);
  const [issuer, setIssuer] = useState("");
  const [loading, setLoading] = useState(false);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [monthly, setMonthly] = useState<MonthlyTotals[]>([]);
  const [creditsDebits, setCreditsDebits] = useState<MonthlyCreditsDebits[]>(
    [],
  );
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
    () =>
      formatRange(
        monthly.map((m) => m.month),
        "All time",
      ),
    [monthly],
  );
  const transactionRange = useMemo(() => {
    const months = new Set<string>();
    creditsDebits.forEach((m) => months.add(m.month));
    topMerchants.forEach((m) => months.add(m.month));
    categories.forEach((m) => months.add(m.month));
    return formatRange(Array.from(months), "All time");
  }, [creditsDebits, topMerchants, categories]);

  const resolvedIssuer = useMemo(() => resolveIssuer(issuer), [issuer]);

  const categorySummary = useMemo<CategorySummaryItem[]>(() => {
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
    const sorted = [...categorySummary].sort((a, b) =>
      a.category.localeCompare(b.category),
    );
    sorted.forEach((item, idx) => {
      map.set(item.category, piePalette[idx % piePalette.length]);
    });
    return map;
  }, [categorySummary, piePalette]);

  const pieSlices = useMemo<PieSlice[]>(() => {
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
    opts?: { isActive?: () => boolean },
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
    opts?: { isActive?: () => boolean },
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
      const res = await fetch(
        `${API_BASE}/ingest-events/${artifactId}/details`,
      );
      if (!res.ok) throw new Error("Failed to load ingestion details");
      const json = await res.json();
      setIngestDetail(json);
      setRollbackIds([]);
    } catch (err) {
      setRollbackError(
        err instanceof Error ? err.message : "Failed to load details",
      );
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
      .filter((value): value is { stage: number; label: string } =>
        Boolean(value),
      );
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
      setUploadStatus(
        `Uploaded. Job ${json.job_id} • Queue ${json.queue_length}`,
      );
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
      prev.includes(txnId)
        ? prev.filter((id) => id !== txnId)
        : [...prev, txnId],
    );
  };

  const handleRollback = async (mode: "all" | "partial") => {
    if (!selectedIngestId) return;
    if (mode === "partial" && rollbackIds.length === 0) return;
    setRollbackLoading(true);
    setRollbackError(null);
    try {
      const res = await fetch(
        `${API_BASE}/ingest-events/${selectedIngestId}/rollback`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            mode === "partial" ? { transaction_ids: rollbackIds } : {},
          ),
        },
      );
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
      <DashboardHeader
        darkMode={darkMode}
        onToggleDarkMode={() => setDarkMode((prev) => !prev)}
        issuer={issuer}
        onIssuerChange={setIssuer}
        loading={loading}
        resolvedIssuer={resolvedIssuer}
        uploading={uploading}
        uploadStatus={uploadStatus}
        uploadError={uploadError}
        uploadStage={uploadStage}
        friendlyStatus={friendlyStatus}
        onUpload={handleUpload}
      />

      {error && (
        <section className="error-card">
          <strong>API error</strong> — {error}
        </section>
      )}

      <IngestionHistoryPanel events={events} onSelect={handleIngestClick} />
      <SummaryGrid totals={totals} />
      <MonthlyTotalsPanel monthly={monthly} statementRange={statementRange} />

      <section className="panel split">
        <CreditActivityPanel
          creditsDebits={creditsDebits}
          transactionRange={transactionRange}
          selectedMonth={selectedMonth}
          onSelectMonth={setSelectedMonth}
        />
        <TopMerchantsPanel
          topMerchants={topMerchants}
          transactionRange={transactionRange}
        />
      </section>

      <CategoryBreakdownPanel
        categories={categories}
        transactionRange={transactionRange}
        categorySummary={categorySummary}
        categoryColorMap={categoryColorMap}
        pieSlices={pieSlices}
        hoveredCategory={hoveredCategory}
        onHoverCategory={setHoveredCategory}
        onSelectCategory={setSelectedCategory}
      />

      {selectedMonth && (
        <MonthTransactionsModal
          month={selectedMonth}
          transactions={monthTransactions}
          loading={txLoading}
          onClose={() => setSelectedMonth(null)}
        />
      )}

      {selectedIngestId && (
        <IngestionDetailModal
          artifactId={selectedIngestId}
          detail={ingestDetail}
          loading={ingestLoading}
          rollbackIds={rollbackIds}
          rollbackLoading={rollbackLoading}
          rollbackError={rollbackError}
          onToggleRollbackId={toggleRollbackId}
          onRollbackAll={() => handleRollback("all")}
          onRollbackPartial={() => handleRollback("partial")}
          onClose={() => setSelectedIngestId(null)}
        />
      )}

      {selectedCategory && (
        <CategoryTransactionsModal
          category={selectedCategory}
          transactions={categoryTransactions}
          loading={categoryLoading}
          onClose={() => setSelectedCategory(null)}
        />
      )}
    </main>
  );
}
