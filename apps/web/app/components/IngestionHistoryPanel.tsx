import type { IngestEvent } from "../lib/types";

type IngestionHistoryPanelProps = {
  events: IngestEvent[];
  onSelect: (event: IngestEvent) => void;
};

export function IngestionHistoryPanel({ events, onSelect }: IngestionHistoryPanelProps) {
  return (
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
            onClick={() => onSelect(event)}
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
  );
}
