import { expect, test } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import type { SeatMap as SeatMapData } from "@/lib/cineplex/types";
import { optimalSeatIds } from "@/lib/seating";
import { SeatLegend } from "./SeatLegend";
import { OCCUPIED_FILL_OPACITY, SeatMap } from "./SeatMap";

/*
 * Real layout and real computed styles, which is the whole reason these are not in the
 * happy-dom tier: a collapsed grid track, a token that resolves to nothing, and a cell
 * that is not the size it claims all measure fine in a fake DOM
 */

/*
 * `page.viewport()` is shared across every file in the run, and more than one of them now
 * sets it, so a test that needs a particular width has to say so rather than inherit
 * whatever ran last. The narrow-viewport case below sets its own
 */
const DESKTOP = { width: 1024, height: 768 };

/** Renders the map the way the page does, deriving the recommended set from the house */
const Seats = ({ map }: { map: SeatMapData }) => (
  <SeatMap map={map} recommended={optimalSeatIds(map.rows)} />
);

/** ...and the legend beside it, from the same set, which is the point of deriving once */
const Legend = ({ map }: { map: SeatMapData }) => (
  <SeatLegend map={map} recommended={optimalSeatIds(map.rows)} />
);

/** One available standard seat, for the cases that build a row by hand */
const cell = (id: string, column: number) => ({
  id,
  label: id,
  column,
  kind: "Standard" as const,
  occupied: false,
});

const house = (rows: number, seatsPerRow: number, totalColumns: number): SeatMapData => ({
  rows: Array.from({ length: rows }, (_, r) => ({
    label: `R${r}`,
    physicalNumber: rows - r,
    seats: Array.from({ length: seatsPerRow }, (_, c) => ({
      id: `R${r}C${c}`,
      label: `R${r}C${c}`,
      column: c,
      kind: "Standard" as const,
      occupied: false,
    })),
  })),
  totalColumns,
  total: rows * seatsPerRow,
  occupied: 0,
  isSoldOut: false,
});

/*
 * The legend bar's surface has to actually paint. A `@theme inline` entry whose backing
 * custom property is missing resolves to an invalid value and the element renders
 * transparent, which no class-name assertion can see
 */
test("the legend paints the ink surface from the palette token", async () => {
  await page.viewport(DESKTOP.width, DESKTOP.height);
  const screen = await render(<Legend map={house(3, 4, 6)} />);
  const bar = screen.container.querySelector('[data-slot="seat-legend"]') as HTMLElement;
  await expect.element(screen.getByText("Standard")).toBeVisible();
  // #270e0e
  expect(getComputedStyle(bar).backgroundColor).toBe("rgb(39, 14, 14)");
});

/*
 * The one control on the legend bar is a target you can actually hit
 *
 * SC 2.5.8 puts the floor at 24 x 24. This was 22, carried only by the spacing exception,
 * and nothing in any tier measured it. The box alone is not enough either: `Badge` is
 * `overflow-hidden` around an 18px padding box at its default height, and an overflow clip
 * removes the clipped strip from hit testing, so a bigger button inside an unchanged badge
 * reports a box it does not own
 */
test("the legend's explainer is a target big enough to press", async () => {
  await page.viewport(DESKTOP.width, DESKTOP.height);
  const screen = await render(<Legend map={paletteHouse()} />);
  const trigger = screen.container.querySelector("button") as HTMLElement;
  await expect.element(screen.getByRole("button", { name: /recommended/i })).toBeVisible();

  // 6px either side of a 16px glyph
  const box = trigger.getBoundingClientRect();
  expect(box.width).toBe(28);
  expect(box.height).toBe(28);

  /*
   * ...and the bottom edge of that box belongs to the button, not to whatever clipped it
   *
   * Half a pixel in, not two: probed at `bottom - 2` a badge one quarter-step short
   * (`h-7`, clipping 1px either side) still answered with the button, so the assertion
   * passed over a clip it is there to catch
   */
  const hit = document.elementFromPoint(box.left + box.width / 2, box.bottom - 0.5);
  expect(trigger.contains(hit)).toBe(true);
});

/*
 * The cell is 20px around a 14px glyph, and both numbers are exact rather than floors
 *
 * Not a tap target. The seat is a `role="img"` span with no handler and no tabindex, so
 * WCAG 2.5.8 does not apply and the cell is sized to fit a house on a phone: 20px is what
 * puts a 26-column auditorium at 545px instead of 649px. The padding is what keeps the
 * glyph off its neighbours, so the two sizes are asserted together
 */
