import type { NextConfig } from "next";

const BACKEND = process.env.ATLAS_BACKEND_URL ?? "http://127.0.0.1:8000";
const TOKEN = process.env.ATLAS_API_TOKEN ?? "dev-token";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The browser never sees ATLAS_API_TOKEN: the rewrite injects it server-side.
  async rewrites() {
    return [
      {
        source: "/api/v1/:path*",
        destination: `${BACKEND}/api/v1/:path*`,
        headers: [{ key: "Authorization", value: `Bearer ${TOKEN}` }],
      },
    ];
  },
  experimental: {
    proxyTimeout: 0,
  },
};

export default nextConfig;
