import { expect, type Page, test } from "@playwright/test";
import {
  attachAxeResults,
  createAxeBuilder,
  disableAnimations,
  waitForHydration,
} from "../fixtures/axe-helper";
import { emptySessions, movies, seatMap, sessions, theatres } from "../fixtures/cineplex-payloads";

/*
 * The happy path, driven end to end against stubbed API routes
 *
 * The preview server deliberately has no API key, so the app's own routes answer 503 and
 * nothing below this file could ever reach a rendered seat map. Stubbing at the network
 * boundary is what makes the populated state reachable at all, and it is also what makes
 * it stable: real showtimes change daily, and a suite pointed at Cineplex would send
 * that API traffic on every run
 */

async function stubApi(page: Page, options: { sessions?: typeof sessions } = {}) {
  const json = (body: unknown) => ({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
  await page.route("**/api/theatres", (route) => route.fulfill(json(theatres)));
  await page.route("**/api/movies", (route) => route.fulfill(json(movies)));
  await page.route("**/api/narrow/movies**", (route) =>
    route.fulfill(json({ filmIds: movies.map((m) => m.id) })),
  );
  await page.route("**/api/narrow/theatres**", (route) =>
    route.fulfill(json({ theatreIds: theatres.map((t) => t.id) })),
  );
  await page.route("**/api/showtimes**", (route) =>
    route.fulfill(json(options.sessions ?? sessions)),
  );
  await page.route("**/api/seats**", (route) => route.fulfill(json(seatMap)));
}

const choose = async (page: Page, name: string, option: string | RegExp) => {
  await page.getByRole("combobox", { name }).click();
  await page.getByRole("option", { name: option }).first().click();
};

const selectShowtime = async (page: Page) => {
  await choose(page, "Theatres", "Galaxy Cinemas Barrie");
  await choose(page, "Movies", "Spider-Man: Brand New Day");
  await expect(page.getByRole("combobox", { name: "Showtimes" })).toBeEnabled();
  await choose(page, "Showtimes", "6:45 PM");
};

test.describe("Seat finder", () => {
  test("renders the seat map, the meter and the legend for a chosen showtime", async ({ page }) => {
    await stubApi(page);
    await page.goto("/");
    await selectShowtime(page);

    /*
     * Every line, in order. Scoped to the card, because the day label also appears as the
     * showtime select's group heading, which Base UI keeps mounted after a choice is made
     *
     * An array over the paragraphs rather than four containment checks: it pins which
     * strings share a line, the order they come in, and that there are exactly four. The
     * wall clock is the one the API sent, never converted, and the auditorium is free text
     * rendered verbatim rather than parsed for a number
     */
    const card = page.locator('[data-slot="card"]');
    await expect(card.locator("p")).toHaveText([
      "Spider-Man: Brand New Day",
      "Galaxy Cinemas Barrie",
      "Sun Aug 2 · 6:45 PM",
      "Aud 12 · 3D · D-BOX",
    ]);

    const meter = page.getByRole("meter", { name: "Capacity" });
    await expect(meter).toHaveAttribute("aria-valuenow", "3");
    await expect(page.getByText("3/10")).toBeVisible();

    // one img role per seat, and the aisle contributes none
    await expect(page.getByRole("img", { name: /^AA1,/ })).toHaveCount(1);
    await expect(page.locator('[data-slot="seat"]')).toHaveCount(10);
    await expect(page.getByRole("img", { name: "AA4, standard, occupied" })).toBeVisible();
    await expect(page.getByRole("img", { name: "AA2, wheelchair, available" })).toBeVisible();
    await expect(page.getByRole("img", { name: "C1, D-BOX, available" })).toBeVisible();

    await expect(page.locator('[data-slot="seat-legend"]')).toBeVisible();
  });

  /*
   * The scan that actually matters. Every other a11y case in this suite runs over the
   * unconfigured error state, because that is all the preview server can produce; this
   * is the only one that sees a populated seat map, which is where the per-seat naming,
   * the meter wiring and the scroller's group name all live
   */
  test("a populated seat map has no accessibility violations", async ({ page }, testInfo) => {
    await stubApi(page);
    await page.goto("/");
    await selectShowtime(page);
    await expect(page.locator('[data-slot="seat"]').first()).toBeVisible();

    await disableAnimations(page);
    await waitForHydration(page);
    const results = await createAxeBuilder(page).analyze();
    await attachAxeResults(testInfo, results);
    expect(results.violations).toEqual([]);
  });

  /*
   * The map shows availability, it does not sell seats. Booking is Cineplex's job, so
   * nothing in the grid may look pickable
   */
  test("seats are read-only, with the booking link as the only way out", async ({ page }) => {
    await stubApi(page);
    await page.goto("/");
    await selectShowtime(page);

    /*
     * The seats have to exist before their absence of controls means anything: a
     * `toHaveCount(0)` over a locator that matches nothing passes when the map failed
     * to render at all
     */
    const scroller = page.locator('[data-slot="seat-scroller"]');
    await expect(page.locator('[data-slot="seat"]')).toHaveCount(10);
    await expect(scroller.locator("button, a, input")).toHaveCount(0);

    // Built from the chosen theatre and screening, so it opens the seat picker for this
    // showtime rather than a Cineplex landing page
    const booking = page.getByRole("link", { name: /book on cineplex/i });
    await expect(booking).toHaveAttribute(
      "href",
      "https://www.cineplex.com/ticketing/preview?theatreId=7249&showtimeId=326227",
    );
    await expect(booking).toHaveAttribute("target", "_blank");
  });

  /*
   * High-contrast mode, where the map was blank
   *
   * The two halves of the map are adjusted differently: `background-color` on the surface
   * IS forced, to Canvas, while the UA sheet gives every `svg` `forced-color-adjust:
   * preserve-parent-color`, so the glyph tones are NOT. Under a light contrast theme, which
   * is the default, tones chosen for a near-black surface were therefore left sitting on
   * white: 1.26:1 for a free seat and 1.11:1 for a taken one. `global.css` opts the glyphs
   * back in and restates the states in system colours, which is correct under either
   * Canvas; this is the only place a populated map exists to check it on
   */
  test("the seat map is legible in forced-colors mode", async ({ page }) => {
    await stubApi(page);
    await page.emulateMedia({ forcedColors: "active" });
    await page.goto("/");
    await selectShowtime(page);
    await expect(page.locator('[data-slot="seat"]').first()).toBeVisible();

    /*
     * Every rendered state, not a sample. The palette tones are what forced colors leaves
     * alone, so any state still wearing one is still invisible, and checking two of six
     * would miss the other four
     */
    const painted = await page.locator('[data-slot="seat"]').evaluateAll((seats) => {
      const tones: Record<string, string> = {};
      for (const seat of seats) {
        const svg = seat.querySelector("svg");
        if (!svg) continue;
        const key = (seat as HTMLElement).dataset.recommended
          ? "recommended"
          : ((seat as HTMLElement).dataset.state ?? "");
        tones[key] = getComputedStyle(svg).stroke;
      }
      return tones;
    });

    /*
     * Guards everything below: the fixture has to render the states being checked
     *
     * No `dbox`, because the fixture's one D-BOX seat is also the recommended one and the
     * green shadows the tan. That state is a documented gap here anyway: under forced
     * colors D-BOX and standard are identical, since tan was the only thing between them
     */
    expect(Object.keys(painted).sort()).toEqual([
      "companion",
      "occupied",
      "recommended",
      "standard",
      "wheelchair",
    ]);

    // No palette value survives. Parchment, tan or rust here is exactly the bug: a warm
    // glyph left on the forced white Canvas
    const palette = ["rgb(245, 227, 190)", "rgb(203, 142, 74)", "rgb(200, 90, 52)"];
    for (const [state, stroke] of Object.entries(painted)) {
      expect(palette, `${state} is still ${stroke}`).not.toContain(stroke);
    }

    // ...and availability still reads, which is the distinction the map exists for
    expect(painted.occupied).not.toBe(painted.standard);

    /*
     * A taken seat is painted solid here, not at the second alpha it wears on the ink
     * surface. Forced colors substitutes the colour and leaves the alpha alone, so without
     * the override the fill is 60% of GrayText over Canvas and the whole argument for
     * system colours, that they are guaranteed to contrast, stops holding
     */
    const occupiedFill = await page
      .locator('[data-slot="seat"][data-state="occupied"] svg')
      .first()
      .evaluate((glyph) => Number(getComputedStyle(glyph).fillOpacity));
    expect(occupiedFill).toBe(1);

    /*
     * The legend too. Its swatches sit on the same ink surface wearing the same palette
     * tones, so it has the identical bug, in the one element whose job is explaining the
     * colours. Measured here rather than in its own test because it only exists on a page
     * that has a seat map
     */
    const swatches = await page
      .locator('[data-slot="seat-legend"] svg')
      .evaluateAll((icons) => icons.map((icon) => getComputedStyle(icon).stroke));
    expect(swatches.length).toBeGreaterThan(0);
    for (const stroke of swatches) {
      expect(palette, `a legend swatch is still ${stroke}`).not.toContain(stroke);
    }
  });

  /*
   * The refresh, against the real bundle and the real network
   *
   * The component tier stubs `@/lib/cineplex-client` outright, so nothing there proves the
   * shipped island installs a real interval after hydration and issues a real request over
   * it. Playwright's clock is what makes half a minute affordable
   *
   * It asserts the numbers and the timestamp, and nothing else. Whether a refresh raises a
   * pending marker is a component-tier question and cannot be asked here: the wait for the
   * new figure only resolves once the refresh has landed and re-rendered, by which point
   * any marker is already gone, so a count taken after it reads zero however the code
   * behaves
   */
  test("refreshes the seat map on a timer", async ({ page }) => {
    await page.clock.install();
    await stubApi(page);

    // Registered after `stubApi`, and Playwright resolves routes newest first, so this is
    // the handler that answers. Second call onward reports two more seats gone
    let seatsCalls = 0;
    await page.route("**/api/seats**", (route) => {
      seatsCalls += 1;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ...seatMap, occupied: 1 + seatsCalls * 2 }),
      });
    });

    await page.goto("/");
    await selectShowtime(page);
    await expect(page.getByText("3/10")).toBeVisible();

    const stamp = page.getByText(/^Updated since /);
    await expect(stamp).toHaveText(/^Updated since \d{1,2}:\d{2}:\d{2} (AM|PM)$/);
    const onArrival = await stamp.textContent();

    await page.clock.fastForward("00:30");
    await expect(page.getByText("5/10")).toBeVisible();
    // The clock is installed, so this only differs if the refresh restamped it. Stronger
    // than the fixed string it replaced, which could not tell a live label from a frozen one
    await expect(stamp).not.toHaveText(onArrival ?? "");

    // A second tick, so this is an interval and not a single deferred refresh
    await page.clock.fastForward("00:30");
    await expect(page.getByText("7/10")).toBeVisible();
  });

  /*
   * The control, against the real bundle: a press has to reach the network without the
   * interval, and the second press inside the cooldown has to not
   */
  test("the refresh control refetches on a press and then holds", async ({ page }) => {
    await page.clock.install();
    await stubApi(page);

    let seatsCalls = 0;
    await page.route("**/api/seats**", (route) => {
      seatsCalls += 1;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ...seatMap, occupied: 1 + seatsCalls * 2 }),
      });
    });

    await page.goto("/");
    await selectShowtime(page);
    await expect(page.getByText("3/10")).toBeVisible();

    const refresh = page.getByRole("button", { name: "Refresh the seat map" });
    await refresh.click();
    await expect(page.getByText("5/10")).toBeVisible();
    await expect(refresh).toHaveAttribute("aria-disabled", "true");

    /*
     * `force`, because Playwright's actionability check reads `aria-disabled` as
     * not-enabled and would refuse the click on the attribute alone. Refusing is the right
     * default, but it proves the attribute rather than the guard behind it, and the guard
     * is what actually keeps the request from going out
     *
     * A plain counter read, never a retrying assertion: this measures that nothing happens,
     * and a web-first assertion would sit out the very window in question
     */
    await refresh.click({ force: true });
    expect(seatsCalls).toBe(2);
  });

  test("showtimes stay disabled until a theatre and a movie are both chosen", async ({ page }) => {
    await stubApi(page);
    await page.goto("/");

    const showtimes = page.getByRole("combobox", { name: "Showtimes" });
    await expect(showtimes).toBeDisabled();
    await choose(page, "Theatres", "Galaxy Cinemas Barrie");
    await expect(showtimes).toBeDisabled();
    await choose(page, "Movies", "Spider-Man: Brand New Day");
    await expect(showtimes).toBeEnabled();
  });

  /*
   * Typing did nothing at all before this, and no unit test could have shown it: Base UI
   * decides an array is grouped by looking for an `items` key on its first entry, so with
   * the days named `sessions` it filtered them as leaf items and every keystroke emptied
   * the list. The fix is a rename, and this is the only tier that runs the real filtering
   */
  test("searching narrows the showtimes to a date", async ({ page }) => {
    await stubApi(page);
    await page.goto("/");
    await choose(page, "Theatres", "Galaxy Cinemas Barrie");
    await choose(page, "Movies", "Spider-Man: Brand New Day");

    const showtimes = page.getByRole("combobox", { name: "Showtimes" });
    await showtimes.click();
    // Both days listed before the search, or narrowing to one proves nothing
    await expect(page.locator('[data-slot="combobox-label"]')).toHaveText([
      "Sun Aug 2",
      "Mon Aug 3",
    ]);

    await showtimes.fill("Aug 3");
    await expect(page.locator('[data-slot="combobox-label"]')).toHaveText(["Mon Aug 3"]);

    /*
     * ...and a time narrows nothing, because the filter reads the date only. Asserted as
     * the empty state rather than as an absence: with no leaf item matching, Base UI drops
     * every group, and "not narrowed to one day" would be satisfied by that too
     */
    await showtimes.fill("6:45");
    await expect(page.getByText("No showtimes")).toBeVisible();
  });

  test("groups the showtimes by day", async ({ page }) => {
    await stubApi(page);
    await page.goto("/");
    await choose(page, "Theatres", "Galaxy Cinemas Barrie");
    await choose(page, "Movies", "Spider-Man: Brand New Day");
    await page.getByRole("combobox", { name: "Showtimes" }).click();

    await expect(page.locator('[data-slot="combobox-label"]')).toHaveText([
      "Sun Aug 2",
      "Mon Aug 3",
    ]);
  });

  test("a pair with nothing playing reads as an empty state, not an error", async ({ page }) => {
    await stubApi(page, { sessions: emptySessions });
    await page.goto("/");
    await choose(page, "Theatres", "Galaxy Cinemas Barrie");
    await choose(page, "Movies", "Spider-Man: Brand New Day");

    await expect(page.getByText("No screenings")).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
  });

  /*
   * The layout property the browser tier cannot reach: whether the map scrolls depends
   * on the whole containment chain from Main through Container and Stack, which only
   * exists on the real page
   */
  test("the seat map scrolls on a narrow screen without the page overflowing", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await stubApi(page, {
      sessions: [
        {
          ...sessions[0],
          sessionId: sessions[0]?.sessionId ?? 1,
        } as (typeof sessions)[number],
      ],
    });
    // a house far wider than the viewport, so the scroller has something to scroll
    await page.route("**/api/seats**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ...seatMap,
          totalColumns: 30,
          rows: [
            {
              label: "A",
              physicalNumber: 1,
              seats: Array.from({ length: 30 }, (_, index) => ({
                id: `wide-${index}`,
                label: `A${index}`,
                column: index,
                kind: "Standard",
                occupied: false,
              })),
            },
          ],
          total: 30,
          occupied: 0,
        }),
      }),
    );
    await page.goto("/");
    await selectShowtime(page);
    await expect(page.locator('[data-slot="seat"]').first()).toBeVisible();

    const scroller = page.locator('[data-slot="seat-scroller"]');
    const box = await scroller.evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    }));
    expect(box.scrollWidth).toBeGreaterThan(box.clientWidth);

    // ...and the page itself stays put, rather than the house pushing it sideways
    const doc = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(doc.scrollWidth).toBe(doc.clientWidth);
  });
});

