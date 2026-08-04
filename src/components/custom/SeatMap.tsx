/**
 * @fileoverview The auditorium grid
 *
 * LIBRARY EXCEPTION, flagged per AGENTS.md. A sparse 21x26 house with aisles and two
 * seat areas cannot be expressed with `Grid`: the track count is per-auditorium data, so
 * `gridTemplateColumns` has to be an inline style, and seats are positioned by their own
 * column rather than by document order. This is the only place in the project that
 * hand-rolls markup a primitive could otherwise cover
 *
 * The glyphs are declared once as `<symbol>`s and each seat renders a single `<use>`. A
 * full house is around 550 seats and the armchair glyph is four paths, so drawing them
 * inline would put roughly 2,200 nodes on the page instead of 550
 */

import type { Seat, SeatMap as SeatMapData } from "@/lib/cineplex/types";
import { gridColumnCount, seatAccessibleName, seatState } from "@/lib/seating";
import { cn } from "@/lib/utils";

/** Upstream columns are 0-based; CSS grid lines start at 1 */
const COLUMN_BASE = 1;

const GLYPH = {
  seat: "seat-glyph-armchair",
  wheelchair: "seat-glyph-accessibility",
  companion: "seat-glyph-person",
} as const;

/*
 * lucide `armchair`, `accessibility` and `person-standing`, inlined as symbols rather than
 * imported: a React icon component per seat is the cost this avoids. Two distinct glyphs
 * rather than one with a variant, because at 14px a variant does not read as a difference
 */
function SeatGlyphs() {
  return (
    <svg aria-hidden="true" className="hidden">
      <title>Seat glyphs</title>
      <symbol id={GLYPH.seat} viewBox="0 0 24 24">
        <path d="M19 9V6a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v3" />
        <path d="M3 16a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5a2 2 0 0 0-4 0v1.5a.5.5 0 0 1-.5.5h-9a.5.5 0 0 1-.5-.5V11a2 2 0 0 0-4 0z" />
        <path d="M5 18v2" />
        <path d="M19 18v2" />
      </symbol>
      <symbol id={GLYPH.wheelchair} viewBox="0 0 24 24">
        <circle cx="16" cy="4" r="1" />
        <path d="m18 19 1-7-6 1" />
        <path d="m5 8 3-3 5.5 3-2.36 3.5" />
        <path d="M4.24 14.5a5 5 0 0 0 6.88 6" />
        <path d="M13.76 17.5a5 5 0 0 0-6.88-6" />
      </symbol>
      <symbol id={GLYPH.companion} viewBox="0 0 24 24">
        <circle cx="12" cy="5" r="1" />
        <path d="m9 20 3-6 3 6" />
        <path d="m6 8 6 2 6-2" />
        <path d="M12 10v4" />
      </symbol>
    </svg>
  );
}

/*
 * Occupied wins over kind, so a taken D-BOX seat reads as taken. Only the accessible kinds
 * get their own glyph; the rest are the same chair in another colour, which is why the
 * accessible name carries the kind as words, and why companion takes the standard fill
 *
 * Every tone clears 3:1 against the ink surface (WCAG 1.4.11), measured in the browser
 * tier. Occupied comes from the palette rather than `--muted-foreground`, so it is tied to
 * the surface rather than the theme; clay was rejected because on ink it reads almost the
 * same as a dimmed occupied seat
 *
 * KNOWN GAP: standard and D-BOX share glyph, outline and stroke, so colour is all that
 * separates them and they are identical under `forced-colors`. Tolerated because D-BOX is
 * a comfort tier rather than availability, and the accessible name says it regardless
 */
export const TONE: Record<string, string> = {
  occupied: "text-cinema-parchment/40",
  standard: "text-cinema-parchment",
  dbox: "text-cinema-tan",
  wheelchair: "text-cinema-rust",
  companion: "text-cinema-parchment",
};

/*
 * A recommended seat overrides the kind's colour rather than sitting beside it
 *
 * The one tone not from the cinema palette: recommended is a judgement, so it borrows the
 * `success` token the capacity meter uses to mean the same thing. That also makes it the
 * only tone here that moves between themes, which the browser test uses to prove a dark
 * render really rendered dark
 *
 * `--success` is oklch hue 162, load-bearing rather than incidental: a hue near 145
 * simulates under deuteranopia into the same khaki band as tan and rust, while 162 stays
 * on the blue-yellow axis both common dichromacies keep
 *
 * The heavier stroke is the second signal, since green alone would fail WCAG 1.4.1 against
 * the shared glyph, and stroke width survives `forced-colors` where colour does not. The
 * margin is thin: at the 7/12 scale of a 14px glyph on a 24-unit viewBox, 3 against 2
 * paints 1.75px against 1.17px
 */
export const RECOMMENDED_TONE = "text-success";
const STROKE_WIDTH = { normal: 2, recommended: 3 } as const;

/*
 * The interior of a taken seat, on top of the 40% the tone already carries, so the body
 * paints at about 24% parchment and reads as recessed rather than merely dim
 *
 * This reverses a recorded fix, deliberately and with the arithmetic to hand. No darker
 * colour exists: the 3:1 floor for a graphical object sits at 37.6% parchment on this
 * surface, the tone is at 40%, and the darkest palette entry (clay) is 2.50:1. Moving the
 * surface runs backwards, because the +0.05 offset dominates at these luminances: on pure
 * black the floor rises to 39.0%
 *
 * So the stroke is what carries WCAG 1.4.11 here, at an unchanged 3.24:1, and the fill is
 * exempted from that floor with its own, lower one. `SeatMap.browser.test.tsx` states both
 * rather than skipping the fill, which is the failure mode its own history warns about
 */
