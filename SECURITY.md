# Security policy

## Reporting a vulnerability

Email maximbrochin@gmail.com with the details and steps to reproduce. Expect an
acknowledgement within a few days.

Please report privately first rather than opening a public issue.

## What ships with the app

Every server-rendered response carries the header set in
`src/lib/security-headers.ts`, applied by `src/middleware.ts`. Prerendered routes are
served by Cloudflare's asset server instead, which reads `public/_headers`. The two
files hold the same set and a colocated test fails if they drift, so a header added to
one has to be added to the other.

The Content-Security-Policy allows images from `mediafiles.cineplex.com`, which is
where movie posters are served from. Nothing else third-party is permitted: `font-src`
is `'self'` because the brand font is self-hosted, and `frame-ancestors` is `'none'`.

`Cross-Origin-Resource-Policy: same-origin` is in the same set. Nothing here sends
`Access-Control-Allow-Origin`, so a browser already blocks another site's JavaScript from
reading these responses; CORP closes the other half by blocking a no-cors embed, which
CORS never sees. There is deliberately no `Origin` header check: it would inspect a value
any non-browser client sets to whatever it likes, so it would stop nobody who matters
while breaking legitimate non-browser callers.

## Rate limiting

`/api/seats`, `/api/showtimes`, `/api/narrow/movies` and `/api/narrow/theatres` are capped
per client IP through a Cloudflare `ratelimit` binding, at 30 requests a minute and 5 for
the last of those. The four are the routes whose cache key a caller can vary: `/api/movies`
and `/api/theatres` take no parameters, so they are one cache entry each and cost nothing to
repeat.

`/api/narrow/theatres` gets the tighter cap because it is the only call that moves real
bytes. Measured on 2026-08-03 against the live API, across the four widest current releases,
the film-wide upstream response decodes to between 2.4 MB and 10.7 MB of JSON (522 KB gzipped
on the wire at the top of that range). The same film scoped to one theatre is 93 KB. That
ratio, about a hundred to one, is what earns it a bucket of its own, and it is the figure to
re-measure rather than trust: it tracks how many theatres carry a given film.

What this protects is the Cineplex API quota, not the site. A request for a showtime that
does not exist misses the cache, makes two upstream calls and stores nothing, so
enumeration is the one pattern whose cost scales. Cloudflare counts per location and
documents the result as eventually consistent, so a distributed caller gets the limit once
per location: this raises the cost of scraping and does not stop it. IPv6 callers are
counted by their /64 rather than their full address, because a routed /64 would otherwise
be 2^64 separate budgets.

The site is now one of the callers that budget has to cover, and it spends it two ways. An
open seat map refetches every 30 seconds, which is 2 of the 30 requests a minute, so about
fifteen idle tabs fit behind one address. The refresh control beside the capacity label is
the other: it holds for 10 seconds after each press, so a reader pressing steadily adds at
most 6 a minute. A worst-case tab is therefore 8, and only three of those fit. Because IPv6
callers are counted by their /64, that address can be a whole household.

Upstream costs less than either figure suggests, because the two seat legs are cached apart.
The auditorium's layout holds for 60 seconds and its availability for 10, so one viewer costs
3 Cineplex calls a minute and any number of viewers on the same screening costs at most 7.
Raising the refresh rate, or shortening the control's cooldown, spends the per-IP budget
faster. Lowering a seat cache TTL does not, because the limiter is consulted before the cache
is; it spends the Cineplex quota instead. They are two separate costs, and the refresh rate
moves both.

There is no client-side API key, deliberately. Any key the browser sends is public: it
ships in the JS bundle and shows in devtools.

## The upstream API key

`CINEPLEX_API_KEY` is a server secret. It lives in `.dev.vars` locally (gitignored) and
is set with `wrangler secret put` in production. It is never written into a tracked
file, never reaches the browser, and never becomes part of a cache key: `getCached()`
keys on the URL alone and the key travels in a request header.

Every upstream call goes through the server. The browser only ever talks to this app's
own `/api/*` routes, which project the upstream payload down before responding, so no
raw Cineplex response reaches a client.

## Audit

`pnpm preflight` runs gitleaks (secret scanning), Semgrep (SAST) and Trivy (dependency
CVEs) before the test tiers. CI runs the same three on every pull request.