test("a seat cell is 20px around a smaller glyph", async () => {
  await page.viewport(DESKTOP.width, DESKTOP.height);
  const screen = await render(<Seats map={house(3, 4, 6)} />);
  const seat = screen.container.querySelector('[data-slot="seat"]') as HTMLElement;
  await expect.element(screen.getByRole("region", { name: /seat map/i })).toBeVisible();

  const box = seat.getBoundingClientRect();
  expect(box.width).toBe(20);
  expect(box.height).toBe(20);

  const glyph = seat.querySelector("svg") as SVGElement;
  expect(glyph.getBoundingClientRect().width).toBe(14);
});

/*
 * The map scrolls; the page does not. A grid track with a zero minimum collapses under
 * a narrow viewport, so the house squeezes into the screen and the seats overlap rather
 * than the scroller overflowing
 */
test("a wide house overflows the scroller instead of the viewport", async () => {
  await page.viewport(360, 720);
  /*
   * Rendered inside the containment the real page provides: a fixed-width column, the
   * way `Container` wraps `Stack`. Rendered bare, the map is free to be as wide as it
   * likes and the assertions below pass whatever the grid tracks do, which is how a
   * collapsed track and a missing `min-w-0` both went unnoticed
   */
  const screen = await render(
    <div style={{ width: "340px", display: "flex", flexDirection: "column" }}>
      <Seats map={house(2, 26, 26)} />
    </div>,
  );
  const scroller = screen.container.querySelector('[data-slot="seat-scroller"]') as HTMLElement;
  await expect.element(screen.getByRole("region", { name: /seat map/i })).toBeVisible();

  // the map stays inside its column...
  expect(scroller.clientWidth).toBeLessThanOrEqual(340);
  // ...and the house that does not fit is scrolled to, not squeezed or clipped
  expect(scroller.scrollWidth).toBeGreaterThan(scroller.clientWidth);
  scroller.scrollLeft = scroller.scrollWidth;
  expect(scroller.scrollLeft).toBeGreaterThan(0);

  // every seat keeps its full width rather than collapsing to fit. Exact, not a floor:
  // the grid track is fixed at 1.25rem precisely so a column cannot shrink under pressure
  const seat = scroller.querySelector('[data-slot="seat"]') as HTMLElement;
  expect(seat.getBoundingClientRect().width).toBe(20);
});

/*
 * ...and both ends of the house are reachable
 *
 * The case above proves there is somewhere to scroll, not that anything arrives. Both edges,
 * because the right one is nearly a CSSOM identity after a maximum scroll while the left is
 * where the reachable failure lives: drop `w-max` and `items-center` centres a 545px row in
 * a 340px column, so the first seats sit at negative x, `scrollLeft` clamps at 0, and they
 * cannot be reached by pointer, keyboard or touch. Every other case in this file stays green
 * through that
 */
test("a wide house is reachable at both ends", async () => {
  await page.viewport(360, 720);
  const screen = await render(
    <div style={{ width: "340px", display: "flex", flexDirection: "column" }}>
      <Seats map={house(2, 26, 26)} />
    </div>,
  );
  const scroller = screen.container.querySelector('[data-slot="seat-scroller"]') as HTMLElement;
  await expect.element(screen.getByRole("region", { name: /seat map/i })).toBeVisible();

  const seats = [...scroller.querySelectorAll('[data-slot="seat"]')] as HTMLElement[];
  const first = seats[0] as HTMLElement;
  const last = seats.at(-1) as HTMLElement;
  // the premise: the house does not fit, or reaching its ends is not an achievement
  expect(last.getBoundingClientRect().right).toBeGreaterThan(
    scroller.getBoundingClientRect().right,
  );

  // unscrolled, the first seat is already inside: nothing sits to the left of scroll zero
  expect(first.getBoundingClientRect().left).toBeGreaterThanOrEqual(
    scroller.getBoundingClientRect().left,
  );

  scroller.scrollLeft = scroller.scrollWidth - scroller.clientWidth;
  expect(last.getBoundingClientRect().right).toBeLessThanOrEqual(
    scroller.getBoundingClientRect().right,
  );
});

/*
 * Every row is drawn as its own grid, and the house lines up only while they all declare the
 * same track count
 *
 * A seat past `totalColumns` opens implicit tracks, which widens that one row, and
 * `items-center` on the column then re-centres it against the rest: the row slides sideways
 * and its column 1 stops being above everyone else's. That is what a D-BOX block numbered
 * against its own area used to do, and nothing in any tier measured it. Row A is the short
 * one, so the mutation moves the row that carries the assertions
 */
