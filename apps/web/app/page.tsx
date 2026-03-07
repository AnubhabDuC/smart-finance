"use client";

import { useEffect, useMemo, useState } from "react";

import { AuthPanel } from "./components/AuthPanel";
import { CategoryBreakdownPanel } from "./components/CategoryBreakdownPanel";
import { CategoryTransactionsModal } from "./components/CategoryTransactionsModal";
import { CreditActivityPanel } from "./components/CreditActivityPanel";
import { DashboardHeader } from "./components/DashboardHeader";
import { IngestionDetailModal } from "./components/IngestionDetailModal";
import { IngestionHistoryPanel } from "./components/IngestionHistoryPanel";
import { MonthTransactionsModal } from "./components/MonthTransactionsModal";
import { MonthlyTotalsPanel } from "./components/MonthlyTotalsPanel";
import { SummaryGrid } from "./components/SummaryGrid";
import { TopMerchantsPanel } from "./components/TopMerchantsPanel";
import { fetchMe, googleLogin, login, register } from "./lib/auth";
import type { AuthUser } from "./lib/auth";
import {
  API_BASE,
  ApiError,
  apiJson,
  getStoredToken,
  setStoredToken,
} from "./lib/api";
import { formatRange } from "./lib/formatters";
import { mapEventToStatus } from "./lib/ingest";
import { resolveIssuer } from "./lib/issuer";
import type {
  CategorySummaryItem,
  IngestDetail,
  IngestEvent,
  MonthlyCategories,
  MonthlyCreditsDebits,
  MonthlyMerchants,
  MonthlyTotals,
  PieSlice,
  Totals,
  TxRow,
} from "./lib/types";

type AuthMode = "login" | "register";

function parseErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return fallback;
}