/*
 * Ordering the theatre list by distance, which is the only tier that can prove the header
 * change works
 *
 * `Permissions-Policy: geolocation=(self)` is served from `public/_headers` for the
 * prerendered home page, and an empty allowlist there denies the API to the page's own
 * origin: the prompt never appears and the error callback fires. The unit tier cannot see
 * that at all, and the parity test between `_headers` and `security-headers.ts` only proves
 * the two agree, not that the value works. Revert the directive and this reorder stops
 */
test.describe("nearest theatres first", () => {
  /*
   * Mississauga: 21 km from Scotiabank Toronto and 82 km from Galaxy Cinemas Barrie. Barrie
   * is first in the fixture, so the sorted order is not the order the API sent
   */
  test.use({
    geolocation: { latitude: 43.589, longitude: -79.6441 },
    permissions: ["geolocation"],
  });

  test("reorders the theatres and shows how far away each one is", async ({ page }) => {
    await stubApi(page);
    await page.goto("/");
    await waitForHydration(page);

    await page.getByRole("combobox", { name: "Theatres" }).click();
    await expect(page.getByRole("option")).toHaveText([
      "Scotiabank Theatre Toronto21 km",
      "Galaxy Cinemas Barrie82 km",
    ]);
  });

  /*
   * The header is what a browser reads, so this asserts the value on the response rather
   * than on the constant the app builds it from
   */
  test("serves a Permissions-Policy that allows geolocation for this origin", async ({ page }) => {
    const response = await page.goto("/");
    expect(response?.headers()["permissions-policy"]).toContain("geolocation=(self)");
  });
});
