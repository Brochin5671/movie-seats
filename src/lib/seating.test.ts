import { describe, expect, it } from "vitest";
import type { Seat, SeatMap, SeatRow } from "@/lib/cineplex/types";
import {
  capacityLabel,
  capacityTone,
  gridColumnCount,
  isSeatingPoor,
  optimalSeatIds,
  seatAccessibleName,
  seatLegendKeys,
  seatState,
} from "./seating";

/*
 * Boundaries, not samples. Every threshold in this module is an inclusive bound that
 * somebody will eventually write as exclusive, and a test at 50% cannot tell the two
 * apart. The values here are the exact edges
 */

const seat = (
  id: string,
  column: number,
  occupied = false,
  kind: Seat["kind"] = "Standard",
): Seat => ({
  id,
  label: id.toUpperCase(),
  column,
  kind,
  occupied,
});

/** A row of `count` seats, the first `taken` of which are occupied */
const row = (label: string, count: number, taken = 0): SeatRow => ({
  label,
  physicalNumber: 1,
  seats: Array.from({ length: count }, (_, i) => seat(`${label}-${i}`, i, i < taken)),
});

const aisle = (): SeatRow => ({ label: null, physicalNumber: 0, seats: [] });

describe("capacityTone", () => {
  it.each([
    [0, 100, "safe"],
    [30, 100, "safe"],
    [31, 100, "warning"],
    [80, 100, "warning"],
    [81, 100, "danger"],
    [100, 100, "danger"],
  ])("%i of %i is %s", (occupied, total, expected) => {
    expect(capacityTone(occupied, total)).toBe(expected);
  });

  // A house with no seats divides by zero; reading danger there would be a lie
  it("reads safe rather than dividing by zero on an empty house", () => {
    expect(capacityTone(0, 0)).toBe("safe");
  });
});

describe("capacityLabel", () => {
  it("reads occupied over total while seats remain", () => {
    expect(capacityLabel(20, 150, false)).toBe("20/150");
  });

  it.each([
    [150, 150, false, "everything is taken"],
    [20, 150, true, "the session is flagged sold out with seats apparently free"],
  ])("reads FULL when %i/%i soldOut=%s (%s)", (occupied, total, soldOut) => {
    expect(capacityLabel(occupied, total, soldOut)).toBe("FULL");
  });
});

describe("isSeatingPoor", () => {
  /*
   * Front is position, not label. These houses have no double-letter rows at all, which
   * is the case a label-based rule would silently never fire in
   */
  it("fires when the only free seats are in the front third", () => {
    const rows = [row("a", 5), row("b", 5, 5), row("c", 5, 5)];
    expect(isSeatingPoor(rows)).toBe(true);
  });

  it("does not fire when a back row still has something free", () => {
    const rows = [row("a", 5), row("b", 5, 5), row("c", 5, 4)];
    expect(isSeatingPoor(rows)).toBe(false);
  });

  /*
   * The vacuous case: `every` over an empty list is true, so a sold-out house would
   * otherwise report poor seating next to a FULL meter
   */
  it("does not fire on a sold-out house, where there is no seating to judge", () => {
    const rows = [row("a", 5, 5), row("b", 5, 5), row("c", 5, 5)];
    expect(isSeatingPoor(rows)).toBe(false);
  });

  it("does not fire on a house with no seats at all", () => {
    expect(isSeatingPoor([aisle(), aisle()])).toBe(false);
  });

  /*
   * Aisles are not positions, so they must not shift where the front third ends. They
   * sit in FRONT of every seated row here on purpose: placed further back, dropping the
   * filter changes nothing and the case passes without exercising it
   */
  it("counts populated rows only when measuring the front third", () => {
    const withAisles = [aisle(), aisle(), row("a", 5), row("b", 5, 5), row("c", 5, 5)];
    expect(isSeatingPoor(withAisles)).toBe(true);
  });

  it.each([
    [1, "a single row is its own front third"],
    [3, "ceil(3/3) is the first row"],
    [4, "ceil(4/3) is the first two"],
  ])("handles a %i-row house (%s)", (count) => {
    const rows = Array.from({ length: count }, (_, i) => row(`r${i}`, 4, i === 0 ? 0 : 4));
    expect(isSeatingPoor(rows)).toBe(true);
  });
});

