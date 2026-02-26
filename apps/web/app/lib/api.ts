const rawBase = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";
const trimmed = rawBase.endsWith("/") ? rawBase.slice(0, -1) : rawBase;

export const API_BASE = `${trimmed}/v1`;
