"use client";
// Registers the offline-caching service worker. Kept in a tiny client component
// so it only runs in the browser and never affects server rendering.
import * as React from "react";

export function PwaRegister() {
  React.useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    // Dev builds recompile on every save, and a cache-first worker then serves
    // stale chunks against fresh HTML. Offline support is a production feature.
    if (process.env.NODE_ENV !== "production") return;

    // Served from /public/sw.js. The previous `new URL("../lib/service-worker.js",
    // import.meta.url)` resolved to a hashed asset under /_next/static/, whose
    // directory is the maximum scope a worker may claim — so the requested
    // scope "/" was rejected and the app never actually worked offline.
    navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .catch(() => {
        // Non-fatal: the app still works online without a service worker.
      });
  }, []);
  return null;
}
