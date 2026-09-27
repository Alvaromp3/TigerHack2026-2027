const API_BASE = (import.meta.env.VITE_API_URL || "https://tigerhack-api.onrender.com").replace(/\/+$/, "");

export function apiUrl(path) {
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${API_BASE}${suffix}`;
}
