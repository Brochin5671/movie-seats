/**
 * @fileoverview Where "Book on Cineplex" points
 *
 * Built here rather than taken from the upstream payload: `showtimes` returns a
 * `ticketingUrl`, but it deep-links into whatever page Cineplex is running today, where
 * the preview URL opens the seat picker for exactly this screening
 */

const PREVIEW = "https://www.cineplex.com/ticketing/preview";

/**
 * The booking link for one screening at one theatre
 *
 * Both ids are integers from upstream, but they go through `URLSearchParams` anyway:
 * hand-joining is how a value that later needs escaping becomes a broken link
 */
export function bookingUrl(theatreId: number, sessionId: number): string {
  const query = new URLSearchParams({
    theatreId: String(theatreId),
    showtimeId: String(sessionId),
  });
  return `${PREVIEW}?${query}`;
}
