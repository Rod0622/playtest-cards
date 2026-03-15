import { NextResponse } from "next/server";
import { scrapeStores } from "@/lib/scrapers";
import { runScrapeAndSync } from "@/lib/db/sync";

export const runtime = "nodejs";
export const maxDuration = 300;

function getAdminTokenFromRequest(request) {
  const headerToken =
    request.headers.get("x-admin-token") ||
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
    "";

  const url = new URL(request.url);
  const queryToken = url.searchParams.get("token") || "";

  return headerToken || queryToken;
}

function normalizeStores(stores) {
  if (!Array.isArray(stores) || stores.length === 0) {
    return ["contemporarynook", "herohobbies", "highmarket"];
  }

  const allowed = new Set(["contemporarynook", "herohobbies", "highmarket"]);
  return stores.filter((s) => allowed.has(String(s).toLowerCase()));
}

export async function POST(request) {
  try {
    const expectedToken = process.env.SCRAPE_ADMIN_TOKEN;
    if (!expectedToken) {
      return NextResponse.json(
        { ok: false, error: "Missing env var: SCRAPE_ADMIN_TOKEN" },
        { status: 500 }
      );
    }

    const providedToken = getAdminTokenFromRequest(request);
    if (!providedToken || providedToken !== expectedToken) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    let body = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }

    const stores = normalizeStores(body.stores);
    if (!stores.length) {
      return NextResponse.json(
        { ok: false, error: "No valid stores requested" },
        { status: 400 }
      );
    }

    const optionsByStore = body.optionsByStore || {};

    const scrapeResults = await scrapeStores(stores, optionsByStore);

    const synced = [];
    for (const result of scrapeResults) {
      const syncResult = await runScrapeAndSync({
        storeSlug: result.storeSlug,
        scrapeResult: result,
        runMeta: {
          options: optionsByStore[result.storeSlug] || {},
        },
      });
      synced.push(syncResult);
    }

    const ok = synced.every((r) => r.ok);

    return NextResponse.json({
      ok,
      results: synced,
    });
  } catch (error) {
    console.error("/api/scrape/run error", error);
    return NextResponse.json(
      {
        ok: false,
        error: error?.message || "Unknown scrape error",
      },
      { status: 500 }
    );
  }
}