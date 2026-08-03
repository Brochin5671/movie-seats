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

/**
 * What the app calls a screening that arrives with no experience group
 *
 * An ordinary 2D showing can carry an empty `experiences` array, and the screening line
 * would then render the auditorium with a trailing separator and nothing after it.
 * "Regular" is upstream's own word for that tier rather than an invention, which is what
 * makes it safe to supply: a screening that sends it and one that sends nothing read the
 * same because they are the same thing
 */
const FALLBACK_FORMAT = "Regular";

/** The formats as one run, or the fallback when upstream sent nothing usable */
const formatsOf = (experiences: readonly string[]) => {
  const named = experiences.map((entry) => entry.trim()).filter(Boolean);
  return named.length > 0 ? named.join(" · ") : FALLBACK_FORMAT;
};

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
  // The theatre stands on a line of its own, so this is a plain string
  const where = theatre && session ? theatre.name : null;
  /*
   * Upstream splits one screening across an experience group per format and `toSessions`
   * merges them back, so `formats` is already deduplicated. Rendered verbatim beside the
   * auditorium rather than reconciled with it: the auditorium sometimes carries the format
   * itself ("AVX 06"), and pulling the two apart would mean guessing at free text
   *
   * Trimmed and filtered before the length check, not after: `experienceTypes` reaches the
   * projection unvalidated, so a `[""]` would pass a bare `length > 0` and leave the line
   * ending on its separator, which is the one thing the fallback exists to prevent
   */
  const screening = session
    ? {
        auditorium: session.auditorium,
        formats: formatsOf(session.experiences),
      }
    : null;
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
          {/* The venue alone. It needs a session too, so the card never names a theatre
              for a screening nobody has picked */}
          {where ? <p className="text-sm text-cinema-tan">{where}</p> : null}
          {/*
           * The auditorium leads and the formats follow, because both describe the
           * screening rather than the venue. auditorium is free text upstream and is
           * rendered exactly as it arrives
           *
           * No `whitespace-nowrap` on the auditorium any more: it was there because the run
           * trailed the theatre name, so a wrap could land inside "VIP 3 (19+)". Leading its
           * own line, the first break opportunity is the space before the separator, and an
           * interior break would need the auditorium alone to outgrow the column: eleven
           * characters, about 80px, against roughly 190px
           */}
          {screening ? (
            <p className="text-sm text-cinema-tan">
              <span data-slot="showtime-auditorium">{screening.auditorium}</span>{" "}
              <span data-slot="showtime-formats">· {screening.formats}</span>
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