test("a column lands at the same x in every row", async () => {
  await page.viewport(DESKTOP.width, DESKTOP.height);
  const wide: SeatMapData = {
    rows: [
      { label: "A", physicalNumber: 2, seats: [cell("A0", 0), cell("A1", 1), cell("A2", 2)] },
      { label: "B", physicalNumber: 1, seats: [cell("B0", 0), cell("B1", 1), cell("B8", 8)] },
    ],
    totalColumns: 3,
    total: 6,
    occupied: 0,
    isSoldOut: false,
  };
  const screen = await render(<Seats map={wide} />);
  await expect.element(screen.getByRole("img", { name: /^B8,/ })).toBeVisible();

  const left = (label: string) =>
    (
      screen.container.querySelector(`[aria-label^="${label},"]`) as HTMLElement
    ).getBoundingClientRect().left;

  // the premise: the rows hold different columns, so equal x is not free
  expect(left("A2")).not.toBe(left("B8"));
  expect(left("A0")).toBe(left("B0"));
  expect(left("A1")).toBe(left("B1"));

  /*
   * ...and both grids really declare the widened count, which is what makes that true. Nine
   * tracks from a seat at column 8, against the three the layout claimed
   */
  const grids = [
    ...screen.container.querySelectorAll<HTMLElement>('[data-slot="seat-scroller"] .grid'),
  ];
  expect(grids.map((grid) => getComputedStyle(grid).gridTemplateColumns.split(" ").length)).toEqual(
    [9, 9],
  );
});

/*
 * The scrollbar is a control boundary, not decoration
 *
 * Unnamed it takes the platform's tones against `color-scheme: dark`, which on this
 * near-black surface is a grey the reader can miss. There is no axe rule for non-text
 * contrast, and once the author sets `scrollbar-color` the "determined by the user agent"
 * exception in SC 1.4.11 is spent, so the 3:1 floor applies here the way it applies to a
 * seat glyph. Thumb against track, because the track is what the thumb is drawn on
 *
 * Colour and nothing else, for two reasons. The same user-agent clause in SC 2.5.8 is what
 * excuses a thumb from the 24px target floor it could never reach, and authoring a
 * `scrollbar-width` would spend that too; `scrollbar-color` changes no dimension. And a
 * `scrollbar-gutter` would reserve the band beside every house, including the ones that fit
 *
 * What colour cannot fix: where the platform draws an overlay scrollbar the bar occupies no
 * layout space and fades out at rest whatever it is painted. That is why the measurement
 * below is a contrast ratio rather than a size, and why no test here asserts the bar is
 * on screen
 */
test("the scroller paints a scrollbar the reader can find", async () => {
  await page.viewport(360, 720);
  const screen = await render(
    <div style={{ width: "340px", display: "flex", flexDirection: "column" }}>
      <Seats map={house(2, 26, 26)} />
    </div>,
  );
  const scroller = screen.container.querySelector('[data-slot="seat-scroller"]') as HTMLElement;
  await expect.element(screen.getByRole("region", { name: /seat map/i })).toBeVisible();
  // the premise: nothing paints a scrollbar on a house that fits
  expect(scroller.scrollWidth).toBeGreaterThan(scroller.clientWidth);

  // Two resolved colours, never `auto`, which is the value the defect wore
  const colours = getComputedStyle(scroller).scrollbarColor.match(/rgba?\([^)]*\)/g) ?? [];
  expect(colours).toHaveLength(2);
  const [thumb, track] = colours as [string, string];

  const surface = getComputedStyle(scroller.parentElement as HTMLElement).backgroundColor;
  const ratio = contrast(paint(thumb, surface), paint(track, surface));
  expect(ratio).toBeGreaterThanOrEqual(3);
  // ...and the value, not just the floor, because 6.50 is what the prose around this cites
  expect(ratio).toBeCloseTo(6.5, 1);
  /*
   * ...and the track is painted the surface it sits on, so the thumb is the only mark on
   * the panel. The resolved colours, not the composited pixels: a transparent track
   * composites to the same pixels and would pass while declaring something else
   */
  expect(track).toBe(surface);
});

/*
 * Availability must not be carried by colour alone
 *
 * A taken seat and a free one share the armchair glyph, so with only a fill change
 * between them the map's primary information is unreadable to anyone who cannot
 * separate those two colours. axe has no rule for this, and repainting occupied to
 * match standard passes every other tier
 */
