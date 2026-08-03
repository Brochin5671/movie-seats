/**
 * @fileoverview Shared JSON responders for the SSR API surface
 *
 * `json` is the success responder; `jsonError` is the canonical error envelope
 * every failure returns: `{ error: { code, message, requestId } }`, so clients get
 * a stable shape and a correlation id to quote in a bug report
 *
 * Shared across the whole API surface, so it outlives any one route. Every handler
 * under `src/lib/cineplex/` answers through it, so the envelope stays one shape
 */

/**
 * JSON success responder: serializes `body` with a JSON content-type, nosniff and a cache
 * policy
 *
 * `cache` defaults to `no-store`, the safe answer for a response nobody has thought about
 * Pass a directive string only on a route whose body is identical for every caller, and
 * remember this surface is public, so "every caller" means everyone
 *
 * No `Content-Security-Policy` here on purpose. `src/middleware.ts` runs after every
 * server-rendered route and `applySecurityHeaders` writes the site-wide set with
 * `headers.set`, which overwrites, so a tighter `default-src 'none'` set here would be
 * silently replaced by the site policy on every response. Tighten it in
 * `src/lib/security-headers.ts` if this surface needs its own, rather than setting a header
 * here that never survives. `Cache-Control` is not in that set, so it does survive
 *
 * @param [cache="no-store"] Sent as `Cache-Control`
 */
export function json(body: unknown, status = 200, cache = "no-store"): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      // also set by middleware; kept here so the responder is correct on its own
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": cache,
    },
  });
}

/**
 * Correlation id for a request: Cloudflare's `cf-ray` when it passed the edge,
 * else a generated uuid (local dev, tests, non-Cloudflare hosts), so it is
 * always set
 *
 * Exported so a handler logging server-side derives its id the same way the error
 * envelope does. Behind Cloudflare that makes them equal, because `cf-ray` is a
 * property of the request and every call reads the same one; without it (local dev,
 * tests) each call mints a fresh uuid, so a log line and an envelope for one
 * request will not match there
 */
export function requestId(request: Request): string {
  return request.headers.get("cf-ray") ?? crypto.randomUUID();
}

/**
 * JSON error responder: the canonical `{ error: { code, message, requestId } }`
 * envelope. `code` is a stable machine string (e.g. "invalid_json"); `message`
 * is human-readable and safe to expose (never leak server internals)
 */
export function jsonError(
  request: Request,
  status: number,
  code: string,
  message: string,
): Response {
  return json({ error: { code, message, requestId: requestId(request) } }, status);
}
