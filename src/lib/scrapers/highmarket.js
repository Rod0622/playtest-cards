import { fetchWithRetry } from "./utils";

export async function scrapeHighMarket() {
  const base = "https://www.highmarketonline.shop/";
  const resp = await fetchWithRetry(base, {}, { retries: 1 });
  const text = await resp.text();

  // High Market Online currently shows an anti-bot checkbox/captcha.
  // We must NOT bypass this.
  if (text.toLowerCase().includes("verify that you are not a robot")) {
    return {
      ok: false,
      storeSlug: "highmarket",
      message:
        "High Market Online is protected by an anti-bot / captcha page. This scraper will not bypass it. You can either (1) request API access/whitelisting from the site owner, or (2) upload exports manually.",
      listings: [],
    };
  }

  return {
    ok: false,
    storeSlug: "highmarket",
    message:
      "High Market Online scraping is not implemented because site protection/structure is unknown. If you can provide an official export/API, we can integrate it.",
    listings: [],
  };
}
