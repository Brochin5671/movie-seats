/**
 * @fileoverview Everything the seat map decides from a SeatMap, and nothing else
 *
 * Pure and separate from the components so the off-by-ones are testable directly
 * Every threshold here is a boundary somebody will get wrong once
 */

import type { Seat, SeatMap, SeatRow } from "@/lib/cineplex/types";

/** Matches `Meter`'s tone axis */
export type CapacityTone = "safe" | "warning" | "danger";

/**
 * Fullness banding
 *
 * Inclusive upper bounds, so exactly 30 is still safe and exactly 80 is still warning
 * An empty auditorium reads safe rather than dividing by zero
 */
export function capacityTone(occupied: number, total: number): CapacityTone {
  if (total <= 0) return "safe";
  const percent = (occupied / total) * 100;
  if (percent <= 30) return "safe";
  if (percent <= 80) return "warning";
  return "danger";
}

/** `20/150`, or `FULL` once there is nothing left to sell */
export function capacityLabel(occupied: number, total: number, isSoldOut: boolean): string {
  if (isSoldOut || (total > 0 && occupied >= total)) return "FULL";
  return `${occupied}/${total}`;
}

/** Rows that hold seats. The rest are aisles, and they are not positions in the house */
export function populatedRows(rows: SeatRow[]): SeatRow[] {
  return rows.filter((row) => row.seats.length > 0);
}

/**
 * Grid tracks wide enough for every seat in the house
 *
 * Each row is drawn as its own grid, and the rows line up only while they all declare the
 * same track count. A seat past `totalColumns` opens implicit tracks, which widens that one
 * row, and the centred column then re-centres it against the rest: the row slides sideways
 * and its column 4 stops being above everyone else's
 *
 * Widening rather than clamping, because two seats forced into one cell overlap and one of
 * them stops being readable at all. The floor of 1 is because `repeat()` takes an integer of
 * 1 or more (CSS Grid Layout Level 1), so `repeat(0, ...)` drops the whole declaration and
 * puts every seat on an implicit track: a layout that omits `totalColumns` projects to 0
 */
export function gridColumnCount(map: SeatMap): number {
  let widest = map.totalColumns;
  for (const row of map.rows) {
    for (const seat of row.seats) {
      if (seat.column + 1 > widest) widest = seat.column + 1;
    }
  }
  return Math.max(widest, 1);
}

/**
 * Whether every seat still free is stuck near the screen
 *
 * Front means position, not label. Double letters do mark front rows where a house uses
 * them, but not every house does, so a label rule would silently never fire in the ones
 * that do not
 */
export function isSeatingPoor(rows: SeatRow[]): boolean {
  const populated = populatedRows(rows);
  if (populated.length === 0) return false;

  const frontThird = new Set(populated.slice(0, Math.ceil(populated.length / 3)));
  const rowsWithSeatsFree = populated.filter((row) => row.seats.some((seat) => !seat.occupied));
  /*
   * Without this guard `every` is vacuously true on a sold-out house, and the line reads
   * "seating is poor" beside a FULL meter
   */
  if (rowsWithSeatsFree.length === 0) return false;

  return rowsWithSeatsFree.every((row) => frontThird.has(row));
}

/** Two thirds back from the screen, which is the usual answer for where to sit */
const OPTIMAL_DEPTH = 0.67;
/** Rows deep, centred on the target. Fewer in a house that does not have three */
const WINDOW_ROWS = 3;

/**
 * The seats in the physical middle third of a row
 *
 * Measured across the row's own columns, not across its seat count. A row split by an aisle
 * has its seats bunched to one side, and a count-based window centres on the bunch: columns
 * 0 to 3 and 10 to 19 put the ordinal middle third at 10 to 15, centred on 12.5, where the
 * row's own centre is 9.5. A hole inside a row is what the map is built to preserve, so that
 * is the ordinary case rather than an exotic one
 *
 * Row-local, which is unchanged: a short row is not centred on the same columns as a long
 * one, so this does not measure against the house's width
 *
 * Computed over every seat in the row and filtered afterwards, so the geometry does not move
 * because a seat sold. The nearest-to-centre fallback is for a window that lands between
 * seats: a two-seat row spans one column, so its middle third is 0.33 to 0.67 and holds none
 */
