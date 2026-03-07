import type { ChangeEvent } from "react";

type DashboardHeaderProps = {
  darkMode: boolean;
  onToggleDarkMode: () => void;
  issuer: string;
  onIssuerChange: (value: string) => void;
  loading: boolean;
  resolvedIssuer: string;
  uploading: boolean;
  uploadStatus: string | null;
  uploadError: string | null;
  uploadStage: number;
  friendlyStatus: string | null;
  onUpload: (file: File | null) => void;
  resetting: boolean;
  resetStatus: string | null;
  resetError: string | null;
  onResetAll: () => void;
  userEmail: string;
  userName: string | null;
  onLogout: () => void;
};

export function DashboardHeader({
  darkMode,
  onToggleDarkMode,
  issuer,
  onIssuerChange,
  loading,
  resolvedIssuer,
  uploading,
  uploadStatus,
  uploadError,
  uploadStage,
  friendlyStatus,
  onUpload,
  resetting,
  resetStatus,
  resetError,
  onResetAll,
  userEmail,
  userName,
  onLogout,
}: DashboardHeaderProps) {
  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    onUpload(event.target.files?.[0] || null);
  };

  return (
    <header className="hero">
      <div>
        <p className="kicker">Finance Intelligence Dashboard</p>
        <h1>Statements, spend, and signals in one view.</h1>
        <p className="subtitle">
          Powered by your ingestion pipeline. Filter by issuer to slice
          statement insights, monthly totals, and category intelligence.
        </p>
      </div>
      <div className="side-stack">
        <div className="session-card">
          <div className="session-copy">
            <span>Signed in</span>
            <strong>{userName || userEmail}</strong>
          </div>
          <button type="button" className="logout-button" onClick={onLogout}>
            Logout
          </button>
        </div>
        <div className="theme-toggle">
          <span>Theme</span>
          <button
            type="button"
            className={`toggle ${darkMode ? "on" : "off"}`}
            onClick={onToggleDarkMode}
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
            onChange={(event) => onIssuerChange(event.target.value)}
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
            onChange={handleFileChange}
          />
          <div className="hint">
            {uploading ? "Uploading…" : "PDF statements only"}
          </div>
          {friendlyStatus && (
            <div className="upload-progress">
              <div className="progress-bar">
                <div
                  className="progress-fill"
                  style={{ width: `${uploadStage}%` }}
                />
              </div>
              <span>{friendlyStatus}</span>
            </div>
          )}
          {uploadStatus && <div className="upload-status">{uploadStatus}</div>}
          {uploadError && <div className="upload-error">{uploadError}</div>}
          <div className="reset-action">
            <button
              type="button"
              className="reset-button"
              onClick={onResetAll}
              disabled={resetting || uploading}
            >
              {resetting ? "Resetting…" : "Reset all data"}
            </button>
            <span className="reset-note">
              Deletes DB, queue, files, and history
            </span>
          </div>
          {resetStatus && <div className="reset-status">{resetStatus}</div>}
          {resetError && <div className="upload-error">{resetError}</div>}
        </div>
      </div>
    </header>
  );
}