test("an occupied seat differs from a free one by more than its colour", async () => {
  await page.viewport(DESKTOP.width, DESKTOP.height);
  const screen = await render(
    <Seats
      map={{
        rows: [
          {
            label: "A",
            physicalNumber: 1,
            seats: [
              { id: "free", label: "A1", column: 0, kind: "Standard", occupied: false },
              { id: "taken", label: "A2", column: 1, kind: "Standard", occupied: true },
            ],
          },
        ],
        totalColumns: 2,
        total: 2,
        occupied: 1,
        isSoldOut: false,
      }}
    />,
  );
  await expect.element(screen.getByRole("img", { name: /A1,/ })).toBeVisible();
  const glyphOf = (name: string) =>
    getComputedStyle(screen.container.querySelector(`[aria-label^="${name},"] svg`) as SVGElement);
  expect(glyphOf("A1").fill).toBe("none");
  expect(glyphOf("A2").fill).not.toBe("none");
  /*
   * ...and filled enough to see. `not.toBe("none")` alone is satisfied at
   * `fill-opacity: 0.001`, which is a fill in name only, and the seat's body now carries a
   * second alpha that could take it there. The floor is the one the contrast test states
   */
  expect(Number(glyphOf("A2").fillOpacity)).toBeGreaterThanOrEqual(OCCUPIED_FILL_OPACITY);
});

/*
 * Non-text contrast, WCAG 1.4.11: a seat glyph is a graphical object and needs 3:1
 * against the surface behind it
 *
 * There is no axe rule for this. Wheelchair sat at 2.95:1 when this was written and the
 * occupied glyph's fill at 1.42:1, and both passed every other tier while being close to
 * invisible. The numbers also cannot be asserted from the token values: these tones carry
 * alpha, and a `fill-opacity` on top of an alpha tone multiplies, which is how the
 * occupied fill got to 1.42 from a 3.35 tone
 */

/** A rendered colour composited over its surface, as the eight-bit sRGB the screen shows */
function paint(foreground: string, surface: string, extraAlpha = 1): [number, number, number] {
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("no 2d context");

  /*
   * The browser converts and blends, rather than this file reimplementing oklab. These
   * values reach `getComputedStyle` as `oklch()` and `color-mix()` results, never as
   * `rgb()`, so a regex over `rgb(...)` would match nothing and whatever it returned
   * would be fiction
   */
  const sentinel = "#ff00ff";
  context.fillStyle = sentinel;
  context.fillStyle = surface;
  if (context.fillStyle === sentinel) throw new Error(`canvas rejected surface: ${surface}`);
  context.fillRect(0, 0, 1, 1);

  context.fillStyle = sentinel;
  context.fillStyle = foreground;
  if (context.fillStyle === sentinel) throw new Error(`canvas rejected colour: ${foreground}`);
  // Multiplies with any alpha the colour already carries, which is what a taken seat's
  // `fill-opacity` does on top of its 40% tone
  context.globalAlpha = extraAlpha;
  context.fillRect(0, 0, 1, 1);

  const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
  return [r ?? 0, g ?? 0, b ?? 0];
}

const relativeLuminance = ([r, g, b]: [number, number, number]) => {
  const channel = (value: number) => {
    const c = value / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};

const contrast = (a: [number, number, number], b: [number, number, number]) => {
  const [high, low] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x) as [
    number,
    number,
  ];
  return (high + 0.05) / (low + 0.05);
};

/**
 * Nine columns across six rows, so `optimalSeatIds` recommends columns 3 to 5 of row 4
 *
 * The four special seats sit in other rows on purpose. Placed inside the recommended
 * window they would render green, their own tone would never paint, and the loop below
 * would be measuring five copies of one colour
 */
function paletteHouse(): SeatMapData {
  const COLUMNS = 9;
  const special: Record<number, Record<number, Partial<SeatMapData["rows"][0]["seats"][0]>>> = {
    0: { 0: { occupied: true } },
    1: { 0: { kind: "Wheelchair" }, 1: { kind: "Companion" } },
    2: Object.fromEntries(
      Array.from({ length: COLUMNS }, (_, column) => [column, { kind: "Dbox" as const }]),
    ),
  };
  const rows = Array.from({ length: 6 }, (_, row) => ({
    label: `R${row}`,
    physicalNumber: 6 - row,
    seats: Array.from({ length: COLUMNS }, (_, column) => ({
      id: `r${row}c${column}`,
      label: `R${row}C${column}`,
      column,
      kind: "Standard" as const,
      occupied: false,
      ...special[row]?.[column],
    })),
  }));
  return { rows, totalColumns: COLUMNS, total: 6 * COLUMNS, occupied: 1, isSoldOut: false };
}