export const OCCUPIED_FILL_OPACITY = 0.6;

function SeatCell({ seat, recommended }: { seat: Seat; recommended: boolean }) {
  const state = seatState(seat);
  const glyph =
    state === "wheelchair"
      ? GLYPH.wheelchair
      : state === "companion"
        ? GLYPH.companion
        : GLYPH.seat;
  return (
    <span
      role="img"
      aria-label={seatAccessibleName(seat, recommended)}
      data-slot="seat"
      data-state={state}
      data-recommended={recommended || undefined}
      // Positioned by its own column, so a gap inside a row stays a gap
      style={{ gridColumnStart: seat.column + COLUMN_BASE }}
      // 20px cell around a 14px glyph. Not a tap target: a `role="img"` span with no handler
      // and no tabindex, so SC 2.5.8 does not reach it and the pitch is free to fit a house on
      // a phone, putting a 26-column auditorium at 545px across rather than 649px
      className="flex size-5 items-center justify-center p-0.5">
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        /*
         * Occupied is a solid silhouette, available an outline. Colour alone would leave the map's
         * primary information unreadable to anyone who cannot separate the tones (WCAG 1.4.1), and
         * axe has no rule for it. Stroke and fill share one tone with a second alpha on the fill,
         * so the outline holds the shape at 3.24:1 while the body sits back at 1.94:1, widening
         * the occupied-against-available gap from 4.44:1 to 7.43:1
         */
        fill={seat.occupied ? "currentColor" : "none"}
        fillOpacity={seat.occupied ? OCCUPIED_FILL_OPACITY : undefined}
        stroke="currentColor"
        strokeWidth={recommended ? STROKE_WIDTH.recommended : STROKE_WIDTH.normal}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={cn("size-3.5", recommended ? RECOMMENDED_TONE : TONE[state])}>
        <use href={`#${glyph}`} />
      </svg>
    </span>
  );
}

export interface SeatMapProps {
  map: SeatMapData;
  /** Derived once by the caller, so the legend cannot disagree about which seats are green */
  recommended: Set<string>;
  className?: string;
}

export function SeatMap({ map, recommended, className }: SeatMapProps) {
  // Once for the whole house, because every row has to declare the same tracks to line up
  const columns = gridColumnCount(map);
  /*
   * The map scrolls, the page does not. A flex child will not shrink under its content, so
   * without `min-w-0` the map is as wide as its widest row and the body's `overflow-x-clip`
   * hides the right-hand seats rather than letting anyone reach them. Pinned by the e2e spec,
   * the only place the whole containment chain exists
   */
  return (
    <div className={cn("w-full min-w-0 rounded-lg bg-cinema-ink p-3", className)}>
      <SeatGlyphs />
      {/* mb-6 rather than mb-3: the gap is what reads as the distance to the screen, and
          at half this the front row looks like part of the label */}
      <p className="mb-6 text-center text-xs tracking-[0.3em] text-cinema-tan uppercase">Screen</p>
      {/*
       * A named `section` rather than a div with `role="group"`: an unnamed region is dropped
       * from the accessibility tree entirely. `tabIndex` is what makes the scroller reachable,
       * since one that cannot take focus needs a pointer
       *
       * Colour on the scrollbar, and nothing else. Unnamed, its tones are whatever the
       * platform picks against `color-scheme: dark`, which on this near-black surface is a
       * grey the reader can miss, so a house wider than the column reads as cut off. The
       * browser test carries the contrast measurement and the reasoning for leaving the
       * size alone
       */}
      <section
        // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region has to be keyboard-reachable, or its content is unreachable without a pointer
        tabIndex={0}
        aria-label="Seat map, screen at the top"
        data-slot="seat-scroller"
        className="overflow-x-auto scrollbar-track-cinema-ink scrollbar-thumb-cinema-tan focus-visible:focus-outline focus-visible:outline-cinema-tan">
        {/* w-max so the rows keep their true width and the parent scrolls to reach them */}
        <div className="flex w-max min-w-full flex-col items-center gap-px">
          {map.rows.map((row, index) =>
            row.seats.length === 0 ? (
              // An aisle is a vertical gap, and nothing a reader needs announced
              <div key={`aisle-${index}`} aria-hidden="true" className="h-2" />
            ) : (
              <div
                // physicalNumber, not label: it is unique per row, where an upstream
                // label can be empty and two empties would collide
                key={`row-${row.physicalNumber}`}
                className="grid gap-px"
                // A fixed track rather than `minmax(0, …)`, so a column cannot
                // collapse and overlap its neighbour when the house is wider than the
                // screen
                style={{ gridTemplateColumns: `repeat(${columns}, 1.25rem)` }}>
                {row.seats.map((seat) => (
                  <SeatCell key={seat.id} seat={seat} recommended={recommended.has(seat.id)} />
                ))}
              </div>
            ),
          )}
        </div>
      </section>
    </div>
  );
}
