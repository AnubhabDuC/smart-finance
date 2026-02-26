export function mapEventToStatus(eventType: string, message?: string | null) {
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
