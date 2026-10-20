import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Hosts `next dev` accepts requests from. The camera needs a secure context, so
  // testing on a phone means opening the HTTPS dev server from a non-localhost
  // origin. Add those origins with an env var rather than editing this list:
  //   DEV_ALLOWED_ORIGINS=192.168.1.20,100.102.76.17 pnpm dev:https
  allowedDevOrigins: [
    "localhost",
    "127.0.0.1",
    ...(process.env.DEV_ALLOWED_ORIGINS ?? "100.102.76.17")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  ],
  turbopack: {
    resolveAlias: {
      // OpenCV.js (Emscripten) asks for Node native modules that don't exist in
      // the browser. Point the browser bundle at a no-op module; those Node-only
      // code paths are never reached on the client.
      fs: { browser: "./lib/empty.ts" },
      path: { browser: "./lib/empty.ts" },
      crypto: { browser: "./lib/empty.ts" },
    },
  },
};

export default nextConfig;
