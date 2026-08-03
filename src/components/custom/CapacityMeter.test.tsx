import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { SeatMap } from "@/lib/cineplex/types";
import { CapacityMeter } from "./CapacityMeter";

/*
 * The meter's three jobs: report the numbers to assistive tech, never let its colour
 * disagree with its own label, and say how old the answer is when it is given one
 */

const row = (label: string, count: number, taken = 0) => ({
  label,
  physicalNumber: 1,
  seats: Array.from({ length: count }, (_, i) => ({
    id: `${label}-${i}`,
    label: `${label}${i}`,
    column: i,
    kind: "Standard" as const,
    occupied: i < taken,
  })),
});

const map = (rows: SeatMap["rows"], isSoldOut = false): SeatMap => {
  const seats = rows.flatMap((r) => r.seats);
  return {
    rows,
    totalColumns: 10,
    total: seats.length,
    occupied: seats.filter((s) => s.occupied).length,
    isSoldOut,
  };
};

describe("CapacityMeter", () => {
  it("exposes the counts through the meter role", () => {
    render(<CapacityMeter map={map([row("a", 10, 2)])} />);
    const meter = screen.getByRole("meter", { name: "Capacity" });
    expect(meter).toHaveAttribute("aria-valuenow", "2");
    expect(meter).toHaveAttribute("aria-valuemax", "10");
  });

  it("reads the fraction while seats remain", () => {
    render(<CapacityMeter map={map([row("a", 10, 2)])} />);
    expect(screen.getByText("2/10")).toBeInTheDocument();
  });

  /*
   * FULL replaces the fraction, rather than sitting beside it. `10/10` is technically
   * true and useless: the reader wants to know there is nothing left
   */
  it("reads FULL once nothing is left", () => {
    render(<CapacityMeter map={map([row("a", 10, 10)])} />);
    expect(screen.getByText("FULL")).toBeInTheDocument();
    expect(screen.queryByText("10/10")).not.toBeInTheDocument();
  });

  /*
   * Colour and text have to agree. Upstream can flag a screening sold out while its seat
   * map still shows seats free, and passing that flag to the label but not the tone
   * paints a green bar at 13% next to the word FULL
   */
  it("paints danger, not safe, whenever it reads FULL", () => {
    render(<CapacityMeter map={map([row("a", 10, 2)], true)} />);
    expect(screen.getByText("FULL")).toBeInTheDocument();
    expect(screen.getByRole("meter", { name: "Capacity" })).toHaveAttribute("data-tone", "danger");
  });

  it("warns when the only free seats are near the screen", () => {
    render(<CapacityMeter map={map([row("a", 5), row("b", 5, 5), row("c", 5, 5)])} />);
    expect(screen.getByText("seating is poor :/")).toBeInTheDocument();
  });

  /*
   * The pair that must never appear together. A sold-out house has no seating to have
   * an opinion about, and `every` over an empty list would otherwise say it is poor
   */
  it("never shows the poor-seating line beside a FULL meter", () => {
    render(<CapacityMeter map={map([row("a", 5, 5), row("b", 5, 5), row("c", 5, 5)])} />);
    expect(screen.getByText("FULL")).toBeInTheDocument();
    expect(screen.queryByText("seating is poor :/")).not.toBeInTheDocument();
  });
});

/*
 * The freshness line is optional, and the absent case is the one nothing else covers:
 * `SeatFinder` always passes a label once a map is on screen, so only here can the
 * no-prop path be seen. Rendering an empty paragraph instead of nothing would leave a
 * gap under the meter that the caller never asked for
 */
describe("the freshness line", () => {
  // Free seats only at the back, so the poor-seating paragraph stays away and a count of
  // paragraphs is a count of this one
  const roomy = () => map([row("a", 5, 5), row("b", 5, 5), row("c", 5)]);

  it("renders what it is given", () => {
    const { container } = render(
      <CapacityMeter map={roomy()} freshness="Updated since 2:03:22 PM" />,
    );
    expect(screen.getByText("Updated since 2:03:22 PM")).toBeInTheDocument();
    // the positive control for the two below, since one paragraph is what they count down from
    expect(container.querySelectorAll("p")).toHaveLength(1);
  });

  it.each([
    ["the prop is absent", undefined],
    ["the prop is null", null],
  ])("renders no paragraph at all when %s", (_name, freshness) => {
    const { container } = render(<CapacityMeter map={roomy()} freshness={freshness} />);
    expect(container.querySelectorAll("p")).toHaveLength(0);
  });
});
