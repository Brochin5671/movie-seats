/**
 * @fileoverview Upstream payloads narrowed to the shapes the page needs
 *
 * Pure, and imports nothing but types. That is the whole reason this is a separate
 * module: every awkward part of the upstream format is then testable against a literal
 * fixture with no fetch and no mocks
 */

import type {
  RawMovie,
  RawSeatAvailability,
  RawSeatLayout,
  RawSeatRow,
  RawShowtimeTheatre,
  RawTheatre,
  RawTheatres,
} from "./raw";
import type { Movie, Seat, SeatKind, SeatMap, SeatRow, Session, Theatre } from "./types";

/** Upstream writes an absent string as "" rather than omitting it */
const blank = (value: string | null | undefined): string | null => value || null;

export function toMovies(raw: RawMovie[] | null): Movie[] {
  return (raw ?? []).map((movie) => ({
    id: movie.id,
    name: movie.name,
    runtimeInMinutes: movie.runtimeInMinutes,
    genres: movie.genres ?? [],
    releaseDate: movie.releaseDate,
    posterUrl: blank(movie.mediumPosterImageUrl),
    isNowPlaying: movie.isNowPlaying,
    isComingSoon: movie.isComingSoon,
  }));
}

/*
 * Three groups flattened into one list. A favourite is plausibly also nearby, so the
 * same theatre arrives twice and the select would show it twice
 *
 * Keyed by id, and a later group wins on purpose rather than the first: only the nearby
 * group carries `distanceToOriginInMeters`, so keeping the favourite copy would throw
 * away the distance for exactly the theatres the reader cares most about
 */
export function toTheatres(raw: RawTheatres | null): Theatre[] {
  const groups = [raw?.favouriteTheatres, raw?.nearbyTheatres, raw?.otherTheatres];
  const byId = new Map<number, Theatre>();
  for (const group of groups) {
    for (const theatre of group ?? []) byId.set(theatre.theatreId, project(theatre));
  }
  return [...byId.values()];
}

const project = (theatre: RawTheatre): Theatre => ({
  id: theatre.theatreId,
  name: theatre.theatreName,
  city: theatre.location?.city ?? "",
  province: theatre.location?.provinceCode ?? "",
  latitude: theatre.location?.geoLocation?.latitude ?? 0,
  longitude: theatre.location?.geoLocation?.longitude ?? 0,
  distanceMeters: theatre.location?.distanceToOriginInMeters ?? null,
});

/**
 * Flatten theatre > dates > movies > experiences > sessions into one list per screening
 *
 * The same screening is repeated once per experience group, so a 7:10 tagged `3D` and
 * again `3D/D-BOX` arrives twice. Merging the two rather than keeping either one is
 * what preserves both format labels, and `experienceTypes` sits on the experience
 * node, so it has to be carried down before the rows can be compared
 */
export function toSessions(raw: RawShowtimeTheatre[] | null): Session[] {
  const merged = new Map<number, Session>();
  for (const theatre of raw ?? []) {
    for (const date of theatre.dates ?? []) {
      for (const movie of date.movies ?? []) {
        for (const experience of movie.experiences ?? []) {
          const types = experience.experienceTypes ?? [];
          for (const session of experience.sessions ?? []) {
            // Today's already-started screenings still come back
            if (session.isInThePast) continue;
            const existing = merged.get(session.vistaSessionId);
            if (existing) {
              for (const type of types) {
                if (!existing.experiences.includes(type)) existing.experiences.push(type);
              }
              continue;
            }
            merged.set(session.vistaSessionId, {
              sessionId: session.vistaSessionId,
              auditorium: session.auditorium,
              start: session.showStartDateTime,
              experiences: [...types],
              // null means unreserved seating, which is not the same as sold out
              seatsRemaining: session.seatsRemaining,
              isSoldOut: session.isSoldOut,
            });
          }
        }
      }
    }
  }
  /*
   * Chronological, because the flattened stream is not. Sessions arrive grouped by
   * experience, so a date carrying both a 3D and a Standard group yields 7:10, 9:30,
   * 1:00, 4:00 in that order, and the picker would list an evening show above an
   * afternoon one. A plain string compare is right here: the wall clock is a
   * fixed-width format with no offset, so lexicographic order is chronological order
   */
  return [...merged.values()].sort((a, b) => a.start.localeCompare(b.start));
}

/*
 * The narrowing extractors walk only far enough to read ids. The film-id direction is
 * a payload of megabytes, so discarding it here rather than downstream is the point
 */
export function filmIdsFrom(raw: RawShowtimeTheatre[] | null): number[] {
  const ids = new Set<number>();
  for (const theatre of raw ?? [])
    for (const date of theatre.dates ?? [])
      for (const movie of date.movies ?? []) ids.add(movie.id);
  return [...ids];
}

export function theatreIdsFrom(raw: RawShowtimeTheatre[] | null): number[] {
  return [...new Set((raw ?? []).map((theatre) => theatre.theatreId))];
}

