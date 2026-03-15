import {
  fetchWithRetry,
  normalizeWhitespace,
} from "./utils";

const BASE = "https://herohobbies.ph";

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function parseProductsFromInertia(html) {
  const match = html.match(/<script[^>]*>window\.__INITIAL_STATE__\s*=\s*(\{.*?\})<\/script>/s)
    || html.match(/"component":"Products","props":(\{.*\})/s);

  if (!match) return [];

  try {
    const jsonText = match[1];
    const data = JSON.parse(jsonText);

    const products = data.products?.data || data.products || [];

    return products.map(p => ({
      name: normalizeWhitespace(p.name),
      price: Number(p.price) || null,
      url: `${BASE}/products/view/${p.id}`,
      setName: p.expansion || null
    }));

  } catch {
    return [];
  }
}

export async function scrapeHeroHobbies({
  startPage = 1,
  endPage = 5,
  delayMs = 700
} = {}) {

  const listings = [];

  for (let page = startPage; page <= endPage; page++) {

    const url =
      page === 1
        ? `${BASE}/products/singles`
        : `${BASE}/products/singles?page=${page}`;

    const resp = await fetchWithRetry(url, {
      headers: {
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
      }
    });

    if (!resp.ok) continue;

    const html = await resp.text();

    const products = parseProductsFromInertia(html);

    for (const p of products) {
      if (!p.price) continue;

      listings.push({
        storeSlug: "herohobbies",
        productUrl: p.url,
        sourceUrl: url,
        name: p.name,
        setName: p.setName,
        setCode: null,
        collectorNumber: null,
        price: p.price,
        currency: "PHP",
        inStock: true
      });
    }

    if (page < endPage) {
      await sleep(delayMs);
    }
  }

  return {
    ok: true,
    storeSlug: "herohobbies",
    listings,
    message: `Scraped ${listings.length} Hero Hobbies products from pages ${startPage}-${endPage}`
  };
}