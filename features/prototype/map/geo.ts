export type LatLng = { lat: number; lng: number };

/**
 * How far `target` sits from where you are currently facing, normalised to (-180, 180].
 * 0 = dead ahead, +90 = hard right, ±180 = directly behind. Used to keep the Street View
 * direction arrow pointing at the next stop while the panorama is rotated.
 */
export function relativeBearing(target: number, heading: number): number {
  return ((((target - heading) % 360) + 540) % 360) - 180;
}

/** Initial compass bearing from `a` to `b`, degrees clockwise from north. */
export function bearing(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const φ1 = toRad(a.lat), φ2 = toRad(b.lat), Δλ = toRad(b.lng - a.lng);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

/** Great-circle distance in metres. Small distances here, so precision is ample. */
export function distanceMetres(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6_371_000;
  const dφ = toRad(b.lat - a.lat), dλ = toRad(b.lng - a.lng);
  const φ1 = toRad(a.lat), φ2 = toRad(b.lat);
  const h = Math.sin(dφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * The direction you physically set off in along a path, rather than the straight line to its
 * end. Walks the polyline until `minMetres` from the start so a short jink at the kerb doesn't
 * dominate, then takes the bearing to that point. Falls back to the last point available.
 */
export function initialHeading(path: readonly LatLng[], minMetres = 20): number | null {
  if (path.length < 2) return null;
  const start = path[0];
  let target = path[path.length - 1];
  for (let i = 1; i < path.length; i += 1) {
    target = path[i];
    if (distanceMetres(start, path[i]) >= minMetres) break;
  }
  return distanceMetres(start, target) < 1 ? null : bearing(start, target);
}

/** Index of the polyline vertex closest to `p` — i.e. roughly how far along the route you are. */
export function nearestPointIndex(path: readonly LatLng[], p: LatLng): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < path.length; i += 1) {
    const d = distanceMetres(path[i], p);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

/** Metres still to walk from `p` to the end of the path, following the route rather than the
 *  straight line — so it actually goes down as you move along the street. */
export function remainingDistance(path: readonly LatLng[], p: LatLng): number {
  if (path.length === 0) return 0;
  const from = nearestPointIndex(path, p);
  const last = path.length - 1;
  if (from >= last) return distanceMetres(p, path[last]);
  let total = distanceMetres(p, path[from + 1]);
  for (let i = from + 1; i < last; i += 1) total += distanceMetres(path[i], path[i + 1]);
  return total;
}

/** Total length of a polyline in metres. */
export function pathLength(path: readonly LatLng[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i += 1) total += distanceMetres(path[i - 1], path[i]);
  return total;
}

/**
 * The point `metres` along `path` from its start, linearly interpolated between the two
 * vertices it falls between. Clamps to the first/last vertex outside that range — used to
 * animate a "you are here" dot walking the route during simulated navigation.
 */
export function pointAtDistance(path: readonly LatLng[], metres: number): LatLng | null {
  if (path.length === 0) return null;
  if (path.length === 1 || metres <= 0) return path[0];
  let remaining = metres;
  for (let i = 1; i < path.length; i += 1) {
    const seg = distanceMetres(path[i - 1], path[i]);
    if (remaining <= seg) {
      const t = seg === 0 ? 0 : remaining / seg;
      return { lat: path[i - 1].lat + (path[i].lat - path[i - 1].lat) * t, lng: path[i - 1].lng + (path[i].lng - path[i - 1].lng) * t };
    }
    remaining -= seg;
  }
  return path[path.length - 1];
}

/**
 * Where to point from your *current* position: a point `lookAhead` metres further along the
 * route, so the arrow follows the street instead of aiming through whatever is between you and
 * the destination. Returns null when the path is unusable.
 */
export function headingAlongPath(path: readonly LatLng[], p: LatLng, lookAhead = 25): number | null {
  if (path.length < 2) return null;
  const from = nearestPointIndex(path, p);
  let travelled = 0;
  for (let i = from + 1; i < path.length; i += 1) {
    travelled += distanceMetres(path[i - 1], path[i]);
    if (travelled >= lookAhead) {
      return distanceMetres(p, path[i]) < 1 ? null : bearing(p, path[i]);
    }
  }
  const end = path[path.length - 1];
  return distanceMetres(p, end) < 1 ? null : bearing(p, end);
}