/*
 * Areas in render order, screen first
 *
 * `top` is a row index rather than a pixel offset, so a non-standard block splices into
 * the standard list at that position. Splicing is what keeps row labels alphabetically
 * continuous (`... E F G H ... I`) and makes the row counts sum to `totalRows`
 */
function orderedRows(layout: RawSeatLayout): { row: RawSeatRow; kind: SeatKind }[] {
  const rows = (layout.standardSeats?.rows ?? []).map((row) => ({
    row,
    kind: "Standard" as SeatKind,
  }));

  const extra = (
    [
      [layout.dboxSeats, "Dbox"],
      [layout.balconySeats, "Standard"],
    ] as const
  )
    .filter(([area]) => (area?.rows ?? []).length > 0)
    /*
     * Descending `top`, because each splice shifts the indices every later one is
     * measured against. Inserting a two-row D-BOX block at 1 before a balcony block at
     * 4 lands the balcony two rows too close to the screen; going back to front means
     * every index still refers to the list the layout described
     */
    .sort((a, b) => (b[0]?.top ?? 0) - (a[0]?.top ?? 0));

  for (const [area, kind] of extra) {
    const block = (area?.rows ?? []).map((row) => ({ row, kind: kind as SeatKind }));
    const at = Math.min(Math.max(area?.top ?? rows.length, 0), rows.length);
    rows.splice(at, 0, ...block);
  }
  return rows;
}

/** No availability could be joined onto a layout that has seats, so the map is unknowable */
class SeatJoinError extends Error {
  constructor(seatCount: number) {
    super(`seat availability was empty for a layout of ${seatCount} seats`);
    this.name = "SeatJoinError";
  }
}

/**
 * Join availability onto the layout by seat id
 *
 * Occupied is `status !== "Available"` rather than `=== "Occupied"`. Only those two
 * statuses were observed, and testing for not-available is what stays correct against
 * a third one nobody has seen; an id missing from the map counts occupied for the same
 * reason, which over-reports rather than selling a taken seat
 *
 * That reading is right for one absent id and inverts for all of them. An empty map
 * against a layout that has seats, where upstream has not also said the house is sold out,
 * is a join that failed: every measured auditorium returned one availability entry per
 * layout seat. Three real paths reach it: a 204, which `fetchUpstream` resolves as `null`;
 * a 200 whose `seatAvailabilities` is null; and a layout served from cache after the
 * showtime it belongs to stopped existing, since availability answers 200 with `{}` for an
 * id that does not. Left alone each renders a confident FULL house, which is worse than an
 * error because nothing about it looks wrong
 *
 * A partly-missing map is still read as occupied and still renders: one id the map answers
 * for is enough to show it joined. Any threshold above that would be invented rather than
 * observed
 */
export function toSeatMap(
  layout: RawSeatLayout | null,
  availability: RawSeatAvailability | null,
): SeatMap {
  const statuses = availability?.seatAvailabilities ?? {};
  const rows: SeatRow[] = [];
  let total = 0;
  let occupied = 0;
  /** Layout seats the availability map actually had an answer for */
  let matched = 0;

  for (const { row, kind } of orderedRows(layout ?? ({} as RawSeatLayout))) {
    const seats: Seat[] = (row.seats ?? []).map((seat) => {
      const isOccupied = statuses[seat.id] !== "Available";
      if (seat.id in statuses) matched += 1;
      total += 1;
      if (isOccupied) occupied += 1;
      return {
        id: seat.id,
        label: seat.label,
        column: seat.column,
        kind: seatKind(seat.type, kind),
        occupied: isOccupied,
      };
    });
    rows.push({
      // An aisle is a row with no seats, and it has no name worth announcing
      label: seats.length ? row.label : null,
      physicalNumber: row.physicalNumber,
      seats,
    });
  }

  /*
   * Checked after the walk, so the counts are the layout's own rather than a second reading
   * of the same nested shape
   *
   * Zero overlap rather than an empty map: an availability payload keyed for a different
   * showtime is not empty, misses on every id just the same, and would render the identical
   * confident FULL house the empty one does
   *
   * The `isSoldOut` clause is a hedge, and worth naming as one. A sold-out house was
   * measured returning one entry per seat, so it has full overlap and never reaches here;
   * the clause only matters if some unmeasured response pairs an empty map with the flag.
   * `seating.ts` records the flag as sometimes true while seats are still free, so trusting
   * it errs toward drawing a full house rather than toward an error. What a showtime pulled
   * from sale sends here is unmeasured: if it sets the flag, this renders FULL instead of
   * the 502 the comment on `TTL.seatLayout` describes
   */
  if (matched === 0 && total > 0 && !availability?.isSoldOut) throw new SeatJoinError(total);

  return {
    rows,
    totalColumns: layout?.totalColumns ?? 0,
    total,
    occupied,
    isSoldOut: availability?.isSoldOut ?? false,
  };
}

/*
 * A wheelchair or companion space keeps its own kind wherever it sits, since that is
 * about who can use the seat. Everything else takes the area's kind, which is the only
 * place D-BOX is ever recorded
 */
function seatKind(type: string, areaKind: SeatKind): SeatKind {
  if (type === "Wheelchair" || type === "Companion") return type;
  return areaKind;
}
