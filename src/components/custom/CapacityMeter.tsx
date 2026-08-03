/**
 * @fileoverview How full the house is, when that answer arrived, and a way to ask again
 *
 * Both numbers come from the seat data rather than the session's `seatsRemaining`, which
 * was measured disagreeing with the real seat map by up to ten seats
 */

import { RefreshCwIcon } from "lucide-react";
import { useId } from "react";

import { Button } from "@/components/elements/Button";
import { Meter } from "@/components/elements/Meter";
import type { SeatMap } from "@/lib/cineplex/types";
import { capacityOf, isSeatingPoor } from "@/lib/seating";

interface CapacityMeterProps {
  map: SeatMap;
  /**
   * When the map arrived, already worded. Optional so a caller that does not refresh
   * renders no line at all rather than one that can only ever name the moment it mounted
   */
  freshness?: string | null;
  /** Omit and no control renders, for a caller with nothing to refresh */
  onRefresh?: () => void;
  /**
   * Whether pressing right now would reach the server. The control still takes focus and
   * still announces itself while held; it is the handler that declines
   */
  refreshHeld?: boolean;
}

export function CapacityMeter({ map, freshness, onRefresh, refreshHeld }: CapacityMeterProps) {
  const { tone, label } = capacityOf(map);
  /*
   * The meter's name, wired by hand
   *
   * `MeterLabel` would set `aria-labelledby` for us, but only from inside `Meter`, and the
   * label had to come out so the control could sit beside it. `useId` rather than a
   * literal, which would collide with a second meter in the same island. It would not save
   * two islands from each other: React numbers ids per root and Astro gives every island
   * its own, so a second one would need an `identifierPrefix`
   */
  const labelId = useId();

  // Raw flex, flagged: `Stack`'s smallest non-zero gap is 8px and this wants 4
  return (
    <div className="flex flex-col gap-1">
      {/*
       * Label, control and figure on one row, with the meter a row of its own beneath.
       * `role="meter"` is `childrenPresentational`, so a focusable descendant is an axe
       * `nested-interactive` violation and assistive tech drops the button's role and name
       * while it stays tabbable: the control can never go inside `Meter`, and putting it
       * next to the word is only reachable by taking the label out with it
       */}
      <div className="flex items-center gap-1">
        {/*
         * Raw spans and utilities, flagged rather than silent. `MeterLabel` and `MeterValue`
         * read Meter's context and cannot render outside it, so the classes come along by
         * hand. The figure is the design's `20/150`, and `FULL` once nothing is left, rather
         * than the percentage Base UI would format
         */}
        <span id={labelId} data-slot="capacity-label" className="text-sm font-medium">
          Capacity
        </span>
        {onRefresh ? (
          /*
           * `aria-disabled`, not `disabled`: a real disabled attribute drops the control
           * from the tab order mid-press, landing a keyboard reader's focus on the body with
           * no way to retry or tab onward. The handler is what refuses. The two
           * `aria-disabled:` utilities are load-bearing, because the base Button dims on
           * `:disabled` only and `global.css` gives every button `cursor: pointer`
           *
           * `icon-sm` is 32px against SC 2.5.8's floor of 24, so the extra 8 is margin
           * rather than minimum. A browser test measures it
           */
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Refresh the seat map"
            aria-disabled={refreshHeld || undefined}
            onClick={onRefresh}
            className="text-cinema-tan hover:text-cinema-parchment aria-disabled:cursor-not-allowed aria-disabled:opacity-50">
            <RefreshCwIcon aria-hidden="true" />
          </Button>
        ) : null}
        {/*
         * Hidden, and the meter says the same words instead. Left exposed this is announced
         * as loose text a step before the meter announces its own figure, so a reader hears
         * the occupancy twice in two wordings, and on a sold-out house they disagree
         * outright: the text reads FULL while `aria-valuenow` is whatever the seat map
         * counted. `aria-valuetext` below carries it once, in the words on screen
         */}
        <span
          aria-hidden="true"
          data-slot="capacity-value"
          className="ml-auto text-sm text-muted-foreground tabular-nums">
          {label}
        </span>
      </div>
      {/*
       * Meter renders its own track and indicator, takes its name from the row above, and
       * speaks the visible figure rather than the percentage Base UI would derive from
       * `value`. The percentage was never right here: upstream can flag a screening sold out
       * while seats remain, which is the whole reason the label reads FULL at 20%
       */}
      <Meter
        value={map.occupied}
        max={Math.max(map.total, 1)}
        tone={tone}
        aria-labelledby={labelId}
        aria-valuetext={label}
      />
      {/*
       * Below the meter, never above the row. `isSeatingPoor` flips as the back fills, so
       * this appears from nothing on a refresh; anywhere above the control it would shove it
       * down a line, and "reflows no control" is one of the three conditions SC 2.2.2's
       * essential exception rests on
       */}
      {isSeatingPoor(map.rows) && <p className="text-sm text-warning">seating is poor :/</p>}
      {/*
       * Inside this block rather than beside it, so it reads as a footnote to the numbers
       * it describes and its height is part of the same box. No live region: a reader does
       * not need the clock read out on every refresh. What is worth announcing is what
       * moved on the map, which `SeatFinder` says once per change
       *
       * Raw `p` and utilities, flagged rather than silent: there is no text primitive in
       * `elements/`, and adding one for a single caller would be the abstraction to avoid
       */}
      {freshness ? <p className="text-muted-foreground text-xs">{freshness}</p> : null}
    </div>
  );
}
