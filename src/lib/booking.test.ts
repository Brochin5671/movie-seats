import { describe, expect, it } from "vitest";
import { bookingUrl } from "./booking";

/*
 * One shape, asserted whole. A `toContain("theatreId=7249")` would pass with the two ids
 * swapped, which is the mistake this function exists to make impossible, so the ids in
 * the fixture are deliberately unalike
 */

describe("bookingUrl", () => {
  it("builds the ticketing preview link for a theatre and a screening", () => {
    expect(bookingUrl(7249, 326227)).toBe(
      "https://www.cineplex.com/ticketing/preview?theatreId=7249&showtimeId=326227",
    );
  });
});
