/**
 * @fileoverview The six GET handlers behind `src/pages/api/`
 *
 * Route files re-export from here so the logic is importable and testable: Astro treats
 * every `.ts` under `src/pages/` as a route, a `.test.ts` included
 */

import type { APIRoute } from "astro";
import { enforceRateLimit } from "@/lib/api/rate-limit";
import {
  filmIdsFrom,
  theatreIdsFrom,
  toMovies,
  toSeatMap,
  toSessions,
  toTheatres,
} from "./projections";
import type {
  RawMovie,
  RawSeatAvailability,
  RawSeatLayout,
  RawShowtimeTheatre,
  RawTheatres,
} from "./raw";
import { requireIntParam, respond } from "./respond";
import { fetchUpstream, TTL, theatricalUrl, ticketingUrl } from "./upstream";

export const getMovies: APIRoute = ({ request }) =>
  respond(request, async () =>
    toMovies(await fetchUpstream<RawMovie[]>(theatricalUrl("movies/bookable"), TTL.movies)),
  );

export const getTheatres: APIRoute = ({ request }) =>
  respond(request, async () =>
    toTheatres(await fetchUpstream<RawTheatres>(theatricalUrl("theatres"), TTL.theatres)),
  );

/** Which films play at one theatre. Cheap, and it genuinely narrows: 86 down to about 49 */
export const getMoviesAtTheatre: APIRoute = async ({ request, url }) => {
  const theatreId = requireIntParam(request, url, "theatreId");
  if (!theatreId.ok) return theatreId.response;
  const limited = await enforceRateLimit(request, "narrow-movies");
  if (limited) return limited;
  return respond(request, async () => ({
    filmIds: filmIdsFrom(
      await fetchUpstream<RawShowtimeTheatre[]>(
        theatricalUrl("showtimes", { locationId: theatreId.value }),
        TTL.narrowByTheatre,
      ),
    ),
  }));
};

/**
 * Which theatres play one film
 *
 * The expensive direction: filming by id alone returns every theatre in the country, so
 * this is the film-wide call. It is projected down to ids here and the payload discarded,
 * and it is only ever made on an actual movie selection, never speculatively
 */
export const getTheatresForMovie: APIRoute = async ({ request, url }) => {
  const filmId = requireIntParam(request, url, "filmId");
  if (!filmId.ok) return filmId.response;
  // After the parameter guards, so a 400 stays a 400 and never spends a token from the
  // bucket, and before the loader, since the bucket exists to protect the upstream
  const limited = await enforceRateLimit(request, "narrow-theatres");
  if (limited) return limited;
  return respond(request, async () => ({
    theatreIds: theatreIdsFrom(
      await fetchUpstream<RawShowtimeTheatre[]>(
        theatricalUrl("showtimes", { filmId: filmId.value }),
        TTL.narrowByFilm,
      ),
    ),
  }));
};

/*
 * Both parameters required, enforced here rather than only in the UI. Pairing them is
 * also what keeps this call small: either one alone is a far larger payload
 */
export const getShowtimes: APIRoute = async ({ request, url }) => {
  const theatreId = requireIntParam(request, url, "theatreId");
  if (!theatreId.ok) return theatreId.response;
  const filmId = requireIntParam(request, url, "filmId");
  if (!filmId.ok) return filmId.response;
  /*
   * Two unbounded ids, so the cache key space is effectively infinite and a caller who
   * never repeats a pair gets an upstream call every single request. The payload is small,
   * which is why this looked cheap; the miss rate is what actually costs
   */
  const limited = await enforceRateLimit(request, "showtimes");
  if (limited) return limited;
  return respond(request, async () =>
    toSessions(
      await fetchUpstream<RawShowtimeTheatre[]>(
        theatricalUrl("showtimes", { locationId: theatreId.value, filmId: filmId.value }),
        TTL.showtimes,
      ),
    ),
  );
};

/*
 * Layout and availability are always fetched together, then joined on seat id, but they
 * are cached apart: the room outlives the sale, so a client refreshing its map pays for
 * one upstream call and not two
 */
export const getSeats: APIRoute = async ({ request, url }) => {
  const theatreId = requireIntParam(request, url, "theatreId");
  if (!theatreId.ok) return theatreId.response;
  const showtimeId = requireIntParam(request, url, "showtimeId");
  if (!showtimeId.ok) return showtimeId.response;
  /*
   * The route the limiter exists for. An id that does not exist misses the cache and costs
   * two upstream calls, of which only the availability leg answers and is stored, for its
   * ten seconds; the layout leg throws. So enumeration is the one pattern here whose cost
   * scales with the caller rather than being absorbed by the cache
   */
  const limited = await enforceRateLimit(request, "seats");
  if (limited) return limited;
  const path = `theatre/${theatreId.value}/showtime/${showtimeId.value}`;
  return respond(
    request,
    async () => {
      const [layout, availability] = await Promise.all([
        fetchUpstream<RawSeatLayout>(ticketingUrl(`${path}/seat-layout`), TTL.seatLayout),
        fetchUpstream<RawSeatAvailability>(
          ticketingUrl(`${path}/seat-availability`),
          TTL.seatAvailability,
        ),
      ]);
      return toSeatMap(layout, availability);
    },
    /*
     * The only route whose path a caller can get wrong, so the only one that maps a 404
     * to a 404. `seat-layout` answers "Showtime with id N cannot be found" for an id that
     * does not exist or belongs to another theatre; `seat-availability` answers 200 with
     * an empty map, so the layout is what rejects and the pair never half-succeeds
     */
    { notFoundMessage: "That showtime is not available.", notFoundFrom: "seat-layout" },
  );
};
