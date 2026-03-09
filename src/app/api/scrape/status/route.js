import { NextResponse } from "next/server";
import { createAnonSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET() {
  try {
    const supabase = createAnonSupabase();

    // Last 20 runs across all stores
    const { data, error } = await supabase
      .from("scrape_runs")
      .select("*")
      .order("started_at", { ascending: false })
      .limit(20);

    if (error) throw error;

    // Reduce into latest per store
    const latest = {};
    for (const r of data || []) {
      if (!latest[r.store_slug]) latest[r.store_slug] = r;
    }

    return NextResponse.json({ ok: true, latest, recent: data || [] });
  } catch (e) {
    console.error("/api/scrape/status error", e);
    return NextResponse.json(
      { ok: false, error: e?.message || String(e) },
      { status: 500 }
    );
  }
}
