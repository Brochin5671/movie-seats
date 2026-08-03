import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Seat, SeatMap } from "@/lib/cineplex/types";
import { optimalSeatIds } from "@/lib/seating";
import { LEGEND_TONES, SeatLegend } from "./SeatLegend";
import { OCCUPIED_FILL_OPACITY, RECOMMENDED_TONE, TONE } from "./SeatMap";

/*
 * The legend is decorative: every seat already carries its own name, so repeating the
 * key to a reader who cannot see the colours is noise. That makes `aria-hidden` the
 * behaviour worth pinning, alongside the two the entries have to satisfy: they follow
 * the house, and each one is drawn the way the map draws that state
 */

const seat = (id: string, over: Partial<Seat> = {}): Seat => ({
  id,
  label: id,
  column: Number(id.slice(1)),
  kind: "Standard",
  occupied: false,
  ...over,
});

/** A row per call, so a house is assembled from exactly the states a case needs */
const house = (rows: Seat[][]): SeatMap => ({
  rows: rows.map((seats, index) => ({ label: `R${index}`, physicalNumber: index + 1, seats })),
  totalColumns: 4,
  total: rows.flat().length,
  occupied: rows.flat().filter((s) => s.occupied).length,
  isSoldOut: false,
});

const labelsOf = (container: HTMLElement) =>
  [...container.querySelectorAll('[data-slot="badge"]')].map((el) => el.textContent?.trim());

const draw = (map: SeatMap) => {
  const recommended = optimalSeatIds(map.rows);
  return render(<SeatLegend map={map} recommended={recommended} />);
};

describe("SeatLegend", () => {
  it("lists every state the house contains, in the order the design gives them", () => {
    /*
     * Six rows, so the recommendation window is the back three and the special seats in
     * the front three keep their own tone. Put inside the window they would render green
     * and their key would vanish from the list
     */
    const full = house([
      [seat("c0"), seat("c1", { kind: "Dbox" })],
      [seat("c2", { occupied: true }), seat("c3", { kind: "Companion" })],
      [seat("c4", { kind: "Wheelchair" }), seat("c5")],
      Array.from({ length: 9 }, (_, i) => seat(`d${i}`)),
      Array.from({ length: 9 }, (_, i) => seat(`e${i}`)),
      Array.from({ length: 9 }, (_, i) => seat(`f${i}`)),
    ]);
    expect(labelsOf(draw(full).container)).toEqual([
      "Standard",
      "D-BOX",
      "Recommended",
      "Occupied",
      "Companion",
      "Wheelchair",
    ]);
  });

  /*
   * Hidden entry by entry, and the per-seat names are why that is safe: a reader would
   * otherwise hear six colour swatches it cannot see before reaching the map
   *
   * The Recommended entry is deliberately not hidden, because its explainer is the one
   * thing on the bar that no seat name carries, and because a focusable button inside an
   * `aria-hidden` subtree is a tab stop a screen reader cannot reach
   */
  it("hides the colour swatches but not the explainer", () => {
    const { container } = draw(
      house([
        [seat("c0", { occupied: true }), seat("c1")],
        Array.from({ length: 9 }, (_, column) => seat(`d${column}`)),
      ]),
    );
    const hidden = [...container.querySelectorAll('[data-slot="badge"]')].map((el) => ({
      label: el.textContent?.trim(),
      hidden: el.getAttribute("aria-hidden"),
    }));
    expect(hidden).toEqual([
      { label: "Standard", hidden: "true" },
      { label: "Recommended", hidden: null },
      { label: "Occupied", hidden: "true" },
    ]);

    // The only focusable thing on the bar, and it sits in the one exposed entry
    const focusable = container.querySelectorAll("a, button, input, [tabindex]");
    expect(focusable).toHaveLength(1);
    expect(focusable[0]?.closest("[aria-hidden]")).toBeNull();
  });

  // A bare "?" reads as nothing, so the button says what it is for
  it("names the explainer button", () => {
    const { container } = draw(house([[seat("c0"), seat("c1")], [seat("c2")]]));
    expect(container.querySelector("button")).toHaveAccessibleName(
      "What makes a seat recommended?",
    );
  });

  /*
   * Four of the six entries use the same armchair, so counting svgs proves nothing about
   * whether they are distinguishable. What matters is that each is drawn the way the map
   * draws it: the occupied chair filled, the recommended one at the heavier stroke
   */
  it("draws each entry the way the map draws that state", () => {
    // Nine seats in the back row so the recommendation lands somewhere, and one taken
    // seat in the front row so `occupied` is listed too
    const { container } = draw(
      house([
        [seat("c0", { occupied: true }), seat("c1")],
        Array.from({ length: 9 }, (_, column) => seat(`d${column}`)),
      ]),
    );
    const glyph = (key: string) => container.querySelector(`[data-legend="${key}"]`);

    expect(glyph("occupied")).toHaveAttribute("fill", "currentColor");
    /*
     * ...and at the map's second alpha, imported rather than restated. The parity test
     * below compares class-name tables, so a numeric opacity cannot enter it: this is the
     * only thing standing between the legend and the map on the newest way they can differ
     */
    expect(glyph("occupied")).toHaveAttribute("fill-opacity", String(OCCUPIED_FILL_OPACITY));
    expect(glyph("standard")).toHaveAttribute("fill", "none");
    expect(glyph("standard")).not.toHaveAttribute("fill-opacity");
    expect(glyph("recommended")).toHaveAttribute("stroke-width", "3");
    expect(glyph("standard")).not.toHaveAttribute("stroke-width", "3");
  });
});

/*
 * The legend's whole job is explaining the map's colours, and the two keep separate
 * tables of them. The classes are compared directly, because a swatch that has drifted
 * from the seat it describes is worse than no swatch: it teaches the wrong code, and
 * every other assertion here passes while it does
 */
describe("SeatLegend and SeatMap tones", () => {
  it("paints each state the colour the map paints it", () => {
    expect(LEGEND_TONES).toEqual({ ...TONE, recommended: RECOMMENDED_TONE });
  });
});
