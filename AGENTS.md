# Movie Seats - Agent instructions

> Project context for AI coding agents. Recognized by Claude Code, Cursor, OpenAI Codex, Gemini CLI, and other tools that read [AGENTS.md](https://agents.md). Claude Code picks this up via a one-line `CLAUDE.md` containing `@AGENTS.md` (trampoline pattern, single source of truth).

## Core Engineering Principles
- Clarity over cleverness. Write code and docs that are obvious on first read.
- Explicit over implicit. State assumptions, dependencies, and constraints directly.
- Composition over inheritance. Prefer small, composable pieces over deep hierarchies.
- Fail fast and loud. Surface errors immediately with meaningful messages.
- Delete code you don't need. Dead code is misleading context.
- Verify, don't assume. Check that changes work before marking them done.

## Fundamentals
- Never assume or guess. Always ask if unclear.
- Show your work, then confirm. Present inferences and get user confirmation before acting.
- User stays in control. Hand opinionated decisions to the user.
- Incremental. Work with what already exists. Do not overwrite, replace, or ignore existing artifacts without asking.

## WHY (project scope)

Movie Seats is a real site. Prefer additive changes (new pages, new components,
content edits) over modifications to the component library under
`src/components/{elements,forms,layouts,blocks,seo}/`, which is shared, stable code.
Only the components this site renders are kept; the rest were deleted along with their
tests. See Library vs Consumer Boundary below for the full split.

## WHAT
- **Framework**: Astro 7 + React 19 islands (interactive components only)
- **Language**: TypeScript 6 (project extends `astro/tsconfigs/strict`)
- **Styling**: Tailwind CSS 4 + shadcn/ui (base-vega style, `@base-ui/react` 1.6.x primitives, CVA variants)
- **Package manager**: pnpm 11
- **Deployment**: Cloudflare Workers via `wrangler deploy` + `@astrojs/cloudflare` adapter
- **Linting/Formatting**: Biome
- **Git hooks**: lefthook (pre-commit: biome check + prettier `*.astro` + `check:types`; commit-msg: commitlint; pre-push: block direct main, then the preflight stages)
- **Commit format**: Conventional Commits (enforced by commitlint)

### Component Architecture
- Astro components (`.astro`) - server-side, minimal JS by default. Use for pages and static content.
- React components (`.tsx`) - browser interactivity only. Prefer `client:visible` over `client:load` for below-the-fold.
- Elements (`src/components/elements/`) - foundational primitives, shadcn/ui pattern, PascalCase files, named exports: Alert, Badge, Button, Card, Empty, Link, Meter, Popover, Skeleton.
- Forms (`src/components/forms/`) - data-entry controls and form composition: Combobox, Field, Input, InputGroup, Label, Textarea.
- Layouts (`src/components/layouts/`) - page structure: AspectRatio, Container, Grid, Main, Separator, Stack.
- Block components (`src/components/blocks/`) - pre-composed page sections. Only Hero, used by the two error pages.
- Custom components (`src/components/custom/`) - project-specific. The seat picker and its parts live here.
- SEO components (`src/components/seo/`) - SEO meta-tag wrapper (title, canonical, Open Graph, Twitter card) and JsonLd primitive (typed structured-data wrapper).
- Content collections (`src/content/`) - none shipped; define one in `src/content.config.ts` with a glob loader when you add Markdown/MDX content.
- `cn()` from `@/lib/utils` for conditional Tailwind classes. CVA for component variants.
- Path alias `@/` maps to `src/`.

## HOW

### Commands

Most-used scripts. Run `pnpm run` for the full list (check:secrets, check:sast, check:deps, format, generate-types, test:coverage, test:watch, etc.).

| Command | Purpose |
|---------|---------|
| `pnpm dev` | Start dev server |
| `pnpm build` | Production build |
| `pnpm preview` | Preview production build |
| `pnpm check` | Biome lint + format with auto-fix |
| `pnpm check:types` | `wrangler types` then `tsc`. The generate step is load-bearing: `worker-configuration.d.ts` is gitignored, so without it a fresh clone fails on `Env` and `cloudflare:workers` |
| `pnpm test` | Unit + component tests (Vitest, happy-dom) |
| `pnpm test:browser` | Real-browser component tests (Vitest Browser Mode, Chromium; `*.browser.test.tsx`) |
| `pnpm test:e2e` | E2E + a11y tests (Playwright, needs prior build) |
| `pnpm preflight` | Full CI pipeline locally (secrets, sast, deps, commitlint, lint, format-astro, types, test, browser, build, snapshots, E2E) |

### Agent dev server (Astro 7)

Astro 7 detects when it runs inside an AI coding agent and adapts the dev server so an agent does not tie up its session on a foreground process:

- `astro dev --background` runs the server detached, printing its URL and PID and writing a lockfile so a second start reuses the running instance instead of duplicating it. Astro enables this automatically under agent detection.
- `astro dev status` and `astro dev stop` inspect or stop that server from a separate command; `GET /_astro/status` is a machine-readable health check.
- `astro dev --json` emits structured JSON logs (also auto-enabled under agent detection). Add handlers with `logger: logHandlers.json()` (from `astro/config`) if you want JSON logging for humans too.

Humans keep using `pnpm dev` (foreground). These flags are for tooling that needs to launch, poll, and tear down the server programmatically.

### Style Rules
- PascalCase for all component files under `src/components/` (both `.astro` and `.tsx`). Kebab-case for pages and utility files.
- Named exports (not default exports) - except where Astro requires defaults (page components)
- Path alias `@/` for all imports (except colocated test files which may use `./Component`)
- **`class` vs `className`**: Astro components (`.astro`) take `class`; React components (`.tsx`) take `className`. `tsc --noEmit` does not validate Astro template attributes; the Astro language server catches mismatches in the IDE. Don't add `className` to Astro Props for convenience - keep the framework idiom (`class`) and let `cn()` / `class:list` merge.
- Present tense, imperative mood for commits: "add feature" not "added feature"
- Merge to `main` by squash (default; one clean PR-linked changelog entry) or rebase (to keep scoped commits as separate entries, no duplicate); use a merge commit only for a stacked PR onto a feature base (a merge commit to `main` is double-counted by semantic-release)

### Comments
- One-line `//` by default. Four lines or more becomes a `/* */` block **where the format has one**: YAML, shell and `.env` have no block form, so there the rule is only the style
- No trailing periods, plain wording
- **Wrap comments at 100 columns**, which is what `biome.json` and `.prettierrc.json` are both set to. Markdown prose is exempt: neither tool reflows it. Neither tool reflows a comment, so nothing enforces this: a 140-column comment survives `pnpm check` untouched. Reflow the comments you edit, not the whole file
- A **module's** file-level block opens `/** @fileoverview `. The tag is what distinguishes a description of the file from a description of whatever declaration follows it, and it needs `/**` rather than `/*` because a plain block carries no JSDoc tags. Where a `CONFIGURE:` marker leads the block, the marker stays on the first line and the tag goes on the paragraph below it. **Test files use a plain `/* */` block**: nothing imports them, so there is no declaration for the tag to disambiguate from and no tooling reading it
- A property whose default lives only in the destructuring gets `@default`. Prose saying "defaults to 3" beside a `rows = 3` restates the code; the tag is what tooling reads. Function parameters take `@param [name=value]` instead, which is the form JSDoc defines for them
- A semicolon joining two related clauses is fine, and is one of the em-dash replacements below. What to avoid is a comment built out of stacked clauses: if it needs three, it needs a block
- Applied going forward, to the files you touch. Do not sweep the tree: a script that inserts `@fileoverview` mechanically splices it mid-sentence wherever the first paragraph wraps

### Testing

| Layer | Command | What belongs here |
|---|---|---|
| Unit | `pnpm test` | pure logic: helpers, schemas, URL and SEO builders, the header set |
| Component | `pnpm test` | rendered output in happy-dom: props, variants, ARIA wiring |
| Browser | `pnpm test:browser` | anything needing real layout or computed style: resolved custom properties, overflow, focus outlines |
| Build | `pnpm test:build` | assertions against `dist/`: head meta, JSON-LD, sitemap, icon links |
| Integration | `pnpm test:e2e` | HTTP-only specs via Playwright's `request` fixture: status codes, response headers |
| E2E and a11y | `pnpm test:e2e` | every registered page, plus reduced-motion and forced-colors |

**Assert a value, never a range the layout already guarantees.** An assertion satisfied by a browser default, by any non-negative number, or by the shape rather than the content stays green while the thing it names is deleted. The classes that have actually shipped here: built only from literals; satisfied by a browser default; satisfied by any non-negative value; `toBeTruthy()` on a shape; a guard already true before the body runs; failing open; a silent skip or early return when a locator matches nothing; vacuous over an empty collection (`[]` compared to `[]`); a `describe` naming a behaviour it never exercises; a snapshot masking the values it protects; a spy on a shared prototype counting the library's calls as well as yours (`Element.prototype.scrollIntoView` also fires when Base UI brings a selected option into view, so a bare call count passed with the seat map's own scroll disabled: filter on `mock.contexts`); and a mock resolving one shared object, which is `Object.is` equal on the second call, so state never changes identity and the effect under test never re-runs.

