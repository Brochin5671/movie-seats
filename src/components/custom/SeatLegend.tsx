import { Accessibility, Armchair, CircleQuestionMark, PersonStanding } from "lucide-react";

import { Badge } from "@/components/elements/Badge";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverTrigger,
} from "@/components/elements/Popover";
import type { SeatMap } from "@/lib/cineplex/types";
import { type SeatLegendKey, seatLegendKeys } from "@/lib/seating";
import { cn } from "@/lib/utils";
import { OCCUPIED_FILL_OPACITY } from "./SeatMap";

/*
 * The legend bar under the seat map
 *
 * Hidden from assistive tech entry by entry rather than as a whole bar: every seat carries
 * its own name ("GG22, standard, occupied"), so a colour key is noise to a reader who
 * cannot see the colours. Recommended is the exception, because its explainer is the one
 * thing here no seat name carries, and because a focusable button inside an `aria-hidden`
 * subtree is a tab stop no screen reader can reach
 *
 * Every entry mirrors how the map draws that state, tone for tone. A legend showing an
 * outline where the map draws a silhouette teaches a code the map does not use
 */

interface LegendEntry {
  label: string;
  icon: typeof Armchair;
  className: string;
  /** Drawn filled, matching how the map paints a taken seat */
  filled?: boolean;
  /** ...and at the same second alpha, so the body sits back the way it does on the map */
  fillOpacity?: number;
  /** The map's recommended stroke, so the two read as the same thing */
  strokeWidth?: number;
}

const ENTRIES: Record<SeatLegendKey, LegendEntry> = {
  standard: { label: "Standard", icon: Armchair, className: "text-cinema-parchment" },
  dbox: { label: "D-BOX", icon: Armchair, className: "text-cinema-tan" },
  recommended: {
    label: "Recommended",
    icon: Armchair,
    className: "text-success",
    strokeWidth: 3,
  },
  occupied: {
    label: "Occupied",
    icon: Armchair,
    className: "text-cinema-parchment/40",
    filled: true,
    fillOpacity: OCCUPIED_FILL_OPACITY,
  },
  companion: { label: "Companion", icon: PersonStanding, className: "text-cinema-parchment" },
  wheelchair: { label: "Wheelchair", icon: Accessibility, className: "text-cinema-rust" },
};

/** The tones alone, so a test can compare them with the map's without rendering */
export const LEGEND_TONES = Object.fromEntries(
  Object.entries(ENTRIES).map(([key, entry]) => [key, entry.className]),
) as Record<SeatLegendKey, string>;

export interface SeatLegendProps {
  map: SeatMap;
  /** The same set the map paints from, so an entry cannot go missing under a green seat */
  recommended: Set<string>;
  className?: string;
}

export function SeatLegend({ map, recommended, className }: SeatLegendProps) {
  const keys = seatLegendKeys(map, recommended);

  return (
    <div
      data-slot="seat-legend"
      // Wraps rather than shrinking: below about 320px six entries on one line stop
      // being readable, and a smaller font is worse than a second row
      className={cn(
        "flex flex-wrap items-center justify-center gap-x-4 gap-y-2 rounded-md bg-cinema-ink px-4 py-3",
        className,
      )}>
      {keys.map((key) => {
        const {
          label,
          icon: Icon,
          className: tone,
          filled,
          fillOpacity,
          strokeWidth,
        } = ENTRIES[key];
        const swatch = (
          <Icon
            className={tone}
            data-legend={key}
            fill={filled ? "currentColor" : "none"}
            fillOpacity={fillOpacity}
            strokeWidth={strokeWidth}
          />
        );
        // Every other entry is a colour key and nothing else, so it stays out of the tree
        if (key !== "recommended") {
          return (
            <Badge
              key={key}
              aria-hidden="true"
              variant="ghost"
              className="gap-1.5 text-cinema-parchment">
              {swatch}
              {label}
            </Badge>
          );
        }
        return (
          <Badge key={key} variant="ghost" className="gap-1.5 text-cinema-parchment">
            {swatch}
            {label}
            <Popover>
              {/*
               * A popover rather than a tooltip: a tooltip opens on hover and focus, and neither
               * happens on a phone. The button carries its own name, since a bare "?" reads as nothing
               */}
              <PopoverTrigger
                aria-label="What makes a seat recommended?"
                className="-mr-1 ml-0.5 rounded-full p-1 text-cinema-tan hover:text-cinema-parchment focus-visible:focus-outline focus-visible:outline-cinema-tan">
                <CircleQuestionMark className="size-3.5" />
              </PopoverTrigger>
              <PopoverContent className="max-w-64">
                <PopoverDescription>
                  Available seats about two thirds back from the screen, in the middle of the row.
                  Usually the best view and sound in the house.
                </PopoverDescription>
              </PopoverContent>
            </Popover>
          </Badge>
        );
      })}
    </div>
  );
}
