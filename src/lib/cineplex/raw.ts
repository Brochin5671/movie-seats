/**
 * @fileoverview The upstream wire shapes, narrowed to the fields we read
 *
 * Deliberately partial. The real payloads carry far more (one runs to megabytes), and typing
 * only what the projections touch is what documents the actual dependency surface
 */

export interface RawMovie {
  id: number;
  name: string;
  runtimeInMinutes: number;
  genres: string[] | null;
  releaseDate: string;
  mediumPosterImageUrl: string;
  isNowPlaying: boolean;
  isComingSoon: boolean;
}

export interface RawTheatre {
  theatreId: number;
  theatreName: string;
  location: {
    /*
     * Optional because the projection defends against its absence, and a type promising
     * otherwise would make that guard read as dead code
     */
    geoLocation?: { latitude: number; longitude: number } | null;
    city: string;
    provinceCode: string;
    distanceToOriginInMeters?: number | null;
  };
}

/** An object of three groups, not an array. A theatre can appear in more than one */
export interface RawTheatres {
  favouriteTheatres?: RawTheatre[] | null;
  nearbyTheatres?: RawTheatre[] | null;
  otherTheatres?: RawTheatre[] | null;
}

export interface RawSession {
  vistaSessionId: number;
  auditorium: string;
  showStartDateTime: string;
  seatsRemaining: number | null;
  isSoldOut: boolean;
  isInThePast: boolean;
  isReservedSeating: boolean;
}

/** `experienceTypes` lives here, on the parent, and not on the sessions below it */
export interface RawExperience {
  experienceTypes: string[] | null;
  sessions: RawSession[] | null;
}

export interface RawShowtimeMovie {
  id: number;
  experiences: RawExperience[] | null;
}

export interface RawShowtimeDate {
  movies: RawShowtimeMovie[] | null;
}

export interface RawShowtimeTheatre {
  theatreId: number;
  dates: RawShowtimeDate[] | null;
}

export interface RawSeat {
  id: string;
  /**
   * 0-based against the seat's own **area**, not against `totalColumns`
   *
   * Measured across four auditoriums: every `dboxSeats` block starts its columns at 0,
   * whatever house column it actually occupies, so a block is only placeable once
   * `RawSeatArea.left` is added back. The standard area always reported `left: 0`, which
   * is why area-local was mistaken for house-absolute here for so long
   *
   * A seat also carries `columnPhysicalNumber`, the same position counted 1-based from the
   * area's right edge, and `seatGroupIds`. Neither is typed, because nothing reads them
   */
  column: number;
  label: string;
  /** Never "Dbox" in practice; that comes from the area the row sits in */
  type: string;
}

export interface RawSeatRow {
  number: number;
  /** Restarts at 1 in every area, so two rows in one layout can share it */
  physicalNumber: number;
  /** Null on a row held open for another area's block, and on a real aisle */
  label: string | null;
  seats: RawSeat[] | null;
}

/**
 * One block of rows, and where it sits in the house
 *
 * `top` is an index into `standardSeats.rows`, and a non-standard area **overlays** those
 * rows rather than being inserted before them: the row it lands on is either empty and
 * held open for it, or holds the standard seats that share the row with the block.
 * Measured across four auditoriums; `totalRows` agrees with neither reading and is unread
 *
 * `left` is the house column the block starts at, and `areaWidth` is how many house columns
 * it covers. The two differ for D-BOX because those chairs are wider: 16 seats over 20
 * columns at Scotiabank Toronto. Upstream also sends the per-seat `columnWidth` that
 * relates them, and it is not typed here because nothing reads it
 */
export interface RawSeatArea {
  left: number;
  top: number;
  areaWidth: number;
  columnCount: number;
  rowCount: number;
  rows: RawSeatRow[] | null;
}

export interface RawSeatLayout {
  totalRows: number;
  totalColumns: number;
  standardSeats?: RawSeatArea | null;
  dboxSeats?: RawSeatArea | null;
  balconySeats?: RawSeatArea | null;
}

export interface RawSeatAvailability {
  /** Keyed by seat id. Observed values are "Available" and "Occupied" */
  seatAvailabilities: Record<string, string> | null;
  isSoldOut: boolean;
}
