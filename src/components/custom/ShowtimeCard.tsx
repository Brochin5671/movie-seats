import { ExternalLinkIcon } from "lucide-react";

import { Card, CardContent } from "@/components/elements/Card";
import { Link } from "@/components/elements/Link";
import { AspectRatio } from "@/components/layouts/AspectRatio";
import { bookingUrl } from "@/lib/booking";
import type { Movie, Session, Theatre } from "@/lib/cineplex/types";
import { formatDayLabel, formatTimeLabel } from "@/lib/showtime-format";

export interface ShowtimeCardProps {
  movie: Movie;
  /** Null until a theatre is picked */
  theatre: Theatre | null;
  /** Null until a showtime is picked */
  session: Session | null;
}

/**
 * The shape Cineplex serves posters at
 *
 * Measured, not assumed: every `mediumPosterImageUrl` ends `_320_470.jpg`. Matching it
 * exactly means the thumbnail below crops nothing, and `object-contain` letterboxes
 * rather than zooming if a poster ever arrives at some other shape
 */
const POSTER_RATIO = 320 / 470;

/*
 * A poster thumbnail beside the details rather than above them
 *
 * Laid out vertically the poster governs the card's height: full width at the page's 704px
 * column it measures 1034px, pushing the seat map and the booking link below the fold on
 * every phone, and cropping it to fit just zooms into a band of the artwork. Sideways the
 * whole poster shows at 96px and the card is about 190px tall
 *
 * No `<time>` element anywhere: it has no ARIA role, so naming it is prohibited and the
 * build tier fails on exactly that
 */
export function ShowtimeCard({ movie, theatre, session }: ShowtimeCardProps) {
  // Built here rather than inline, so the JSX carries no conditional whose falsy branch
  // could leak a value into the markup
  const whenLine = session
    ? `${formatDayLabel(session.start)} · ${formatTimeLabel(session.start)}`
    : null;
  // An object rather than a joined string, because the auditorium is rendered as its own
  // unbreakable run below. Still precomputed, so no falsy branch can leak into the markup
  const where = theatre && session ? { name: theatre.name, auditorium: session.auditorium } : null;
  /*
   * Upstream splits one screening across an experience group per format and `toSessions`
   * merges them back, so this is already deduplicated. Rendered verbatim and separately
   * from the auditorium, which sometimes carries the format itself ("AVX 06"): reconciling
   * the two would mean guessing at free text
   */
  const formats =
    session && session.experiences.length > 0 ? session.experiences.join(" · ") : null;
  const booking = theatre && session ? bookingUrl(theatre.id, session.sessionId) : null;

  /*
   * `ring-`, not `border-`: Card sets no border width, so a border colour paints nothing
   * Its own `ring-1` is the visible edge and this recolours it
   *
   * Capped and centred rather than filling the column: the content is about 350px, and
   * stretched across 704px the card reads as a large empty element. A fixed cap also means a
   * long theatre name wraps instead of the card resizing under it
   */
  return (
    <Card className="mx-auto w-full max-w-md bg-cinema-ink ring-cinema-clay/40">
      <CardContent className="flex flex-row items-start gap-4">
        {/* Fixed width, and `shrink-0` so a long title cannot squeeze the poster */}
        <div className="w-24 shrink-0">
          <AspectRatio
            ratio={POSTER_RATIO}
            className="overflow-hidden rounded-md bg-cinema-clay/30">
            {movie.posterUrl ? (
              <img
                src={movie.posterUrl}
                // Empty: the title is the next thing read out, so naming the poster too
                // just says it twice
                alt=""
                loading="lazy"
                className="size-full object-contain"
              />
            ) : (
              // Never `<img src="">`: an empty src re-requests the current page
              <div
                aria-hidden="true"
                className="size-full bg-gradient-to-b from-cinema-clay to-cinema-ink"
              />
            )}
          </AspectRatio>
        </div>

        {/* `min-w-0` so a long title wraps instead of pushing the column past the card */}
        <div className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
          <p className="font-medium text-cinema-parchment">{movie.name}</p>
          {/* Nothing at all until there is a showtime, rather than a placeholder */}
          {whenLine ? <p className="text-sm text-cinema-tan">{whenLine}</p> : null}
          {/*
           * auditorium is free text upstream, so it is rendered exactly as it arrives, and
           * as one unbreakable run: the JSX space before the span is the only place the
           * line can break, so the separator travels onto the new line with the auditorium
           * rather than the auditorium breaking through its own middle
           *
           * Safe against reflow at 400% zoom, where `overflow-x-clip` on the body would
           * cut rather than scroll: the longest auditorium observed is eleven characters
           * ("VIP 3 (19+)"), about 80px, against a text column of roughly 190px
           */}
          {where ? (
            <p className="text-sm text-cinema-tan">
              {where.name}{" "}
              <span data-slot="showtime-auditorium" className="whitespace-nowrap">
                · {where.auditorium}
              </span>
            </p>
          ) : null}
          {/* Its own line, below the subtitle: appended to the one above it would be a
              third run competing for the same break */}
          {formats ? (
            <p data-slot="showtime-formats" className="text-sm text-cinema-tan">
              {formats}
            </p>
          ) : null}
          {booking ? (
            /*
             * New tab, said in the name rather than only implied by the icon: a screen reader
             * announces the link before the tab opens, and an unexpected context change is what
             * WCAG 3.2.5 is about
             */
            <Link
              href={booking}
              variant="default"
              size="sm"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2">
              Book on Cineplex
              <span className="sr-only"> (opens in a new tab)</span>
              <ExternalLinkIcon aria-hidden="true" className="size-4" />
            </Link>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