function middleThird(row: SeatRow): Seat[] {
  const columns = row.seats.map((seat) => seat.column);
  const first = Math.min(...columns);
  const last = Math.max(...columns);
  const third = (last - first) / 3;
  const inside = row.seats.filter(
    (seat) => seat.column >= first + third && seat.column <= last - third,
  );
  if (inside.length > 0) return inside;

  // Ties kept, so a row with an equal gap either side of centre offers both
  const centre = (first + last) / 2;
  const nearest = Math.min(...row.seats.map((seat) => Math.abs(seat.column - centre)));
  return row.seats.filter((seat) => Math.abs(seat.column - centre) === nearest);
}

/**
 * Free, and not a space allocated to someone who needs it
 *
 * Recommending an accessible space repaints it, and the green would replace the tone that
 * says what the space is
 */
const isPickable = (seat: Seat) =>
  !seat.occupied && seat.kind !== "Wheelchair" && seat.kind !== "Companion";

/**
 * The seats worth recommending: middle of the three rows around two thirds back
 *
 * Three rows rather than one. Measured against ten real screenings at one theatre, a
 * single row recommended nothing in five of them: the window is about seven seats and a
 * house at 40% can easily have all seven taken. Three rows drops that to three in ten
 *
 * Centred on the target, and the window shrinks rather than sliding when a house has
 * fewer rows than that
 */
export function optimalSeatIds(rows: SeatRow[]): Set<string> {
  const populated = populatedRows(rows);
  if (populated.length === 0) return new Set();

  const rowCount = Math.min(WINDOW_ROWS, populated.length);
  const target = Math.round(OPTIMAL_DEPTH * populated.length);
  const start = Math.min(
    Math.max(target - Math.floor(rowCount / 2), 0),
    populated.length - rowCount,
  );

  const picks = populated
    .slice(start, start + rowCount)
    .map((row) => middleThird(row).filter(isPickable));

  return new Set(picks.flat().map((seat) => seat.id));
}

/** The legend rows, in the order the bar reads them */
export type SeatLegendKey =
  | "standard"
  | "dbox"
  | "recommended"
  | "occupied"
  | "companion"
  | "wheelchair";

const LEGEND_ORDER: SeatLegendKey[] = [
  "standard",
  "dbox",
  "recommended",
  "occupied",
  "companion",
  "wheelchair",
];

/**
 * Which legend rows this house actually needs
 *
 * A key for a state no seat is drawn in teaches a code the map does not use, and most
 * auditoriums have no D-BOX block and no accessible spaces at all. `recommended` is
 * derived from the same set the map paints from, not recomputed, so the two cannot
 * disagree: a green seat with no legend row would leave that state carried by colour alone
 */
export function seatLegendKeys(map: SeatMap, recommended: Set<string>): SeatLegendKey[] {
  const present = new Set<SeatLegendKey>();
  for (const row of map.rows) {
    for (const seat of row.seats) {
      if (recommended.has(seat.id)) present.add("recommended");
      else present.add(seatState(seat) as SeatLegendKey);
    }
  }
  return LEGEND_ORDER.filter((key) => present.has(key));
}

/** Occupied wins over kind, because a taken D-BOX seat is first of all taken */
export function seatState(seat: { kind: string; occupied: boolean }): string {
  return seat.occupied ? "occupied" : seat.kind.toLowerCase();
}

/**
 * What a screen reader says for one seat
 *
 * The whole state in the name, so colour is never the only signal. `recommended` is
 * appended rather than replacing the status, since it is an addition to the seat's
 * state and not a state of its own
 */
export function seatAccessibleName(
  seat: { label: string; kind: string; occupied: boolean },
  recommended = false,
): string {
  const kind = seat.kind === "Dbox" ? "D-BOX" : seat.kind.toLowerCase();
  const status = seat.occupied ? "occupied" : "available";
  return `${seat.label}, ${kind}, ${status}${recommended ? ", recommended" : ""}`;
}

/**
 * The meter's tone and label together
 *
 * `isSoldOut` reaches both, not just the label. Upstream can flag a screening sold out
 * while its seat map still shows seats free, and passing it to only one of the two paints
 * a green bar at 13% next to the word FULL
 */
export function capacityOf(map: SeatMap) {
  const soldOut = map.isSoldOut || (map.total > 0 && map.occupied >= map.total);
  return {
    tone: soldOut ? ("danger" as CapacityTone) : capacityTone(map.occupied, map.total),
    label: capacityLabel(map.occupied, map.total, map.isSoldOut),
  };
}
