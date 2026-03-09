import { NextResponse } from "next/server";
import { promisify } from "util";
import dns from "dns";

export const runtime = "nodejs";

const lookup = promisify(dns.lookup);

function isPrivateIp(ip) {
  if (!ip) return true;
  // IPv4 only for now
  if (ip === "127.0.0.1") return true;
  if (ip.startsWith("10.")) return true;
  if (ip.startsWith("192.168.")) return true;
  if (ip.startsWith("169.254.")) return true;
  const m = ip.match(/^172\.(\d+)\./);
  if (m) {
    const n = Number(m[1]);
    if (n >= 16 && n <= 31) return true;
  }
  return false;
}

async function assertSafeUrl(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    throw new Error("Invalid url");
  }

  if (!/^https?:$/.test(u.protocol)) {
    throw new Error("Only http/https allowed");
  }

  const host = u.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local")) {
    throw new Error("Blocked host");
  }

  // Resolve and block private IPs
  try {
    const r = await lookup(host);
    if (r?.address && isPrivateIp(r.address)) {
      throw new Error("Blocked private IP");
    }
  } catch {
    // If DNS fails, we block (safer default).
    throw new Error("Unable to resolve host");
  }

  return u;
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const rawUrl = searchParams.get("url");
    if (!rawUrl) {
      return NextResponse.json({ error: "Missing url" }, { status: 400 });
    }

    const url = await assertSafeUrl(rawUrl);

    const resp = await fetch(url.toString(), {
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; PlaytestForgeImageProxy/1.0)",
        Accept: "image/*,*/*;q=0.8",
      },
    });

    if (!resp.ok) {
      return NextResponse.json(
        { error: `Upstream error ${resp.status}` },
        { status: resp.status }
      );
    }

    const contentType = resp.headers.get("content-type") || "application/octet-stream";

    // Soft guard: only allow images
    if (!contentType.startsWith("image/")) {
      return NextResponse.json(
        { error: "Upstream is not an image" },
        { status: 415 }
      );
    }

    const buf = Buffer.from(await resp.arrayBuffer());

    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e?.message || String(e) },
      { status: 400 }
    );
  }
}
