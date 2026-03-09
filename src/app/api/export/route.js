import { NextResponse } from "next/server";
import { createAnonSupabase } from "@/lib/supabase/server";
import * as XLSX from "xlsx";
import PDFDocument from "pdfkit";

export const runtime = "nodejs";

function toCsv(rows) {
  const escape = (v) => {
    if (v == null) return "";
    const s = String(v);
    if (/[\n\r,\"]/g.test(s)) return `"${s.replace(/\"/g, '""')}"`;
    return s;
  };

  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const out = [headers.join(",")];
  for (const r of rows) {
    out.push(headers.map((h) => escape(r[h])).join(","));
  }
  return out.join("\n");
}

function flatten(cards) {
  const rows = [];
  for (const c of cards || []) {
    const listings = c.listings || [];
    if (!listings.length) {
      rows.push({
        card_name: c.name,
        set_code: c.set_code,
        collector_number: c.collector_number,
        store: "",
        price: "",
        currency: "",
        condition: "",
        language: "",
        in_stock: "",
        stock_qty: "",
        product_url: "",
      });
      continue;
    }

    for (const l of listings) {
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
}

async function queryData({ q, limit }) {
  const supabase = createAnonSupabase();
  let query = supabase
    .from("cards")
    .select(
      "id,name,set_code,collector_number, listings(id,price,currency,condition,language,product_url,in_stock,stock_qty, stores(slug,name))"
    );

  if (q) {
    const pattern = `%${q.replace(/%/g, "\\%")}%`;
    query = query.or(
      `name.ilike.${pattern},set_code.ilike.${pattern},collector_number.ilike.${pattern}`
    );
  }

  const { data, error } = await query.order("name", { ascending: true }).limit(limit);
  if (error) throw error;
  return data || [];
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const format = (searchParams.get("format") || "csv").toLowerCase();
    const q = (searchParams.get("q") || "").trim();
    const limit = Math.min(5000, Math.max(1, Number(searchParams.get("limit") || 2000)));

    const cards = await queryData({ q, limit });
    const rows = flatten(cards);

    const ts = new Date().toISOString().replace(/[:.]/g, "-");

    if (format === "csv") {
      const csv = toCsv(rows);
      return new NextResponse(csv, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="mtg_prices_${ts}.csv"`,
        },
      });
    }

    if (format === "xlsx") {
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Prices");
      const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
      return new NextResponse(buf, {
        status: 200,
        headers: {
          "Content-Type":
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="mtg_prices_${ts}.xlsx"`,
        },
      });
    }

    if (format === "pdf") {
      const doc = new PDFDocument({ size: "A4", margin: 36 });
      const chunks = [];
      doc.on("data", (c) => chunks.push(c));

      doc.fontSize(16).text("MTG Price Database Export", { align: "left" });
      doc.moveDown(0.5);
      doc.fontSize(10).fillColor("gray").text(`Generated: ${new Date().toISOString()}`);
      if (q) doc.text(`Filter: ${q}`);
      doc.moveDown();
      doc.fillColor("black");

      // Simple row dump (kept basic for reliability)
      doc.fontSize(9);
      const maxRows = Math.min(rows.length, 800); // prevent huge PDFs
      for (let i = 0; i < maxRows; i++) {
        const r = rows[i];
        doc.text(
          `${r.card_name} [${r.set_code || ""} ${r.collector_number || ""}] | ${r.store} | ${r.currency} ${r.price} | ${r.condition || ""} ${r.language ? `(${r.language})` : ""}`
        );
      }
      if (rows.length > maxRows) {
        doc.moveDown();
        doc.fillColor("gray").text(`(Truncated: ${rows.length - maxRows} more rows)`);
      }

      doc.end();

      const buf = await new Promise((resolve) => {
        doc.on("end", () => resolve(Buffer.concat(chunks)));
      });

      return new NextResponse(buf, {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="mtg_prices_${ts}.pdf"`,
        },
      });
    }

    return NextResponse.json(
      { ok: false, error: "Unsupported format. Use csv|xlsx|pdf" },
      { status: 400 }
    );
  } catch (e) {
    console.error("/api/export error", e);
    return NextResponse.json(
      { ok: false, error: e?.message || String(e) },
      { status: 500 }
    );
  }
}
