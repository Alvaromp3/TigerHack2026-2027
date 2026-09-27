const API_BASE = (import.meta.env.VITE_API_URL || "https://tigerhack-api.onrender.com").replace(/\/+$/, "");

export function apiUrl(path) {
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${API_BASE}${suffix}`;
}

export { API_BASE };

// Who is acting, for the audit trail. Set from the Auth0 session; empty means "Command center".
let actor = "";

export function setActor(name) {
  actor = String(name || "").trim().slice(0, 80);
}

export function actorHeaders() {
  // Header values must be Latin-1; encode so names like "Álvaro" or "李" survive.
  return actor ? { "X-Actor": encodeURIComponent(actor) } : {};
}

export async function getJson(path, options) {
  const res = await fetch(apiUrl(path), options);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(typeof body.detail === "string" ? body.detail : `HTTP ${res.status}`);
  }
  return body;
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