**Break the thing and watch the test fail.** A fix whose test does not fail under mutation is not done, and the mutation has to reach the fix: a parity test comparing two constants is not verified by editing a constant.

**Extension decides the vitest project, not directory.** `src/**/*.test.ts` is `unit`, `src/**/*.test.tsx` is `components`, `src/**/*.browser.test.tsx` is `browser`, `tests/build/**/*.test.ts` is `build` (so a `.spec.ts` there runs in no project). Nothing else under `tests/` is matched by any project, so a `src/` test moved there runs in **no project at all**, silently. And `test:coverage` runs `unit` and `components` only, so a module whose only test is a browser test scores as untested while being fully exercised.

**A test file under `src/pages/` needs a `_` prefix.** Everything else there is a route and builds as an endpoint. `src/pages/_robots.txt.test.ts` works because Astro excludes underscore-prefixed files from routing.

**Both `dist/`-reading tiers need a fresh build.** `pnpm preflight:build` builds and then runs the Vitest `build` project, so use it rather than a bare `pnpm test:build`, which asserts against whatever is on disk. Playwright reads the built output too and `preflight:e2e` does not build, so it relies on `preflight:build` having run first.

**...and Playwright reuses a server it did not start.** `webServer.reuseExistingServer` is on whenever `CI` is unset, so a preview server left listening on 4400 by an earlier run serves that run's `dist/` for the rest of the day: the suite goes green or red against a bundle that no longer exists on disk. Symptom is a spec failing on text the current source plainly renders. `ss -ltnp | grep 4400` before believing an e2e result, and kill what you find. CI never hits this, which is what makes it expensive locally.

