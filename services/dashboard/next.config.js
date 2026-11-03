const path = require("path");

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Vercel deployment — no output config needed
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  // Keep Turbopack scoped to this repo, not the user's home folder.
  turbopack: { root: path.resolve(__dirname, "../..") },
};

module.exports = nextConfig;
