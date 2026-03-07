import { apiJson } from "./api";

export type AuthUser = {
  id: string;
  email: string;
  full_name?: string | null;
  created_at: string;
};

export type AuthResponse = {
  access_token: string;
  token_type: "bearer";
  user: AuthUser;
};

export async function register(input: {
  email: string;
  password: string;
  full_name?: string;
}): Promise<AuthResponse> {
  return apiJson<AuthResponse>("/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function login(input: {
  email: string;
  password: string;
}): Promise<AuthResponse> {
  return apiJson<AuthResponse>("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function googleLogin(input: {
  id_token: string;
}): Promise<AuthResponse> {
  return apiJson<AuthResponse>("/auth/google", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function fetchMe(token: string): Promise<AuthUser> {
  return apiJson<AuthUser>("/auth/me", { token });
}