**A wrapper that filters command output can invent an exit code.** Anything that summarizes a tool's stdout can also replace its status: seen here reporting `biome ci` as failed with "Lint: No issues found" while biome was clean, and the reverse. Run verification commands unfiltered before believing either colour.

`tests/fixtures/site-pages.ts` is the single page registry: adding an entry confers smoke, a11y, SEO, emulation, sitemap and snapshot coverage. `tests/fixtures/api-endpoints.ts` is the same for endpoints.

**Eight traps worth knowing before writing a spec:**
- **A server-rendered control is not a working control.** It exists and is clickable before its island hydrates. Put `data-pending` on every pending region and every `<Suspense>` fallback, because `waitForHydration` polls it. A placeholder that is deliberately delayed still puts its marker up at once, on a `display: none` element while it waits: `querySelector` finds one, and a hidden element generates no box, so it costs no gap. A marker that recurs on a timer is worse than one left standing, so a background refresh must not reuse a pending flag
- **Testing Library will not drive Vitest's fake clock.** It decides by looking for a `jest` global, finds none, and builds every `waitFor` out of timers it believes are real. Frozen, those never fire and every wait runs to the timeout. Use `vi.useFakeTimers({ shouldAdvanceTime: true })` and pair `userEvent.setup({ advanceTimers: vi.advanceTimersByTime })` with it. `restoreMocks` does not restore timers, so `afterEach` still needs `vi.useRealTimers()`. The cost of `shouldAdvanceTime` is that the fake clock then tracks real time, so any assertion measuring a sub-second window is racing the machine
- **`waitFor` flushes a timer-queued render only for an assertion that has to *become* true.** Its act boundary is at its exit, and a condition already satisfied resolves on the first synchronous probe, before that. So a "nothing changed" assertion inside one reads the pre-flush DOM and passes however the code behaves. Use `await act(async () => {})` there. Both halves of this cost a real defect: one test missed the guard it was written for, and another passed while the value it named was never rendered at all
- **`vi.clearAllMocks()` leaves a `mockResolvedValueOnce` queue in place.** A case that dies partway through its sequence hands the unconsumed values to the next one, so a single broken test reddens unrelated tests after it and the failure surfaces in the wrong place. `vi.resetAllMocks()` clears both
- **`transition-all` means a computed style can be mid-flight.** Poll for the value; do not wait on one property and then read another
- **Safari keeps buttons out of the tab order** unless Full Keyboard Access is on, and webkit models that: `element.focus()` leaves `activeElement` as BODY while `press("Enter")` still activates. Assert authoring and activation, not focus
- **Playwright's web-first assertions retry.** `expect(locator).toHaveCount(0)` waits up to five seconds, so it will sit out the very condition a "did this helper wait?" test is checking. Use a plain `count()` there
- **happy-dom's `matchMedia` does not observe an `innerWidth` redefined on the global.** Probed: `innerWidth` reads back 375 while `(max-width: 767px)` is still false, so a width-dependent hook needs both stubbed

