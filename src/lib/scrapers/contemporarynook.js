import * as cheerio from "cheerio";
import {
  extractSetCodeCollectorAndName,
  fetchWithRetry,
  normalizeWhitespace,
  parsePhpPrice,
  safeUrlJoin,
} from "./utils";

const BASE = "https://contemporarynook.com";
const COLLECTIONS = [
  "high-end-cards/high-to-low",
  "new-arrivals",
  "staple-lands",
  "budget-lands-for-your-deck",
  "edh-and-commander-stuff-on-budget",
  "standard",
  "pauper-staples",
  ">>-staples-binder-<<",
  "lorwyn-eclipsed",
  "teenage-mutant-ninja-turtles",
  "tla-the-last-airbender",
];

function looksLikeCardTitle(text) {
  return /\[[A-Z0-9]{2,10}\]\s*\([^\)]+\)\s+/.test(text || "");
}

function parseCardBlock(text, productUrl, sourceUrl) {
  const blob = normalizeWhitespace(text);
  const parsed = extractSetCodeCollectorAndName(blob);
  if (!parsed) return null;

  const price = parsePhpPrice(blob);

  let condition = null;
  let language = null;
  const condLang = blob.match(
    /\b(NM|LP|MP|HP|DMG|Near Mint|Lightly Played|Moderately Played|Heavily Played|Damaged)\s*\(([^\)]+)\)/i
  );
  if (condLang) {
    condition = condLang[1];
    language = condLang[2];
  }

  let stockQty = null;
  const avail = blob.match(/Available\s*:?\s*(\d+)/i);
  if (avail) stockQty = Number(avail[1]);

  return {
    storeSlug: "contemporarynook",
    productUrl,
    name: parsed.name,
    setCode: parsed.setCode,
    collectorNumber: parsed.collectorNumber,
    condition,
    language,
    price,
    currency: "PHP",
    stockQty,
    inStock: stockQty == null ? true : stockQty > 0,
    sourceUrl,
  };
}

function extractListingsFromCollectionPage(html, url) {
  const $ = cheerio.load(html);
  const listings = [];
  const seen = new Set();

  $("a[href*='/singles/']").each((_, el) => {
    const a = $(el);
    const href = a.attr("href") || "";
    const productUrl = safeUrlJoin(BASE, href);
    if (!productUrl || seen.has(productUrl)) return;

    const title = normalizeWhitespace(a.text());
    if (!looksLikeCardTitle(title)) return;

    const container = a.closest("li, article, section, div").first();
    const blob = normalizeWhitespace(container.text() || title);
    const parsed = parseCardBlock(blob || title, productUrl, url);
    if (!parsed) return;

    seen.add(productUrl);
    listings.push(parsed);
  });

  return listings;
}

async function scrapeCollectionPath(path, { maxPages = 25 } = {}) {
  const all = [];
  const seenUrls = new Set();
  let emptyPages = 0;

  for (let page = 1; page <= maxPages; page++) {
    const url = `${BASE}/collections/${path}${path.includes("?") ? "&" : "?"}page=${page}`;
    const resp = await fetchWithRetry(url, {}, { retries: 4, baseDelayMs: 1200 });
    if (!resp.ok) break;

    const html = await resp.text();
    const rows = extractListingsFromCollectionPage(html, url);

    let fresh = 0;
    for (const row of rows) {
      if (seenUrls.has(row.productUrl)) continue;
      seenUrls.add(row.productUrl);
      all.push(row);
      fresh++;
    }

    if (!rows.length || fresh === 0) {
      emptyPages += 1;
    } else {
      emptyPages = 0;
    }

    if (emptyPages >= 2) break;
  }

  return all;
}

export async function scrapeContemporaryNook({ maxPagesPerCollection = 20 } = {}) {
  const all = [];
  const seen = new Set();

  for (const path of COLLECTIONS) {
    try {
      const rows = await scrapeCollectionPath(path, { maxPages: maxPagesPerCollection });
      for (const row of rows) {
        const key = `${row.productUrl}__${row.price ?? ""}__${row.condition ?? ""}__${row.language ?? ""}`;
        if (seen.has(key)) continue;
        seen.add(key);
        all.push(row);
      }
    } catch {
      // continue to next collection
    }
  }

  return {
    ok: true,
    storeSlug: "contemporarynook",
    message: `Scraped ${all.length} listing rows across ${COLLECTIONS.length} Contemporary Nook collections.`,
    listings: all,
    meta: { collections: COLLECTIONS },
  };
}
