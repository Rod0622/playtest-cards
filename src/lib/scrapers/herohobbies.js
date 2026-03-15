import { fetchWithRetry, normalizeWhitespace } from "./utils";

const BASE = "https://herohobbies.ph";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractInertiaJson(html) {
  if (!html) return null;

  const patterns = [
    /<div[^>]+id=["']app["'][^>]+data-page=["']([^"]+)["']/s,
    /data-page="([^"]+)"/s,
    /"component":"Products","props":(\{.*\})/s,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (!match) continue;

    try {
      let raw = match[1];

      // If pulled from data-page="", decode common HTML entities
      raw = raw
        .replace(/&quot;/g, '"')
        .replace(/&#34;/g, '"')
        .replace(/&amp;/g, "&")
        .replace(/&#x27;/g, "'")
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">");

      // Pattern 3 only captures props, so wrap it
      if (raw.startsWith("{") && !raw.includes('"component"')) {
        return { props: JSON.parse(raw) };
      }

      return JSON.parse(raw);
    } catch {
      // try next pattern
    }
  }

  return null;
}

function toListing(product, sourceUrl) {
  const id = product?.id;
  const name = normalizeWhitespace(product?.name || product?.original_name || "");
  const expansion = normalizeWhitespace(product?.expansion || "");
  const collectorNumber = product?.card_number
    ? String(product.card_number).trim()
    : null;

  const price =
    product?.price != null && !Number.isNaN(Number(product.price))
      ? Number(product.price)
      : null;

  if (!id || !name || price == null) return null;

  return {
    storeSlug: "herohobbies",
    sourceUrl,
    productUrl: `${BASE}/products/view/${id}`,
    name,
    setCode: null,
    setName: expansion || null,
    collectorNumber,
    condition: null,
    language: null,
    price,
    currency: "PHP",
    stockQty:
      product?.quantity != null && !Number.isNaN(Number(product.quantity))
        ? Number(product.quantity)
        : null,
    inStock: Number(product?.quantity || 0) > 0,
    imageUrl: product?.image_path || null,
    scryfallId: product?.scryfall_id || null,
    raw: {
      category: product?.category || null,
      variation: product?.variation || null,
      rarity: product?.rarity || null,
      type: product?.type || null,
    },
  };
}

function extractProductsFromHtml(html) {
  const page = extractInertiaJson(html);
  if (!page?.props) {
    return {
      products: [],
      lastPage: 1,
    };
  }

  const datas = page.props.datas || {};
  const rows = Array.isArray(datas.data) ? datas.data : [];
  const lastPage =
    datas.last_page != null && !Number.isNaN(Number(datas.last_page))
      ? Number(datas.last_page)
      : 1;

  return {
    products: rows,
    lastPage,
  };
}

export async function scrapeHeroHobbies({
  startPage = 1,
  endPage = null,
  maxPages = 10,
  delayMs = 700,
} = {}) {
  const firstUrl = `${BASE}/products/singles`;

  const firstResp = await fetchWithRetry(
    firstUrl,
    {
      headers: {
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    },
    { retries: 4 }
  );

  if (!firstResp.ok) {
    return {
      ok: false,
      storeSlug: "herohobbies",
      listings: [],
      message: `Failed to fetch Hero Hobbies singles page: ${firstResp.status}`,
      meta: {},
    };
  }

  const firstHtml = await firstResp.text();
  const firstParsed = extractProductsFromHtml(firstHtml);
  const discoveredLastPage = firstParsed.lastPage || 1;

  const safeStart = Math.max(1, Number(startPage) || 1);
  const safeEnd = Math.max(
    safeStart,
    endPage == null
      ? Math.min(discoveredLastPage, safeStart + Math.max(1, maxPages) - 1)
      : Math.min(discoveredLastPage, Number(endPage) || safeStart)
  );

  const allListings = [];
  const failedPages = [];
  const seen = new Set();

  for (let page = safeStart; page <= safeEnd; page++) {
    const url =
      page === 1
        ? `${BASE}/products/singles`
        : `${BASE}/products/singles?page=${page}`;

    try {
      let html;

      if (page === 1) {
        html = firstHtml;
      } else {
        const resp = await fetchWithRetry(
          url,
          {
            headers: {
              "user-agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
              accept:
                "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            },
          },
          { retries: 4 }
        );

        if (!resp.ok) {
          failedPages.push({ page, status: resp.status });
          continue;
        }

        html = await resp.text();
      }

      const parsed = extractProductsFromHtml(html);
      const rows = parsed.products || [];

      for (const product of rows) {
        const listing = toListing(product, url);
        if (!listing) continue;

        const dedupeKey = `${listing.productUrl}__${listing.price}`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);

        allListings.push(listing);
      }

      if (page < safeEnd) {
        await sleep(delayMs);
      }
    } catch (error) {
      failedPages.push({
        page,
        error: error?.message || String(error),
      });
    }
  }

  return {
    ok: true,
    storeSlug: "herohobbies",
    listings: allListings,
    message: `Scraped ${allListings.length} Hero Hobbies products from pages ${safeStart}-${safeEnd} of ~${discoveredLastPage}`,
    meta: {
      startPage: safeStart,
      endPage: safeEnd,
      discoveredLastPage,
      failedPages,
    },
  };
}