import * as cheerio from "cheerio";
import {
  fetchWithRetry,
  normalizeWhitespace,
  parsePhpPrice,
  safeUrlJoin,
} from "./utils";

const BASE = "https://herohobbies.ph";
const SINGLES_URL = `${BASE}/products/singles`;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function looksLikeProductUrl(url) {
  if (!url) return false;
  if (!url.startsWith(BASE)) return false;
  if (url.includes("/products/singles")) return false;
  return /\/products\/[^/?#]+/.test(url);
}

function parseTitleBits(title) {
  const clean = normalizeWhitespace(title);

  const collectorMatch = clean.match(/#\s*([0-9A-Za-z-]+)/);
  const collectorNumber = collectorMatch ? collectorMatch[1] : null;

  let name = clean;
  let setName = null;

  if (collectorMatch && collectorMatch.index != null) {
    const idx = collectorMatch.index;
    name = normalizeWhitespace(clean.slice(0, idx));
    const after = normalizeWhitespace(clean.slice(idx + collectorMatch[0].length));

    const stopWords = [
      "Creature",
      "Instant",
      "Sorcery",
      "Artifact",
      "Enchantment",
      "Land",
      "Planeswalker",
      "Battle",
      "Kindred",
      "Legendary",
    ];

    let cut = after.length;
    for (const word of stopWords) {
      const pos = after.indexOf(` ${word}`);
      if (pos !== -1) cut = Math.min(cut, pos);
    }
    setName = normalizeWhitespace(after.slice(0, cut)) || null;
  }

  return {
    name: name || clean,
    collectorNumber,
    setName,
  };
}

function extractPaginationLastPage(html) {
  const $ = cheerio.load(html);
  let last = 1;

  $("a[href]").each((_, a) => {
    const href = $(a).attr("href") || "";
    try {
      const u = new URL(href, SINGLES_URL);
      if (u.pathname !== "/products/singles") return;
      const p = Number(u.searchParams.get("page"));
      if (Number.isFinite(p) && p > last) last = p;
    } catch {}
  });

  const bodyText = normalizeWhitespace($("body").text());
  for (const m of bodyText.matchAll(/\bpage\s+(\d+)\s+of\s+(\d+)\b/gi)) {
    const candidate = Number(m[2]);
    if (Number.isFinite(candidate) && candidate > last) last = candidate;
  }

  return last;
}

function extractListingsFromSinglesPage(html, pageUrl) {
  const $ = cheerio.load(html);
  const listings = [];
  const seen = new Set();

  $("a[href]").each((_, a) => {
    const href = $(a).attr("href") || "";
    const productUrl = safeUrlJoin(BASE, href);
    if (!looksLikeProductUrl(productUrl)) return;

    const text = normalizeWhitespace($(a).text());
    const container = $(a).closest("article, li, div, section").first();
    const blob = normalizeWhitespace(container.text() || text);

    const combined = normalizeWhitespace(`${text} ${blob}`.trim());
    if (!combined) return;

    const price = parsePhpPrice(combined);
    if (price == null) return;

    const bits = parseTitleBits(text || blob);

    const key = `${productUrl}__${price}`;
    if (seen.has(key)) return;
    seen.add(key);

    listings.push({
      storeSlug: "herohobbies",
      sourceUrl: pageUrl,
      productUrl,
      name: bits.name,
      setCode: null,
      setName: bits.setName,
      collectorNumber: bits.collectorNumber,
      condition: null,
      language: null,
      price,
      currency: "PHP",
      stockQty: null,
      inStock: true,
    });
  });

  return listings;
}

export async function scrapeHeroHobbies({
  startPage = 1,
  endPage = null,
  maxPages = 10,
  delayMs = 700,
} = {}) {
  const firstResp = await fetchWithRetry(
    SINGLES_URL,
    {
      headers: {
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      },
    },
    { retries: 4 }
  );

  if (!firstResp.ok) {
    return {
      ok: false,
      storeSlug: "herohobbies",
      message: `Failed to fetch singles catalog: ${firstResp.status}`,
      listings: [],
      meta: { startPage, endPage, maxPages },
    };
  }

  const firstHtml = await firstResp.text();
  const discoveredLastPage = extractPaginationLastPage(firstHtml);

  const safeStart = Math.max(1, Number(startPage) || 1);
  const safeEnd = Math.max(
    safeStart,
    endPage == null
      ? Math.min(discoveredLastPage, safeStart + Math.max(1, maxPages) - 1)
      : Math.min(discoveredLastPage, Number(endPage) || safeStart)
  );

  const all = [];
  const failedPages = [];

  for (let page = safeStart; page <= safeEnd; page++) {
    const url = page === 1 ? SINGLES_URL : `${SINGLES_URL}?page=${page}`;

    try {
      const resp =
        page === 1
          ? { ok: true, text: async () => firstHtml }
          : await fetchWithRetry(
              url,
              {
                headers: {
                  "user-agent":
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
                },
              },
              { retries: 4 }
            );

      if (!resp.ok) {
        failedPages.push({ page, status: resp.status });
        continue;
      }

      const html = await resp.text();
      const rows = extractListingsFromSinglesPage(html, url);
      all.push(...rows);

      if (page < safeEnd) {
        await sleep(delayMs);
      }
    } catch (e) {
      failedPages.push({ page, error: e?.message || String(e) });
    }
  }

  return {
    ok: true,
    storeSlug: "herohobbies",
    message: `Scraped ${all.length} listing rows from Hero Hobbies pages ${safeStart}-${safeEnd} of ~${discoveredLastPage}.`,
    listings: all,
    meta: {
      startPage: safeStart,
      endPage: safeEnd,
      discoveredLastPage,
      failedPages,
    },
  };
}