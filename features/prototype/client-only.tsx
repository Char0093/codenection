"use client";

import React, { useEffect, useState } from "react";

/**
 * Renders children only after mount. Some real presentational components the prototype reuses
 * (the chat message list, the proposal card) format timestamps with `toLocaleString`, whose
 * output differs between the Node and browser Intl builds and trips React's hydration check.
 * The demo has no SEO or first-paint need, so skipping SSR for those screens is the cheapest
 * fix and keeps every shared component untouched.
 */
export function ClientOnly({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return <p className="inline-notice" role="status">Loading demo…</p>;
  return <>{children}</>;
}
