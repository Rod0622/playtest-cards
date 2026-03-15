import { scrapeContemporaryNook } from "./contemporarynook";
import { scrapeHeroHobbies } from "./herohobbies";
import { scrapeHighMarket } from "./highmarket";

export async function scrapeStores(stores = [], optionsByStore = {}) {
  const requestedStores =
    Array.isArray(stores) && stores.length
      ? stores
      : ["contemporarynook", "herohobbies", "highmarket"];

  const results = [];

  for (const rawStore of requestedStores) {
    const storeSlug = String(rawStore || "").toLowerCase();
    const options = optionsByStore?.[storeSlug] || {};

    try {
      if (storeSlug === "contemporarynook") {
        const result = await scrapeContemporaryNook(options);
        results.push(result);
        continue;
      }

      if (storeSlug === "herohobbies") {
        const result = await scrapeHeroHobbies(options);
        results.push(result);
        continue;
      }

      if (storeSlug === "highmarket") {
        const result = await scrapeHighMarket(options);
        results.push(result);
        continue;
      }

      results.push({
        ok: false,
        storeSlug,
        message: `Unsupported store: ${storeSlug}`,
        listings: [],
        meta: {},
      });
    } catch (error) {
      results.push({
        ok: false,
        storeSlug,
        message: error?.message || String(error),
        listings: [],
        meta: {},
      });
    }
  }

  return results;
}