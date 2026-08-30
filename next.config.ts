import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["100.102.76.17", "localhost", "127.0.0.1"],
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
