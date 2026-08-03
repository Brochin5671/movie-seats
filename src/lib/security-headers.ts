/**
 * @fileoverview The security header set, and the single place it is written
 *
 * `public/_headers` covers static assets only, so without this every Worker-rendered
 * response would ship bare: `/404`, `/500` and all of `/api/*`. `not_found_handling:
 * "none"` in `wrangler.jsonc` sends an asset miss to the Worker, which makes every 404
 * on the site one of them. `src/middleware.ts` applies the set; the colocated test
 * asserts it never diverges from `public/_headers`, comparing names case-insensitively
 */

/*
 * `img-src` allows mediafiles.cineplex.com, where every poster URL in `/movies/bookable`
 * was served from when checked against the live catalogue. A poster on any other host is
 * blocked and nothing here would notice
 *
 * CONFIGURE: keep these in step with the `/*` block in `public/_headers`. The two
 * `cloudflareinsights.com` entries are Web Analytics' beacon; drop them from both files
 * if you have not enabled it
 */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  /*
   * Blocks another origin pulling these in as a subresource. CORS already stops a
   * cross-origin read, since nothing here sends `Access-Control-Allow-Origin`, but a
   * no-cors embed (`<script src>`, `<img>`) is not a read and CORS never saw it. The
   * rejected alternative is an `Origin` check, which any non-browser client forges
   */
  "Cross-Origin-Resource-Policy": "same-origin",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "Content-Security-Policy":
    "default-src 'self'; object-src 'none'; script-src 'self' 'unsafe-inline' static.cloudflareinsights.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: mediafiles.cineplex.com; font-src 'self'; connect-src 'self' cloudflareinsights.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
});

/**
 * Writes the set onto a Headers object, overwriting any existing value
 *
 * Throws on an immutable Headers guard, so call it directly only on Headers you
 * constructed; use `withSecurityHeaders` for a Response of unknown provenance
 */
export function applySecurityHeaders(headers: Headers): void {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    headers.set(name, value);
  }
}

/**
 * Returns a Response carrying the set, whatever the original's headers allow
 *
 * `Headers.set` throws `TypeError: immutable` on a guarded Headers, and two ordinary
 * handler returns produce one: `Response.redirect(...)` and a Response passed through
 * from `fetch`. Throwing is worse than a missing header, because Astro answers a
 * middleware throw by re-rendering with the middleware skipped, so the error page it
 * lands on carries nothing at all. Hence three layers, each falling back to the next
 *
 * Mutating in place preserves everything about the response, including a streamed body,
 * so the rebuild runs only on the immutable path. The rebuild is guarded in turn: the
 * Response constructor rejects a status outside 200-599, which both `Response.error()`
 * (status 0) and a 101 upgrade are, and a rebuild drops workerd-only fields like
 * `webSocket`
 */
export function withSecurityHeaders(response: Response): Response {
  try {
    applySecurityHeaders(response.headers);
    return response;
  } catch {
    try {
      const headers = new Headers(response.headers);
      applySecurityHeaders(headers);
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    } catch {
      return response;
    }
  }
}
