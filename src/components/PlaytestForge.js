"use client";

import { useState, useEffect, useRef } from "react";
import JSZip from "jszip";

// ─── CONSTANTS ───
const SCRYFALL_API = "https://api.scryfall.com/cards";
const STORAGE_KEY = "playtest-forge-customers";

// ─── HELPERS ───
function parseScryfallUrl(url) {
  const match = url.match(/scryfall\.com\/card\/([^/]+)\/([^/]+)/);
  if (match) return { set: match[1], collector: match[2] };
  return null;
}

function parseGoogleDriveUrl(url) {
  // Supports: drive.google.com/file/d/FILE_ID/... or drive.google.com/open?id=FILE_ID
  const match1 = url.match(/drive\.google\.com\/file\/d\/([^/]+)/);
  if (match1) return match1[1];
  const match2 = url.match(/drive\.google\.com\/open\?id=([^&]+)/);
  if (match2) return match2[1];
  return null;
}

function getLinkType(url) {
  if (url.includes("scryfall.com/card/")) return "scryfall";
  if (url.includes("drive.google.com")) return "gdrive";
  return "unknown";
}

function getGDriveImageUrl(fileId) {
  return `/api/gdrive?id=${fileId}`;
}

function getGDriveThumbnailUrl(fileId) {
  return `https://drive.google.com/thumbnail?id=${fileId}&sz=w200`;
}

function getGDriveDirectUrl(fileId) {
  return `https://drive.google.com/uc?export=download&id=${fileId}`;
}

async function fetchCardData(url) {
  const parsed = parseScryfallUrl(url);
  if (!parsed) return null;
  try {
    const resp = await fetch(
      `${SCRYFALL_API}/${parsed.set}/${parsed.collector}`
    );
    if (!resp.ok) return null;
    const data = await resp.json();
    return {
      type: "scryfall",
      name: data.name,
      set_name: data.set_name,
      set: data.set,
      collector_number: data.collector_number,
      image_normal:
        data.image_uris?.normal ||
        data.card_faces?.[0]?.image_uris?.normal ||
        null,
      image_large:
        data.image_uris?.large ||
        data.card_faces?.[0]?.image_uris?.large ||
        null,
      image_png:
        data.image_uris?.png ||
        data.card_faces?.[0]?.image_uris?.png ||
        null,
      image_small:
        data.image_uris?.small ||
        data.card_faces?.[0]?.image_uris?.small ||
        null,
      scryfall_uri: url,
      rarity: data.rarity,
    };
  } catch {
    return null;
  }
}

