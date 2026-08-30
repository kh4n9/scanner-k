"use client";
// Registers the offline-caching service worker. Kept in a tiny client component
// so it only runs in the browser and never affects server rendering.
import * as React from "react";

export function PwaRegister() {
  React.useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .register(new URL("../lib/service-worker.js", import.meta.url), {
          scope: "/",
          updateViaCache: "none",
        })
        .catch(() => {
          // Non-fatal: the app still works online without a service worker.
        });
    }
  }, []);
  return null;
}
