"use client";

import { useEffect } from "react";

/** Registers the service worker that keeps the technician app's shell and assets available offline. */
export function SwRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined);
  }, []);
  return null;
}
