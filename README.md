# Movie Seats

See which seats are still available for a Cineplex showtime before you book.

Pick a theatre and a movie, pick a showtime, and the page renders the auditorium's seat
map with live availability, a capacity meter, and a legend. Mobile first.

## Running it

You need a Cineplex API key. It is the key Cineplex ships to its own browser, findable
in DevTools on cineplex.com. It is not licensed to this project and Cineplex can rotate
it at any time, at which point every call starts returning 401.

```bash
pnpm install
echo 'CINEPLEX_API_KEY=<key>' > .dev.vars   # gitignored, never commit it
pnpm dev
```

Without the key the routes answer `503 upstream_unconfigured` and the page says so.
That is deliberate: an unset key is an operator problem, not an empty result.

| Command | Purpose |
|---|---|
| `pnpm dev` | Start the dev server |
| `pnpm build` | Production build |
| `pnpm preview` | Serve the production build |
| `pnpm check` | Lint and format |
| `pnpm check:types` | Type check |
| `pnpm test` | Unit and component tests |
| `pnpm test:browser` | Real-browser component tests |
| `pnpm test:e2e` | End-to-end and accessibility tests (needs a build first) |
| `pnpm preflight` | The full pipeline, in CI order |
| `pnpm generate:og` | Re-render `public/og-logo.png` after changing the tagline or the palette |

Run `pnpm run` for the rest.

## Layout

```
src/
  components/
    custom/      the seat picker: SeatFinder and its parts
    elements/    Alert, Badge, Button, Card, Empty, Link, Meter, Popover, Skeleton
    forms/       Combobox, Field, Input, InputGroup, Label, Textarea
    layouts/     AspectRatio, Container, Grid, Main, Separator, Stack
    blocks/      Hero, used by the two error pages
    seo/         meta tags and JSON-LD
  lib/
    cineplex/    upstream calls and the projections that shrink them
    api/         shared response helpers, the cached fetch, the rate limiter
  pages/
    api/         the six internal routes the browser talks to
  styles/        global.css: design tokens and the base layer
scripts/         generate-og-logo.mjs, the only build artifact kept in the repo
tests/           build, e2e, integration, and shared fixtures
```

## How the data flows

The browser never calls Cineplex. It calls this app's `/api/*` routes, which fetch
upstream on the server, project the payload down to the shape the page needs, and
cache the result. One upstream response runs to megabytes; none of that reaches a client.

`src/lib/cineplex/projections.ts` is pure and imports nothing but types, which is what
makes the awkward parts of the upstream format testable against literal fixtures.

An open seat map re-requests `/api/seats` every 30 seconds so it does not go stale, pauses
while the tab is hidden, and can be refreshed by hand from the control beside the capacity
label. The two seat legs are cached apart to pay for that: the auditorium's layout does not
change while a screening is on sale, so a refresh costs one upstream call rather than two.
Change the interval, or the control's cooldown, and you change what the rate limiter and the
Cineplex quota both have to absorb; `SECURITY.md` has the arithmetic.

The map names the moment it last arrived rather than how old it is, so a refresh that stops
working shows as a time that stops moving instead of a label that keeps sounding fresh.

## More

- `AGENTS.md` - the instruction file AI coding agents read before touching this repo:
  conventions, testing layers, and the library boundary. It follows the
  [agents.md](https://agents.md) convention, and a one-line `CLAUDE.md` points Claude Code at
  it so there is one source of truth rather than a copy per tool
- `CONTRIBUTING.md` - branch naming and commit format
- `SECURITY.md` - response headers, the API key, reporting
