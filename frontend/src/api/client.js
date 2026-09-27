const API_BASE = (import.meta.env.VITE_API_URL || "https://tigerhack-api.onrender.com").replace(/\/+$/, "");

export function apiUrl(path) {
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${API_BASE}${suffix}`;
}

export async function fetchAuthConfig() {
  const res = await fetch(apiUrl("/api/auth/config"));
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || "Auth0 no está configurado");
  }
  return res.json();
}

export async function fetchHealth() {
  const res = await fetch(apiUrl("/api/health"));
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return res.json();
}
