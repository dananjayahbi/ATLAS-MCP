import type { NextRequest } from "next/server";

/**
 * Server-side proxy for `/api/v1/*` (Doc 01 §12, §14.2).
 *
 * The browser calls this same-origin path; the bearer token is attached here,
 * so it never reaches client JavaScript. A Route Handler is used instead of a
 * `rewrite()` because rewrites cannot set request headers, and because SSE
 * bodies must be piped through unbuffered.
 */

const BACKEND = process.env.ATLAS_BACKEND_URL ?? "http://127.0.0.1:8471";
const TOKEN = process.env.ATLAS_API_TOKEN ?? "";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Never forwarded verbatim in either direction. */
const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length",
]);

function forwardRequestHeaders(request: NextRequest): Headers {
  const headers = new Headers();
  request.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (!HOP_BY_HOP.has(lower) && lower !== "authorization" && lower !== "cookie") {
      headers.set(key, value);
    }
  });
  headers.set("Authorization", `Bearer ${TOKEN}`);
  return headers;
}

function backendUnavailable(): Response {
  return Response.json(
    {
      error: {
        code: "BACKEND_UNAVAILABLE",
        message: "Django backend unreachable.",
        retryable: true,
        detail: { url: BACKEND },
        request_id: null,
      },
    },
    { status: 502 },
  );
}

async function proxy(request: NextRequest, path: string[]): Promise<Response> {
  const target = `${BACKEND}/api/v1/${path.map(encodeURIComponent).join("/")}${request.nextUrl.search}`;

  const mayHaveBody = request.method !== "GET" && request.method !== "HEAD";
  let body: ArrayBuffer | undefined;
  if (mayHaveBody) {
    const buffer = await request.arrayBuffer();
    body = buffer.byteLength > 0 ? buffer : undefined;
  }

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: request.method,
      headers: forwardRequestHeaders(request),
      body,
      cache: "no-store",
      redirect: "manual",
    });
  } catch {
    return backendUnavailable();
  }

  const headers = new Headers();
  upstream.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase())) headers.set(key, value);
  });
  if (upstream.headers.get("content-type")?.includes("text/event-stream")) {
    headers.set("Cache-Control", "no-cache, no-transform");
    headers.set("X-Accel-Buffering", "no");
  }

  return new Response(upstream.body, { status: upstream.status, headers });
}

type RouteContext = { params: Promise<{ path: string[] }> };

async function handle(request: NextRequest, context: RouteContext): Promise<Response> {
  const { path } = await context.params;
  return proxy(request, path);
}

export async function GET(request: NextRequest, context: RouteContext) {
  return handle(request, context);
}

export async function POST(request: NextRequest, context: RouteContext) {
  return handle(request, context);
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  return handle(request, context);
}

export async function PUT(request: NextRequest, context: RouteContext) {
  return handle(request, context);
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  return handle(request, context);
}
