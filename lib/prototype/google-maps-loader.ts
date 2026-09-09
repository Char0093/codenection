// Promise-cached loader for the Google Maps JavaScript API. Used only by the prototype route
// map (features/prototype/map/) and only when a maps key is configured.

declare global {
  interface Window {
    google?: { maps?: { Map?: unknown } };
    __wpMapsLoading?: Promise<void>;
    __wpMapsInit?: () => void;
  }
}

// `NEXT_PUBLIC_GOOGLE_MAPS_KEY` is the name; `_EMBED_KEY` is accepted as a legacy alias from
// when this used the Embed API. Both are static member accesses so Next inlines them client-side.
export const MAPS_KEY =
  process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_EMBED_KEY;

/**
 * Loads maps/api/js once (subsequent calls return the same promise). Resolves only after the
 * `maps` + `routes` libraries are ready (via the loader `callback`), so `google.maps.Map` and
 * `google.maps.DirectionsService` are safe to `new` immediately after.
 */
export function loadGoogleMaps(): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new Error("google maps: browser only"));
  if (window.google?.maps?.Map) return Promise.resolve();
  if (window.__wpMapsLoading) return window.__wpMapsLoading;
  if (!MAPS_KEY) return Promise.reject(new Error("google maps: NEXT_PUBLIC_GOOGLE_MAPS_KEY not set"));

  window.__wpMapsLoading = new Promise<void>((resolve, reject) => {
    window.__wpMapsInit = () => resolve();
    const script = document.createElement("script");
    const params = new URLSearchParams({
      key: MAPS_KEY, v: "weekly", loading: "async", libraries: "maps,routes", callback: "__wpMapsInit",
    });
    script.src = `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
    script.async = true;
    script.onerror = () => reject(new Error("google maps: script failed to load (check the API key and referrer restrictions)"));
    document.head.appendChild(script);
  });
  return window.__wpMapsLoading;
}
