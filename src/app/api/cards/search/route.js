import { NextResponse } from "next/server";
import { createAnonSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const q = (searchParams.get("q") || "").trim();
    const limit = Math.min(50, Math.max(1, Number(searchParams.get("limit") || 20)));

    const supabase = createAnonSupabase();

    if (!q) {
      // Return recent cards
      const { data, error } = await supabase
        .from("cards")
        .select(
          "id,name,set_code,set_name,collector_number,image_small,image_normal,image_png,scryfall_uri,created_at, listings(id,price,currency,condition,language,product_url,in_stock,stock_qty, stores(slug,name,base_url))"
        )
        .order("created_at", { ascending: false })
        .limit(limit);

      if (error) throw error;
      return NextResponse.json({ ok: true, q: "", results: data || [] });
    }

    // Search name OR set_code OR collector_number
    const pattern = `%${q.replace(/%/g, "\\%")}%`;

    const { data, error } = await supabase
      .from("cards")
      .select(
        "id,name,set_code,set_name,collector_number,image_small,image_normal,image_png,scryfall_uri, listings(id,price,currency,condition,language,product_url,in_stock,stock_qty, stores(slug,name,base_url))"
      )
      .or(
        `name.ilike.${pattern},set_code.ilike.${pattern},collector_number.ilike.${pattern}`
      )
      .order("name", { ascending: true })
      .limit(limit);

    if (error) throw error;

    return NextResponse.json({ ok: true, q, results: data || [] });
  } catch (e) {
    console.error("/api/cards/search error", e);
    return NextResponse.json(
      { ok: false, error: e?.message || String(e) },
      { status: 500 }
    );
  }
}
