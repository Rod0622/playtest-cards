import { createServiceSupabase } from "../supabase/server";
import {
  fetchScryfallByName,
  fetchScryfallBySetCollector,
  pickScryfallImages,
} from "./mtg";

/**
 * Ensure stores exist in DB.
 */
export async function ensureStores(service) {
  const stores = [
    {
      slug: "contemporarynook",
      name: "Contemporary Nook",
      base_url: "https://contemporarynook.com",
    },
    {
      slug: "herohobbies",
      name: "HeroHobbies",
      base_url: "https://herohobbies.ph",
    },
    {
      slug: "highmarket",
      name: "High Market Online",
      base_url: "https://www.highmarketonline.shop",
    },
  ];

  const { data, error } = await service
    .from("stores")
    .upsert(stores, { onConflict: "slug" })
    .select("id,slug");

  if (error) throw error;

  const map = new Map();
  for (const s of data || []) map.set(s.slug, s.id);
  return map;
}

async function findCard(service, { name, setCode, collectorNumber }) {
  // best-effort match
  let q = service.from("cards").select("*");
  if (setCode && collectorNumber) {
    q = q
      .ilike("name", name)
      .eq("set_code", String(setCode).toLowerCase())
      .eq("collector_number", String(collectorNumber));
  } else {
    q = q.ilike("name", name);
  }
  const { data } = await q.limit(1);
  return data?.[0] || null;
}

export async function ensureCard(service, { name, setCode, collectorNumber }) {
  const cleanName = String(name || "").trim();
  if (!cleanName) return null;

  const existing = await findCard(service, {
    name: cleanName,
    setCode,
    collectorNumber,
  });
  if (existing) return existing;

  // Enrich with Scryfall.
  let scryfall = null;
  if (setCode && collectorNumber) {
    scryfall = await fetchScryfallBySetCollector(setCode, collectorNumber);
  }
  if (!scryfall) {
    scryfall = await fetchScryfallByName(cleanName);
  }

  const imgs = pickScryfallImages(scryfall);

  const payload = {
    name: cleanName,
    set_code: (imgs.set_code || setCode || null)?.toLowerCase?.() || null,
    set_name: imgs.set_name || null,
    collector_number: imgs.collector_number || collectorNumber || null,
    scryfall_id: imgs.scryfall_id || null,
    scryfall_uri: imgs.scryfall_uri || null,
    image_normal: imgs.image_normal || null,
    image_png: imgs.image_png || null,
    image_small: imgs.image_small || null,
  };

  const { data, error } = await service
    .from("cards")
    .insert(payload)
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

export async function upsertListing(service, {
  storeId,
  cardId,
  productUrl,
  price,
  currency = "PHP",
  condition = null,
  language = null,
  inStock = true,
  stockQty = null,
}) {
  const now = new Date().toISOString();
  const payload = {
    store_id: storeId,
    card_id: cardId,
    product_url: productUrl,
    price: price ?? 0,
    currency,
    condition,
    language,
    in_stock: !!inStock,
    stock_qty: stockQty,
    last_seen_at: now,
    last_scraped_at: now,
  };

  const { data, error } = await service
    .from("listings")
    .upsert(payload, { onConflict: "store_id,product_url" })
    .select("*")
    .single();

  if (error) throw error;

  // Always record price history when we scrape (cheap audit trail).
  await service.from("price_history").insert({
    listing_id: data.id,
    price: data.price,
    currency: data.currency,
    scraped_at: now,
  });

  return data;
}

export async function runScrapeAndSync({
  storeSlug,
  scrapeResult,
  runMeta = {},
}) {
  const service = createServiceSupabase();

  // create scrape run row
  const startedAt = new Date().toISOString();
  const runInsert = await service
    .from("scrape_runs")
    .insert({
      store_slug: storeSlug,
      status: "running",
      started_at: startedAt,
      meta: runMeta,
    })
    .select("*")
    .single();

  if (runInsert.error) throw runInsert.error;
  const runRow = runInsert.data;

  try {
    const storeMap = await ensureStores(service);
    const storeId = storeMap.get(storeSlug);
    if (!storeId) throw new Error(`Store not found/created: ${storeSlug}`);

    if (!scrapeResult.ok) {
      await service
        .from("scrape_runs")
        .update({
          status: "error",
          finished_at: new Date().toISOString(),
          message: scrapeResult.message,
        })
        .eq("id", runRow.id);

      return {
        ok: false,
        storeSlug,
        message: scrapeResult.message,
        inserted: 0,
      };
    }

    // Cache for cards to avoid repeated DB queries.
    const cardCache = new Map();

    let inserted = 0;
    for (const row of scrapeResult.listings || []) {
      const key = `${(row.setCode || "").toLowerCase()}__${row.collectorNumber || ""}__${row.name}`;
      let card = cardCache.get(key);
      if (!card) {
        card = await ensureCard(service, {
          name: row.name,
          setCode: row.setCode,
          collectorNumber: row.collectorNumber,
        });
        if (card) cardCache.set(key, card);
      }

      if (!card) continue;
      if (!row.productUrl) continue;
      if (row.price == null) continue; // only keep priced listings

      await upsertListing(service, {
        storeId,
        cardId: card.id,
        productUrl: row.productUrl,
        price: row.price,
        currency: row.currency || "PHP",
        condition: row.condition,
        language: row.language,
        inStock: row.inStock,
        stockQty: row.stockQty,
      });
      inserted++;
    }

    await service
      .from("scrape_runs")
      .update({
        status: "success",
        finished_at: new Date().toISOString(),
        message: scrapeResult.message,
        rows: inserted,
      })
      .eq("id", runRow.id);

    return {
      ok: true,
      storeSlug,
      message: scrapeResult.message,
      inserted,
    };
  } catch (e) {
    await service
      .from("scrape_runs")
      .update({
        status: "error",
        finished_at: new Date().toISOString(),
        message: e?.message || String(e),
      })
      .eq("id", runRow?.id);

    return {
      ok: false,
      storeSlug,
      message: e?.message || String(e),
      inserted: 0,
    };
  }
}
