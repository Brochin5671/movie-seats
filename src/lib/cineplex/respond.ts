/**
 * @fileoverview Shared guards and error mapping for the six routes
 *
 * Guard order is load-bearing: parameters are validated before the key is read. The
 * other way round, every route answers 503 whenever the key is unset, and the
 * missing-parameter contract stops being observable at all, including in the tests that
 * are supposed to pin it
 */

import { UpstreamStatusError } from "@/lib/api/cached-fetch";
import { json, jsonError } from "@/lib/api/response";
import { MissingKeyError } from "./upstream";

type Guarded = { ok: true; value: number } | { ok: false; response: Response };

/**
 * Read a required integer query parameter
 *
 * Integer rather than "parses as a number", because these are ids that go straight into
 * an upstream path. `Number("")` is 0 and `Number("1.5")` is 1.5, both of which would
 * otherwise sail through
 */
export function requireIntParam(request: Request, url: URL, name: string): Guarded {
  const raw = url.searchParams.get(name);
  if (raw === null || raw === "") {
    return {
      ok: false,
      response: jsonError(request, 400, "missing_param", `Missing required parameter: ${name}`),
    };
  }
  const value = Number(raw);
  /*
   * Safe-integer, not merely integer. `Number.isInteger(1e21)` is true and
   * `String(1e21)` is "1e+21", which is what would reach the upstream path. Nothing
   * injectable, just a guaranteed 502 reported as an upstream problem
   */
  if (!Number.isSafeInteger(value)) {
    return {
      ok: false,
      response: jsonError(request, 400, "invalid_param", `Parameter ${name} must be an integer`),
    };
  }
  return { ok: true, value };
}

export interface RespondOptions {
  /**
   * Turn an upstream 404 into a 404 rather than a 502, with this as the message
   *
   * Opt-in per route, not the default. Only the seat route addresses a resource that a
   * caller can name wrongly; on the catalogue routes the path is ours, so a 404 there
   * means Cineplex moved an endpoint, and answering the client "not found" would report
   * an outage as a normal empty result
   */
  notFoundMessage?: string;
  /**
   * The upstream path fragment allowed to produce that 404
   *
   * Required alongside the message, because a route can make more than one upstream call
   * and only some of them address the caller's resource. The seat route fetches a layout
   * and an availability map together: the layout 404s for an id that does not exist,
   * while the availability map answers 200, so a 404 from *that* leg means the endpoint
   * moved. Without this the second case inherits the first's message and an outage reads
   * as a bad id
   */
  notFoundFrom?: string;
}

/**
 * Run a loader and turn whatever it throws into an answer a client can act on
 *
 * An unset key is 503 and separate from 502, so an operator can tell "nobody configured
 * this" from "the upstream is unhappy" without reading logs. The original message is
 * logged either way, and `getCached` already phrases it as `upstream 401 Unauthorized`,
 * which is the rotated-key signal without parsing an error string for it
 */
export async function respond<T>(
  request: Request,
  load: () => Promise<T>,
  { notFoundMessage, notFoundFrom }: RespondOptions = {},
): Promise<Response> {
  try {
    return json(await load());
  } catch (error) {
    if (
      notFoundMessage &&
      notFoundFrom &&
      error instanceof UpstreamStatusError &&
      error.status === 404 &&
      error.url.includes(notFoundFrom)
    ) {
      /*
       * Not `console.error`: an id that does not exist is a routine client mistake, and
       * logging it at error level buries the outages that page somebody
       *
       * The URL is what makes it readable afterwards. A run of these against varying ids
       * is a scraper; the same run against one path is Cineplex having moved an endpoint,
       * and every seat request quietly answering 404. The message alone cannot tell them
       * apart, since it is the same six words either way
       */
      console.info(`[cineplex] upstream has no such resource: ${error.url}`);
      return jsonError(request, 404, "not_found", notFoundMessage);
    }
    if (error instanceof MissingKeyError) {
      console.error("[cineplex] CINEPLEX_API_KEY is not set");
      return jsonError(
        request,
        503,
        "upstream_unconfigured",
        "Showtime data is not configured on this server.",
      );
    }
    console.error("[cineplex] upstream call failed:", error);
    return jsonError(
      request,
      502,
      "upstream_unavailable",
      "Showtime data is temporarily unavailable.",
    );
  }
}
