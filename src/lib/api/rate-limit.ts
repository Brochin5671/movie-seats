/**
 * @fileoverview A per-IP cap on the routes that cost an upstream call
 *
 * The endpoints are public and unauthenticated, and one of them is expensive in a way
 * caching does not cover: a seat request for an id that does not exist is a cache miss
 * that makes two upstream calls and keeps only one, since the layout leg throws before its
 * cache write while the availability leg answers 200 and is stored. Enumerating ids
 * therefore burns the API key's quota, and the quota is the thing worth protecting
 *
 * What this is not: an access control. Cloudflare counts per location and describes the
 * result as eventually consistent, so a request spread across colos gets the limit once
 * per colo. It raises the cost of scraping; it does not stop it
 */

import { env } from "cloudflare:workers";
import { jsonError } from "./response";

/** Seconds a limited caller is asked to wait, matching the binding's `period` */
export const RETRY_AFTER_SECONDS = 60;

/**
 * Which counter to charge
 *
 * Every route whose cache key a caller can vary is here, which is the property that
 * matters rather than payload size. `/movies` and `/theatres` take no parameters at all,
 * so they are one cache entry each and genuinely free; `/showtimes` takes two unbounded
 * ids, so an attacker who never repeats a pair gets a guaranteed upstream call per
 * request. Separate keys per bucket, so a cheap route cannot spend an expensive one's
 * budget
 */
export type RateLimitBucket = "seats" | "showtimes" | "narrow-movies" | "narrow-theatres";

/**
 * Two bindings, because one limit cannot serve both
 *
 * `narrow-theatres` is the film-wide call, and it is the one that moves real bytes. Measured
 * 2026-08-03 across four current wide releases, it decodes to between 2.4 MB and 10.7 MB
 * against 93 KB for the same film scoped to one theatre: about a hundred times the cheap
 * call. At the standard thirty a minute that is hundreds of megabytes a minute of upstream
 * egress, so the count has to be far lower even though the request looks identical from
 * outside. `SECURITY.md` carries the arithmetic
 */
const BUCKETS: Record<RateLimitBucket, "UPSTREAM_LIMITER" | "HEAVY_LIMITER"> = {
  seats: "UPSTREAM_LIMITER",
  showtimes: "UPSTREAM_LIMITER",
  "narrow-movies": "UPSTREAM_LIMITER",
  "narrow-theatres": "HEAVY_LIMITER",
};

/**
 * The key an address is counted under
 *
 * IPv4 is counted whole. IPv6 is truncated to its /64, because that is the smallest block
 * routinely routed to a single customer: keyed on the full /128 a cheap VPS with one /64
 * would hold 2^64 separate budgets, and the limit would mean nothing. Cloudflare's own
 * Rate Limiting Rules offer an "IP with mask /64" characteristic for exactly this reason,
 * and the Workers binding has no equivalent, so it is done here
 */
function counterFor(bucket: RateLimitBucket, clientIp: string): string {
  if (!clientIp.includes(":")) return `${bucket}:${clientIp}`;
  return `${bucket}:${clientIp.split(":").slice(0, 4).join(":")}::`;
}

/**
 * Answer a 429, or `null` to carry on
 *
 * Degrades open on every failure it can have: no binding, no client address, or the
 * limiter itself throwing. This is called outside `respond`'s try, so an unhandled
 * rejection would escape the route, and Astro answers that by re-rendering with the
 * middleware skipped, which drops the security headers off the error page
 *
 * Vitest is the only place the binding is genuinely absent. Measured, not assumed:
 * miniflare simulates `ratelimit` locally, so `astro dev`, `astro preview` and therefore
 * the Playwright web server all enforce for real, keyed on `127.0.0.1` for every caller
 */
export async function enforceRateLimit(
  request: Request,
  bucket: RateLimitBucket,
): Promise<Response | null> {
  const limiter = env[BUCKETS[bucket]];
  const clientIp = request.headers.get("CF-Connecting-IP");
  if (!limiter) {
    // Loud, because it can only happen if the binding was dropped from wrangler.jsonc or
    // its namespace_id collided. Never fires in a deployed Worker, so it cannot spam
    console.error(`[rate-limit] no ${BUCKETS[bucket]} binding; requests are uncapped`);
    return null;
  }
  if (!clientIp) return null;

  const { success } = await limiter.limit({ key: counterFor(bucket, clientIp) }).catch(() => {
    console.error("[rate-limit] limiter threw; letting the request through");
    return { success: true };
  });
  if (success) return null;

  const response = jsonError(
    request,
    429,
    "rate_limited",
    "Too many requests. Wait a minute and try again.",
  );
  // The status alone does not say for how long, and a client that guesses will guess
  // wrong in the direction that keeps hammering
  response.headers.set("Retry-After", String(RETRY_AFTER_SECONDS));
  return response;
}
