/*
 * Single source of truth for every API endpoint shipped under src/pages/api/
 * CONFIGURE: add an entry here when adding a new endpoint; remove the entry
 * (and the route file) if you do not need APIs at all
 *
 * `path` uses Astro's route notation (so dynamic routes appear as
 * `/api/users/[id]`, matching the file at `src/pages/api/users/[id].ts`)
 *
 * `method` is the primary HTTP method the endpoint exports. All six here are GET, and
 * that matters to the smoke spec: Astro answers an unsupported method with 404, which
 * is indistinguishable from a route that does not exist, so declaring the wrong method
 * turns the whole assertion into a check that nothing is there
 *
 * `emptyPayloadStatus` is what the endpoint answers a well-formed request carrying no
 * parameters. Without it the only assertable contract is "not 404 and not 5xx", which
 * 200, 400, 401, 403 and 429 all satisfy equally
 *
 * The two 503s are deterministic only because `playwright.config.ts` deletes the built
 * `.dev.vars` before serving, so the preview worker has no API key. Run `pnpm preview`
 * by hand with a key present and those two answer 200 instead
 */

export const apiEndpoints: {
  path: string;
  method: string;
  description: string;
  emptyPayloadStatus: number;
}[] = [
  // No required parameters, so these reach the key check and report it missing
  { path: "/api/movies", method: "GET", description: "Movie catalogue", emptyPayloadStatus: 503 },
  { path: "/api/theatres", method: "GET", description: "Theatre list", emptyPayloadStatus: 503 },
  /*
   * The rest guard their parameters first, so they answer 400 whether or not a key is
   * configured. Swap the guard order and these four turn into 503s, which is what makes
   * this table worth having
   */
  {
    path: "/api/narrow/movies",
    method: "GET",
    description: "Films playing at one theatre",
    emptyPayloadStatus: 400,
  },
  {
    path: "/api/narrow/theatres",
    method: "GET",
    description: "Theatres playing one film",
    emptyPayloadStatus: 400,
  },
  {
    path: "/api/showtimes",
    method: "GET",
    description: "Screenings for a theatre and film",
    emptyPayloadStatus: 400,
  },
  {
    path: "/api/seats",
    method: "GET",
    description: "Seat map for a showtime",
    emptyPayloadStatus: 400,
  },
];

export type ApiEndpoint = (typeof apiEndpoints)[number];
