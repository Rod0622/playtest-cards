import * as cheerio from "cheerio";
import {
  fetchWithRetry,
  normalizeWhitespace,
  parsePhpPrice,
  safeUrlJoin,
} from "./utils";

const BASE = "https://herohobbies.ph";

function looksLikeMtgProductUrl(href) {
  return /\/product\//i.test(href || "") || /\/mtg\//i.test(href || "");
}

function parseCardText(text) {
  const blob = normalizeWhitespace(text);

  let condition = null;
  let language = null;
  const condLang = blob.match(
    /\b(NM|LP|MP|HP|DMG|Near Mint|Lightly Played|Moderately Played|Heavily Played|Damaged)\b\s*(?:\(([^\)]+)\))?/i
  );
  if (condLang) {
    condition = condLang[1];
    language = condLang[2] || null;
  }

  let stockQty = null;
  const qty = blob.match(/(?:Available|Quantity|Stock)\s*:?\s*(\d+)/i);
  if (qty) stockQty = Number(qty[1]);

  return { blob, condition, language, stockQty };
}

function inferTitleFromContainer($, a) {
  const title = normalizeWhitespace($(a).text());
  if (title && !/^view$/i.test(title)) return title;

  const container = $(a).closest("li, article, div, section").first();
  const heading = normalizeWhitespace(container.find("h1,h2,h3,h4,.woocommerce-loop-product__title,.product-title").first().text());
  return heading || title || null;
}

function extractListingsFromShopPage(html, url) {
  const $ = cheerio.load(html);
  const listings = [];
  const seen = new Set();

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") || "";
    if (!looksLikeMtgProductUrl(href)) return;

    const productUrl = safeUrlJoin(BASE, href);
    if (!productUrl || seen.has(productUrl)) return;

    const name = inferTitleFromContainer($, el);
    if (!name || name.length < 2) return;

    const container = $(el).closest("li, article, div, section").first();
    const { blob, condition, language, stockQty } = parseCardText(container.text());
    const price = parsePhpPrice(blob);

    if (price == null) return;

    seen.add(productUrl);
    listings.push({
      storeSlug: "herohobbies",
      productUrl,
      name,
      setCode: null,
      collectorNumber: null,
      condition,
      language,
      price,
      currency: "PHP",
      stockQty,
      inStock: stockQty == null ? true : stockQty > 0,
      sourceUrl: url,
    });
  });

  return listings;
}

export async function scrapeHeroHobbies({ maxPages = 40 } = {}) {
  const all = [];
  const seen = new Set();
  let emptyPages = 0;

  for (let page = 1; page <= maxPages; page++) {
    const url = `${BASE}/mtg/page/${page}/`;
    const resp = await fetchWithRetry(url, {}, { retries: 4, baseDelayMs: 1200 });
    if (!resp.ok) break;

    const html = await resp.text();
    const rows = extractListingsFromShopPage(html, url);

    let fresh = 0;
    for (const row of rows) {
      const key = `${row.productUrl}__${row.price}`;
      if (seen.has(key)) continue;
      seen.add(key);
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

  return {
    ok: true,
    storeSlug: "herohobbies",
    message: `Scraped ${all.length} listing rows from Hero Hobbies shop pages.`,
    listings: all,
    meta: { maxPages },
  };
}
