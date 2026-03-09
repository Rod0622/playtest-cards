import pLimit from "p-limit";

export function normalizeWhitespace(s) {
  return (s || "").replace(/\s+/g, " ").trim();
}

export function parsePhpPrice(text) {
  // Supports: "₱ 1,234.00" or "PHP 1234" etc.
  if (!text) return null;
  const m = String(text).match(/(?:₱|PHP)\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{1,2})?|[0-9]+(?:\.[0-9]{1,2})?)/i);
  if (!m) return null;
  const num = Number(m[1].replace(/,/g, ""));
  return Number.isFinite(num) ? num : null;
}

export function safeUrlJoin(base, path) {
  try {
    return new URL(path, base).toString();
  } catch {
    return null;
  }
}

export async function fetchWithRetry(url, options = {}, retry = {}) {
  const {
    retries = 4,
    baseDelayMs = 800,
    maxDelayMs = 12000,
    retryOn = [408, 425, 429, 500, 502, 503, 504],
  } = retry;

  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const resp = await fetch(url, {
        redirect: "follow",
        ...options,
        headers: {
          "User-Agent":
            options?.headers?.["User-Agent"] ||
            "Mozilla/5.0 (compatible; PlaytestForgeBot/1.0; +https://vercel.com)",
          "Accept":
            options?.headers?.Accept ||
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          ...options.headers,
        },
      });

      if (retryOn.includes(resp.status)) {
        const delay = Math.min(
          maxDelayMs,
          baseDelayMs * 2 ** attempt + Math.floor(Math.random() * 250)
        );
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }

      return resp;
    } catch (e) {
      lastErr = e;
      const delay = Math.min(
        maxDelayMs,
        baseDelayMs * 2 ** attempt + Math.floor(Math.random() * 250)
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  throw lastErr || new Error(`Failed to fetch ${url}`);
}

export function makeLimiter(concurrency = 2) {
  return pLimit(Math.max(1, concurrency));
}

export function uniq(arr) {
  return Array.from(new Set(arr));
}

export function extractSetCodeCollectorAndName(text) {
  // Examples from Contemporary Nook snippets:
  // "AETHERDRIFT [DFT] (38) AETHER SYPHON"
  // "THE LIST [PLST] (DDG-70) SEETHING SONG"
  const t = normalizeWhitespace(text);
  const m = t.match(/\[([A-Z0-9]{2,10})\]\s*\(([^\)]+)\)\s*(.+)$/);
  if (!m) return null;
  return {
    setCode: m[1].toLowerCase(),
    collectorNumber: m[2].trim(),
    name: m[3].trim(),
  };
}