describe("optimalSeatIds", () => {
  /*
   * Which rows, not how many. A count passes wherever the window sits, and the depth is
   * the thing the rule is about: these are round(0.67 x n) with a row either side
   */
  it.each([
    [16, ["r10", "r11", "r12"]],
    [17, ["r10", "r11", "r12"]],
    [20, ["r12", "r13", "r14"]],
  ])("centres a three-row window on the target row in a %i-row house", (rowCount, expected) => {
    const rows = Array.from({ length: rowCount }, (_, i) => row(`r${i}`, 9));
    const rowsHit = [...new Set([...optimalSeatIds(rows)].map((id) => id.split("-")[0]))].sort();
    expect(rowsHit).toEqual(expected);
  });

  // The window shrinks to fit rather than sliding off the front of a small house
  it.each([
    [1, ["r0"]],
    [2, ["r0", "r1"]],
    [3, ["r0", "r1", "r2"]],
  ])("fits the window to a %i-row house", (rowCount, expected) => {
    const rows = Array.from({ length: rowCount }, (_, i) => row(`r${i}`, 9));
    const rowsHit = [...new Set([...optimalSeatIds(rows)].map((id) => id.split("-")[0]))].sort();
    expect(rowsHit).toEqual(expected);
  });

  /*
   * An accessible space is allocated to someone who needs it, and recommending one also
   * repaints it: the green replaces the tone that says what the space is, so the map
   * would stop showing that the house has accessible seating at all
   */
  it("never recommends a wheelchair space or its companion seat", () => {
    /*
     * The window is r3 to r5 in a six-row house and columns 3 to 5 are each row's middle
     * third, so every accessible seat below sits squarely inside it. Placed outside they
     * would be skipped for being out of range and the filter would go unexercised
     */
    const rows = Array.from({ length: 6 }, (_, index) => {
      const seats = Array.from({ length: 9 }, (_, column) => seat(`r${index}-${column}`, column));
      if (index >= 3) {
        seats[3] = seat(`r${index}-3`, 3, false, "Wheelchair");
        seats[4] = seat(`r${index}-4`, 4, false, "Companion");
      }
      return { label: `r${index}`, physicalNumber: 6 - index, seats };
    });
    expect([...optimalSeatIds(rows)].sort()).toEqual(["r3-5", "r4-5", "r5-5"]);
  });

  it("never recommends a seat that is already taken", () => {
    const rows = Array.from({ length: 6 }, (_, i) => row(`r${i}`, 9, 9));
    expect(optimalSeatIds(rows).size).toBe(0);
  });

  it("recommends nothing in a house with no seats", () => {
    expect(optimalSeatIds([aisle()]).size).toBe(0);
  });

  /*
   * The middle third is measured across the row's columns, not across its seat count
   *
   * A row split by an aisle has its seats bunched to one side, and counting seats centres on
   * the bunch instead of on the row. This is the ordinary case: a hole inside a row is what
   * the map is built to preserve
   */
  describe("a row split by an aisle", () => {
    /** Four seats hard left, then a ten-seat block: extent 0 to 19, so the centre is 9.5 */
    const split = (label: string): SeatRow => ({
      label,
      physicalNumber: 1,
      seats: [0, 1, 2, 3, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19].map((column) =>
        seat(`${label}-${column}`, column),
      ),
    });

    it("centres on the row's columns rather than on its seat count", () => {
      const rows = [split("a"), split("b"), split("c")];
      /*
       * The middle third of the extent 0 to 19 runs 6.33 to 12.67, and the only seats in it
       * are 10, 11 and 12. Counting seats instead reads columns[4] to columns[9], which is
       * 10 to 15: three seats further right, and centred on 12.5 rather than on 9.5
       */
      expect([...optimalSeatIds(rows)].filter((id) => id.startsWith("a-")).sort()).toEqual([
        "a-10",
        "a-11",
        "a-12",
      ]);
    });
  });

  /*
   * A window that lands between seats. The middle third of a two-seat row spanning one
   * column is 0.33 to 0.67, which holds nothing at all, so the nearest seat stands in
   */
  it.each([
    ["a two-seat row", [0, 1], ["r0-0", "r0-1"]],
    ["an equal gap either side of centre", [0, 1, 18, 19], ["r0-1", "r0-18"]],
  ])("falls back to the nearest seat to centre in %s", (_name, columns, expected) => {
    const rows = [
      {
        label: "r0",
        physicalNumber: 1,
        seats: columns.map((column) => seat(`r0-${column}`, column)),
      },
    ];
    expect([...optimalSeatIds(rows)].sort()).toEqual(expected);
  });

  /*
   * Named because it is a decision rather than a surprise. Eight contiguous seats put the
   * physical middle third at 2.33 to 4.67, which is two seats, where counting seats gave
   * four. The window is three rows deep precisely because a narrow one recommends nothing
   * too often, so this is the direction to watch if that starts happening again
   */
  it("narrows an eight-seat row from four seats to two", () => {
    const rows = [row("r0", 8), row("r1", 8), row("r2", 8)];
    expect([...optimalSeatIds(rows)].filter((id) => id.startsWith("r0-")).sort()).toEqual([
      "r0-3",
      "r0-4",
    ]);
  });
});

