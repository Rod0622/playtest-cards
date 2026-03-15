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

function isProbablyProductUrl(url) {
  if (!url) return false;
  if (!url.startsWith(BASE)) return false;
  if (url.includes("/products/singles")) return false;
  if (url.includes("/products/?")) return false;
  if (url.includes("/collections/")) return false;
  return url.includes("/products/");
}

function parseTitleBits(title) {
  const clean = normalizeWhitespace(title);

  // Example patterns seen on Hero Hobbies:
  // "Mox Diamond #138 Stronghold Artifact (R)"
  // "Rhystic Study (0091 - Anime Confetti Foil) #091 Wilds Of Eldraine Enchanting Tales Enchantment (M)"
  // "Ancient Copper Dragon (0012 - Dragon of Mount Gulg) #012 Final Fantasy Through the Ages ..."
  const collectorMatch = clean.match(/#\s*([0-9A-Za-z-]+)/);
  const collectorNumber = collectorMatch ? collectorMatch[1] : null;

  let name = clean;
  let setName = null;

  if (collectorMatch) {
    const idx = collectorMatch.index ?? -1;
    if (idx >= 0) {
      name = normalizeWhitespace(clean.slice(0, idx));
      const after = normalizeWhitespace(clean.slice(idx + collectorMatch[0].length));

      // Heuristic: take text after # as set-ish text until card-type-ish words start
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
      for (const w of stopWords) {
        const pos = after.indexOf(` ${w}`);
        if (pos !== -1) cut = Math.min(cut, pos);
      }
      setName = normalizeWhitespace(after.slice(0, cut)) || null;
    }
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
    } catch {
      // ignore bad href
    }
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
    if (!isProbablyProductUrl(productUrl)) return;

    const text = normalizeWhitespace($(a).text());
    const container = $(a).closest("article, li, div").first();
    const blob = normalizeWhitespace(container.text() || text);

    const title = text || blob;
    if (!title) return;

    const price = parsePhpPrice(blob);
    if (price == null) return;

    const bits = parseTitleBits(title);

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
  maxPages = 20,
  delayMs = 700,
} = {}) {
  const firstResp = await fetchWithRetry(SINGLES_URL, {}, { retries: 4 });

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
          : await fetchWithRetry(url, {}, { retries: 4 });

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