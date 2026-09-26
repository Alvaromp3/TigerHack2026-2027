const API_BASE = import.meta.env.VITE_API_URL || "";

export async function fetchAuthConfig() {
  const res = await fetch(`${API_BASE}/api/auth/config`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || "Auth0 no está configurado");
  }
  return res.json();
}

export async function fetchHealth() {
  const res = await fetch(`${API_BASE}/api/health`);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return res.json();
}
