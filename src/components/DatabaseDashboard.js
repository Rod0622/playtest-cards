"use client";

import { useEffect, useMemo, useState } from "react";

function fmtMoney(v) {
  if (v == null || Number.isNaN(Number(v))) return "—";
  return `₱${Number(v).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

async function readJsonSafe(resp) {
  const text = await resp.text();
  try {
    return { json: JSON.parse(text), raw: text };
  } catch {
    return { json: null, raw: text };
  }
}

export default function DatabaseDashboard() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [selected, setSelected] = useState(null);
  const [adminToken, setAdminToken] = useState("");
  const [statusRows, setStatusRows] = useState([]);
  const [searching, setSearching] = useState(false);
  const [scraping, setScraping] = useState(false);

  const [heroStartPage, setHeroStartPage] = useState(1);
  const [heroEndPage, setHeroEndPage] = useState(2);
  const [heroDelayMs, setHeroDelayMs] = useState(400);

  useEffect(() => {
    const saved = window.localStorage.getItem("SCRAPE_ADMIN_TOKEN") || "";
    setAdminToken(saved);
  }, []);

  useEffect(() => {
    if (adminToken) {
      window.localStorage.setItem("SCRAPE_ADMIN_TOKEN", adminToken);
    }
  }, [adminToken]);

  async function searchCards() {
    setSearching(true);
    try {
      const resp = await fetch(
        `/api/cards/search?q=${encodeURIComponent(query || "")}`
      );
      const { json, raw } = await readJsonSafe(resp);

      if (!resp.ok || !json?.ok) {
        throw new Error(
          json?.error || raw || `Search failed with status ${resp.status}`
        );
      }

      setResults(json.results || []);
      setSelected(null);
    } catch (e) {
      alert(e.message || "Search failed");
    } finally {
      setSearching(false);
    }
  }

  async function refreshStatus() {
    try {
      const resp = await fetch("/api/scrape/status");
      const { json, raw } = await readJsonSafe(resp);

      if (!resp.ok || !json?.ok) {
        throw new Error(
          json?.error || raw || `Failed to fetch scrape status (${resp.status})`
        );
      }

      setStatusRows(json.runs || []);
    } catch (e) {
      console.error(e);
    }
  }

  useEffect(() => {
    refreshStatus();
  }, []);

  async function runScrape(stores, optionsByStore = {}) {
    if (!adminToken) {
      alert("Paste your admin token first.");
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
          optionsByStore,
        }),
      });

      const { json, raw } = await readJsonSafe(resp);

      if (!resp.ok || !json?.ok) {
        throw new Error(
          json?.error || raw || `Scrape failed with status ${resp.status}`
        );
      }

      alert("Scrape finished. Check status panel for details.");
      await refreshStatus();
      await searchCards();
    } catch (e) {
      alert(e.message || "Scrape failed");
    } finally {
      setScraping(false);
    }
  }

  async function exportFormat(format) {
    const url = `/api/export?format=${encodeURIComponent(
      format
    )}&q=${encodeURIComponent(query || "")}`;
    window.open(url, "_blank");
  }

  async function copyGoogleSheets() {
    try {
      const resp = await fetch(
        `/api/export?format=csv&q=${encodeURIComponent(query || "")}`
      );
      const text = await resp.text();
      await navigator.clipboard.writeText(text);
      alert("CSV copied. Paste it into Google Sheets.");
    } catch {
      alert("Copy failed");
    }
  }

  const selectedListings = useMemo(() => selected?.listings || [], [selected]);

  return (
    <div className="db-page" style={{ padding: 32 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 24,
          alignItems: "flex-start",
          flexWrap: "wrap",
        }}
      >
        <div style={{ flex: "1 1 720px", minWidth: 320 }}>
          <h1 style={{ fontSize: 48, marginBottom: 4 }}>Card Price Database</h1>
          <p style={{ opacity: 0.75, marginBottom: 24 }}>
            Search cards and compare prices across stores.
          </p>

          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by card name, set code (e.g. MH2), or collector #"
              style={{
                flex: 1,
                minWidth: 280,
                padding: "12px 14px",
                borderRadius: 8,
                border: "1px solid #555",
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") searchCards();
              }}
            />
            <button onClick={searchCards} disabled={searching}>
              {searching ? "Searching..." : "Search"}
            </button>
          </div>

          <div style={{ display: "flex", gap: 8, marginBottom: 18, flexWrap: "wrap" }}>
            <button onClick={() => exportFormat("csv")}>Export CSV</button>
            <button onClick={() => exportFormat("xlsx")}>Export XLSX</button>
            <button onClick={() => exportFormat("pdf")}>Export PDF</button>
            <button onClick={copyGoogleSheets}>Copy → Google Sheets</button>
          </div>

          <h2 style={{ marginBottom: 10 }}>Results ({results.length})</h2>

          <div
            style={{
              border: "1px solid rgba(255,255,255,0.35)",
              borderRadius: 12,
              overflow: "hidden",
              background: "rgba(255,255,255,0.03)",
            }}
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1.8fr 120px 80px 120px",
                gap: 12,
                padding: "12px 14px",
                fontWeight: 700,
                background: "rgba(255,255,255,0.06)",
              }}
            >
              <div>Card</div>
              <div>Set</div>
              <div>#</div>
              <div>Cheapest</div>
            </div>

            {results.length === 0 ? (
              <div style={{ padding: 16, opacity: 0.7 }}>
                No results. Try a different search.
              </div>
            ) : (
              results.map((row) => (
                <button
                  key={row.id}
                  onClick={() => setSelected(row)}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    display: "grid",
                    gridTemplateColumns: "1.8fr 120px 80px 120px",
                    gap: 12,
                    padding: "14px",
                    border: "none",
                    borderTop: "1px solid rgba(255,255,255,0.08)",
                    background:
                      selected?.id === row.id ? "rgba(255,255,255,0.08)" : "transparent",
                    color: "inherit",
                    cursor: "pointer",
                  }}
                >
                  <div style={{ display: "flex", gap: 12 }}>
                    {row.image_small ? (
                      <img
                        src={row.image_small}
                        alt={row.name}
                        style={{
                          width: 40,
                          height: 56,
                          objectFit: "cover",
                          borderRadius: 4,
                          flexShrink: 0,
                        }}
                      />
                    ) : null}
                    <div>
                      <div style={{ fontWeight: 700 }}>{row.name}</div>
                      <div style={{ opacity: 0.65 }}>{row.set_name || "—"}</div>
                    </div>
                  </div>
                  <div>{row.set_code || "—"}</div>
                  <div>{row.collector_number || "—"}</div>
                  <div>{fmtMoney(row.cheapest_price)}</div>
                </button>
              ))
            )}
          </div>
        </div>

        <div style={{ width: 380, flexShrink: 0 }}>
          <h2 style={{ marginBottom: 10 }}>Crawler</h2>

          <div
            style={{
              border: "1px solid rgba(255,255,255,0.35)",
              borderRadius: 12,
              padding: 14,
              marginBottom: 18,
            }}
          >
            <p style={{ opacity: 0.75, marginBottom: 10 }}>
              Use this to refresh the database. High Market is captcha-protected
              and will show as an error unless they whitelist you.
            </p>

            <div style={{ marginBottom: 8, fontSize: 13 }}>
              Admin Token (SCRAPE_ADMIN_TOKEN)
            </div>
            <input
              type="text"
              value={adminToken}
              onChange={(e) => setAdminToken(e.target.value)}
              placeholder="Paste token here"
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: 8,
                border: "1px solid #555",
                marginBottom: 14,
              }}
            />

            <div
              style={{
                border: "1px solid rgba(255,255,255,0.18)",
                borderRadius: 10,
                padding: 12,
                marginBottom: 12,
              }}
            >
              <div style={{ fontWeight: 700, marginBottom: 10 }}>
                Hero Hobbies page range
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 8,
                  marginBottom: 8,
                }}
              >
                <div>
                  <div style={{ fontSize: 12, marginBottom: 4 }}>Start page</div>
                  <input
                    type="number"
                    min="1"
                    value={heroStartPage}
                    onChange={(e) => setHeroStartPage(Number(e.target.value || 1))}
                    style={{
                      width: "100%",
                      padding: "8px 10px",
                      borderRadius: 8,
                      border: "1px solid #555",
                    }}
                  />
                </div>
                <div>
                  <div style={{ fontSize: 12, marginBottom: 4 }}>End page</div>
                  <input
                    type="number"
                    min="1"
                    value={heroEndPage}
                    onChange={(e) => setHeroEndPage(Number(e.target.value || 1))}
                    style={{
                      width: "100%",
                      padding: "8px 10px",
                      borderRadius: 8,
                      border: "1px solid #555",
                    }}
                  />
                </div>
              </div>

              <div>
                <div style={{ fontSize: 12, marginBottom: 4 }}>Delay (ms)</div>
                <input
                  type="number"
                  min="0"
                  step="100"
                  value={heroDelayMs}
                  onChange={(e) => setHeroDelayMs(Number(e.target.value || 400))}
                  style={{
                    width: "100%",
                    padding: "8px 10px",
                    borderRadius: 8,
                    border: "1px solid #555",
                  }}
                />
              </div>
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
              <button
                disabled={scraping}
                onClick={() => runScrape(["contemporarynook"], {})}
              >
                {scraping ? "Scraping..." : "Scrape Contemporary Nook"}
              </button>

              <button
                disabled={scraping}
                onClick={() =>
                  runScrape(["herohobbies"], {
                    herohobbies: {
                      startPage: heroStartPage,
                      endPage: heroEndPage,
                      delayMs: heroDelayMs,
                    },
                  })
                }
              >
                {scraping ? "Scraping..." : "Scrape HeroHobbies"}
              </button>

              <button
                disabled={scraping}
                onClick={() => runScrape(["highmarket"], {})}
              >
                {scraping ? "Scraping..." : "Try High Market"}
              </button>

              <button
                disabled={scraping}
                onClick={() =>
                  runScrape(
                    ["contemporarynook", "herohobbies", "highmarket"],
                    {
                      herohobbies: {
                        startPage: heroStartPage,
                        endPage: heroEndPage,
                        delayMs: heroDelayMs,
                      },
                    }
                  )
                }
              >
                {scraping ? "Scraping..." : "Scrape All"}
              </button>
            </div>

            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginTop: 10,
                marginBottom: 8,
              }}
            >
              <div style={{ fontWeight: 700 }}>Status</div>
              <button onClick={refreshStatus}>Refresh</button>
            </div>

            <div style={{ display: "grid", gap: 10 }}>
              {statusRows.length === 0 ? (
                <div style={{ opacity: 0.7 }}>No scrape runs yet.</div>
              ) : (
                statusRows.map((row) => (
                  <div
                    key={row.id}
                    style={{
                      border: "1px solid rgba(255,255,255,0.25)",
                      borderRadius: 10,
                      padding: 10,
                    }}
                  >
                    <div style={{ fontWeight: 700 }}>{row.store_slug}</div>
                    <div style={{ opacity: 0.8 }}>
                      {row.status} • {row.rows ?? row.items_found ?? 0} rows
                    </div>
                    <div style={{ fontSize: 12, opacity: 0.7 }}>
                      {row.finished_at || row.started_at}
                    </div>
                    <div style={{ marginTop: 4, fontSize: 13, opacity: 0.9 }}>
                      {row.message || row.error_text || "—"}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <h2 style={{ marginBottom: 10 }}>Card details</h2>
          <div
            style={{
              border: "1px solid rgba(255,255,255,0.35)",
              borderRadius: 12,
              padding: 14,
              minHeight: 220,
            }}
          >
            {!selected ? (
              <div style={{ opacity: 0.7 }}>Select a card to see details.</div>
            ) : (
              <>
                <div style={{ display: "flex", gap: 14, marginBottom: 14 }}>
                  {selected.image_normal ? (
                    <img
                      src={selected.image_normal}
                      alt={selected.name}
                      style={{ width: 146, borderRadius: 8 }}
                    />
                  ) : null}
                  <div>
                    <div style={{ fontSize: 24, fontWeight: 800 }}>{selected.name}</div>
                    <div style={{ opacity: 0.8 }}>
                      {selected.set_name || "—"}{" "}
                      {selected.collector_number ? `#${selected.collector_number}` : ""}
                    </div>
                    <div style={{ opacity: 0.8 }}>
                      Set code: {selected.set_code || "—"}
                    </div>
                    {selected.scryfall_uri ? (
                      <a
                        href={selected.scryfall_uri}
                        target="_blank"
                        rel="noreferrer"
                        style={{ color: "#8ab4ff" }}
                      >
                        Open in Scryfall
                      </a>
                    ) : null}
                  </div>
                </div>

                <div style={{ display: "grid", gap: 8 }}>
                  {selectedListings.length === 0 ? (
                    <div style={{ opacity: 0.7 }}>No store listings saved yet.</div>
                  ) : (
                    selectedListings.map((l) => (
                      <div
                        key={l.id}
                        style={{
                          border: "1px solid rgba(255,255,255,0.2)",
                          borderRadius: 10,
                          padding: 10,
                        }}
                      >
                        <div style={{ fontWeight: 700 }}>{l.store_name || l.store_slug}</div>
                        <div>{fmtMoney(l.price)}</div>
                        <div style={{ opacity: 0.75 }}>
                          {l.condition || "—"} {l.language ? `• ${l.language}` : ""}
                        </div>
                        {l.product_url ? (
                          <a
                            href={l.product_url}
                            target="_blank"
                            rel="noreferrer"
                            style={{ color: "#8ab4ff" }}
                          >
                            Open listing
                          </a>
                        ) : null}
                      </div>
                    ))
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}