describe("gridColumnCount", () => {
  const at = (columns: number[]): SeatRow => ({
    label: "a",
    physicalNumber: 1,
    seats: columns.map((column) => seat(`a-${column}`, column)),
  });
  const map = (totalColumns: number, rows: SeatRow[]): SeatMap => ({
    rows,
    totalColumns,
    total: rows.flatMap((r) => r.seats).length,
    occupied: 0,
    isSoldOut: false,
  });

  it("declares the layout's own width when every seat fits inside it", () => {
    expect(gridColumnCount(map(26, [at([0, 12, 25])]))).toBe(26);
  });

  /*
   * Widening rather than clamping. Every row is drawn as its own grid and they line up only
   * while the track counts match, so one row reaching past the declared width would open
   * implicit tracks and slide sideways. Clamping instead would stack two seats in one cell
   */
  it("widens past the layout's own width to reach the furthest seat", () => {
    expect(gridColumnCount(map(6, [at([0, 1]), at([0, 8])]))).toBe(9);
  });

  /*
   * `repeat()` takes an integer of 1 or more, so `repeat(0, ...)` drops the declaration and
   * every seat lands on an implicit track. A layout that omits `totalColumns` projects to 0
   */
  it("never declares fewer than one track", () => {
    expect(gridColumnCount(map(0, []))).toBe(1);
  });
});

describe("seat naming", () => {
  // Occupied beats kind: a taken D-BOX seat is first of all taken
  it("reports occupied ahead of the seat kind", () => {
    expect(seatState({ kind: "Dbox", occupied: true })).toBe("occupied");
    expect(seatState({ kind: "Dbox", occupied: false })).toBe("dbox");
  });

  it.each([
    [{ label: "GG22", kind: "Standard", occupied: true }, false, "GG22, standard, occupied"],
    [{ label: "GG22", kind: "Standard", occupied: false }, false, "GG22, standard, available"],
    [{ label: "C1", kind: "Dbox", occupied: false }, false, "C1, D-BOX, available"],
    [{ label: "A4", kind: "Wheelchair", occupied: false }, false, "A4, wheelchair, available"],
    [
      { label: "B7", kind: "Standard", occupied: false },
      true,
      "B7, standard, available, recommended",
    ],
  ])("names %o as %s", (input, recommended, expected) => {
    expect(seatAccessibleName(input, recommended)).toBe(expected);
  });
});

/*
 * The legend has to describe the house on screen, and it has to agree with the map about
 * which seats are green. Both are pinned by the exact array, since a length check passes
 * while listing the wrong things
 */
describe("seatLegendKeys", () => {
  const house = (rows: SeatRow[]) => ({
    rows,
    totalColumns: 9,
    total: rows.flatMap((r) => r.seats).length,
    occupied: rows.flatMap((r) => r.seats).filter((s) => s.occupied).length,
    isSoldOut: false,
  });

  it("lists every state present, in the bar's own order", () => {
    /*
     * Six rows, so the window is r3 to r5 and the front three are outside it. D-BOX sits
     * in r0 on purpose: inside the window it would render green and `recommended` would
     * shadow the key it is supposed to be listed beside
     */
    const rows = [
      {
        label: "a",
        physicalNumber: 6,
        seats: [seat("a-0", 0, false, "Dbox"), seat("a-1", 1, true)],
      },
      {
        label: "b",
        physicalNumber: 5,
        seats: [seat("b-0", 0, false, "Wheelchair"), seat("b-1", 1, false, "Companion")],
      },
      row("c", 9),
      row("d", 9),
      row("e", 9),
      row("f", 9),
    ];
    const map = house(rows);
    expect(seatLegendKeys(map, optimalSeatIds(rows))).toEqual([
      "standard",
      "dbox",
      "recommended",
      "occupied",
      "companion",
      "wheelchair",
    ]);
  });

  // Most auditoriums have no D-BOX block and no accessible spaces, which is the whole
  // reason the list is derived rather than fixed
  it("omits a state no seat is drawn in", () => {
    const rows = [row("a", 9), row("b", 9)];
    // No D-BOX, no accessible spaces, nothing taken: three of the six keys never apply
    expect(seatLegendKeys(house(rows), optimalSeatIds(rows))).toEqual(["standard", "recommended"]);
  });

  /*
   * A sold-out house is the case where every other key drops at once, so an assertion
   * about one omission is co-satisfied by five others. The whole array is the assertion
   */
  it("lists only occupied for a house with nothing free", () => {
    const rows = [row("a", 9, 9), row("b", 9, 9)];
    expect(seatLegendKeys(house(rows), optimalSeatIds(rows))).toEqual(["occupied"]);
  });

  /*
   * The pair that can silently diverge. Recommended-ness is carried by colour plus stroke
   * weight, so a green seat the legend does not list leaves that state on colour alone
   */
  it("takes recommended from the set the map paints, not from its own guess", () => {
    const rows = [row("a", 9)];
    expect(seatLegendKeys(house(rows), new Set())).not.toContain("recommended");
    expect(seatLegendKeys(house(rows), new Set(["a-4"]))).toContain("recommended");
  });
});
