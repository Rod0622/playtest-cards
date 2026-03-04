import { NextResponse } from "next/server";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const fileId = searchParams.get("id");

  if (!fileId) {
    return NextResponse.json({ error: "Missing file ID" }, { status: 400 });
  }

  try {
    // First try the direct download URL
    let downloadUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;
    let resp = await fetch(downloadUrl, { redirect: "follow" });

    // If we get an HTML page (virus scan warning for large files), try to extract confirm token
    const contentType = resp.headers.get("content-type") || "";
    if (contentType.includes("text/html")) {
      const html = await resp.text();
      // Look for the confirm download link
      const confirmMatch = html.match(/confirm=([0-9A-Za-z_-]+)/);
      if (confirmMatch) {
        downloadUrl = `https://drive.google.com/uc?export=download&confirm=${confirmMatch[1]}&id=${fileId}`;
        resp = await fetch(downloadUrl, { redirect: "follow" });
      } else {
        // Try the direct download with confirm=t (works for most files)
        downloadUrl = `https://drive.google.com/uc?export=download&confirm=t&id=${fileId}`;
        resp = await fetch(downloadUrl, { redirect: "follow" });
      }
    }

    if (!resp.ok) {
      return NextResponse.json(
        { error: "Failed to download from Google Drive" },
        { status: resp.status }
      );
    }

    const blob = await resp.blob();

    // Determine content type
    const type = resp.headers.get("content-type") || "image/png";

    return new NextResponse(blob, {
      status: 200,
      headers: {
        "Content-Type": type,
        "Content-Disposition": `attachment; filename="gdrive_${fileId}.png"`,
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (err) {
    console.error("Google Drive proxy error:", err);
    return NextResponse.json(
      { error: "Proxy download failed" },
      { status: 500 }
    );
  }
}
