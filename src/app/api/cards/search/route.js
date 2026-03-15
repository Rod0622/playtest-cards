import { NextResponse } from "next/server";
import { createBrowserSupabase } from "@/lib/supabase/server";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const q = (searchParams.get("q") || "").trim();
    const limitParam = Number(searchParams.get("limit") || "200");
    const limit = Math.min(Math.max(limitParam, 1), 1000);

    const supabase = createBrowserSupabase();

    let query = supabase
      .from("cards")
      .select(
        `
        id,
        name,
        normalized_name,
        set_code,
        set_name,
        collector_number,
        image_small,
        image_normal,
        image_large,
        image_png,
        scryfall_uri
      `
      )
      .order("name", { ascending: true })
      .limit(limit);

    if (q) {
      query = query.or(
        [
          `name.ilike.%${q}%`,
          `set_code.ilike.%${q}%`,
          `set_name.ilike.%${q}%`,
          `collector_number.ilike.%${q}%`,
        ].join(",")
      );
    }

    const { data: cards, error } = await query;

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 }
      );
    }

    const cardIds = (cards || []).map((c) => c.id);
    let listings = [];

    if (cardIds.length > 0) {
      const { data: listingRows, error: listingError } = await supabase
        .from("listings")
        .select(
          `
          id,
          card_id,
          product_url,
          price,
          currency,
          condition,
          language,
          in_stock,
          stock_qty,
          store_id,
          stores:store_id (
            id,
            slug,
            name
          )
        `
        )
        .in("card_id", cardIds)
        .order("price", { ascending: true });

      if (listingError) {
        return NextResponse.json(
          { ok: false, error: listingError.message },
          { status: 500 }
        );
      }

      listings = listingRows || [];
    }

    const listingsByCard = new Map();
    for (const listing of listings) {
      const arr = listingsByCard.get(listing.card_id) || [];
      arr.push({
        id: listing.id,
        product_url: listing.product_url,
        price: listing.price,
        currency: listing.currency,
        condition: listing.condition,
        language: listing.language,
        in_stock: listing.in_stock,
        stock_qty: listing.stock_qty,
        store_slug: listing.stores?.slug || null,
        store_name: listing.stores?.name || null,
      });
      listingsByCard.set(listing.card_id, arr);
    }

    const results = (cards || []).map((card) => {
      const cardListings = listingsByCard.get(card.id) || [];
      const cheapest = cardListings.length
        ? Math.min(...cardListings.map((l) => Number(l.price)).filter((v) => !Number.isNaN(v)))
        : null;

      return {
        ...card,
        cheapest_price: cheapest,
        listings: cardListings,
      };
    });

    return NextResponse.json({
      ok: true,
      results,
      count: results.length,
    });
  } catch (error) {
    console.error("/api/cards/search error", error);
    return NextResponse.json(
      { ok: false, error: error?.message || "Unknown search error" },
      { status: 500 }
    );
  }
}