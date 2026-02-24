const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  "http://127.0.0.1:8000";
const DEFAULT_TIMEOUT_MS = 30000;
let apiTokenProvider = null;

export function setApiTokenProvider(provider) {
  apiTokenProvider = typeof provider === "function" ? provider : null;
}

export async function apiGet(path, params = {}, options = {}) {
  const url = new URL(`${API_BASE_URL}${path}`);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, v);
  });
  const timeoutMs = Number(options.timeout_ms || DEFAULT_TIMEOUT_MS);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let token = "";
  if (apiTokenProvider) {
    try {
      token = (await apiTokenProvider()) || "";
    } catch {
      token = "";
    }
  }
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const res = await fetch(url.toString(), { cache: "no-store", signal: controller.signal, headers })
    .catch((err) => {
      if (err?.name === "AbortError") {
        throw new Error(`API timeout after ${timeoutMs}ms: ${path}`);
      }
      throw err;
    })
    .finally(() => clearTimeout(timer));
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${res.status}: ${text}`);
  }
  return res.json();
}
