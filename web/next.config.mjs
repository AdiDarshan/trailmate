import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Pin the workspace root: a stray lockfile in $HOME otherwise confuses
  // Next's file tracing (matters for the Vercel build).
  outputFileTracingRoot: __dirname,
  // Allow remote tiuli trail-map images to render in the notebook.
  images: {
    remotePatterns: [{ protocol: "https", hostname: "www.tiuli.com" }],
  },
};

export default nextConfig;
