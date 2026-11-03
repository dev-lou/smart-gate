const path = require("path");

/** @type {import('next').NextConfig} */
const nextConfig = {
  // ✅ Standard Vercel deployment — no output config needed.
  // DO NOT add `output: "standalone"` — it breaks Vercel's serverless infrastructure.
  // The PWA service worker handles offline caching.
  devIndicators: false,
  // Dev resources (HMR, client chunks) must be allowed for the loopback origin,
  // otherwise the kiosk serves HTML that never hydrates — dead buttons on screen.
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  // A stray package-lock.json in the user's home folder makes Turbopack infer
  // C:\Users\<user> as the workspace root, which stalls kiosk compiles.
  turbopack: { root: path.resolve(__dirname, "../..") },
};

module.exports = nextConfig;