### Accessibility

The axe scan runs WCAG 2.1 and 2.2 AA plus `best-practice`. Ten things this library gets wrong if you are not deliberate:

1. **An `<h1>` must exist and sit inside a landmark.** `page-has-heading-one` only checks that one exists anywhere; the separate `region` rule fires on content outside every landmark, so an `<h1>` loose between `<header>` and `<main>` satisfies one and violates the other
2. **Never `aria-label` on `<time>`.** It has no corresponding ARIA role, so naming it is prohibited, and screen readers commonly drop the label. **axe cannot catch this**: it returns *incomplete* when the element has text and does not flag it at all inside a link. Nothing automated enforces it either: the page renders no `<time>` at all, so a build-tier scan for one matched an empty set and read as coverage while providing none. The rule stands as a rule
3. **Name any `role="region"`.** An unnamed region is dropped from the accessibility tree, which takes its `aria-roledescription` with it
4. **A `ring-*` box-shadow is not painted under `forced-colors: active`, and a border is forced to the same colour focused or not.** So a focus indicator built only from those is invisible in high-contrast mode. Use the `focus-outline` utility, or `outline-hidden` for a forced-colors-only outline

5. **`forced-colors: active` does not adjust an `svg` the way it adjusts its container.** The UA sheet gives every `svg` `forced-color-adjust: preserve-parent-color`, so glyph tones survive while the `background-color` behind them is forced to Canvas. Tones picked for a dark surface then sit on white: the seat map measured 1.26:1 that way. Opt the glyph back in with `forced-color-adjust: auto` and restate the states in system colours