/**
 * Both palettes on the page at once, so a run measures them without re-rendering
 *
 * `.dark` is a plain class selector, so a wrapper switches the palette for its subtree
 * Rendering twice in one test instead would leave two maps answering the same
 * document-wide role query, and unmounting between them detaches the container the
 * measurement reads from
 */
async function renderBothPalettes() {
  await page.viewport(DESKTOP.width, DESKTOP.height);
  const screen = await render(
    <>
      <div data-testid="light">
        <Seats map={paletteHouse()} />
      </div>
      <div data-testid="dark" className="dark">
        <Seats map={paletteHouse()} />
      </div>
    </>,
  );
  await expect.element(screen.getByRole("region", { name: /seat map/i }).first()).toBeVisible();
  return (theme: "light" | "dark") =>
    measureTones(screen.container.querySelector(`[data-testid="${theme}"]`) as HTMLElement);
}

/** Every tone under one palette, measured off the page rather than from the token values */
function measureTones(root: HTMLElement) {
  // Read from the page, never a literal. Hardcoding #270e0e would leave the test green
  // after `bg-cinema-ink` was deleted from the component
  const surface = root.querySelector('[data-slot="seat-scroller"]')?.parentElement;
  if (!surface) throw new Error("no seat map rendered");
  const surfaceColour = getComputedStyle(surface).backgroundColor;
  /*
   * The map has to paint its own surface, or every ratio below is measured against a
   * backdrop the seats are not actually drawn on. Deleting `bg-cinema-ink` leaves this
   * `rgba(0, 0, 0, 0)`, which composites to black and reads as *better* contrast, so
   * without this the test fails open on exactly the change that would break the design
   * Painted over white and over black: an opaque colour lands in the same place twice
   */
  if (String(paint(surfaceColour, "#ffffff")) !== String(paint(surfaceColour, "#000000"))) {
    throw new Error(`seat map paints no opaque surface: ${surfaceColour}`);
  }
  const painted = paint(surfaceColour, "#000000");

  const tones = new Map<string, number>();
  for (const seat of root.querySelectorAll<HTMLElement>('[data-slot="seat"]')) {
    const glyph = seat.querySelector("svg") as SVGElement;
    const style = getComputedStyle(glyph);
    const key = seat.dataset.recommended ? "recommended" : (seat.dataset.state ?? "");
    /*
     * Every alpha on the path, not just the colour's own. `opacity` on either element and
     * `stroke-opacity` or `fill-opacity` on the glyph all multiply into what is painted,
     * and reading only the colour is how a 45% tone behind a 0.35 fill-opacity measured as
     * 3.77:1 while actually painting at 1.47:1. A taken seat carries exactly that shape
     * again today, at 40% and 0.6, which is why the fill is measured and then exempted by
     * name below rather than left to the colour
     */
    const inherited = Number(style.opacity) * Number(getComputedStyle(seat).opacity);
    tones.set(
      key,
      contrast(
        paint(style.stroke, surfaceColour, inherited * Number(style.strokeOpacity)),
        painted,
      ),
    );
    if (style.fill !== "none") {
      const alpha = inherited * Number(style.fillOpacity);
      tones.set(`${key} fill`, contrast(paint(style.fill, surfaceColour, alpha), painted));
    }
  }
  return tones;
}

/**
 * The one tone held to a lower floor than 1.4.11's, and the floor it is held to instead
 *
 * A taken seat's body carries `OCCUPIED_FILL_OPACITY` on top of a tone that already has
 * 40%, so it paints at 1.94:1. That is deliberate and it is a reversal: no darker colour
 * clears 3:1 on this surface (the floor is 37.6% parchment against a 40% tone, and the
 * darkest palette entry is 2.50:1), so the stroke carries the criterion at 3.24:1 and the
 * body is free to recede. 1.8 is the floor it keeps: enough to read as a filled shape
 * rather than a hole, and the point below which this stops being a silhouette at all
 *
 * Named and asserted rather than skipped. An entry dropped out of the loop is how a tone
 * goes unmeasured, which is the failure this file was written after
 */
const SILHOUETTE_FLOOR = 1.8;
const EXEMPT_FROM_NON_TEXT_CONTRAST = new Set(["occupied fill"]);

