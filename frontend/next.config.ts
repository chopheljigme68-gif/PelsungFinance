import type { NextConfig } from "next";

/**
 * The browser always talks to the app's own origin. Next.js proxies every
 * `/api/*` request to the backend server-side (below), so the session cookie is
 * set and sent first-party — it needs no `SameSite=None`, and no browser (Safari
 * included) treats it as a blocked third-party cookie. The proxy target is the
 * backend URL; keep `NEXT_PUBLIC_API_URL` pointed at it.
 */
const BACKEND_ORIGIN = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000").replace(/\/+$/, "");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  eslint: { ignoreDuringBuilds: false },
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${BACKEND_ORIGIN}/api/:path*` }];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
        ],
      },
    ];
  },
};

export default nextConfig;