6. **Content that updates on its own is SC 2.2.2, and axe has no rule that reaches it.** Its only 2.2.2 rules are `blink` and `marquee`, so an auto-updating region is never flagged. The seat map refetches on a timer with no pause control; the refresh button beside the capacity label is not one, because the criterion asks for pause, stop or hide. Two grounds, in order: the criterion's auto-updating clause reaches content "presented in parallel with other content", and the map is what the reader came for rather than a ticker beside it; failing that, live availability is essential to the activity, which is the exception a scoreboard runs on. It holds only while the update moves no focus, reflows no control, and stops on a hidden tab. Break any of those and the exception goes with it. **"Reflows no control" is a live constraint, not a formality**: the poor-seating warning flips as the back fills, so it renders *below* the meter rather than anywhere above it, where appearing would shove the refresh button down a line mid-read. The control sits on the label row, two rows up, which is what keeps it out of reach of a warning that comes and goes

7. **`role="meter"` is `childrenPresentational`, so a control belongs beside a meter and never inside one.** axe-core matches the root and fails `nested-interactive` on any focusable descendant (`wcag2a`, `wcag412`, serious), and assistive tech drops the child's role and name while it stays tabbable. Applies equally to the other children-presentational roles. It also prunes the label and the value, so putting a control between them means lifting both out and wiring `aria-labelledby` by hand: Base UI's `Meter.Root` merges element props after its own defaults, so an explicit one wins and the internal id is never emitted with no label child. `Meter` here exports no label or value part for that reason: both could only render inside the root, where nothing reads them

8. **`aria-disabled` over `disabled` for a transient busy state.** A real `disabled` attribute drops the element from the tab order mid-press, so a keyboard reader's focus lands on `<body>` and they can neither retry nor tab onward. `aria-disabled` keeps focus and announces "unavailable", and the click handler is what actually refuses. Two costs to pay deliberately: the base `Button` dims on the `:disabled` pseudo-class only, so the `aria-disabled:` variants have to be written out, and **Playwright's actionability check reads `aria-disabled` as not-enabled**, so a test that means to exercise the handler's guard needs `click({ force: true })`

9. **Base UI's combobox highlight is an index, so reordering an open list retargets it silently.** `activeIndex` is a plain integer, the option's DOM id is `${rootId}-${index}`, and `aria-activedescendant` is built from that index. Reorder a list of the same length while it is open and the reported id is byte-identical while the option under it is a different thing: nothing announces, and the next Enter commits a choice the reader never aimed at. There is no prop for it, the model is index-based by design, so the fix belongs in the consumer: hold the new order until `onOpenChange` reports the list closed, which is what `SeatFinder` does with the reader's position. The same applies to any list a background result can reorder

10. **A `fill-opacity` on a tone that already carries alpha multiplies.** Where stroke and fill then differ, it is the stroke that carries 1.4.11: the fill is interior shading rather than the part that makes the object perceivable. Under `forced-colors: active` the substitution replaces the colour and leaves the alpha, so any element relying on a system colour to guarantee contrast needs `fill-opacity: 1` restated in that block

Colour is never the only state signal. Tap targets clear 24 x 24 including the spacing exception, **for anything interactive**; a `role="img"` with no handler and no tabindex is not a target and SC 2.5.8 does not reach it, which is why the seat cells are 20px.

**A control that disables itself while it loads announces nothing.** NVDA and JAWS skip a disabled field in forms mode, so `placeholder="Loading showtimes"` reaches sighted readers only. Deliberate here, since the alternative is an enabled control offering an empty list, but it is a gap rather than a solved problem: nothing in `src/` sets `aria-busy`, and `Skeleton` carries no role or label either, so seat-map loading is not conveyed to assistive tech at any point. **The refresh control has the same gap from the other side**: it is reachable and it works, but nothing announces that a press succeeded. The timestamp changes and is deliberately not a live region, and the `role="status"` beside the map speaks only when the occupied count rose, so a refresh that changes nothing is silent (SC 4.1.3). There are two live regions on the page now, the map's and the theatre list's. They can both speak: the list's fires whenever the position resolves, which on a first visit is however long the reader takes to answer the browser prompt, so one left sitting while all three selects are filled lands in the same window as a refresh. Unmeasured and untested, and the reason to keep the count at two.

