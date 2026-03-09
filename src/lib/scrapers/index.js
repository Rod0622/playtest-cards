import { scrapeContemporaryNook } from "./contemporarynook";
import { scrapeHeroHobbies } from "./herohobbies";
import { scrapeHighMarket } from "./highmarket";

export async function scrapeStore(slug, options = {}) {
  switch (slug) {
    case "contemporarynook":
      return scrapeContemporaryNook(options);
    case "herohobbies":
      return scrapeHeroHobbies(options);
    case "highmarket":
      return scrapeHighMarket(options);
    default:
      return {
        ok: false,
        storeSlug: slug,
        message: `Unknown store slug: ${slug}`,
        listings: [],
      };
  }
}

export async function scrapeAllStores({ stores, optionsByStore } = {}) {
  const slugs = stores && stores.length ? stores : ["contemporarynook", "herohobbies", "highmarket"];
  const results = [];

  for (const slug of slugs) {
    const opt = (optionsByStore && optionsByStore[slug]) || {};
    results.push(await scrapeStore(slug, opt));
  }

  return results;
}