test("every seat tone clears 3:1 against the surface it is drawn on", async () => {
  const tonesFor = await renderBothPalettes();

  for (const theme of ["light", "dark"] as const) {
    const tones = tonesFor(theme);

    /*
     * Before the loop, not after. A house that rendered nothing, or a fixture missing a
     * kind, makes a `for ... expect` body pass over an empty collection
     */
    expect([...tones.keys()].sort(), theme).toEqual([
      "companion",
      "dbox",
      "occupied",
      "occupied fill",
      "recommended",
      "standard",
      "wheelchair",
    ]);

    // Both sets asserted, and both non-empty, so nothing can quietly move between them
    const exempt = [...tones.keys()].filter((tone) => EXEMPT_FROM_NON_TEXT_CONTRAST.has(tone));
    expect(exempt, theme).toEqual(["occupied fill"]);

    for (const [tone, ratio] of tones) {
      const floor = EXEMPT_FROM_NON_TEXT_CONTRAST.has(tone) ? SILHOUETTE_FLOOR : 3;
      expect(ratio, `${theme} ${tone} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(floor);
    }
  }
});

/**
 * ...and the exempt one is exactly as dark as the constant says, not merely above a floor
 *
 * Derived from the page on both sides: the expected colour is the seat's own stroke
 * re-composited at `OCCUPIED_FILL_OPACITY`, so it cannot be satisfied by a literal, and the
 * `not` half is what removing the attribute would produce. A floor alone would be satisfied
 * by no second alpha at all, which is the mutation this exists to catch
 */
test("a taken seat's body paints at the second alpha, not at the tone alone", async () => {
  await page.viewport(DESKTOP.width, DESKTOP.height);
  const screen = await render(<Seats map={paletteHouse()} />);
  await expect.element(screen.getByRole("region", { name: /seat map/i })).toBeVisible();

  const seat = screen.container.querySelector(
    '[data-slot="seat"][data-state="occupied"] svg',
  ) as SVGElement;
  const surface = getComputedStyle(
    screen.container.querySelector('[data-slot="seat-scroller"]')?.parentElement as HTMLElement,
  ).backgroundColor;
  const style = getComputedStyle(seat);

  expect(String(paint(style.fill, surface, Number(style.fillOpacity)))).toBe(
    String(paint(style.stroke, surface, OCCUPIED_FILL_OPACITY)),
  );
  expect(String(paint(style.fill, surface, Number(style.fillOpacity)))).not.toBe(
    String(paint(style.stroke, surface, 1)),
  );
});

/*
 * ...and the dark wrapper really did switch the palette, or the test above measured the
 * light one twice
 *
 * The recommended green is the only tone that can show it. Every other one is
 * deliberately theme-independent, since the surface is ink in both, while `--success` is
 * oklch(0.62) at `:root` and oklch(0.74) in `.dark`. On the real page `Layout.astro` sets
 * the class; the browser project renders without it
 */
test("the dark wrapper measures the dark palette", async () => {
  const tonesFor = await renderBothPalettes();
  expect(tonesFor("dark").get("recommended")).not.toBe(tonesFor("light").get("recommended"));
});

/*
 * The other half of the recommended signal, and the half that carries it where colour
 * cannot
 *
 * Recommended shares the armchair glyph with standard and D-BOX, so green is the only
 * other difference, and under `forced-colors` every tone is replaced. The heavier stroke
 * is what survives both. It was asserted nowhere, so setting it back to 2 left every tier
 * green while the 1.4.1 argument in the component quietly stopped being true
 */
test("a recommended seat is drawn with a heavier stroke than its neighbours", async () => {
  await page.viewport(DESKTOP.width, DESKTOP.height);
  const screen = await render(<Seats map={paletteHouse()} />);
  await expect.element(screen.getByRole("region", { name: /seat map/i })).toBeVisible();

  const widthsOf = (selector: string) =>
    new Set(
      [...screen.container.querySelectorAll<HTMLElement>(selector)].map(
        (seat) => getComputedStyle(seat.querySelector("svg") as SVGElement).strokeWidth,
      ),
    );

  const recommended = widthsOf('[data-slot="seat"][data-recommended]');
  const ordinary = widthsOf('[data-slot="seat"]:not([data-recommended])');
  // Both non-empty, or comparing two sets proves nothing
  expect(recommended.size).toBe(1);
  expect(ordinary.size).toBe(1);
  expect([...recommended]).toEqual(["3px"]);
  expect([...ordinary]).toEqual(["2px"]);
});
