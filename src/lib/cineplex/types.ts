/**
 * @fileoverview The shapes this app serves, as opposed to the ones it receives
 *
 * Types only, no runtime values. `src/lib/cineplex-client.ts` imports from here into
 * the browser island, and a single `const` in this file would drag server code into
 * the client chunk
 */

export interface Movie {
  id: number;
  name: string;
  runtimeInMinutes: number;
  genres: string[];
  releaseDate: string;
  posterUrl: string | null;
  isNowPlaying: boolean;
  isComingSoon: boolean;
}

export interface Theatre {
  id: number;
  name: string;
  city: string;
  province: string;
  /** Null when upstream sent no location. Zero is a real coordinate, so it cannot stand in */
  latitude: number | null;
  longitude: number | null;
  /** Only ever set when upstream was given an origin, which this app never does */
  distanceMeters: number | null;
}

export interface Session {
  /** `vistaSessionId`, and the key duplicate rows are merged on */
  sessionId: number;
  /** Free text: "Aud 12", "IMAX #1", "VIP 3 (19+)". Render it verbatim */
  auditorium: string;
  /** Theatre-local wall clock with no offset. Never convert it */
  start: string;
  experiences: string[];
  seatsRemaining: number | null;
  isSoldOut: boolean;
}

/**
 * What a seat is, for colouring and naming
 *
 * `Dbox` is derived rather than read: upstream lists it in `seatLegendTypes` but never
 * sets it on a seat, because D-BOX is a property of the area a row belongs to. A
 * type-based rule would paint every D-BOX seat as standard
 */
export type SeatKind = "Standard" | "Wheelchair" | "Companion" | "Dbox";

export interface Seat {
  /** Joins to the availability map, for example "1_18_24" */
  id: string;
  /** "GG22" */
  label: string;
  /**
   * 0-based across the whole house, with every area's own offset already applied
   *
   * Not what upstream sends: there a column is measured against the area the seat sits in.
   * A row can therefore hold seats from two areas, and can reach past `totalColumns` if a
   * layout ever misreports its own width
   */
  column: number;
  kind: SeatKind;
  occupied: boolean;
}

export interface SeatRow {
  /** null on an aisle */
  label: string | null;
  /** Restarts per area upstream, so two rows in one map can share it. Not a key */
  physicalNumber: number;
  /** Empty on an aisle */
  seats: Seat[];
}

export interface SeatMap {
  /** Screen first: index 0 is the row closest to the screen */
  rows: SeatRow[];
  totalColumns: number;
  total: number;
  occupied: number;
  isSoldOut: boolean;
}
