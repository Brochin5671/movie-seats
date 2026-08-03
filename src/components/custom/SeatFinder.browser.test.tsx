import { beforeEach, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { SeatFinder } from "./SeatFinder";

/*
 * The three selects and how they line up, which only a real layout can answer
 *
 * The showtime select is sized against the two above it with `calc(50% - 0.5rem)`, where
 * the half comes from their `flex-1` and the 0.5rem from the Stack's `gap-4`. That is
 * arithmetic about another component's default, so it breaks silently: nothing about the
 * class says which gap it was derived from
 *
 * The island fetches its catalogues on mount and there is no server here, so `fetch` is
 * stubbed. Only the two boot calls matter: the selects have to be enabled and laid out,
 * and nothing below depends on a showtime being chosen
 */

const theatre = {
  id: 7249,
  name: "Galaxy Cinemas Barrie",
  city: "Barrie",
  province: "ON",
  latitude: 0,
  longitude: 0,
  distanceMeters: null,
};
const movie = {
  id: 37997,
  name: "Spider-Man: Brand New Day",
  runtimeInMinutes: 145,
  genres: [],
  releaseDate: "2026-07-31",
  posterUrl: null,
  isNowPlaying: true,
  isComingSoon: false,
};

/** One screening and a four-seat house, for the case that needs a rendered map */
const session = {
  sessionId: 328257,
  auditorium: "Aud 11",
  start: "2026-08-02T19:10:00",
  experiences: [],
  seatsRemaining: 3,
  isSoldOut: false,
};
const seatMap = {
  rows: [
    {
      label: "A",
      physicalNumber: 1,
      seats: Array.from({ length: 4 }, (_, i) => ({
        id: `a${i}`,
        label: `A${i + 1}`,
        column: i,
        kind: "Standard" as const,
        occupied: i === 0,
      })),
    },
  ],
  totalColumns: 4,
  total: 4,
  occupied: 1,
  isSoldOut: false,
};

beforeEach(() => {
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const url = String(input);
    // Ordered longest-path first: `/api/theatres` is a substring of nothing here, but
    // `/api/narrow/theatres` contains it, so a loose check would answer the wrong shape
    const body = url.includes("/api/narrow/movies")
      ? { filmIds: [movie.id] }
      : url.includes("/api/narrow/theatres")
        ? { theatreIds: [theatre.id] }
        : url.includes("/api/showtimes")
          ? [session]
          : url.includes("/api/seats")
            ? seatMap
            : url.includes("/api/theatres")
              ? [theatre]
              : url.includes("/api/movies")
                ? [movie]
                : [];
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
});

/*
 * The `Field` wrapper, not the `<input>`. The input sits inside an `InputGroup` with its
 * own padding, so its box is inset from the thing actually being sized and its edges are
 * not the ones a reader sees line up
 */
const fieldOf = (root: HTMLElement, id: string) =>
  (root.querySelector(`#${id}`) as HTMLElement).closest('[data-slot="field"]') as HTMLElement;

const widthOf = (root: HTMLElement, id: string) => fieldOf(root, id).getBoundingClientRect().width;

test("the showtime select matches the width of the two above it", async () => {
  await page.viewport(1024, 800);
  const screen = await render(
    <div style={{ width: "704px" }}>
      <SeatFinder />
    </div>,
  );
  await expect.element(screen.getByLabelText("Showtimes")).toBeVisible();
  const root = screen.container;

  const theatres = widthOf(root, "theatre-select");
  const movies = widthOf(root, "movie-select");
  const showtimes = widthOf(root, "showtime-select");

  // Guards the comparison: the two above have to be side by side, or all three are
  // trivially the same full width and the assertion says nothing
  expect(theatres).toBe(movies);
  expect(theatres).toBeLessThan(704);

  expect(showtimes).toBe(theatres);
});

test("...and sits centred under them", async () => {
  await page.viewport(1024, 800);
  const screen = await render(
    <div style={{ width: "704px" }}>
      <SeatFinder />
    </div>,
  );
  await expect.element(screen.getByLabelText("Showtimes")).toBeVisible();

  const outer = (screen.container.firstElementChild as HTMLElement).getBoundingClientRect();
  const field = fieldOf(screen.container, "showtime-select").getBoundingClientRect();

  // Equal gutters, which is what separates centred from merely half-width
  expect(Math.round(field.left - outer.left)).toBe(Math.round(outer.right - field.right));
});

/*
 * Below the breakpoint the Stack turns vertical and the two above go full width, so the
 * third has to as well. A cap that stayed on would leave it half the width of its
 * siblings on a phone, which is the exact opposite of the alignment above
 */
test("all three go full width once the row stacks", async () => {
  await page.viewport(390, 800);
  const screen = await render(
    <div style={{ width: "390px" }}>
      <SeatFinder />
    </div>,
  );
  await expect.element(screen.getByLabelText("Showtimes")).toBeVisible();
  const root = screen.container;

  expect(widthOf(root, "showtime-select")).toBe(widthOf(root, "theatre-select"));
  expect(widthOf(root, "showtime-select")).toBe(390);
});

/*
 * The map and its legend are one surface, not two stacked ones
 *
 * `SeatFinder` wraps them in a `Stack gap="none"` and rounds away the corners where they
 * meet, so the pair reads as a single panel with a footer. `Stack`'s default gap is 16px,
 * and dropping the prop opens that much daylight between two edges deliberately squared
 * off for each other
 *
 * Rendered through `SeatFinder` rather than by composing the pair here. A local `Stack`
 * with `gap="none"` passed in the test would assert that `none` means `gap-0`, which is
 * `Stack`'s contract restated from a literal the test supplies, and would stay green with
 * the prop deleted from the component
 */
test("the legend sits flush against the seat map", async () => {
  await page.viewport(1024, 900);
  const screen = await render(<SeatFinder />);

  await expect.element(screen.getByLabelText("Showtimes")).toBeVisible();
  await screen.getByLabelText("Theatres").click();
  await screen.getByRole("option", { name: /Galaxy Cinemas Barrie/ }).click();
  await screen.getByLabelText("Movies").click();
  await screen.getByRole("option", { name: /Spider-Man/ }).click();
  await screen.getByLabelText("Showtimes").click();
  await screen.getByRole("option", { name: "7:10 PM" }).click();

  const legend = await vi.waitUntil(() =>
    screen.container.querySelector<HTMLElement>('[data-slot="seat-legend"]'),
  );
  // Its parent is the wrapper under test, and its sibling is the map
  const wrapper = legend.parentElement as HTMLElement;
  const [mapPanel, legendPanel] = [...wrapper.children] as HTMLElement[];

  // Both rendered, or the arithmetic below is over two empty boxes
  expect(mapPanel?.getBoundingClientRect().height).toBeGreaterThan(0);
  expect(legendPanel?.getBoundingClientRect().height).toBeGreaterThan(0);
  expect(
    (legendPanel as HTMLElement).getBoundingClientRect().top -
      (mapPanel as HTMLElement).getBoundingClientRect().bottom,
  ).toBe(0);
});

/*
 * The refresh control is a real target, unlike the seat cells
 *
 * A `role="img"` span with no handler is outside SC 2.5.8; a button is not, and 24 x 24 is
 * the minimum. `size="icon-xs"` resolves to `size-6`, which is 24px only while nothing
 * overrides Tailwind's `--spacing`, and the base Button carries a transparent border that
 * would push the box out under `content-box`. Both are measured here rather than assumed
 */
test("the refresh control is at least the minimum target size", async () => {
  await page.viewport(1024, 900);
  const screen = await render(<SeatFinder />);

  await expect.element(screen.getByLabelText("Showtimes")).toBeVisible();
  await screen.getByLabelText("Theatres").click();
  await screen.getByRole("option", { name: /Galaxy Cinemas Barrie/ }).click();
  await screen.getByLabelText("Movies").click();
  await screen.getByRole("option", { name: /Spider-Man/ }).click();
  await screen.getByLabelText("Showtimes").click();
  await screen.getByRole("option", { name: "7:10 PM" }).click();

  const control = await vi.waitUntil(() =>
    screen.container.querySelector<HTMLElement>('[aria-label="Refresh the seat map"]'),
  );
  const box = control.getBoundingClientRect();
  expect(box.width).toBe(24);
  expect(box.height).toBe(24);

  /*
   * ...and the meter beside it still fills the row. `Meter` is `flex flex-wrap` with a
   * `w-full` track, so without `flex-1` it collapses to its content: measured at 91px in a
   * 600px column against 568px with it, a change nothing else in any tier can see
   */
  const meter = screen.container.querySelector('[data-slot="meter"]') as HTMLElement;
  const row = meter.parentElement as HTMLElement;
  const gap = 8;
  expect(meter.getBoundingClientRect().width).toBe(row.getBoundingClientRect().width - 24 - gap);
});
