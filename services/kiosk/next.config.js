/** @type {import('next').NextConfig} */
const nextConfig = {
  // ✅ Standard Vercel deployment — no output config needed.
  // DO NOT add `output: "standalone"` — it breaks Vercel's serverless infrastructure.
  // The PWA service worker handles offline caching.
};

module.exports = nextConfig;
