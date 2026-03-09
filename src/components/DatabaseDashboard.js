"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

function formatMoney(v, currency = "PHP") {
  if (v == null || v === "") return "";
  const num = Number(v);
  if (!Number.isFinite(num)) return String(v);
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(num);
  } catch {
    return `${currency} ${num.toFixed(2)}`;
  }
}

function minBy(arr, fn) {
  let best = null;
  for (const x of arr || []) {
    const v = fn(x);
    if (v == null) continue;
    if (!best || v < fn(best)) best = x;
  }
  return best;
}

function toTsv(rows) {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const esc = (s) => String(s ?? "").replace(/\t/g, " ").replace(/\n/g, " ");
  const out = [headers.join("\t")];
  for (const r of rows) {
    out.push(headers.map((h) => esc(r[h])).join("\t"));
  }
  return out.join("\n");
}

export default function DatabaseDashboard() {
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState([]);
  const [selected, setSelected] = useState(null);
  const [status, setStatus] = useState(null);
  const [adminToken, setAdminToken] = useState("");
  const [scraping, setScraping] = useState(false);

  useEffect(() => {
    setAdminToken(localStorage.getItem("pf_admin_token") || "");
  }, []);

  useEffect(() => {
    localStorage.setItem("pf_admin_token", adminToken);
  }, [adminToken]);

  const fetchStatus = async () => {
    const resp = await fetch("/api/scrape/status", { cache: "no-store" });
    const json = await resp.json();
    if (json.ok) setStatus(json);
  };

  useEffect(() => {
    fetchStatus();
  }, []);

  const search = async (term) => {
    setLoading(true);
    try {
      const url = `/api/cards/search?q=${encodeURIComponent(term)}&limit=30`;
      const resp = await fetch(url, { cache: "no-store" });
      const json = await resp.json();
      if (json.ok) {
        setResults(json.results || []);
        // Keep selection if still present
        if (selected) {
          const nextSel = (json.results || []).find((c) => c.id === selected.id);
          setSelected(nextSel || null);
        }
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const t = setTimeout(() => search(q), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const rowsForClipboard = useMemo(() => {
    const rows = [];
    for (const c of results) {
      for (const l of c.listings || []) {
        rows.push({
          card_name: c.name,
          set_code: c.set_code,
          collector_number: c.collector_number,
          store: l.stores?.name || l.stores?.slug || "",
          price: l.price,
          currency: l.currency,
          condition: l.condition,
          language: l.language,
          in_stock: l.in_stock,
          stock_qty: l.stock_qty,
          product_url: l.product_url,
        });
      }
    }
    return rows;
  }, [results]);

  const runScrape = async (stores) => {
    if (!adminToken) {
      alert(
        "Set your Admin Token first (SCRAPE_ADMIN_TOKEN). This is required to trigger crawling."
      );
      return;
    }

    setScraping(true);
    try {
      const resp = await fetch("/api/scrape/run", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-token": adminToken,
        },
        body: JSON.stringify({
          stores,
          optionsByStore: {
            contemporarynook: { maxSetPages: 80, concurrency: 2 },
            herohobbies: { maxExpansions: 30, maxPagesPerExpansion: 3 },
          },
        }),
      });

      const json = await resp.json();
      if (!json.ok) {
        alert(json.error || "Scrape failed");
        return;
      }
      await fetchStatus();
      await search(q);
      alert("Scrape finished. Check status panel for details.");
    } finally {
      setScraping(false);
    }
  };

  const exportFile = (format) => {
    const url = `/api/export?format=${encodeURIComponent(
      format
    )}&q=${encodeURIComponent(q)}&limit=2000`;
    window.location.href = url;
  };

  const copyToGoogleSheets = async () => {
    const tsv = toTsv(rowsForClipboard);
    if (!tsv) {
      alert("No rows to copy.");
      return;
    }
    await navigator.clipboard.writeText(tsv);
    alert("Copied as TSV. Paste into Google Sheets.");
  };

  return (
    <div style={{ padding: 16, maxWidth: 1200, margin: "0 auto" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
          marginBottom: 16,
        }}
      >
        <div>
          <h1 style={{ margin: 0 }}>Card Price Database</h1>
          <div style={{ opacity: 0.7 }}>
            Search cards and compare prices across stores.
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Link href="/" style={{ textDecoration: "underline" }}>
            Image Downloader
          </Link>
          <span style={{ opacity: 0.5 }}>|</span>
          <Link href="/database" style={{ textDecoration: "underline" }}>
            Database
          </Link>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 380px",
          gap: 16,
        }}
      >
        <div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by card name, set code (e.g. MH2), or collector #"
              style={{
                width: "100%",
                padding: 10,
                border: "1px solid #ddd",
                borderRadius: 8,
              }}
            />
            <button
              onClick={() => search(q)}
              disabled={loading}
              style={{ padding: "10px 12px" }}
            >
              {loading ? "Searching…" : "Search"}
            </button>
          </div>

          <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button onClick={() => exportFile("csv")}>Export CSV</button>
            <button onClick={() => exportFile("xlsx")}>Export XLSX</button>
            <button onClick={() => exportFile("pdf")}>Export PDF</button>
            <button onClick={copyToGoogleSheets}>Copy → Google Sheets</button>
          </div>

          <div style={{ marginTop: 16 }}>
            <h3 style={{ marginBottom: 8 }}>Results ({results.length})</h3>
            <div
              style={{
                border: "1px solid #eee",
                borderRadius: 10,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1.2fr 0.6fr 0.5fr 0.7fr",
                  gap: 8,
                  padding: 10,
                  background: "#fafafa",
                  fontWeight: 600,
                }}
              >
                <div>Card</div>
                <div>Set</div>
                <div>#</div>
                <div>Cheapest</div>
              </div>

              {results.map((c) => {
                const cheapest = minBy(c.listings || [], (l) => l.price);
                const isSelected = selected?.id === c.id;
                return (
                  <button
                    key={c.id}
                    onClick={() => setSelected(c)}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1.2fr 0.6fr 0.5fr 0.7fr",
                      gap: 8,
                      padding: 10,
                      width: "100%",
                      textAlign: "left",
                      border: "none",
                      borderTop: "1px solid #eee",
                      background: isSelected ? "#f1f7ff" : "white",
                      cursor: "pointer",
                    }}
                  >
                    <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                      {c.image_small ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={c.image_small}
                          alt={c.name}
                          style={{ width: 36, height: "auto", borderRadius: 4 }}
                        />
                      ) : (
                        <div
                          style={{
                            width: 36,
                            height: 28,
                            borderRadius: 4,
                            background: "#eee",
                          }}
                        />
                      )}
                      <div>
                        <div style={{ fontWeight: 600 }}>{c.name}</div>
                        <div style={{ opacity: 0.7, fontSize: 12 }}>
                          {c.set_name || ""}
                        </div>
                      </div>
                    </div>
                    <div>{(c.set_code || "").toUpperCase()}</div>
                    <div>{c.collector_number || ""}</div>
                    <div>
                      {cheapest
                        ? `${formatMoney(cheapest.price, cheapest.currency)} (${cheapest.stores?.slug || ""})`
                        : "—"}
                    </div>
                  </button>
                );
              })}

              {!results.length && (
                <div style={{ padding: 12, opacity: 0.7 }}>
                  No results. Try a different search.
                </div>
              )}
            </div>
          </div>
        </div>

        <div>
          <h3 style={{ marginBottom: 8 }}>Crawler</h3>
          <div
            style={{
              border: "1px solid #eee",
              borderRadius: 10,
              padding: 12,
            }}
          >
            <div style={{ fontSize: 13, opacity: 0.75, marginBottom: 8 }}>
              Use this to refresh the database. High Market is captcha-protected and
              will show as an error unless they whitelist you.
            </div>

            <label style={{ display: "block", fontSize: 12, opacity: 0.7 }}>
              Admin Token (SCRAPE_ADMIN_TOKEN)
            </label>
            <input
              value={adminToken}
              onChange={(e) => setAdminToken(e.target.value)}
              placeholder="Paste token here (stored locally)"
              style={{
                width: "100%",
                padding: 10,
                border: "1px solid #ddd",
                borderRadius: 8,
                marginTop: 6,
              }}
            />

            <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
              <button
                disabled={scraping}
                onClick={() => runScrape(["contemporarynook"])}
              >
                {scraping ? "Scraping…" : "Scrape Contemporary Nook"}
              </button>
              <button
                disabled={scraping}
                onClick={() => runScrape(["herohobbies"])}
              >
                {scraping ? "Scraping…" : "Scrape HeroHobbies"}
              </button>
              <button
                disabled={scraping}
                onClick={() => runScrape(["highmarket"])}
              >
                {scraping ? "Scraping…" : "Try High Market"}
              </button>
              <button disabled={scraping} onClick={() => runScrape()}>
                {scraping ? "Scraping…" : "Scrape All"}
              </button>
            </div>

            <div style={{ marginTop: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <strong>Status</strong>
                <button onClick={fetchStatus} style={{ fontSize: 12 }}>
                  Refresh
                </button>
              </div>

              <div style={{ marginTop: 8, fontSize: 13 }}>
                {status?.latest ? (
                  <div style={{ display: "grid", gap: 8 }}>
                    {Object.entries(status.latest).map(([slug, r]) => (
                      <div
                        key={slug}
                        style={{
                          border: "1px solid #eee",
                          borderRadius: 8,
                          padding: 8,
                        }}
                      >
                        <div style={{ fontWeight: 700 }}>{slug}</div>
                        <div style={{ opacity: 0.8 }}>
                          {r.status} • {r.rows || 0} rows
                        </div>
                        <div style={{ opacity: 0.7, fontSize: 12 }}>
                          {r.started_at}
                        </div>
                        {r.message && (
                          <div style={{ opacity: 0.8, fontSize: 12 }}>
                            {r.message}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ opacity: 0.7 }}>No scrape runs yet.</div>
                )}
              </div>
            </div>
          </div>

          <h3 style={{ margin: "16px 0 8px" }}>Card details</h3>
          <div
            style={{
              border: "1px solid #eee",
              borderRadius: 10,
              padding: 12,
              minHeight: 260,
            }}
          >
            {!selected ? (
              <div style={{ opacity: 0.7 }}>Select a card to see details.</div>
            ) : (
              <div>
                <div style={{ display: "flex", gap: 12 }}>
                  <div>
                    {selected.image_normal ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={selected.image_normal}
                        alt={selected.name}
                        style={{ width: 140, height: "auto", borderRadius: 10 }}
                      />
                    ) : (
                      <div
                        style={{
                          width: 140,
                          height: 180,
                          borderRadius: 10,
                          background: "#eee",
                        }}
                      />
                    )}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 800, fontSize: 16 }}>
                      {selected.name}
                    </div>
                    <div style={{ opacity: 0.7 }}>
                      {(selected.set_code || "").toUpperCase()} • {selected.set_name || ""} • #{selected.collector_number || ""}
                    </div>
                    {selected.scryfall_uri && (
                      <a
                        href={selected.scryfall_uri}
                        target="_blank"
                        rel="noreferrer"
                        style={{ fontSize: 12, textDecoration: "underline" }}
                      >
                        Open on Scryfall
                      </a>
                    )}

                    <div style={{ marginTop: 10 }}>
                      <strong>Store prices</strong>
                      <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
                        {(selected.listings || [])
                          .slice()
                          .sort((a, b) => (a.price ?? 0) - (b.price ?? 0))
                          .map((l) => (
                            <div
                              key={l.id}
                              style={{
                                border: "1px solid #eee",
                                borderRadius: 8,
                                padding: 8,
                              }}
                            >
                              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                                <div style={{ fontWeight: 700 }}>
                                  {l.stores?.name || l.stores?.slug}
                                </div>
                                <div style={{ fontWeight: 700 }}>
                                  {formatMoney(l.price, l.currency)}
                                </div>
                              </div>
                              <div style={{ opacity: 0.8, fontSize: 12 }}>
                                {l.condition || ""}{" "}
                                {l.language ? `(${l.language})` : ""}
                                {l.stock_qty != null ? ` • Qty: ${l.stock_qty}` : ""}
                              </div>
                              <a
                                href={l.product_url}
                                target="_blank"
                                rel="noreferrer"
                                style={{ fontSize: 12, textDecoration: "underline" }}
                              >
                                Open product
                              </a>
                            </div>
                          ))}
                      </div>
                      {!(selected.listings || []).length && (
                        <div style={{ opacity: 0.7, fontSize: 12, marginTop: 6 }}>
                          No store listings yet.
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div style={{ marginTop: 18, fontSize: 12, opacity: 0.7 }}>
        Tip: For automation, you can configure a Vercel Cron job to call
        <code style={{ padding: "0 4px" }}>/api/scrape/run</code> with your admin token.
      </div>
    </div>
  );
}