Non-text contrast (SC 1.4.11) has **no automated axe rule**. `SeatMap.browser.test.tsx` measures every seat tone against the surface it is drawn on, which covers graphical objects on that one surface and nothing else: a **control** boundary still needs its own written check. One tone is exempted from the 3:1 floor by name, with its own lower one: an occupied seat's *body*. No darker colour exists on that surface (the floor is 37.6% parchment against a 40% tone, and the darkest palette entry is 2.50:1), and moving the surface runs backwards, so the stroke carries the criterion and the fill recedes. The exemption is a named set the test asserts, never a skipped entry. One control boundary on that surface does now have its own check, in the same file: the scroller's scrollbar thumb, measured against its track at 6.50:1. **Authoring `scrollbar-color` is what puts a scrollbar inside 1.4.11 at all**, since the criterion exempts appearance "determined by the user agent and not modified by the author"; the same clause is why the size is left alone, a thumb being a target that cannot reach 24. Every other authored control boundary here (`Button`'s ring, `InputGroup`'s border, `Card`'s `ring-1`) is still unmeasured.

### Styling traps
- **Tailwind 4's `outline-none` sets `--tw-outline-style: none`**, and every `outline-<n>` resolves its style through that variable, so `outline-none` plus `focus-visible:outline-1` paints nothing while every class is present in the markup
- **Only quarter-step spacing multiples emit.** `p-2.25` compiles; `p-3.7` compiles to no rule at all, with no warning. Negative forms are separate utilities and can go missing independently
- **`cn()` can drop a class it does not recognize.** It is plain `twMerge(clsx(...))` with no group config, and tailwind-merge decides conflicts from a built-in table, so a custom utility it parses as belonging to a known group loses to a built-in one in the same group. Check a new `@utility` against `cn()` before relying on it; if one does get dropped, the remedy is to introduce `extendTailwindMerge`, which this repo does not currently use. The shipped `focus-outline` was checked and survives alongside `outline-none`
- **tailwind-merge wins by deletion, not by cascade**, so swapping `cn()` for plain `clsx` would make the outcome order-dependent
- **Never redefine a Tailwind breakpoint token.** `lg:` alone has over a hundred call sites here; add a new name instead
- **A disabled button gets `pointer-events-none`**, so a control positioned over another passes its click through to it

### Measured numbers carry their derivation
Cite the primary source when there is one: the WCAG criterion, the Cloudflare doc, the npm package. When there is not, write the arithmetic into the repo in one line. A bare magic number and an invented citation are both the failure mode, **and so is a derivation nothing verifies**: the comment is not the fix, so pin the number with a test.

### Verify a dependency override is obsolete before dropping it
Re-resolve in a scratch copy; do not read the version. An override can resolve above its own floor and still be load-bearing, because removing it lets an older copy back in through a different dependent. `.trivyignore` follows the same discipline: every entry carries a rationale and a review-by date.

### Branch Naming
`feat/`, `fix/`, `chore/`, `refactor/`, `docs/` + short-description

### Project Tools

| Tool | Purpose |
|------|---------|
| Biome | Lint + format (JS, TS, JSON, JSONC, CSS) |
| Prettier (`prettier-plugin-astro`) | Format `.astro` files (Biome's Astro support is experimental) |
| lefthook | Git hooks manager |
| commitlint | Commit message validation (Conventional Commits) |
| gitleaks | Secret scanning (lefthook pre-commit + CI `secrets`) |
| Semgrep | SAST (CI `sast`, Docker container) |
| Trivy | CVE scan against `pnpm-lock.yaml` (preflight + CI `deps`) |
| Vitest | Unit + component tests (happy-dom); real-browser component tests via Browser Mode (`*.browser.test.tsx`, Chromium) |
| Playwright | E2E + a11y tests via `pnpm exec playwright` (CLI). |
| axe-core | WCAG 2.1 + 2.2 AA scanning |
| gh | GitHub CLI for PRs/issues |
| wrangler | Cloudflare Workers CLI |
| semantic-release | Automated version + tag + GitHub Release |

## Output Preferences
- Tables for structured comparisons
- Bullet lists for enumerated items
- Code blocks for reviewable content
- Summary first, details on request

## Additional Documentation

This file is the engineering reference. There is no second one, so a convention that
belongs somewhere belongs here.

- `SECURITY.md` - response headers, audit policy
- `CONTRIBUTING.md` - workflow, branch naming, commit format

## Mandatory Directives

### Parameterization markers (IMPORTANT)
`// CONFIGURE:` comment markers flag every project-specific swap point. Fill
each one, or delete it once the decision it flags is made. Do not delete one
without making the decision. Add new
markers when introducing new project-specific values.

### Staleness Prevention (CRITICAL)
When codebase changes occur, update ALL affected artifacts BEFORE stopping:
- [ ] AGENTS.md - counts, descriptions, references still accurate?
- [ ] CHANGELOG.md - autogenerated by semantic-release from commits; never hand-edit. Confirm the commit message (Conventional Commits) captures the change.
- [ ] Code comments - updated to reflect changes, not left stale
- [ ] `tests/fixtures/site-pages.ts` and `api-endpoints.ts` - did a route or endpoint appear or leave?
- [ ] `public/_headers` and `src/lib/security-headers.ts` - a header edited in one needs the other; the colocated test fails on drift
- [ ] `vitest.config.ts` coverage floors - re-measure with `pnpm test:coverage` if the change moves them, and say what the new numbers are

### Comment Preservation (IMPORTANT)
Never strip existing code comments. Update stale comments. Only delete
comments that obviously restate the code itself.

### Scoped Commits (IMPORTANT)
Commits should be scoped like PRs. Split unrelated changes into separate commits.

### No AI Attribution (CRITICAL)
NEVER add Co-Authored-By, Generated-By, or any AI attribution lines to
commit messages.

### No Em Dashes in Tracked Files (IMPORTANT)
Never use em dashes in human-facing files: CHANGELOG, CONTRIBUTING, README,
SECURITY.md, page content, code comments. Replacements: `-` (hyphen) for labels and separators,
`,` for inline asides, `:` for definitions, `;` for related clauses.
Internal agent-tool config (`.claude/`, `.cursor/`, `.codex/`, `.gemini/`, memory files) are exempt.

### No Overengineering (IMPORTANT)
Do not add features, abstractions, or complexity beyond what was asked.
Three similar lines is better than a premature abstraction.

### No Phantom References
Only reference a file, test, command, job name, number, skill, rule, hook or doc
pointer that actually exists. If something is planned, say **planned**: a doc
asserting a test exists is worse than one saying nothing, because it stops anyone
from writing the test.

### Fix the code, not the comment (IMPORTANT)
If a workaround needs a paragraph of comment to justify it, the code is wrong.
Rewrite the code. A comment explaining why something indefensible is acceptable is
the signal, not the fix.

### Ordered Deletion (IMPORTANT)
Removing a feature is not one pass. Fix importers **before** deleting what they
import, or the build breaks midway and the failures point at the wrong files. Grep
for consumers first; a single directory can sit on a chain of several hidden
dependencies.

### Library vs Consumer Boundary (IMPORTANT)
- Library code: `src/components/{elements,forms,layouts,blocks,seo}/`, `src/hooks/`, `src/lib/{utils,seo,structured-data,security-headers,url}.ts`, `src/lib/api/`, `src/middleware.ts`, `src/styles/global.css` (the layer + tokens part). Treat as stable; modify with care. `src/middleware.ts` is what puts the security headers on every server-rendered response, including every 404, so deleting it is a security change rather than a cleanup. `src/lib/api/` is on the hot path of every API route despite `cached-fetch.ts` once claiming nothing imported it.
- Consumer code: `src/pages/`, `src/components/custom/` (this project's own components; consumer-owned), `src/lib/cineplex/`, `src/lib/{site-config,seating,showtime-format,booking,cineplex-client,theatre-distance}.ts`, brand parameterization points. Edit freely.
- Every file under `src/lib/` is on one of those two lists. If a new one is not, add it here rather than guessing.

When asked for changes, default to consumer code. Modify library code
only when the change is genuinely a library improvement. `CHANGELOG.md` is
generated from commit messages, so a library defect and its fix are recorded by
the commit that carries them: give it a `fix:` type and say what broke.

Build pages and sections from the included library components first
(`elements`, `forms`, `layouts`, `blocks`, `seo`). Reach for
`src/components/custom/` only when no library component fits, or while you
iterate on a new component before it stabilizes. A custom component that
settles and gets reused belongs in the library, not `custom/`.

### Library-First UI (CRITICAL)
When building UI, reach for library primitives in `src/components/{elements,forms,layouts,blocks,seo}/` BEFORE writing raw HTML + Tailwind utilities. Workarounds (`<div class="flex flex-col gap-4">`, `<div class="grid grid-cols-3">`, `<button class="bg-primary ...">`, `<a class="rounded-md border ...">`, hand-rolled card or item markup) duplicate behavior the library already owns: variant systems, focus rings, dark-mode tokens, ARIA wiring, mobile responsiveness, hover/active/disabled states.

**Reach for these primitives first:**

| If you would write... | Use instead |
|---|---|
| `<div class="flex flex-col gap-N">` / `<div class="flex flex-row gap-N">` | `<Stack direction={...} gap={...}>` |
| `<div class="grid grid-cols-N">` | `<Grid cols={N}>` |
| `<div class="mx-auto max-w-7xl">` | `<Container size={...}>` |
| `<main id="main-content" tabindex="-1">` | `<Main>` |
| `<div style="aspect-ratio: 16/9">` or `<div class="aspect-video">` | `<AspectRatio ratio={...}>` |
| `<hr>` or a bespoke divider | `<Separator>` |
| `<button class="bg-primary ...">` | `<Button variant={...} size={...}>` |
| `<a class="bg-primary ...">` styled link | `<Link variant={...}>` (`src/components/elements/Link.tsx`) |
| `<div class="rounded border bg-card ...">` card surface | `<Card>` (+ `CardHeader`, `CardTitle`, `CardContent`, `CardFooter`) |
| A hand-rolled popover or disclosure | `<Popover>` from `src/components/elements/` |
| A hand-rolled badge, banner or empty state | `<Badge>` / `<Alert>` / `<Empty>` |
| A hand-rolled progress or capacity bar | `<Meter>` |
| A loading placeholder built from `animate-pulse` | `<Skeleton>` |
| `<input>` / `<textarea>` / a searchable select styled by hand | `<Input>` / `<Textarea>` / `<Combobox>` from `src/components/forms/`, wrapped in `<Field>` |

Every row here names something that exists, but the table is not a full inventory, so
check `src/components/` before concluding a primitive is missing. If a row ever names
something that is gone, the row is the bug: delete it rather than chasing the import.

**When workarounds are warranted:**
- The library primitive truly does not fit (one-off animation, an exact visual that cannot be expressed via existing variants).
- Adding a variant would over-fit the primitive to a single consumer.
- The pattern is one-off enough that extending the library would be premature abstraction.

**When you do reach for raw HTML/Tailwind:** flag it explicitly in your response so the user can decide whether to (a) extend the existing primitive, (b) introduce a new primitive, or (c) accept the workaround as a deliberate exception. Silent workarounds erode the library; tracked workarounds let the library grow.

### Do Not Weaken a Test to Make it Pass (IMPORTANT)
If a test starts failing, first find out whether it had been passing for the wrong
reason. Loosening an assertion, masking a value in a snapshot or widening a range
turns a real signal into a green one.

## Self-Correcting

If a directive in this file is ignored or a command is hallucinated,
treat it as a bug in `AGENTS.md`. Refactor or re-prioritize the rule
rather than working around it. If a directive is unclear, ineffective,
or contradicts another, rewrite it.
