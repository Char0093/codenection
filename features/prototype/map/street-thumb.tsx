"use client";

import React, { useState } from "react";
import { PersonStanding } from "lucide-react";
import { MAPS_KEY } from "@/lib/prototype/google-maps-loader";
import { povHeading } from "./street-view";
import type { DemoMapStop } from "./types";

/**
 * The corner Street View preview, like Google Maps' own. Uses the **Street View Static API**
 * (a separate API to enable on the key); `return_error_code=true` makes Google 404 instead of
 * serving its grey "no imagery" tile, so a missing panorama or a disabled API simply hides the
 * card rather than showing a broken one. Clicking it opens the full panorama.
 */
export function StreetThumb({ stops, onOpen }: { stops: DemoMapStop[]; onOpen: () => void }) {
  const [failed, setFailed] = useState(false);
  const stop = stops[0];
  if (!MAPS_KEY || !stop || failed) return null;

  const params = new URLSearchParams({
    size: "320x224",
    location: `${stop.lat},${stop.lng}`,
    fov: "80",
    heading: String(Math.round(povHeading(stops, 0))),
    pitch: "0",
    return_error_code: "true",
    key: MAPS_KEY,
  });

  return (
    <button type="button" className="map-streetthumb" onClick={onOpen}
      aria-label={`Open street view at ${stop.name}`}>
      {/* A fixed-size third-party thumbnail: next/image would add remotePatterns config and a
          proxy hop for no benefit here. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`https://maps.googleapis.com/maps/api/streetview?${params.toString()}`}
        alt="" loading="lazy" onError={() => setFailed(true)} />
      <span className="map-streetthumb-badge"><PersonStanding aria-hidden="true" />Street view</span>
    </button>
  );
}
