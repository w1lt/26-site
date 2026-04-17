import { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get("url");
  if (!url || !url.startsWith("https://")) {
    return new Response("Invalid URL", { status: 400 });
  }
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error("Failed to fetch");
    const buffer = await res.arrayBuffer();
    const contentType = res.headers.get("content-type") || "image/jpeg";
    return new Response(buffer, {
      headers: { "Content-Type": contentType },
    });
  } catch {
    return new Response("Failed to fetch image", { status: 502 });
  }
}