export default function Page() {
  const googleClientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || null;
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
  const [resetting, setResetting] = useState(false);
  const [resetStatus, setResetStatus] = useState<string | null>(null);
  const [resetError, setResetError] = useState<string | null>(null);
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

  const [authToken, setAuthToken] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

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
    const totalsMap = new Map<string, number>();
    categories.forEach((month) => {
      month.categories.forEach((item) => {
        const current = totalsMap.get(item.category) || 0;
        totalsMap.set(item.category, current + (item.total?.value || 0));
      });
    });
    return Array.from(totalsMap.entries())
      .map(([category, value]) => ({ category, value }))
      .filter((item) => item.value > 0)
      .sort((a, b) => b.value - a.value);
  }, [categories]);

  const piePalette = useMemo(
    () => [
      "#ff8a3d",
      "#ff6f3d",
      "#f2a65a",
      "#ffb27c",
      "#d86234",
      "#c84628",
      "#ffa64d",
      "#f26d5b",
      "#ffcc66",
      "#c95d8b",
    ],
    [],
  );

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

  const clearDashboardState = () => {
    setTotals(null);
    setMonthly([]);
    setCreditsDebits([]);
    setTopMerchants([]);
    setCategories([]);
    setEvents([]);
    setSelectedMonth(null);
    setMonthTransactions([]);
    setSelectedCategory(null);
    setCategoryTransactions([]);
    setSelectedIngestId(null);
    setIngestDetail(null);
    setRollbackIds([]);
    setError(null);
  };

  const expireSession = (message: string) => {
    setStoredToken(null);
    setAuthToken(null);
    setCurrentUser(null);
    clearDashboardState();
    setAuthError(message);
  };

  const fetchDashboardData = async (opts?: {
    silent?: boolean;
    isActive?: () => boolean;
  }) => {
    if (!authToken) return;

    const canSet = () => (opts?.isActive ? opts.isActive() : true);
    if (!opts?.silent) {
      setLoading(true);
    }
    setError(null);

    try {
      const [
        totalsJson,
        monthlyJson,
        creditsJson,
        merchantsJson,
        categoriesJson,
        eventsJson,
      ] = await Promise.all([
        apiJson<Totals>(`/statements/summary/totals${query}`, {
          token: authToken,
        }),
        apiJson<MonthlyTotals[]>(`/statements/summary/by-month${query}`, {
          token: authToken,
        }),
        apiJson<MonthlyCreditsDebits[]>(
          `/statements/summary/credits-debits-by-month${query}`,
          { token: authToken },
        ),
        apiJson<MonthlyMerchants[]>(
          `/statements/summary/top-merchants-by-month${query}`,
          { token: authToken },
        ),
        apiJson<MonthlyCategories[]>(
          `/statements/summary/categories-by-month${query}`,
          { token: authToken },
        ),
        apiJson<IngestEvent[]>("/ingest-events?limit=20", { token: authToken }),
      ]);

      if (!canSet()) return;
      setTotals(totalsJson);
      setMonthly(monthlyJson);
      setCreditsDebits(creditsJson);
      setTopMerchants(merchantsJson);
      setCategories(categoriesJson);
      setEvents(eventsJson);
    } catch (err) {
      if (!canSet()) return;
      if (err instanceof ApiError && err.status === 401) {
        expireSession("Session expired. Sign in again.");
        return;
      }
      setError(parseErrorMessage(err, "Failed to load dashboard"));
    } finally {
      if (!opts?.silent && canSet()) setLoading(false);
    }
  };

  const fetchMonthTransactions = async (
    monthKey: string,
    opts?: { isActive?: () => boolean },
  ) => {
    if (!authToken) return;
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
      const json = await apiJson<TxRow[]>(
        `/transactions?${params.toString()}`,
        {
          token: authToken,
        },
      );
      if (canSet()) setMonthTransactions(json);
    } catch (err) {
      if (canSet()) {
        if (err instanceof ApiError && err.status === 401) {
          expireSession("Session expired. Sign in again.");
        }
        setMonthTransactions([]);
      }
    } finally {
      if (canSet()) setTxLoading(false);
    }
  };

  const fetchCategoryTransactions = async (
    category: string,
    opts?: { isActive?: () => boolean },
  ) => {
    if (!authToken) return;
    const canSet = () => (opts?.isActive ? opts.isActive() : true);
    if (canSet()) setCategoryLoading(true);
    const params = new URLSearchParams();
    if (resolvedIssuer) params.set("issuer", resolvedIssuer);
    params.set("category", category);

    try {
      const json = await apiJson<TxRow[]>(
        `/transactions?${params.toString()}`,
        {
          token: authToken,
        },
      );
      if (canSet()) setCategoryTransactions(json);
    } catch (err) {
      if (canSet()) {
        if (err instanceof ApiError && err.status === 401) {
          expireSession("Session expired. Sign in again.");
        }
        setCategoryTransactions([]);
      }
    } finally {
      if (canSet()) setCategoryLoading(false);
    }
  };

  const loadIngestDetail = async (artifactId: string) => {
    if (!authToken) return;
    setIngestLoading(true);
    setRollbackError(null);
    try {
      const json = await apiJson<IngestDetail>(
        `/ingest-events/${artifactId}/details`,
        { token: authToken },
      );
      setIngestDetail(json);
      setRollbackIds([]);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        expireSession("Session expired. Sign in again.");
      }
      setRollbackError(parseErrorMessage(err, "Failed to load details"));
      setIngestDetail(null);
    } finally {
      setIngestLoading(false);
    }
  };

  useEffect(() => {
    let mounted = true;

    const bootstrap = async () => {
      const token = getStoredToken();
      if (!token) {
        if (mounted) setAuthReady(true);
        return;
      }

      try {
        const me = await fetchMe(token);
        if (!mounted) return;
        setAuthToken(token);
        setCurrentUser(me);
      } catch {
        if (!mounted) return;
        setStoredToken(null);
        setAuthError("Session expired. Sign in again.");
      } finally {
        if (mounted) setAuthReady(true);
      }
    };

    bootstrap();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!authToken) {
      clearDashboardState();
      return;
    }

    let mounted = true;
    fetchDashboardData({ isActive: () => mounted });
    return () => {
      mounted = false;
    };
  }, [query, authToken]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.body.classList.toggle("dark-mode", darkMode);
  }, [darkMode]);

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
    if (!authToken || !uploadStatus || uploadStage >= 100) return;

    let active = true;
    const poll = async () => {
      try {
        const json = await apiJson<IngestEvent[]>("/ingest-events?limit=20", {
          token: authToken,
        });
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
  }, [authToken, uploadStatus, uploadStage]);

  useEffect(() => {
    if (!selectedMonth || !authToken) return;
    let mounted = true;
    fetchMonthTransactions(selectedMonth, { isActive: () => mounted });
    return () => {
      mounted = false;
    };
  }, [selectedMonth, resolvedIssuer, authToken]);

  useEffect(() => {
    if (!selectedCategory || !authToken) return;
    let mounted = true;
    fetchCategoryTransactions(selectedCategory, { isActive: () => mounted });
    return () => {
      mounted = false;
    };
  }, [selectedCategory, resolvedIssuer, authToken]);

  const handleAuthSubmit = async (input: {
    mode: AuthMode;
    email: string;
    password: string;
    fullName?: string;
  }) => {
    setAuthLoading(true);
    setAuthError(null);

    try {
      const response =
        input.mode === "register"
          ? await register({
              email: input.email,
              password: input.password,
              full_name: input.fullName,
            })
          : await login({ email: input.email, password: input.password });

      setStoredToken(response.access_token);
      setAuthToken(response.access_token);
      setCurrentUser(response.user);
      setAuthMode("login");
    } catch (err) {
      setAuthError(parseErrorMessage(err, "Authentication failed"));
    } finally {
      setAuthLoading(false);
    }
  };

  const handleGoogleSubmit = async (idToken: string) => {
    setAuthLoading(true);
    setAuthError(null);
    try {
      const response = await googleLogin({ id_token: idToken });
      setStoredToken(response.access_token);
      setAuthToken(response.access_token);
      setCurrentUser(response.user);
      setAuthMode("login");
    } catch (err) {
      setAuthError(parseErrorMessage(err, "Google sign-in failed"));
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = () => {
    setStoredToken(null);
    setAuthToken(null);
    setCurrentUser(null);
    clearDashboardState();
    setUploadStatus(null);
    setUploadError(null);
    setUploadStage(0);
    setFriendlyStatus(null);
    setResetStatus(null);
    setResetError(null);
    setAuthError(null);
  };

  const handleUpload = async (file: File | null) => {
    if (!file || !authToken) return;

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
        headers: { Authorization: `Bearer ${authToken}` },
        body: form,
      });

      if (!res.ok) {
        let detail = "Upload failed";
        try {
          const data = await res.json();
          if (typeof data?.detail === "string") detail = data.detail;
        } catch {
          // ignore parse errors
        }
        throw new ApiError(detail, res.status);
      }

      const json = await res.json();
      setLastObjectKey(json.object_key ?? null);
      setUploadStatus(
        `Uploaded. Job ${json.job_id} • Queue ${json.queue_length}`,
      );
      setUploadStage(40);
      setFriendlyStatus("Queued for extraction…");
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        expireSession("Session expired. Sign in again.");
      }
      setUploadError(parseErrorMessage(err, "Upload failed"));
      setFriendlyStatus(null);
    } finally {
      setUploading(false);
    }
  };

  const handleResetAll = async () => {
    if (!authToken) return;

    if (typeof window !== "undefined") {
      const confirmed = window.confirm(
        "This will permanently delete all statements, transactions, EMIs, uploads, and ingestion history for your account. Continue?",
      );
      if (!confirmed) return;
    }

    setResetting(true);
    setResetStatus(null);
    setResetError(null);

    try {
      const json = await apiJson<{ warnings?: string[] }>("/debug/reset-all", {
        method: "POST",
        token: authToken,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm_text: "DELETE_EVERYTHING" }),
      });

      const warnings =
        Array.isArray(json?.warnings) && json.warnings.length
          ? ` (warnings: ${json.warnings.join(" | ")})`
          : "";
      setResetStatus(`All account data deleted${warnings}`);

      setUploadStatus(null);
      setUploadError(null);
      setUploadStage(0);
      setFriendlyStatus(null);
      setLastObjectKey(null);
      setSelectedMonth(null);
      setMonthTransactions([]);
      setSelectedCategory(null);
      setCategoryTransactions([]);
      setSelectedIngestId(null);
      setIngestDetail(null);
      setRollbackIds([]);
      setRollbackError(null);
      setEvents([]);
      await fetchDashboardData({ silent: true });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        expireSession("Session expired. Sign in again.");
      }
      setResetError(parseErrorMessage(err, "Reset failed"));
    } finally {
      setResetting(false);
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
    if (!selectedIngestId || !authToken) return;
    if (mode === "partial" && rollbackIds.length === 0) return;

    setRollbackLoading(true);
    setRollbackError(null);
    try {
      await apiJson(`/ingest-events/${selectedIngestId}/rollback`, {
        method: "POST",
        token: authToken,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          mode === "partial" ? { transaction_ids: rollbackIds } : {},
        ),
      });

      await loadIngestDetail(selectedIngestId);
      await fetchDashboardData({ silent: true });
      if (selectedMonth) {
        await fetchMonthTransactions(selectedMonth);
      }
      if (selectedCategory) {
        await fetchCategoryTransactions(selectedCategory);
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        expireSession("Session expired. Sign in again.");
      }
      setRollbackError(parseErrorMessage(err, "Rollback failed"));
    } finally {
      setRollbackLoading(false);
    }
  };

  return (
    <main className={`page ${darkMode ? "dark" : ""}`}>
      <div className="orb orb-one" />
      <div className="orb orb-two" />

      {!authReady ? (
        <section className="panel auth-loading">Checking session…</section>
      ) : !currentUser ? (
        <header className="hero">
          <div>
            <p className="kicker">Finance Intelligence Dashboard</p>
            <h1>Statements, spend, and signals in one view.</h1>
            <p className="subtitle">
              Sign in to access your private data workspace. Every dashboard,
              ingestion event, and statement is scoped to your account.
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
            <AuthPanel
              darkMode={darkMode}
              loading={authLoading}
              error={authError}
              mode={authMode}
              onModeChange={setAuthMode}
              onSubmit={handleAuthSubmit}
              googleClientId={googleClientId}
              onGoogleSubmit={handleGoogleSubmit}
            />
          </div>
        </header>
      ) : (
        <>
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
            resetting={resetting}
            resetStatus={resetStatus}
            resetError={resetError}
            onResetAll={handleResetAll}
            userEmail={currentUser.email}
            userName={currentUser.full_name ?? null}
            onLogout={handleLogout}
          />

          {error && (
            <section className="error-card">
              <strong>API error</strong> — {error}
            </section>
          )}

          <IngestionHistoryPanel events={events} onSelect={handleIngestClick} />
          <SummaryGrid totals={totals} />
          <MonthlyTotalsPanel
            monthly={monthly}
            statementRange={statementRange}
          />

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
        </>
      )}
    </main>
  );
}
