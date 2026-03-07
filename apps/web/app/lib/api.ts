const rawBase = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";
const trimmed = rawBase.endsWith("/") ? rawBase.slice(0, -1) : rawBase;

export const API_BASE = `${trimmed}/v1`;
export const AUTH_TOKEN_KEY = "smart_finance.auth_token";

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

function buildHeaders(
  token?: string | null,
  extraHeaders?: HeadersInit,
): Headers {
  const headers = new Headers(extraHeaders);
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  return headers;
}

export async function apiJson<T>(
  path: string,
  options?: {
    method?: string;
    token?: string | null;
    headers?: HeadersInit;
    body?: BodyInit | null;
  },
): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    method: options?.method || "GET",
    headers: buildHeaders(options?.token, options?.headers),
    body: options?.body,
  });

  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const data = await response.json();
      if (typeof data?.detail === "string") {
        message = data.detail;
      }
    } catch {
      // ignore parse errors for non-json responses
    }
    throw new ApiError(message, response.status);
  }

  return (await response.json()) as T;
}

export function getStoredToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(AUTH_TOKEN_KEY);
}

export function setStoredToken(token: string | null): void {
  if (typeof window === "undefined") return;
  if (!token) {
    window.localStorage.removeItem(AUTH_TOKEN_KEY);
    return;
  }
  window.localStorage.setItem(AUTH_TOKEN_KEY, token);
}
