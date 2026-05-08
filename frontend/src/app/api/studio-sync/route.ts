import { NextResponse } from "next/server";

const backendUrl = process.env.HF_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8000";
const hfToken = process.env.HF_TOKEN;

async function proxyStudioSync(method: "GET" | "PUT", request?: Request) {
  try {
    const response = await fetch(`${backendUrl}/api/studio-sync`, {
      method,
      headers: {
        ...(method === "PUT" ? { "content-type": "application/json" } : {}),
        ...(hfToken ? { Authorization: `Bearer ${hfToken}` } : {})
      },
      body: method === "PUT" ? await request?.text() : undefined,
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
    return NextResponse.json({ error: "Studio sync backend unavailable" }, { status: 502 });
  }
}

export async function GET() {
  return proxyStudioSync("GET");
}

export async function PUT(request: Request) {
  return proxyStudioSync("PUT", request);
}
