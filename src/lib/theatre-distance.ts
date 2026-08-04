/**
 * @fileoverview Great-circle distance, and the theatre list ordered by it
 *
 * Pure. The reader's position is passed in and never stored, so nothing here can leak it:
 * the component holds it in state, no request carries it, and the sort runs against the
 * theatre list the page already has
 */

import type { Theatre } from "@/lib/cineplex/types";

export interface Point {
  latitude: number;
  longitude: number;
}

/**
 * Mean Earth radius, kilometres
 *
 * The IUGG arithmetic mean R1 = (2a + b) / 3 over WGS-84, whose semi-major axis a is
 * 6378.137 km and semi-minor axis b is 6356.752314245 km:
 * (2 x 6378.137 + 6356.752314245) / 3 = 6371.0088 km
 */
export const EARTH_RADIUS_KM = 6371.0088;

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

/**
 * Haversine distance between two points, in kilometres
 *
 * a = sin^2(dLat / 2) + cos(lat1) cos(lat2) sin^2(dLon / 2)
 * c = 2 atan2(sqrt(a), sqrt(1 - a))
 * d = R c
 *
 * `atan2` rather than `asin`, which loses precision over short distances and can be handed
 * a value marginally above 1 by rounding, where its domain rejects it
 *
 * A straight line over the sphere, not a driving distance. It orders a theatre list well and
 * would be wrong to present as a journey
 */
export function haversineKm(from: Point, to: Point): number {
  const deltaLat = toRadians(to.latitude - from.latitude);
  const deltaLon = toRadians(to.longitude - from.longitude);
  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(toRadians(from.latitude)) *
      Math.cos(toRadians(to.latitude)) *
      Math.sin(deltaLon / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** A theatre's distance from the reader, or null when either end has no coordinates */
export function theatreDistanceKm(theatre: Theatre, origin: Point | null): number | null {
  if (!origin || theatre.latitude === null || theatre.longitude === null) return null;
  return haversineKm(origin, { latitude: theatre.latitude, longitude: theatre.longitude });
}

/**
 * Nearest first, with the theatres of unknown position last
 *
 * Copies before sorting, because `Array.prototype.sort` mutates and the list handed in is
 * component state. Returns the input untouched with no origin, so the order upstream chose
 * survives until the reader's position actually arrives
 *
 * Sorting is stable in ES2019 and later, so two theatres the same distance away keep that
 * order, and so do the ones with no coordinates among themselves
 */
export function sortByDistance(theatres: Theatre[], origin: Point | null): Theatre[] {
  if (!origin) return theatres;
  return [...theatres].sort((a, b) => {
    const left = theatreDistanceKm(a, origin);
    const right = theatreDistanceKm(b, origin);
    if (left === null) return right === null ? 0 : 1;
    if (right === null) return -1;
    return left - right;
  });
}

/**
 * A distance a reader can scan, at the precision the number actually carries
 *
 * Whole kilometres, because this is a great-circle distance rather than a driving one and a
 * decimal would claim a precision it does not have. Under a kilometre reads as "<1 km", since
 * rounding those to 0 says the theatre is where the reader is standing
 */
export function formatDistance(km: number): string {
  return km < 1 ? "<1 km" : `${Math.round(km)} km`;
}
