import type { NextConfig } from "next";

const securityHeaders = [
  // Prevent the app from being embedded in iframes (clickjacking)
  { key: "X-Frame-Options", value: "DENY" },
  // Stop browsers from MIME-sniffing responses away from the declared content-type
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Enforce HTTPS for 1 year — include subdomains
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains; preload" },
  // Don't send Referer header to third parties
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Restrict browser features
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  // Content-Security-Policy
  // - Scripts: only same origin + inline (required for Next.js hydration)
  // - Connect: allow Binance/CoinGecko for price fetches (server-side, not needed for browser)
  //   but Loop SDK needs wss:// and https:// to its endpoints
  // - Frame-ancestors: DENY equivalent via CSP (belt-and-suspenders with X-Frame-Options)
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'", // unsafe-eval needed by some Next.js internals in dev
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: blob:",
      // Loop SDK connects to cantonloop.com (devnet + mainnet), loop.cash, and fivenorth.io
      // cantonloop.com: both bare domain (mainnet) and subdomains (devnet uses devnet.cantonloop.com)
      // Binance WebSocket: direct browser connection for live BTC/USD price feed
      "connect-src 'self' https://cantonloop.com wss://cantonloop.com https://*.cantonloop.com wss://*.cantonloop.com https://*.loop.cash wss://*.loop.cash https://*.fivenorth.io wss://*.fivenorth.io wss://stream.binance.com",
      "frame-ancestors 'none'",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  transpilePackages: ["@fivenorth/loop-sdk"],
  headers: async () => [
    {
      source: "/(.*)",
      headers: securityHeaders,
    },
  ],
};

export default nextConfig;
