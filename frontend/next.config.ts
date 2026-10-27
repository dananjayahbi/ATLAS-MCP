import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // No `rewrites()` here on purpose: a rewrite cannot attach the bearer token,
  // and the token must be injected server-side (Doc 01 §14.2). The proxy lives
  // in `app/api/v1/[...path]/route.ts`, which also streams SSE unbuffered.
  poweredByHeader: false,
  // Django's routes all end in `/` and it cannot APPEND_SLASH a POST, so Next
  // must not strip the trailing slash before the proxy handler sees it.
  // Without this every POST/PATCH through /api/v1 answers 308 then 500.
  skipTrailingSlashRedirect: true,
  // `next dev` is reached over 127.0.0.1 by Playwright, which Next would
  // otherwise flag as a cross-origin request for /_next/* assets.
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  experimental: {
    // SSE connections outlive the default proxy window.
    proxyTimeout: 0,
  },
};

export default nextConfig;
