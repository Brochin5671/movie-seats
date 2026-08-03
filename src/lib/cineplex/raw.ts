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
    geoLocation: { latitude: number; longitude: number };
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
   * 0-based against `totalColumns`
   *
   * Measured, not assumed: theatre 7249 Aud 12 returned columns 0..24 with
   * `totalColumns: 26`. The grid adds 1, since CSS grid lines start at 1
   */
  column: number;
  label: string;
  /** Never "Dbox" in practice; that comes from the area the row sits in */
  type: string;
}

export interface RawSeatRow {
  number: number;
  physicalNumber: number;
  label: string;
  seats: RawSeat[] | null;
}

/**
 * One block of rows
 *
 * `top` is a row index, not a pixel offset: the non-standard areas splice into the
 * standard list at that position, and the row counts then sum to `totalRows`
 */
export interface RawSeatArea {
  top: number;
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
