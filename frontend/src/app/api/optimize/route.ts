import { NextResponse } from "next/server";

const backendUrl = process.env.HF_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8000";
const hfToken = process.env.HF_TOKEN;

export async function POST(request: Request) {
  try {
    const response = await fetch(`${backendUrl}/api/optimize`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(hfToken ? { Authorization: `Bearer ${hfToken}` } : {})
      },
      body: await request.text(),
      cache: "no-store"
    });
    const body = await response.text();

    return new NextResponse(body, {
      status: response.status,
      headers: {
        "content-type": response.headers.get("content-type") ?? "application/json"
      }
    });
  } catch {
    return NextResponse.json({ error: "Optimizer backend unavailable" }, { status: 502 });
  }
}
