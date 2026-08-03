/**
 * @fileoverview How full the house is, when that answer arrived, and a way to ask again
 *
 * Both numbers come from the seat data rather than the session's `seatsRemaining`, which
 * was measured disagreeing with the real seat map by up to ten seats
 */

import { RefreshCwIcon } from "lucide-react";

import { Button } from "@/components/elements/Button";
import { Meter, MeterLabel, MeterValue } from "@/components/elements/Meter";
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

  // Raw flex, flagged: `Stack`'s smallest non-zero gap is 8px and this wants 4
  return (
    <div className="flex flex-col gap-1">
      {/*
       * The control is a sibling of the meter, never a child. `role="meter"` is
       * `childrenPresentational`, so a focusable descendant is an axe `nested-interactive`
       * violation and assistive tech drops the button's role and name while it stays
       * tabbable. `flex-1` because Meter's own track is `w-full` and needs the room
       */}
      <div className="flex items-center gap-2">
        {/* Meter renders its own track and indicator after the children */}
        {/* No aria-label: MeterLabel sets aria-labelledby on the root, which wins over it */}
        <Meter value={map.occupied} max={Math.max(map.total, 1)} tone={tone} className="flex-1">
          <MeterLabel>Capacity</MeterLabel>
          {/*
           * A render function, which is the only child shape Base UI's Value accepts. The
           * formatted percentage it would pass in is discarded: the design asks for
           * `20/150`, and `FULL` once nothing is left
           */}
          <MeterValue>{() => label}</MeterValue>
        </Meter>
        {onRefresh ? (
          /*
           * `aria-disabled`, not `disabled`: a real disabled attribute drops the control
           * from the tab order mid-press, landing a keyboard reader's focus on the body with
           * no way to retry or tab onward. The handler is what refuses. The two
           * `aria-disabled:` utilities are load-bearing, because the base Button dims on
           * `:disabled` only and `global.css` gives every button `cursor: pointer`
           */
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Refresh the seat map"
            aria-disabled={refreshHeld || undefined}
            onClick={onRefresh}
            className="text-cinema-tan hover:text-cinema-parchment aria-disabled:cursor-not-allowed aria-disabled:opacity-50">
            <RefreshCwIcon aria-hidden="true" />
          </Button>
        ) : null}
      </div>
      {/*
       * Below the row, never above it. `isSeatingPoor` flips as the back fills, so this
       * appears from nothing on a refresh; above the row it would shove the control down
       * 24px, and "reflows no control" is one of the three conditions SC 2.2.2's essential
       * exception rests on
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
