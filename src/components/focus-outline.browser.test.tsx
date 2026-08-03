import { expect, test } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import type { SeatMap as SeatMapData } from "@/lib/cineplex/types";
import { SeatMap } from "./custom/SeatMap";

/*
 * The `focus-outline` utility on the one element this app focuses
 *
 * happy-dom cannot see this: it resolves no custom properties, so
 * `outline-style: var(--tw-outline-style)` reads back as the empty string rather than as
 * whatever the cascade produced
 *
 * The hazard is specific to Tailwind 4. `outline-none` compiles to
 * `--tw-outline-style: none; outline-style: none`, and `outline-1` to
 * `outline-style: var(--tw-outline-style); outline-width: 1px`, so an element carrying
 * both resolves its focused outline through a variable it has pinned to `none`: every
 * class is present, the width applies, nothing paints. `focus-outline` sets the style
 * directly so the variable cannot defeat it
 *
 * It matters on the seat scroller because that is a keyboard-reachable region whose only
 * other indicator would be a `ring-*` box-shadow, and box-shadow is not painted under
 * `forced-colors: active`
 */

const house: SeatMapData = {
  rows: [
    {
      label: "A",
      physicalNumber: 1,
      seats: [{ id: "a1", label: "A1", column: 0, kind: "Standard", occupied: false }],
    },
  ],
  totalColumns: 1,
  total: 1,
  occupied: 0,
  isSoldOut: false,
};

// The resolved value, not the class list: the class list was correct throughout the bug
test("the seat scroller paints an outline when focused by keyboard", async () => {
  const screen = await render(<SeatMap map={house} recommended={new Set()} />);
  const scroller = screen.container.querySelector('[data-slot="seat-scroller"]') as HTMLElement;

  expect(getComputedStyle(scroller).outlineStyle).toBe("none");

  // A real Tab, because `.focus()` does not always satisfy `:focus-visible`
  await userEvent.tab();
  expect(document.activeElement).toBe(scroller);

  const focused = getComputedStyle(scroller);
  expect(focused.outlineStyle).toBe("solid");
  expect(Number.parseFloat(focused.outlineWidth)).toBeGreaterThan(0);
});
