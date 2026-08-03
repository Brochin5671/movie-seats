/**
 * @fileoverview The only place this app calls Cineplex
 *
 * Every call goes through `getCached`, which collapses many visitors into one upstream
 * request and serves stale when the upstream fails. The key travels in a header, never
 * in the URL, which is what keeps it out of the shared cache key
 */

import { CINEPLEX_API_KEY } from "astro:env/server";
import { getCached } from "@/lib/api/cached-fetch";

const BASE = {
  theatrical: "https://apis.cineplex.com/prod/cpx/theatrical/api/v1",
  ticketing: "https://apis.cineplex.com/prod/ticketing/api/v1",
} as const;

// CONFIGURE: "en" or "fr". Required on every theatrical call; omitting it is a 400
const LANGUAGE = "en";

/** The key is unset. An operator problem, and answered as one rather than as no results */
export class MissingKeyError extends Error {
  constructor() {
    super("CINEPLEX_API_KEY is not set");
    this.name = "MissingKeyError";
  }
}

type Params = Record<string, string | number | undefined>;

/** Theatrical URLs always carry `language`; an undefined param is dropped, not sent empty */
export function theatricalUrl(path: string, params: Params = {}): string {
  const query = new URLSearchParams({ language: LANGUAGE });
  for (const [name, value] of Object.entries(params)) {
    if (value !== undefined) query.set(name, String(value));
  }
  return `${BASE.theatrical}/${path.replace(/^\//, "")}?${query}`;
}

export function ticketingUrl(path: string): string {
  return `${BASE.ticketing}/${path.replace(/^\//, "")}`;
}

export interface UpstreamOptions {
  /** Seconds the payload stays fresh */
  maxAge: number;
  /** Seconds past freshness a stale payload may still be served. @default 86400 */
  staleIfError?: number;
  /** @default 5000 */
  timeoutMs?: number;
}

/**
 * Fetch and parse one upstream payload
 *
 * Resolves `null` on a 204, which is how the API says the query was valid and nothing
 * matched. Callers coalesce rather than treating it as a failure
 *
 * No retry, deliberately. `getCached` has none, a 401 means the key rotated and
 * retrying only hammers the gateway, and stale-on-error already covers the transient
 * case better than a retry would
 */
export async function fetchUpstream<T>(url: string, options: UpstreamOptions): Promise<T | null> {
  if (!CINEPLEX_API_KEY) throw new MissingKeyError();
  /*
   * Spread, rather than naming each option. `getCached` applies its defaults with
   * `{ ...DEFAULTS, ...options }`, and a key written out as `timeoutMs: options.timeoutMs`
   * is still *present* when the value is undefined, so it overwrites the default with
   * undefined. `setTimeout(fn, undefined)` fires immediately, which aborted every call
   * in about 25ms
   */
  const { data } = await getCached<T | null>(url, {
    ...options,
    init: {
      headers: {
        "Ocp-Apim-Subscription-Key": CINEPLEX_API_KEY,
        Accept: "application/json",
      },
    },
  });
  return data;
}

/*
 * Freshness per resource. The stale budget matters as much as the TTL: showtimes and both
 * seat legs set it to 0 because yesterday's seat map is worse than an honest error, while
 * the catalogue is happy to be a day old if the upstream is down
 */
export const TTL = {
  movies: { maxAge: 6 * 60 * 60 },
  theatres: { maxAge: 24 * 60 * 60 },
  narrowByTheatre: { maxAge: 60 * 60 },
  // The film-wide call. Cache hardest, and give it room to actually arrive
  narrowByFilm: { maxAge: 6 * 60 * 60, timeoutMs: 15_000 },
  showtimes: { maxAge: 5 * 60, staleIfError: 0 },
  /*
   * The room, not the sale. A grid and its labels do not change while a screening is on
   * sale, so under the client's poll this drops layout fetches from 2 a minute to 1
   *
   * Held at the 60s the two legs used to share, rather than the quarter hour the structure
   * would tolerate. A showtime pulled from sale answers 404 on the layout and 200 with an
   * empty map on availability, so while the layout is served from cache the pair joins to
   * nothing and the route answers 502; only once this window lapses does the layout refetch
   * and the answer become the 404 it should be. 60s is how long that wrong-but-honest
   * status can last
   */
  seatLayout: { maxAge: 60, staleIfError: 0 },
  /*
   * The only thing that moves. Below the client's refresh interval so a poll is never handed an
   * entry it already has, and above zero so concurrent viewers still collapse onto one call
   */
  seatAvailability: { maxAge: 10, staleIfError: 0 },
} as const satisfies Record<string, UpstreamOptions>;
