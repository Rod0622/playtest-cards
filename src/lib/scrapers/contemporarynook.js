import * as cheerio from "cheerio";
import {
  extractSetCodeCollectorAndName,
  fetchWithRetry,
  normalizeWhitespace,
  parsePhpPrice,
  safeUrlJoin,
  uniq,
} from "./utils";

const BASE = "https://contemporarynook.com";

function extractSetSlugsFromHtml(html) {
  const slugs = [];
  // Most reliable: match /sets/mtg/<slug>
  const re = /\/sets\/mtg\/([a-z0-9-]+)/gi;
  let m;
  while ((m = re.exec(html))) {
    slugs.push(m[1]);
  }
  return uniq(slugs);
}

function extractListingsFromSetPage(html, url) {
  const $ = cheerio.load(html);
  const listings = [];

  // Heuristic: each card entry has an <a> containing "[SET] (NUM) NAME"
  const links = $("a")
    .map((_, a) => {
      const href = $(a).attr("href") || "";
      const txt = normalizeWhitespace($(a).text());
      return { href, txt };
    })
    .get()
    .filter((x) => x.txt.includes("[") && x.txt.includes("]") && x.txt.includes("(") && x.txt.includes(")"));

  // Map link text to listing candidates.
  for (const link of links) {
    const parsed = extractSetCodeCollectorAndName(link.txt);
    if (!parsed) continue;

    // Find a nearby container for price/condition/availability.
    // We walk up a few parents and take text.
    let containerText = "";
    try {
      const a = $("a")
        .filter((_, el) => normalizeWhitespace($(el).text()) === link.txt)
        .first();
      const container = a.closest("li, div, article, section").first();
      containerText = normalizeWhitespace(container.text());
    } catch {
      containerText = link.txt;
    }

    const price = parsePhpPrice(containerText);

    // Condition/language often appear as "NM (English)" or "Near Mint (English)" etc.
    let condition = null;
    let language = null;
    const condLang = containerText.match(/\b(NM|LP|MP|HP|DMG|Near Mint|Lightly Played|Moderately Played|Heavily Played|Damaged)\s*\(([^\)]+)\)/i);
    if (condLang) {
      condition = condLang[1];
      language = condLang[2];
    }

    // Availability may appear as "Available: 2"
    let stockQty = null;
    const avail = containerText.match(/Available\s*:\s*(\d+)/i);
    if (avail) stockQty = Number(avail[1]);

    // Product URL could be a /singles/... or something else.
    const productUrl = link.href ? safeUrlJoin(BASE, link.href) : url;

    listings.push({
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
      sourceUrl: url,
    });
  }

  // Deduplicate by productUrl+price+collector
  const key = (x) => `${x.productUrl}__${x.setCode}__${x.collectorNumber}__${x.price ?? ""}__${x.condition ?? ""}__${x.language ?? ""}`;
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

export async function scrapeContemporaryNook({ maxSetPages = 50, concurrency = 2 } = {}) {
  // 1) Fetch sets page to get set slugs
  const setsUrl = `${BASE}/sets/mtg/latest`;
  const setsResp = await fetchWithRetry(setsUrl, {}, { retries: 4 });
  if (!setsResp.ok) {
    return {
      ok: false,
      storeSlug: "contemporarynook",
      message: `Failed to fetch sets page: ${setsResp.status}`,
      listings: [],
    };
  }

  const setsHtml = await setsResp.text();
  const slugs = extractSetSlugsFromHtml(setsHtml)
    // keep only plausible set codes
    .filter((s) => /^[a-z0-9]{2,10}$/.test(s))
    .slice(0, maxSetPages);

  // 2) Fetch each set page and extract listings
  const { makeLimiter } = await import("./utils");
  const limit = makeLimiter(concurrency);
  const all = [];

  await Promise.all(
    slugs.map((slug) =>
      limit(async () => {
        const url = `${BASE}/sets/mtg/${slug}`;
        const resp = await fetchWithRetry(url, {}, { retries: 5 });
        if (!resp.ok) return;
        const html = await resp.text();
        const listings = extractListingsFromSetPage(html, url);
        for (const l of listings) all.push(l);
      })
    )
  );

  return {
    ok: true,
    storeSlug: "contemporarynook",
    message: `Scraped ${all.length} listing rows from ${slugs.length} set pages (limit=${maxSetPages}).`,
    listings: all,
    meta: { setSlugs: slugs },
  };
}
