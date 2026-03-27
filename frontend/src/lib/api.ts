const API_BASE = "/api/v1";

let accessToken: string | null = sessionStorage.getItem("access_token");

let onAuthFailure: (() => void) | null = null;

export function setOnAuthFailure(fn: () => void) {
  onAuthFailure = fn;
}

export function setAccessToken(token: string | null) {
  accessToken = token;
  if (token) {
    sessionStorage.setItem("access_token", token);
  } else {
    sessionStorage.removeItem("access_token");
  }
}

export function getAccessToken(): string | null {
  return accessToken;
}

async function tryRefresh(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/auth/refresh`, {
      method: "POST",
      credentials: "include",
    });
    if (!res.ok) return false;
    const data = await res.json();
    setAccessToken(data.access_token);
    return true;
  } catch {
    return false;
  }
}

export async function apiFetch(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const headers = new Headers(options.headers || {});
  if (accessToken) {
    headers.set("Authorization", `Bearer ${accessToken}`);
  }

  let res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
    credentials: "include",
  });

  if (res.status === 401) {
    const refreshed = await tryRefresh();
    if (refreshed) {
      const retryHeaders = new Headers(options.headers || {});
      retryHeaders.set("Authorization", `Bearer ${accessToken}`);
      res = await fetch(`${API_BASE}${path}`, {
        ...options,
        headers: retryHeaders,
        credentials: "include",
      });
    }
    if (res.status === 401) {
      setAccessToken(null);
      onAuthFailure?.();
    }
  }

  return res;
}

// Auth-specific API calls
export async function loginApi(email: string, password: string) {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail || "Login failed");
  }
  return res.json();
}

export async function logoutApi() {
  await fetch(`${API_BASE}/auth/logout`, {
    method: "POST",
    credentials: "include",
  });
  setAccessToken(null);
}

export async function fetchMe() {
  const res = await apiFetch("/auth/me");
  if (!res.ok) return null;
  return res.json();
}
