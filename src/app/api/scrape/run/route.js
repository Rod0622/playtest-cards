import { NextResponse } from "next/server";
import { scrapeAllStores, scrapeStore } from "@/lib/scrapers";
import { runScrapeAndSync } from "@/lib/db/sync";

export const runtime = "nodejs";

function requireAdmin(request) {
  const expected = process.env.SCRAPE_ADMIN_TOKEN;
  if (!expected) {
    throw new Error(
      "Missing SCRAPE_ADMIN_TOKEN env var (set this in Vercel + .env.local)"
    );
  }

  // 1) Header (preferred)
  const headerToken = request.headers.get("x-admin-token");
  if (headerToken && headerToken === expected) return true;

  // 2) Query param (useful for Vercel Cron jobs)
  try {
    const { searchParams } = new URL(request.url);
    const qp = searchParams.get("token");
    if (qp && qp === expected) return true;
  } catch {
    // ignore
  }

  return false;
}

export async function POST(request) {
  try {
    if (!requireAdmin(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const stores = Array.isArray(body.stores) ? body.stores : null;
    const optionsByStore = body.optionsByStore || {};

    const results = [];

    // Run sequentially to be polite to the target sites.
    const slugs = stores && stores.length ? stores : ["contemporarynook", "herohobbies", "highmarket"];

    for (const slug of slugs) {
      const scrapeResult = await scrapeStore(slug, optionsByStore?.[slug] || {});
      const sync = await runScrapeAndSync({
        storeSlug: slug,
        scrapeResult,
        runMeta: { options: optionsByStore?.[slug] || {} },
      });
      results.push({
        store: slug,
        scrape: {
          ok: scrapeResult.ok,
          message: scrapeResult.message,
          rows: scrapeResult.listings?.length || 0,
        },
        sync,
      });
    }

    return NextResponse.json({ ok: true, results });
  } catch (e) {
    console.error("/api/scrape/run error", e);
    return NextResponse.json(
      { ok: false, error: e?.message || String(e) },
      { status: 500 }
    );
  }
}
