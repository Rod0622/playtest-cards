const SCRYFALL_API = "https://api.scryfall.com";

export async function fetchScryfallBySetCollector(setCode, collectorNumber) {
  if (!setCode || !collectorNumber) return null;
  try {
    const url = `${SCRYFALL_API}/cards/${encodeURIComponent(
      String(setCode).toLowerCase()
    )}/${encodeURIComponent(String(collectorNumber))}`;
    const resp = await fetch(url);
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}

export async function fetchScryfallByName(name) {
  if (!name) return null;
  try {
    const url = `${SCRYFALL_API}/cards/named?fuzzy=${encodeURIComponent(
      name
    )}`;
    const resp = await fetch(url);
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}

export function pickScryfallImages(cardJson) {
  if (!cardJson) return {};
  const img = cardJson.image_uris || cardJson.card_faces?.[0]?.image_uris || {};
  return {
    scryfall_id: cardJson.id || null,
    scryfall_uri: cardJson.scryfall_uri || cardJson.uri || null,
    set_code: cardJson.set || null,
    set_name: cardJson.set_name || null,
    collector_number: cardJson.collector_number || null,
    image_normal: img.normal || null,
    image_png: img.png || null,
    image_small: img.small || null,
  };
}
