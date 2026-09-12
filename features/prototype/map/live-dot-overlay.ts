"use client";

import type { LatLng } from "./geo";

/* Minimal shape of the google.maps.OverlayView surface this file touches. */
type GLatLng = { lat: () => number; lng: () => number };
type Projection = {
  fromLatLngToDivPixel: (l: GLatLng) => { x: number; y: number } | null;
  fromDivPixelToLatLng: (p: { x: number; y: number }) => GLatLng | null;
};
type OverlayInstance = {
  setMap: (m: unknown) => void;
  getPanes: () => { overlayLayer: HTMLElement } | null;
  getProjection: () => Projection | null;
  draw?(): void;
};
type GMaps = {
  maps: {
    OverlayView: { new (): OverlayInstance };
    LatLng: new (lat: number, lng: number) => GLatLng;
  };
};

export type LiveDotOverlay = {
  setPosition: (p: LatLng | null) => void;
  setHeading: (deg: number | null) => void;
  /** `latlng` shifted by (dx, dy) screen pixels — e.g. to find the map centre that puts a point
   *  `liftPx` above the div's true centre. Null until the overlay's projection is ready. */
  offset: (latlng: LatLng, dx: number, dy: number) => LatLng | null;
  destroy: () => void;
};

/**
 * A DOM "you are here" marker — pulsing dot + heading cone — placed via OverlayView rather than
 * a google.maps.Marker icon, so it gets full CSS control (pulse keyframes, smooth cone rotation)
 * that a static data-URI icon can't do. Lives in the non-interactive `overlayLayer` pane so it
 * never intercepts drag/click gestures meant for the map underneath.
 */
export function createLiveDotOverlay(map: unknown): LiveDotOverlay | null {
  const g = (window as unknown as { google?: GMaps }).google;
  if (!g?.maps?.OverlayView) return null;
  const maps = g.maps;

  let position: LatLng | null = null;
  let heading: number | null = null;
  let root: HTMLDivElement | null = null;
  let cone: HTMLDivElement | null = null;

  class LiveDot extends maps.OverlayView {
    onAdd() {
      root = document.createElement("div");
      root.className = "live-dot";
      root.setAttribute("aria-hidden", "true");
      root.innerHTML = '<div class="live-dot-cone"></div><div class="live-dot-pulse"></div><div class="live-dot-core"></div>';
      cone = root.querySelector<HTMLDivElement>(".live-dot-cone");
      this.getPanes()?.overlayLayer.appendChild(root);
      this.draw();
    }
    draw() {
      if (!root) return;
      const proj = this.getProjection();
      if (!position || !proj) { root.style.display = "none"; return; }
      const point = proj.fromLatLngToDivPixel(new maps.LatLng(position.lat, position.lng));
      if (!point) { root.style.display = "none"; return; }
      root.style.display = "";
      root.style.transform = `translate(${point.x}px, ${point.y}px)`;
      if (cone) {
        cone.style.opacity = heading === null ? "0" : "1";
        cone.style.transform = `translate(-50%, -50%) rotate(${heading ?? 0}deg)`;
      }
    }
    onRemove() {
      root?.remove();
      root = null;
      cone = null;
    }
  }

  const overlay = new LiveDot();
  overlay.setMap(map);

  return {
    setPosition(p) { position = p; overlay.draw?.(); },
    setHeading(h) { heading = h; overlay.draw?.(); },
    offset(latlng, dx, dy) {
      const proj = overlay.getProjection();
      if (!proj) return null;
      const point = proj.fromLatLngToDivPixel(new maps.LatLng(latlng.lat, latlng.lng));
      if (!point) return null;
      const shifted = proj.fromDivPixelToLatLng({ x: point.x + dx, y: point.y + dy });
      return shifted ? { lat: shifted.lat(), lng: shifted.lng() } : null;
    },
    destroy() { overlay.setMap(null); },
  };
}
