import { describe, expect, it } from "vitest";
import type { Theatre } from "@/lib/cineplex/types";
import {
  EARTH_RADIUS_KM,
  formatDistance,
  haversineKm,
  sortByDistance,
  theatreDistanceKm,
} from "./theatre-distance";

/*
 * Derivations, not samples. A distance test built from a literal somebody once printed says
 * nothing about the formula, and the two mistakes this formula invites, degrees left
 * unconverted and a dropped cos(lat) factor, both survive a single north-south case
 */

const at = (id: number, latitude: number | null, longitude: number | null): Theatre => ({
  id,
  name: `T${id}`,
  city: "",
  province: "",
  latitude,
  longitude,
  distanceMeters: null,
});

describe("EARTH_RADIUS_KM", () => {
  // Recomputed from its own derivation rather than restated, so the comment cannot drift
  it("is the IUGG mean radius over WGS-84", () => {
    const semiMajor = 6378.137;
    const semiMinor = 6356.752314245;
    expect(EARTH_RADIUS_KM).toBeCloseTo((2 * semiMajor + semiMinor) / 3, 4);
  });
});

describe("haversineKm", () => {
  /** One degree of latitude is R x pi / 180 anywhere on the sphere */
  const DEGREE_KM = (EARTH_RADIUS_KM * Math.PI) / 180;

  it("measures one degree of latitude as R x pi / 180", () => {
    expect(haversineKm({ latitude: 0, longitude: 0 }, { latitude: 1, longitude: 0 })).toBeCloseTo(
      DEGREE_KM,
      3,
    );
    expect(DEGREE_KM).toBeCloseTo(111.195, 3);
  });

  /*
   * The case a latitude-only test cannot see. A degree of longitude shortens by cos(lat) as
   * it goes north, and a formula missing that factor is exactly right on the equator
   */
  it("shortens a degree of longitude by cos(lat) at 60 north", () => {
    const measured = haversineKm({ latitude: 60, longitude: 0 }, { latitude: 60, longitude: 1 });
    expect(measured).toBeCloseTo(DEGREE_KM * Math.cos((60 * Math.PI) / 180), 2);
    expect(measured).toBeCloseTo(55.597, 2);
  });

  // Half the circumference. `asin` can be handed a rounding error above 1 here and reject it
  it("measures antipodal points as pi x R", () => {
    expect(haversineKm({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 180 })).toBeCloseTo(
      Math.PI * EARTH_RADIUS_KM,
      3,
    );
  });

  it("is zero to itself and the same in both directions", () => {
    const toronto = { latitude: 43.6532, longitude: -79.3832 };
    const barrie = { latitude: 44.3894, longitude: -79.6903 };
    expect(haversineKm(toronto, toronto)).toBe(0);
    expect(haversineKm(toronto, barrie)).toBeCloseTo(haversineKm(barrie, toronto), 9);
  });
});

describe("theatreDistanceKm", () => {
  it("is null when the theatre has no coordinates", () => {
    expect(theatreDistanceKm(at(1, null, null), { latitude: 43, longitude: -79 })).toBeNull();
  });

  it("is null when there is no origin", () => {
    expect(theatreDistanceKm(at(1, 43, -79), null)).toBeNull();
  });

  /*
   * Zero is a real place, and the projection now keeps an absent coordinate as null for
   * exactly this reason: coerced to 0 a theatre lands off West Africa and sorts by accident
   */
  it("treats zero as the real coordinate it is", () => {
    expect(theatreDistanceKm(at(1, 0, 0), { latitude: 0, longitude: 0 })).toBe(0);
  });
});

describe("sortByDistance", () => {
  const origin = { latitude: 43.6532, longitude: -79.3832 };
  const toronto = at(1, 43.6532, -79.3832);
  const barrie = at(2, 44.3894, -79.6903);
  const ottawa = at(3, 45.4215, -75.6972);

  it("puts the nearest theatre first", () => {
    expect(sortByDistance([ottawa, barrie, toronto], origin).map((t) => t.id)).toEqual([1, 2, 3]);
  });

  // The order upstream chose is the answer until the reader's position arrives
  it("returns the list untouched with no origin", () => {
    const list = [ottawa, barrie, toronto];
    expect(sortByDistance(list, null)).toBe(list);
  });

  /*
   * `Array.prototype.sort` mutates, and the list handed in is component state: sorting it in
   * place rewrites the order React is holding and the next filter reads the sorted copy
   */
  it("leaves the list it was given in its original order", () => {
    const list = [ottawa, barrie, toronto];
    sortByDistance(list, origin);
    expect(list.map((t) => t.id)).toEqual([3, 2, 1]);
  });

  it("puts theatres with no coordinates last, in the order they arrived", () => {
    const unknownA = at(8, null, null);
    const unknownB = at(9, null, null);
    expect(sortByDistance([unknownA, ottawa, unknownB, toronto], origin).map((t) => t.id)).toEqual([
      1, 3, 8, 9,
    ]);
  });

  // Stable since ES2019, so two theatres the same distance away keep the API's order
  it("keeps ties in the order they arrived", () => {
    const twin = { ...barrie, id: 7 };
    expect(sortByDistance([barrie, twin], origin).map((t) => t.id)).toEqual([2, 7]);
  });
});

describe("formatDistance", () => {
  it.each([
    [0, "<1 km"],
    [0.4, "<1 km"],
    // The boundary: exactly one kilometre is a kilometre, not "less than one"
    [1, "1 km"],
    [2.4, "2 km"],
    [2.5, "3 km"],
    [79.2, "79 km"],
  ])("reads %s km as %s", (km, expected) => {
    expect(formatDistance(km)).toBe(expected);
  });
});
