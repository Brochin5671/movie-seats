import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Seat, SeatMap as SeatMapData } from "@/lib/cineplex/types";
import { optimalSeatIds } from "@/lib/seating";
import { SeatMap } from "./SeatMap";

/*
 * The contract a screen reader and a pointer both depend on: every seat is named with
 * its state, and every seat sits in the column the data says it does. Colours are not
 * asserted here, they are in the browser tier where a computed style exists
 */

/** Renders the map the way the page does, deriving the recommended set from the house */
const Seats = ({ map }: { map: SeatMapData }) => (
  <SeatMap map={map} recommended={optimalSeatIds(map.rows)} />
);

const seat = (id: string, column: number, over: Partial<Seat> = {}): Seat => ({
  id,
  label: id,
  column,
  kind: "Standard",
  occupied: false,
  ...over,
});

const map = (rows: SeatMapData["rows"], totalColumns = 6): SeatMapData => ({
  rows,
  totalColumns,
  total: rows.flatMap((r) => r.seats).length,
  occupied: rows.flatMap((r) => r.seats).filter((s) => s.occupied).length,
  isSoldOut: false,
});

describe("SeatMap", () => {
  /*
   * Two rows, and the assertions are on the front one. With a single row every centre
   * seat is also the recommended seat, so the names would all carry ", recommended" and
   * the test would be asserting the wrong thing
   */
  it("names each seat with its label, kind and status", () => {
    render(
      <Seats
        map={map([
          {
            label: "GG",
            physicalNumber: 2,
            seats: [
              seat("GG22", 0),
              seat("GG21", 1, { occupied: true }),
              seat("GG20", 2, { kind: "Wheelchair" }),
              seat("GG19", 3, { kind: "Dbox" }),
            ],
          },
          { label: "FF", physicalNumber: 1, seats: [seat("FF1", 0), seat("FF2", 1)] },
        ])}
      />,
    );
    expect(screen.getByRole("img", { name: "GG22, standard, available" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "GG21, standard, occupied" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "GG20, wheelchair, available" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "GG19, D-BOX, available" })).toBeInTheDocument();
  });

  /*
   * Occupied wins over kind. A taken D-BOX seat that still reads as D-BOX invites a
   * reader to try to book it
   */
  it("reports a taken seat as occupied whatever its kind", () => {
    render(
      <Seats
        map={map([
          {
            label: "A",
            physicalNumber: 1,
            seats: [seat("A1", 0, { kind: "Dbox", occupied: true })],
          },
        ])}
      />,
    );
    expect(screen.getByRole("img", { name: "A1, D-BOX, occupied" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /occupied/ })).toHaveAttribute("data-state", "occupied");
  });

  /*
   * Positioned by its own column, so a gap inside a row survives. Rendering seats in
   * document order instead would silently close every gap and misreport the house
   */
  it("places a seat in the grid column its data names", () => {
    render(
      <Seats
        map={map([{ label: "A", physicalNumber: 1, seats: [seat("A1", 0), seat("A9", 4)] }])}
      />,
    );
    // 0-based upstream, 1-based in CSS
    expect(screen.getByRole("img", { name: /A1,/ })).toHaveStyle({ gridColumnStart: "1" });
    expect(screen.getByRole("img", { name: /A9,/ })).toHaveStyle({ gridColumnStart: "5" });
  });

  /*
   * `physicalNumber` restarts at 1 in every upstream area. The projection keeps the standard
   * area's on a merged row, so a normal house no longer produces a duplicate, but an overlay
   * landing past the end of the list is appended carrying its own: that is the shape below.
   * Keyed by the number, React reconciles the pair as one child
   *
   * The warning is the assertion rather than a proxy for it, because React does render both
   * rows on the first pass and only diverges once a refresh re-reconciles them
   */
  it("keys rows so two areas numbered from one do not collide", () => {
    const warn = vi.spyOn(console, "error").mockImplementation(() => {});
    const { container } = render(
      <Seats
        map={map([
          { label: "A", physicalNumber: 1, seats: [seat("A1", 0)] },
          { label: "G", physicalNumber: 1, seats: [seat("G1", 1)] },
        ])}
      />,
    );
    expect(warn.mock.calls.flat().join(" ")).not.toMatch(/same key/i);
    expect(container.querySelectorAll('[data-slot="seat"]')).toHaveLength(2);
  });

  it("renders an aisle as a gap with no seats", () => {
    const { container } = render(
      <Seats
        map={map([
          { label: "A", physicalNumber: 2, seats: [seat("A1", 0)] },
          { label: null, physicalNumber: 1, seats: [] },
        ])}
      />,
    );
    expect(screen.getAllByRole("img")).toHaveLength(1);
    // hidden rather than announced: an aisle is not a place anyone sits
    expect(container.querySelectorAll('[aria-hidden="true"].h-2')).toHaveLength(1);
  });

  /*
   * A scrollable region has to be reachable without a pointer, and an unnamed group is
   * dropped from the accessibility tree, taking its scrollability with it
   */
  it("gives the scroller a name and a tab stop", () => {
    render(<Seats map={map([{ label: "A", physicalNumber: 1, seats: [seat("A1", 0)] }])} />);
    const scroller = screen.getByRole("region", { name: /seat map/i });
    expect(scroller).toHaveAttribute("tabindex", "0");
  });

  it("marks the recommended seats so they are named as such", () => {
    render(
      <Seats
        map={map(
          Array.from({ length: 6 }, (_, index) => ({
            label: `R${index}`,
            physicalNumber: 6 - index,
            seats: Array.from({ length: 9 }, (_, column) => seat(`R${index}C${column}`, column)),
          })),
          9,
        )}
      />,
    );
    const recommended = screen.getAllByRole("img", { name: /recommended$/ });
    expect(recommended.length).toBeGreaterThan(0);
    for (const element of recommended) {
      expect(element).toHaveAttribute("data-recommended", "true");
    }
  });

  /*
   * The map shows availability; it does not sell seats. Booking happens on Cineplex,
   * so a seat must never look pickable: no button, no link, no tab stop and no click
   * handler. `role="img"` says the same thing to a screen reader
   */
  it("renders seats as read-only, never as something to pick", () => {
    const { container } = render(
      <Seats
        map={map([
          { label: "A", physicalNumber: 2, seats: [seat("A1", 0), seat("A2", 1)] },
          { label: "B", physicalNumber: 1, seats: [seat("B1", 0)] },
        ])}
      />,
    );
    const seats = container.querySelectorAll('[data-slot="seat"]');
    expect(seats.length).toBe(3);
    for (const element of seats) {
      expect(element.tagName).toBe("SPAN");
      expect(element).toHaveAttribute("role", "img");
      expect(element).not.toHaveAttribute("tabindex");
      expect(element.closest("button, a, [role='button'], [role='checkbox']")).toBeNull();
    }
    // the scroller is the only tab stop the map contributes
    expect(container.querySelectorAll("[tabindex]")).toHaveLength(1);
  });
});
