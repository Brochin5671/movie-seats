import { defineConfig, devices } from "@playwright/test";

// Test infrastructure owns its port; does not depend on Astro's default
const TEST_PORT = 4400;
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${TEST_PORT}`;

/*
 * Desktop-only specs. Text, DOM counts, HTTP status and computed colour do not move with
 * the viewport, so a second run buys nothing. Accessibility stays on both, because
 * target-size and reflow are the viewport-dependent axe rules
 *
 * `seat-finder` is here despite one narrow-screen case: that case sets its own viewport,
 * so under Pixel 5 it would override the project's and assert the same thing twice
 */
const DESKTOP_ONLY = [/emulation\.spec/, /harness\.spec/, /smoke\.spec/, /seat-finder\.spec/];

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  /*
   * Local keeps retries at 0: a flake is a real bug, so fix the test rather
   * than paper over it. CI gets 2 retries to absorb parallel-load timing
   * flakes that do not reproduce locally under GH-runner contention. Real flakes
   * still surface in dev, where retries stay 0.
   */
  retries: process.env.CI ? 2 : 0,
  /*
   * Two workers, one per core on the 2 vCPU runner. The suite is all-chromium, so
   * nothing here needs a third process, and the CD a11y job passes `--workers=2` for
   * the same reason. Local matches CI: the unbounded default overwhelms the shared
   * preview server and times out under load
   */
  workers: 2,
  // CI: `list` streams live per-test progress to the job log; `html` is the
  // durable report (uploaded as an artifact); `github` posts inline
  // annotations (pass count, flaky, slowest spec)
  reporter: process.env.CI
    ? [["list"], ["html", { open: "never" }], ["github"]]
    : [["html", { open: "on-failure" }]],
  timeout: 15_000,
  use: {
    baseURL: BASE_URL,
    // CI runs retries:2, so on-first-retry captures the run where a flake
    // reproduces without tracing every pass. Local runs retries:0, where
    // on-first-retry never fires - keep retain-on-failure for live debugging
    trace: process.env.CI ? "on-first-retry" : "retain-on-failure",
    screenshot: "only-on-failure",
    actionTimeout: 5_000,
    // CONFIGURE: pin for reproducible runs; change for non-US/UTC audiences
    locale: "en-US",
    timezoneId: "UTC",
    // CONFIGURE: matches site's class="dark"; forward-compat for prefers-color-scheme
    colorScheme: "dark",
  },
  /*
   * CONFIGURE: chromium at two viewports, because this is a mobile-first page whose
   * layout is the thing worth checking twice. The webkit projects were dropped: they
   * doubled the run to re-assert engine-independent rules, and the seat grid's real
   * risks are layout and per-seat naming, which one engine answers. Add a webkit
   * project back before shipping anything that depends on Safari-specific behaviour
   */
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chromium", use: { ...devices["Pixel 5"] }, testIgnore: DESKTOP_ONLY },
    // HTTP-only specs against the preview server, so no browser device
    { name: "integration", testDir: "./tests/integration" },
  ],
  webServer: {
    /*
     * Strip the built secrets before serving, so the suite cannot send real
     * traffic through a provider you wire up later
     *
     * `pnpm build` copies `.dev.vars` into `dist/server/`, and wrangler loads it from
     * there, so a key present only in `.dev.vars` still reaches the preview worker
     *
     * Load-bearing here, not a precaution. Without it every `pnpm test:e2e` run would
     * send real traffic to Cineplex from one IP, which the API notes name as the
     * fastest way to get the key rotated. It is also what makes the integration specs
     * deterministic: with no key the routes answer a flat 503, so their expected
     * statuses do not depend on what is playing today
     *
     * A `process.env` override does not substitute for it. Wrangler reads the file
     */
    command: `node -e "require('node:fs').rmSync('dist/server/.dev.vars',{force:true})" && pnpm preview --port ${TEST_PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    // Astro 7's Cloudflare adapter previews through workerd; a cold boot (first
    // CI run, no warm cache) runs past the old 15s, so give startup headroom
    timeout: 120_000,
  },
});
