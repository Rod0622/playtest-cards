import * as cheerio from "cheerio";
import {
  fetchWithRetry,
  normalizeWhitespace,
  parsePhpPrice,
  safeUrlJoin,
  uniq,
} from "./utils";

const BASE = "https://herohobbies.ph";

function extractExpansionNames(html) {
  // Heuristic: look for product-search links
  const expansions = [];
  const re = /product-search\/\?expansion=([^"&]+)/gi;
  let m;
  while ((m = re.exec(html))) {
    try {
      const decoded = decodeURIComponent(m[1].replace(/\+/g, "%20"));
      if (decoded) expansions.push(decoded);
    } catch {
      // ignore
    }
  }
  return uniq(expansions);
}

function extractPaginationLastPage(html) {
  const text = normalizeWhitespace(cheerio.load(html)("body").text());
  const m = text.match(/Page\s*\d+\s*of\s*(\d+)/i);
  if (m) return Number(m[1]);

  // fallback: detect max "page=" in links
  const re = /[?&]page=(\d+)/gi;
  let last = 1;
  let mm;
  while ((mm = re.exec(html))) {
    last = Math.max(last, Number(mm[1]));
  }
  return last;
}

function extractListingsFromSearchPage(html) {
  const $ = cheerio.load(html);
  const listings = [];

  // Collect candidate product links
  const links = $("a")
    .map((_, a) => {
      const href = $(a).attr("href") || "";
      const txt = normalizeWhitespace($(a).text());
      return { href, txt };
    })
    .get()
    .filter((x) => x.href.includes("/mtg/") && x.txt && x.txt.length >= 2);

  const byHref = new Map();
  for (const l of links) {
    const abs = safeUrlJoin(BASE, l.href);
    if (!abs) continue;
    if (!byHref.has(abs)) byHref.set(abs, l.txt);
  }

  for (const [productUrl, nameGuess] of byHref.entries()) {
    // Find an element that contains this link and look around for a PHP price.
    const a = $("a").filter((_, el) => safeUrlJoin(BASE, $(el).attr("href") || "") === productUrl).first();
    const container = a.closest("li, div, article").first();
    const blob = normalizeWhitespace(container.text());
    const price = parsePhpPrice(blob);

    // Try to infer expansion / set code and collector number if present in text.
    // HeroHobbies pages are inconsistent; we store name + price + url at minimum.
    let condition = null;
    let language = null;
    const condLang = blob.match(/\b(NM|LP|MP|HP|DMG|Near Mint|Lightly Played|Moderately Played|Heavily Played|Damaged)\b\s*(?:\(([^\)]+)\))?/i);
    if (condLang) {
      condition = condLang[1];
      language = condLang[2] || null;
    }

    let stockQty = null;
    const qty = blob.match(/Quantity\s*:\s*(\d+)/i);
    if (qty) stockQty = Number(qty[1]);

    listings.push({
      storeSlug: "herohobbies",
      productUrl,
      name: nameGuess,
      setCode: null,
      collectorNumber: null,
      condition,
      language,
      price,
      currency: "PHP",
      stockQty,
      inStock: stockQty == null ? true : stockQty > 0,
      sourceUrl: productUrl,
    });
  }

  // De-dupe
  const key = (x) => `${x.productUrl}__${x.price ?? ""}`;
  const out = [];
  const seen = new Set();
  for (const x of listings) {
    const k = key(x);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(x);
  }
  return out;
}

export async function scrapeHeroHobbies({ maxExpansions = 30, maxPagesPerExpansion = 5 } = {}) {
  // 1) Load expansions list.
  const allSetsUrl = `${BASE}/all-sets/`;
  const resp = await fetchWithRetry(allSetsUrl, {}, { retries: 4 });

  if (!resp.ok) {
    return {
      ok: false,
      storeSlug: "herohobbies",
      message: `Failed to fetch expansions list: ${resp.status}`,
      listings: [],
    };
  }

  const html = await resp.text();
  const expansions = extractExpansionNames(html).slice(0, maxExpansions);

  const all = [];
  for (const expansion of expansions) {
    const firstUrl = `${BASE}/product-search/?expansion=${encodeURIComponent(expansion)}`;
    const firstResp = await fetchWithRetry(firstUrl, {}, { retries: 4 });
    if (!firstResp.ok) continue;
    const firstHtml = await firstResp.text();
    const lastPage = Math.min(
      maxPagesPerExpansion,
      Math.max(1, extractPaginationLastPage(firstHtml))
    );

    // page 1
    all.push(...extractListingsFromSearchPage(firstHtml));

    // additional pages (best-guess: &page=N)
    for (let p = 2; p <= lastPage; p++) {
      const url = `${firstUrl}&page=${p}`;
      const r = await fetchWithRetry(url, {}, { retries: 4 });
      if (!r.ok) break;
      const h = await r.text();
      all.push(...extractListingsFromSearchPage(h));
    }
  }

  return {
    ok: true,
    storeSlug: "herohobbies",
    message: `Scraped ${all.length} listing rows from ${expansions.length} expansions (maxPagesPerExpansion=${maxPagesPerExpansion}).`,
    listings: all,
    meta: { expansions },
  };
}