function buildGDriveCardData(url, fileId) {
  // Extract a name from the URL or use file ID
  return {
    type: "gdrive",
    name: `Drive Image (${fileId.slice(0, 8)}...)`,
    set_name: "Google Drive",
    set: "gdrive",
    collector_number: fileId.slice(0, 8),
    image_normal: getGDriveThumbnailUrl(fileId),
    image_large: getGDriveImageUrl(fileId),
    image_png: null,
    image_small: getGDriveThumbnailUrl(fileId),
    scryfall_uri: url,
    rarity: null,
    gdrive_file_id: fileId,
  };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── COMPONENT ───
export default function PlaytestForge() {
  const [customers, setCustomers] = useState([]);
  const [activeCustomerId, setActiveCustomerId] = useState(null);
  const [linkInput, setLinkInput] = useState("");
  const [defaultQty, setDefaultQty] = useState(1);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newCustomerName, setNewCustomerName] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState("");
  const [progress, setProgress] = useState({
    current: 0,
    total: 0,
    cardName: "",
  });
  const [toast, setToast] = useState(null);
  const [mounted, setMounted] = useState(false);
  const [selectedCards, setSelectedCards] = useState(new Set());
  const toastTimeout = useRef(null);

  // Load from localStorage on mount
  useEffect(() => {
    setMounted(true);
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        setCustomers(parsed);
        if (parsed.length > 0) {
          setActiveCustomerId(parsed[0].id);
        }
      }
    } catch (e) {
      console.error("Load error:", e);
    }
  }, []);

  // Save to localStorage whenever customers change
  useEffect(() => {
    if (mounted && customers.length >= 0) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(customers));
      } catch (e) {
        console.error("Save error:", e);
      }
    }
  }, [customers, mounted]);

  function showToast(msg, isError = false) {
    setToast({ msg, isError });
    if (toastTimeout.current) clearTimeout(toastTimeout.current);
    toastTimeout.current = setTimeout(() => setToast(null), 3000);
  }

  const activeCustomer = customers.find((c) => c.id === activeCustomerId);

  function addCustomer() {
    if (!newCustomerName.trim()) return;
    const newC = {
      id: Date.now().toString(),
      name: newCustomerName.trim(),
      cards: [],
    };
    const updated = [...customers, newC];
    setCustomers(updated);
    setActiveCustomerId(newC.id);
    setNewCustomerName("");
    setShowAddModal(false);
    showToast(`${newC.name} added`);
  }

  function deleteCustomer(id) {
    const c = customers.find((x) => x.id === id);
    if (!confirm(`Delete "${c?.name}" and all their cards?`)) return;
    const updated = customers.filter((x) => x.id !== id);
    setCustomers(updated);
    if (activeCustomerId === id) {
      setActiveCustomerId(updated.length > 0 ? updated[0].id : null);
    }
    showToast(`${c?.name} removed`);
  }

  async function addLinks() {
    if (!activeCustomer || !linkInput.trim()) return;
    const lines = linkInput
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.startsWith("http"));

    if (lines.length === 0) {
      showToast("No valid links found", true);
      return;
    }

    setLoading(true);
    setProgress({ current: 0, total: lines.length, cardName: "" });
    setLoadingMsg("Fetching card data...");

    const newCards = [];
    let skipped = 0;
    for (let i = 0; i < lines.length; i++) {
      const url = lines[i];
      const linkType = getLinkType(url);

      setProgress({
        current: i + 1,
        total: lines.length,
        cardName: url.split("/").pop()?.replace(/-/g, " ") || "",
      });

      if (linkType === "scryfall") {
        const cardData = await fetchCardData(url);
        if (cardData) {
          newCards.push({
            id: Date.now().toString() + Math.random().toString(36).slice(2),
            ...cardData,
            quantity: defaultQty,
          });
        } else {
          skipped++;
        }
        // Respect Scryfall rate limit
        await sleep(110);
      } else if (linkType === "gdrive") {
        const fileId = parseGoogleDriveUrl(url);
        if (fileId) {
          const cardData = buildGDriveCardData(url, fileId);
          newCards.push({
            id: Date.now().toString() + Math.random().toString(36).slice(2),
            ...cardData,
            quantity: defaultQty,
          });
        } else {
          skipped++;
        }
      } else {
        skipped++;
      }
    }

    const updated = customers.map((c) => {
      if (c.id === activeCustomerId) {
        return { ...c, cards: [...c.cards, ...newCards] };
      }
      return c;
    });

    setCustomers(updated);
    setLinkInput("");
    setLoading(false);
    const skippedText = skipped > 0 ? " (" + skipped + " skipped)" : "";
    const msg = newCards.length + " card" + (newCards.length !== 1 ? "s" : "") + " added" + skippedText;
    showToast(msg, newCards.length === 0);
  }

  function updateCardQty(cardId, qty) {
    const updated = customers.map((c) => {
      if (c.id === activeCustomerId) {
        return {
          ...c,
          cards: c.cards.map((card) =>
            card.id === cardId
              ? { ...card, quantity: Math.max(1, parseInt(qty) || 1) }
              : card
          ),
        };
      }
      return c;
    });
    setCustomers(updated);
  }

  function removeCard(cardId) {
    const updated = customers.map((c) => {
      if (c.id === activeCustomerId) {
        return { ...c, cards: c.cards.filter((card) => card.id !== cardId) };
      }
      return c;
    });
    setCustomers(updated);
  }

  function clearAllCards() {
    if (!activeCustomer || activeCustomer.cards.length === 0) return;
    if (
      !confirm(
        `Clear all ${activeCustomer.cards.length} cards for ${activeCustomer.name}?`
      )
    )
      return;
    const updated = customers.map((c) => {
      if (c.id === activeCustomerId) return { ...c, cards: [] };
      return c;
    });
    setCustomers(updated);
    setSelectedCards(new Set());
    showToast("All cards cleared");
  }

  function toggleSelectCard(cardId) {
    setSelectedCards((prev) => {
      const next = new Set(prev);
      if (next.has(cardId)) {
        next.delete(cardId);
      } else {
        next.add(cardId);
      }
      return next;
    });
  }

  function toggleSelectAll() {
    if (!activeCustomer) return;
    if (selectedCards.size === activeCustomer.cards.length) {
      setSelectedCards(new Set());
    } else {
      setSelectedCards(new Set(activeCustomer.cards.map((c) => c.id)));
    }
  }

  function deleteSelected() {
    if (selectedCards.size === 0) return;
    if (!confirm(`Delete ${selectedCards.size} selected card${selectedCards.size !== 1 ? "s" : ""}?`)) return;
    const updated = customers.map((c) => {
      if (c.id === activeCustomerId) {
        return { ...c, cards: c.cards.filter((card) => !selectedCards.has(card.id)) };
      }
      return c;
    });
    setCustomers(updated);
    showToast(`${selectedCards.size} card${selectedCards.size !== 1 ? "s" : ""} deleted`);
    setSelectedCards(new Set());
  }

  async function downloadAllCards() {
    if (!activeCustomer || activeCustomer.cards.length === 0) return;

    setLoading(true);
    setLoadingMsg("Downloading card images...");

    const cards = activeCustomer.cards;
    const totalImages = cards.reduce((sum, c) => sum + c.quantity, 0);
    setProgress({ current: 0, total: totalImages, cardName: "" });

    try {
      const zip = new JSZip();
      const folder = zip.folder(
        activeCustomer.name.replace(/[^a-zA-Z0-9]/g, "_")
      );

      let count = 0;
      for (const card of cards) {
        let imageUrl;
        let ext = "jpg";

        if (card.type === "gdrive" && card.gdrive_file_id) {
          // Use direct download URL for Google Drive
          imageUrl = getGDriveImageUrl(card.gdrive_file_id);
          ext = "png";
        } else {
          imageUrl = card.image_png || card.image_large || card.image_normal;
          ext = card.image_png ? "png" : "jpg";
        }

        if (!imageUrl) continue;

        setProgress({
          current: count + 1,
          total: totalImages,
          cardName: card.name,
        });

        try {
          const resp = await fetch(imageUrl);
          const blob = await resp.blob();
          const ext = card.image_png ? "png" : "jpg";
          const safeName = card.name
            .replace(/[^a-zA-Z0-9 ]/g, "")
            .replace(/\s+/g, "_");

          for (let q = 0; q < card.quantity; q++) {
            const fileName =
              card.quantity > 1
                ? `${safeName}_${card.set}_${card.collector_number}_copy${q + 1}.${ext}`
                : `${safeName}_${card.set}_${card.collector_number}.${ext}`;
            folder.file(fileName, blob);
            count++;
            setProgress({
              current: count,
              total: totalImages,
              cardName: card.name,
            });
          }
        } catch (err) {
          console.error(`Failed to download ${card.name}:`, err);
          count += card.quantity;
        }

        await sleep(110);
      }

      setLoadingMsg("Generating ZIP file...");
      const zipBlob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${activeCustomer.name.replace(/[^a-zA-Z0-9]/g, "_")}_playtest_cards.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      showToast(`Downloaded ${count} card images!`);
    } catch (err) {
      console.error("Download error:", err);
      showToast("Download failed: " + err.message, true);
    }

    setLoading(false);
  }

  const totalCards =
    activeCustomer?.cards.reduce((s, c) => s + c.quantity, 0) || 0;
  const uniqueCards = activeCustomer?.cards.length || 0;
  const CARDS_PER_PAGE = 8;
  const PRICE_PER_PAGE = 125;
  const totalPages = Math.ceil(totalCards / CARDS_PER_PAGE);
  const cardsNeeded = totalPages * CARDS_PER_PAGE;
  const blankSlots = cardsNeeded - totalCards;
  const totalPrice = totalPages * PRICE_PER_PAGE;

  if (!mounted) return null;

  return (
    <div className="app-container">
      {/* ─── HEADER ─── */}
      <header className="header">
        <div className="logo-text">Playtest Cards</div>
        <div className="logo-sub">MTG Card Image Downloader</div>
      </header>

      {/* ─── MAIN LAYOUT ─── */}
      <div className="main-layout">
        {/* ─── SIDEBAR ─── */}
        <aside className="sidebar">
          <div className="sidebar-title">Customers</div>
          {customers.map((c) => (
            <div
              key={c.id}
              className={`customer-btn ${c.id === activeCustomerId ? "active" : ""}`}
              onClick={() => { setActiveCustomerId(c.id); setSelectedCards(new Set()); }}
            >
              <span style={{ fontSize: 18 }}>&#9878;</span>
              <span className="customer-btn-name">{c.name}</span>
              <span className="customer-badge">{c.cards.length}</span>
              <button
                className="delete-customer-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  deleteCustomer(c.id);
                }}
                title="Delete customer"
              >
                &#10005;
              </button>
            </div>
          ))}
          <button
            className="add-customer-btn"
            onClick={() => setShowAddModal(true)}
          >
            <span style={{ fontSize: 18 }}>+</span> Add Customer
          </button>
        </aside>

        {/* ─── CONTENT ─── */}
        <main className="content-panel">
          {activeCustomer ? (
            <>
              <div className="panel-header">
                <div className="panel-title">{activeCustomer.name}</div>
                <div className="panel-actions">
                  {selectedCards.size > 0 && (
                    <button
                      className="btn btn-danger btn-sm btn-selected-delete"
                      onClick={deleteSelected}
                    >
                      &#128465; Delete Selected ({selectedCards.size})
                    </button>
                  )}
                  <button
                    className="btn btn-danger btn-sm"
                    onClick={clearAllCards}
                    disabled={activeCustomer.cards.length === 0}
                  >
                    &#128465; Clear All
                  </button>
                  <button
                    className="btn btn-cyber"
                    onClick={downloadAllCards}
                    disabled={activeCustomer.cards.length === 0}
                  >
                    &#11015; Download All as ZIP
                  </button>
                </div>
              </div>

              {/* INPUT */}
              <div className="input-section">
                <label className="input-label">Paste Scryfall Links</label>
                <textarea
                  className="link-input-area"
                  placeholder={`Paste one link per line (Scryfall or Google Drive)...\nhttps://scryfall.com/card/sld/1856/demonic-tutor\nhttps://drive.google.com/file/d/ABC123/view`}
                  value={linkInput}
                  onChange={(e) => setLinkInput(e.target.value)}
                />
                <div className="input-actions">
                  <div className="qty-input-inline">
                    <label>Default Qty:</label>
                    <input
                      type="number"
                      min="1"
                      max="99"
                      value={defaultQty}
                      onChange={(e) =>
                        setDefaultQty(parseInt(e.target.value) || 1)
                      }
                    />
                  </div>
                  <button
                    className="btn btn-primary"
                    onClick={addLinks}
                    disabled={!linkInput.trim()}
                  >
                    + Add Cards
                  </button>
                </div>
                <div className="input-hint">
                  <span style={{ color: "var(--accent-primary)" }}>
                    &#9432;
                  </span>
                  One link per line. Supports Scryfall links and Google Drive image links.
                </div>
              </div>

              {/* CARD LIST */}
              {activeCustomer.cards.length > 0 ? (
                <div className="card-list">
                  <div className="card-list-header">
                    <span>
                      <input
                        type="checkbox"
                        className="card-checkbox"
                        checked={activeCustomer.cards.length > 0 && selectedCards.size === activeCustomer.cards.length}
                        onChange={toggleSelectAll}
                      />
                    </span>
                    <span>#</span>
                    <span>Image</span>
                    <span>Card</span>
                    <span>Qty</span>
                    <span></span>
                  </div>
                  {activeCustomer.cards.map((card, i) => (
                    <div key={card.id} className={`card-row ${selectedCards.has(card.id) ? "card-row-selected" : ""}`}>
                      <div>
                        <input
                          type="checkbox"
                          className="card-checkbox"
                          checked={selectedCards.has(card.id)}
                          onChange={() => toggleSelectCard(card.id)}
                        />
                      </div>
                      <div className="card-row-num">
                        {String(i + 1).padStart(2, "0")}
                      </div>
                      <div>
                        {card.image_small || card.image_normal ? (
                          <img
                            className="card-row-img"
                            src={card.image_small || card.image_normal}
                            alt={card.name}
                            loading="lazy"
                          />
                        ) : (
                          <div className="card-row-img-placeholder">?</div>
                        )}
                      </div>
                      <div className="card-row-info">
                        <div className="card-row-name">{card.name}</div>
                        <div className="card-row-set">
                          {card.set_name} &middot;{" "}
                          {card.set.toUpperCase()} #{card.collector_number}
                          {card.rarity && (
                            <span
                              className="card-rarity"
                              data-rarity={card.rarity}
                            >
                              {card.rarity}
                            </span>
                          )}
                          {card.type === "gdrive" && (
                            <span className="card-source-badge gdrive">DRIVE</span>
                          )}
                        </div>
                        <a
                          className="card-row-link"
                          href={card.scryfall_uri}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {card.scryfall_uri}
                        </a>
                      </div>
                      <div className="card-row-qty">
                        <input
                          type="number"
                          min="1"
                          max="99"
                          value={card.quantity}
                          onChange={(e) =>
                            updateCardQty(card.id, e.target.value)
                          }
                        />
                      </div>
                      <div className="card-row-actions">
                        <button
                          className="icon-btn"
                          onClick={() => removeCard(card.id)}
                          title="Remove card"
                        >
                          &#128465;
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty-state">
                  <div className="empty-icon">&#127183;</div>
                  <div className="empty-title">No Cards Yet</div>
                  <div className="empty-desc">
                    Paste Scryfall links above to start building this
                    customer&apos;s playtest order.
                  </div>
                </div>
              )}

              {/* STATS & PRICING BAR */}
              {activeCustomer.cards.length > 0 && (
                <div className="stats-bar">
                  <div className="stats-row">
                    <div className="stat-item">
                      <span className="stat-label">Unique</span>
                      <span className="stat-value">{uniqueCards}</span>
                    </div>
                    <div className="stat-item">
                      <span className="stat-label">Total Cards</span>
                      <span className="stat-value">{totalCards}</span>
                    </div>
                    <div className="stat-item">
                      <span className="stat-label">Pages</span>
                      <span className="stat-value">{totalPages}</span>
                    </div>
                    {blankSlots > 0 && (
                      <div className="stat-item">
                        <span className="stat-label">Empty Slots</span>
                        <span className="stat-value stat-warn">{blankSlots} of {cardsNeeded}</span>
                      </div>
                    )}
                  </div>
                  <div className="price-display">
                    <div className="price-breakdown">
                      {totalPages} page{totalPages !== 1 ? "s" : ""} × ₱{PRICE_PER_PAGE}
                    </div>
                    <div className="price-total">₱{totalPrice.toLocaleString()}</div>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="empty-state">
              <div className="empty-icon">&#9878;</div>
              <div className="empty-title">Select or Add a Customer</div>
              <div className="empty-desc">
                Create customer tabs on the left to start managing playtest
                card orders.
              </div>
            </div>
          )}
        </main>
      </div>

      {/* ─── ADD CUSTOMER MODAL ─── */}
      {showAddModal && (
        <div className="modal-overlay" onClick={() => setShowAddModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">New Customer</div>
            <input
              className="modal-input"
              placeholder="Customer name..."
              value={newCustomerName}
              onChange={(e) => setNewCustomerName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addCustomer()}
              autoFocus
            />
            <div className="modal-actions">
              <button
                className="btn btn-ghost"
                onClick={() => setShowAddModal(false)}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={addCustomer}
                disabled={!newCustomerName.trim()}
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── PROGRESS OVERLAY ─── */}
      {loading && (
        <div className="progress-overlay">
          <div className="progress-card">
            <div className="progress-title">{loadingMsg}</div>
            <div className="progress-bar-track">
              <div
                className="progress-bar-fill"
                style={{
                  width:
                    progress.total > 0
                      ? `${(progress.current / progress.total) * 100}%`
                      : "0%",
                }}
              />
            </div>
            <div className="progress-text">
              {progress.current} / {progress.total}
            </div>
            {progress.cardName && (
              <div className="progress-current">{progress.cardName}</div>
            )}
          </div>
        </div>
      )}

      {/* ─── TOAST ─── */}
      {toast && (
        <div className={`toast ${toast.isError ? "error" : ""}`}>
          {toast.msg}
        </div>
      )}

      <style jsx>{`
        .app-container {
          max-width: 1400px;
          margin: 0 auto;
          padding: 20px;
          min-height: 100vh;
          position: relative;
          z-index: 1;
        }

        /* ─── HEADER ─── */
        .header {
          text-align: center;
          padding: 40px 0 30px;
          position: relative;
        }
        .header::after {
          content: "";
          position: absolute;
          bottom: 0;
          left: 50%;
          transform: translateX(-50%);
          width: 200px;
          height: 2px;
          background: var(--gradient-cyber);
          border-radius: 1px;
          box-shadow: var(--glow-purple);
        }
        .logo-text {
          font-family: "Orbitron", sans-serif;
          font-size: 36px;
          font-weight: 900;
          letter-spacing: 4px;
          text-transform: uppercase;
          background: var(--gradient-cyber);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          filter: drop-shadow(0 0 30px rgba(139, 92, 246, 0.4));
        }
        .logo-sub {
          font-family: "JetBrains Mono", monospace;
          font-size: 12px;
          color: var(--text-muted);
          letter-spacing: 6px;
          text-transform: uppercase;
          margin-top: 8px;
        }

        /* ─── LAYOUT ─── */
        .main-layout {
          display: grid;
          grid-template-columns: 280px 1fr;
          gap: 20px;
          margin-top: 30px;
        }
        @media (max-width: 900px) {
          .main-layout {
            grid-template-columns: 1fr;
          }
        }

        /* ─── SIDEBAR ─── */
        .sidebar {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .sidebar-title {
          font-family: "Orbitron", sans-serif;
          font-size: 11px;
          letter-spacing: 3px;
          text-transform: uppercase;
          color: var(--text-muted);
          padding: 0 12px;
          margin-bottom: 4px;
        }
        .customer-btn {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 12px 16px;
          background: var(--bg-panel);
          border: 1px solid var(--border-dim);
          border-radius: 8px;
          color: var(--text-secondary);
          font-family: "Rajdhani", sans-serif;
          font-size: 15px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s ease;
          position: relative;
          overflow: hidden;
        }
        .customer-btn::before {
          content: "";
          position: absolute;
          left: 0;
          top: 0;
          bottom: 0;
          width: 3px;
          background: var(--accent-primary);
          transform: scaleY(0);
          transition: transform 0.2s ease;
        }
        .customer-btn:hover {
          border-color: rgba(139, 92, 246, 0.3);
          color: var(--text-primary);
          background: rgba(139, 92, 246, 0.05);
        }
        .customer-btn:hover::before {
          transform: scaleY(1);
        }
        .customer-btn.active {
          border-color: var(--accent-primary);
          color: var(--text-primary);
          background: rgba(139, 92, 246, 0.1);
          box-shadow: var(--glow-purple);
        }
        .customer-btn.active::before {
          transform: scaleY(1);
          background: var(--accent-secondary);
        }
        .customer-btn-name {
          flex: 1;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .customer-badge {
          margin-left: auto;
          background: rgba(139, 92, 246, 0.2);
          color: var(--accent-primary);
          font-family: "JetBrains Mono", monospace;
          font-size: 11px;
          padding: 2px 8px;
          border-radius: 4px;
          flex-shrink: 0;
        }
        .customer-btn.active .customer-badge {
          background: rgba(6, 255, 165, 0.15);
          color: var(--accent-secondary);
        }
        .add-customer-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          padding: 12px;
          background: transparent;
          border: 1px dashed var(--border-dim);
          border-radius: 8px;
          color: var(--text-muted);
          font-family: "Rajdhani", sans-serif;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s ease;
        }
        .add-customer-btn:hover {
          border-color: var(--accent-secondary);
          color: var(--accent-secondary);
          background: rgba(6, 255, 165, 0.03);
        }
        .delete-customer-btn {
          background: none;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          padding: 2px 4px;
          font-size: 14px;
          transition: color 0.2s;
          flex-shrink: 0;
        }
        .delete-customer-btn:hover {
          color: var(--accent-danger);
        }

        /* ─── CONTENT PANEL ─── */
        .content-panel {
          background: var(--bg-panel);
          border: 1px solid var(--border-dim);
          border-radius: 12px;
          overflow: hidden;
        }
        .panel-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 20px 24px;
          border-bottom: 1px solid var(--border-dim);
          background: rgba(139, 92, 246, 0.02);
          flex-wrap: wrap;
          gap: 12px;
        }
        .panel-title {
          font-family: "Orbitron", sans-serif;
          font-size: 18px;
          font-weight: 700;
          letter-spacing: 1px;
        }
        .panel-actions {
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
        }

        /* ─── BUTTONS ─── */
        .btn {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 10px 20px;
          border: none;
          border-radius: 6px;
          font-family: "Rajdhani", sans-serif;
          font-size: 14px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 1px;
          cursor: pointer;
          transition: all 0.25s ease;
        }
        .btn-primary {
          background: var(--accent-primary);
          color: white;
          box-shadow: 0 4px 15px rgba(139, 92, 246, 0.3);
        }
        .btn-primary:hover {
          box-shadow: 0 4px 25px rgba(139, 92, 246, 0.5);
          transform: translateY(-1px);
        }
        .btn-primary:disabled,
        .btn-cyber:disabled {
          background: #333;
          color: #666;
          box-shadow: none;
          cursor: not-allowed;
          transform: none;
        }
        .btn-cyber {
          background: var(--gradient-cyber);
          color: #000;
          font-weight: 800;
          box-shadow: var(--glow-green);
        }
        .btn-cyber:hover {
          box-shadow: 0 0 30px rgba(6, 255, 165, 0.4),
            0 0 60px rgba(6, 255, 165, 0.2);
          transform: translateY(-1px);
        }
        .btn-danger {
          background: rgba(255, 56, 96, 0.15);
          color: var(--accent-danger);
          border: 1px solid rgba(255, 56, 96, 0.3);
        }
        .btn-danger:hover {
          background: rgba(255, 56, 96, 0.25);
        }
        .btn-danger:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }
        .btn-ghost {
          background: transparent;
          color: var(--text-secondary);
          border: 1px solid var(--border-dim);
        }
        .btn-ghost:hover {
          border-color: var(--accent-primary);
          color: var(--text-primary);
        }
        .btn-sm {
          padding: 6px 12px;
          font-size: 12px;
        }

        /* ─── INPUT SECTION ─── */
        .input-section {
          padding: 24px;
          border-bottom: 1px solid var(--border-dim);
        }
        .input-label {
          font-family: "JetBrains Mono", monospace;
          font-size: 11px;
          color: var(--text-muted);
          letter-spacing: 2px;
          text-transform: uppercase;
          margin-bottom: 10px;
          display: block;
        }
        .link-input-area {
          width: 100%;
          min-height: 100px;
          background: var(--bg-input);
          border: 1px solid var(--border-dim);
          border-radius: 8px;
          color: var(--text-primary);
          font-family: "JetBrains Mono", monospace;
          font-size: 13px;
          padding: 14px;
          resize: vertical;
          transition: border-color 0.2s;
          line-height: 1.8;
        }
        .link-input-area:focus {
          outline: none;
          border-color: var(--accent-primary);
          box-shadow: 0 0 0 3px rgba(139, 92, 246, 0.1);
        }
        .link-input-area::placeholder {
          color: var(--text-muted);
          font-style: italic;
        }
        .input-hint {
          font-size: 12px;
          color: var(--text-muted);
          margin-top: 8px;
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .input-actions {
          display: flex;
          gap: 10px;
          margin-top: 14px;
          align-items: center;
          flex-wrap: wrap;
        }
        .qty-input-inline {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .qty-input-inline label {
          font-family: "JetBrains Mono", monospace;
          font-size: 11px;
          color: var(--text-muted);
          text-transform: uppercase;
          letter-spacing: 1px;
        }
        .qty-input-inline input {
          width: 60px;
          background: var(--bg-input);
          border: 1px solid var(--border-dim);
          border-radius: 6px;
          color: var(--text-primary);
          font-family: "JetBrains Mono", monospace;
          font-size: 13px;
          padding: 6px 10px;
          text-align: center;
        }
        .qty-input-inline input:focus {
          outline: none;
          border-color: var(--accent-primary);
        }

        /* ─── CARD LIST ─── */
        .card-list-header {
          display: grid;
          grid-template-columns: 36px 50px 70px 1fr 70px 50px;
          gap: 12px;
          padding: 12px 24px;
          background: rgba(0, 0, 0, 0.2);
          border-bottom: 1px solid var(--border-dim);
          font-family: "JetBrains Mono", monospace;
          font-size: 10px;
          color: var(--text-muted);
          letter-spacing: 2px;
          text-transform: uppercase;
          align-items: center;
        }
        .card-row {
          display: grid;
          grid-template-columns: 36px 50px 70px 1fr 70px 50px;
          gap: 12px;
          padding: 10px 24px;
          align-items: center;
          border-bottom: 1px solid rgba(26, 26, 58, 0.5);
          transition: background 0.15s;
        }
        .card-row:hover {
          background: rgba(139, 92, 246, 0.03);
        }
        .card-row-selected {
          background: rgba(255, 56, 96, 0.05);
          border-left: 2px solid var(--accent-danger);
        }
        .card-row-selected:hover {
          background: rgba(255, 56, 96, 0.08);
        }
        .card-checkbox {
          width: 16px;
          height: 16px;
          accent-color: var(--accent-primary);
          cursor: pointer;
        }
        .btn-selected-delete {
          animation: pulseDelete 1.5s ease-in-out infinite;
        }
        @keyframes pulseDelete {
          0%, 100% { box-shadow: 0 0 0 0 rgba(255, 56, 96, 0.4); }
          50% { box-shadow: 0 0 12px 2px rgba(255, 56, 96, 0.3); }
        }
        .card-row-num {
          font-family: "JetBrains Mono", monospace;
          font-size: 13px;
          color: var(--text-muted);
        }
        .card-row-img {
          width: 55px;
          height: 77px;
          border-radius: 4px;
          object-fit: cover;
          border: 1px solid var(--border-dim);
          background: var(--bg-card);
        }
        .card-row-img-placeholder {
          width: 55px;
          height: 77px;
          border-radius: 4px;
          border: 1px dashed var(--border-dim);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 20px;
          color: var(--text-muted);
          background: var(--bg-card);
        }
        .card-row-info {
          display: flex;
          flex-direction: column;
          gap: 2px;
          min-width: 0;
        }
        .card-row-name {
          font-weight: 700;
          font-size: 15px;
          color: var(--text-primary);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .card-row-set {
          font-family: "JetBrains Mono", monospace;
          font-size: 11px;
          color: var(--text-muted);
          text-transform: uppercase;
          letter-spacing: 1px;
        }
        .card-rarity {
          margin-left: 8px;
          text-transform: capitalize;
        }
        .card-rarity[data-rarity="mythic"] {
          color: #ff6a00;
        }
        .card-rarity[data-rarity="rare"] {
          color: #c9aa71;
        }
        .card-rarity[data-rarity="uncommon"] {
          color: #b0b0b0;
        }
        .card-rarity[data-rarity="common"] {
          color: #555;
        }
        .card-source-badge {
          margin-left: 8px;
          font-size: 9px;
          padding: 1px 6px;
          border-radius: 3px;
          letter-spacing: 1px;
          font-weight: 700;
        }
        .card-source-badge.gdrive {
          background: rgba(66, 133, 244, 0.2);
          color: #4285f4;
          border: 1px solid rgba(66, 133, 244, 0.3);
        }
        .card-row-link {
          font-family: "JetBrains Mono", monospace;
          font-size: 10px;
          color: var(--accent-primary);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          text-decoration: none;
        }
        .card-row-link:hover {
          text-decoration: underline;
        }
        .card-row-qty input {
          width: 50px;
          background: var(--bg-input);
          border: 1px solid var(--border-dim);
          border-radius: 4px;
          color: var(--accent-secondary);
          font-family: "JetBrains Mono", monospace;
          font-size: 14px;
          padding: 4px;
          text-align: center;
        }
        .card-row-qty input:focus {
          outline: none;
          border-color: var(--accent-secondary);
        }
        .icon-btn {
          background: none;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          padding: 4px;
          font-size: 16px;
          transition: color 0.15s;
        }
        .icon-btn:hover {
          color: var(--accent-danger);
        }

        /* ─── STATS BAR ─── */
        .stats-bar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 16px 24px;
          background: rgba(0, 0, 0, 0.3);
          border-top: 1px solid var(--border-dim);
          flex-wrap: wrap;
          gap: 16px;
        }
        .stats-row {
          display: flex;
          gap: 24px;
          flex-wrap: wrap;
        }
        .stat-item {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .stat-label {
          font-family: "JetBrains Mono", monospace;
          font-size: 10px;
          color: var(--text-muted);
          letter-spacing: 2px;
          text-transform: uppercase;
        }
        .stat-value {
          font-family: "Orbitron", sans-serif;
          font-size: 16px;
          font-weight: 700;
          color: var(--accent-secondary);
        }
        .stat-warn {
          color: var(--accent-warn);
        }
        .price-display {
          display: flex;
          align-items: center;
          gap: 16px;
          padding-left: 16px;
          border-left: 1px solid var(--border-dim);
        }
        .price-breakdown {
          font-family: "JetBrains Mono", monospace;
          font-size: 12px;
          color: var(--text-muted);
        }
        .price-total {
          font-family: "Orbitron", sans-serif;
          font-size: 22px;
          font-weight: 900;
          background: var(--gradient-cyber);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          filter: drop-shadow(0 0 10px rgba(6, 255, 165, 0.3));
        }

        /* ─── EMPTY STATE ─── */
        .empty-state {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 80px 40px;
          text-align: center;
        }
        .empty-icon {
          font-size: 64px;
          margin-bottom: 20px;
          opacity: 0.3;
        }
        .empty-title {
          font-family: "Orbitron", sans-serif;
          font-size: 18px;
          font-weight: 600;
          color: var(--text-secondary);
          margin-bottom: 8px;
        }
        .empty-desc {
          font-size: 14px;
          color: var(--text-muted);
          max-width: 400px;
        }

        /* ─── MODAL ─── */
        .modal-overlay {
          position: fixed;
          inset: 0;
          background: rgba(6, 6, 14, 0.85);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 100;
          backdrop-filter: blur(4px);
        }
        .modal {
          background: var(--bg-panel);
          border: 1px solid var(--border-dim);
          border-radius: 12px;
          padding: 30px;
          width: 400px;
          max-width: 90%;
        }
        .modal-title {
          font-family: "Orbitron", sans-serif;
          font-size: 16px;
          font-weight: 700;
          margin-bottom: 20px;
          letter-spacing: 1px;
        }
        .modal-input {
          width: 100%;
          background: var(--bg-input);
          border: 1px solid var(--border-dim);
          border-radius: 8px;
          color: var(--text-primary);
          font-family: "Rajdhani", sans-serif;
          font-size: 16px;
          font-weight: 600;
          padding: 12px 16px;
          margin-bottom: 20px;
        }
        .modal-input:focus {
          outline: none;
          border-color: var(--accent-primary);
        }
        .modal-actions {
          display: flex;
          gap: 10px;
          justify-content: flex-end;
        }

        /* ─── PROGRESS ─── */
        .progress-overlay {
          position: fixed;
          inset: 0;
          background: rgba(6, 6, 14, 0.9);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 100;
          backdrop-filter: blur(8px);
        }
        .progress-card {
          background: var(--bg-panel);
          border: 1px solid var(--border-dim);
          border-radius: 16px;
          padding: 40px 50px;
          text-align: center;
          max-width: 500px;
          width: 90%;
          box-shadow: var(--glow-purple);
        }
        .progress-title {
          font-family: "Orbitron", sans-serif;
          font-size: 20px;
          font-weight: 700;
          margin-bottom: 24px;
          letter-spacing: 2px;
        }
        .progress-bar-track {
          width: 100%;
          height: 6px;
          background: var(--bg-card);
          border-radius: 3px;
          overflow: hidden;
          margin-bottom: 16px;
        }
        .progress-bar-fill {
          height: 100%;
          background: var(--gradient-cyber);
          border-radius: 3px;
          transition: width 0.3s ease;
          box-shadow: var(--glow-green);
        }
        .progress-text {
          font-family: "JetBrains Mono", monospace;
          font-size: 13px;
          color: var(--text-secondary);
        }
        .progress-current {
          margin-top: 12px;
          font-size: 14px;
          color: var(--text-muted);
        }

        /* ─── TOAST ─── */
        .toast {
          position: fixed;
          bottom: 30px;
          right: 30px;
          background: var(--bg-panel);
          border: 1px solid var(--accent-secondary);
          border-radius: 8px;
          padding: 14px 20px;
          font-family: "Rajdhani", sans-serif;
          font-weight: 600;
          color: var(--accent-secondary);
          box-shadow: var(--glow-green);
          z-index: 200;
          animation: toastIn 0.3s ease;
        }
        .toast.error {
          border-color: var(--accent-danger);
          color: var(--accent-danger);
          box-shadow: 0 0 20px rgba(255, 56, 96, 0.3);
        }
        @keyframes toastIn {
          from {
            opacity: 0;
            transform: translateY(20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </div>
  );
}
