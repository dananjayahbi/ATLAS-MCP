import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiGet, apiPost, withQuery } from "@/lib/api/client";
import { parseRetryAfter } from "@/lib/api/decode";

const ENVELOPE = {
  error: {
    code: "STALE_LEASE",
    message: "lease_id does not match the live lease",
    retryable: false,
    detail: { task_id: "5f2d" },
    request_id: "req_1",
  },
};

function mockFetch(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as never);
}

describe("api client", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_ATLAS_MOCK", "0");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("builds query strings, skipping null/undefined", () => {
    expect(withQuery("/tasks", { a: 1, b: null, c: undefined, d: true })).toBe("/tasks?a=1&d=true");
    expect(withQuery("/tasks", {})).toBe("/tasks");
  });

  it("prefixes the v1 base path", async () => {
    const spy = mockFetch(200, { items: [] });
    vi.stubGlobal("fetch", spy);
    await apiGet("/projects/");
    expect(spy.mock.calls[0][0]).toBe("/api/v1/projects/");
  });

  it("returns the parsed body on success", async () => {
    vi.stubGlobal("fetch", mockFetch(200, { items: [1, 2] }));
    await expect(apiGet<{ items: number[] }>("/x")).resolves.toEqual({ items: [1, 2] });
  });

  it("maps the error envelope onto ApiError", async () => {
    vi.stubGlobal("fetch", mockFetch(409, ENVELOPE));
    await expect(apiGet("/x")).rejects.toBeInstanceOf(ApiError);
    await apiGet("/x").catch((err: ApiError) => {
      expect(err.code).toBe("STALE_LEASE");
      expect(err.status).toBe(409);
      expect(err.retryable).toBe(false);
      expect(err.requestId).toBe("req_1");
      expect(err.detail).toEqual({ task_id: "5f2d" });
    });
  });

  it("treats 401 as an auth error with the server code preserved", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(401, { error: { ...ENVELOPE.error, code: "AUTH_INVALID" } }),
    );
    await apiGet("/x").catch((err: ApiError) => {
      expect(err.code).toBe("AUTH_INVALID");
      expect(err.status).toBe(401);
    });
  });

  it("flags 507 as a storage failure the UI can surface", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(507, { error: { ...ENVELOPE.error, code: "STORAGE_WRITE_FAILED" } }),
    );
    await apiGet("/x").catch((err: ApiError) => {
      expect(err.code).toBe("STORAGE_WRITE_FAILED");
      expect(err.status).toBe(507);
    });
  });

  it("posts JSON with the right content type", async () => {
    const spy = mockFetch(201, { ok: true });
    vi.stubGlobal("fetch", spy);
    await apiPost("/x", { priority: 42 });
    const init = spy.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ priority: 42 }));
    expect(new Headers(init.headers).get("content-type")).toContain("application/json");
    expect(new Headers(init.headers).get("accept")).toContain("application/json");
  });

  it("sends `{}` for a bodyless POST, which the API accepts (Doc 01 §8, T8)", async () => {
    const spy = mockFetch(200, { ok: true });
    vi.stubGlobal("fetch", spy);
    await apiPost("/reviews/abc/approve/");
    const init = spy.mock.calls[0][1] as RequestInit;
    expect(init.body).toBe("{}");
  });

  describe("throttling (Doc 04 §3.4, Doc 06 §11.4)", () => {
    const rateLimited = (retryAfter: string | null) =>
      vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        headers: new Headers({
          "content-type": "application/json",
          ...(retryAfter === null ? {} : { "retry-after": retryAfter }),
        }),
        text: async () =>
          JSON.stringify({
            error: {
              code: "RATE_LIMITED",
              message: "Too many requests; retry shortly.",
              retryable: true,
              detail: { limit: 600, window_seconds: 60 },
              request_id: "req_429",
            },
          }),
      } as never);

    it("retries a throttled request exactly once", async () => {
      const spy = rateLimited("0");
      vi.stubGlobal("fetch", spy);
      // `retry-after: 0` keeps the test instantaneous.
      await apiGet("/x").catch(() => undefined);
      expect(spy).toHaveBeenCalledTimes(2);
    });

    it("exposes Retry-After as retryAfterMs on the error", async () => {
      vi.stubGlobal("fetch", rateLimited("0"));
      await apiPost("/x", {}).catch((err: ApiError) => {
        expect(err.code).toBe("RATE_LIMITED");
        expect(err.status).toBe(429);
        expect(err.retryAfterMs).toBe(0);
      });
    });

    it("parses Retry-After as delta-seconds and as an HTTP-date", () => {
      expect(parseRetryAfter("7")).toBe(7000);
      expect(parseRetryAfter("0")).toBe(0);
      expect(parseRetryAfter(null)).toBeNull();
      expect(parseRetryAfter("not-a-date")).toBeNull();
      const future = new Date(Date.now() + 5000).toUTCString();
      // Whole-second HTTP-date rounding leaves a small tolerance.
      expect(parseRetryAfter(future)).toBeGreaterThan(3000);
    });

    it("does not retry a throttled mutation more than once", async () => {
      const spy = rateLimited("0");
      vi.stubGlobal("fetch", spy);
      await apiPost("/x", {}).catch(() => undefined);
      expect(spy).toHaveBeenCalledTimes(2);
    });

    it("classifies a bare 429 with no envelope as RATE_LIMITED", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: false,
          status: 429,
          statusText: "Too Many Requests",
          headers: new Headers(),
          text: async () => "",
        } as never),
      );
      await apiGet("/x").catch((err: ApiError) => {
        expect(err.code).toBe("RATE_LIMITED");
        expect(err.retryAfterMs).toBeNull();
      });
    });
  });
});
