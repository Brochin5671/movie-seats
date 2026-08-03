import { expect, test } from "@playwright/test";

/*
 * The API contracts that hold without an upstream call
 *
 * The preview server has no API key (playwright.config.ts strips the built `.dev.vars`
 * on purpose), which is what makes these deterministic: a parameter guard answers the
 * same way whether or not a key exists, and the key check answers the same way whether
 * or not Cineplex is up. Anything that needs real data lives in the e2e spec, where it
 * is stubbed at the browser
 *
 * HTTP-only, so this runs in the `integration` project rather than repeating across the
 * browser projects
 */

const body = async (response: { json: () => Promise<unknown> }) =>
  (await response.json()) as { error?: { code?: string; message?: string; requestId?: string } };

test.describe("parameter guards", () => {
  /*
   * Guard order is the thing under test. Parameters are validated before the key is
   * read, so these stay 400 on a server with no key configured. Read the key first and
   * every one of them becomes 503, and the missing-parameter contract stops being
   * observable anywhere
   */
  test("showtimes rejects a request with neither parameter", async ({ request }) => {
    const response = await request.get("/api/showtimes", { failOnStatusCode: false });
    expect(response.status()).toBe(400);
    expect((await body(response)).error?.code).toBe("missing_param");
  });

  /*
   * Half-specified, which the smoke spec cannot reach: it sends no parameters at all, so
   * only this case proves the second guard exists rather than the first one covering
   * both
   */
  test("showtimes rejects a request carrying only the theatre", async ({ request }) => {
    const response = await request.get("/api/showtimes?theatreId=7249", {
      failOnStatusCode: false,
    });
    expect(response.status()).toBe(400);
    const parsed = await body(response);
    expect(parsed.error?.code).toBe("missing_param");
    // names the parameter that is missing, not the one that was supplied
    expect(parsed.error?.message).toContain("filmId");
  });

  test("seats rejects a non-integer id", async ({ request }) => {
    const response = await request.get("/api/seats?theatreId=7249&showtimeId=abc", {
      failOnStatusCode: false,
    });
    expect(response.status()).toBe(400);
    expect((await body(response)).error?.code).toBe("invalid_param");
  });

  /*
   * An id has to be an integer, not merely numeric. `Number("1.5")` is a number and
   * would go straight into an upstream path
   */
  test("seats rejects a fractional id", async ({ request }) => {
    const response = await request.get("/api/seats?theatreId=7249&showtimeId=1.5", {
      failOnStatusCode: false,
    });
    expect(response.status()).toBe(400);
    expect((await body(response)).error?.code).toBe("invalid_param");
  });
});

test.describe("an unconfigured upstream", () => {
  /*
   * 503 and a named code, not an empty list. An unset key is an operator problem, and
   * answering it as "no results" is how that gets mistaken for a quiet afternoon
   */
  test("reports itself as unconfigured rather than returning nothing", async ({ request }) => {
    const response = await request.get("/api/showtimes?theatreId=7249&filmId=37997", {
      failOnStatusCode: false,
    });
    expect(response.status()).toBe(503);
    expect((await body(response)).error?.code).toBe("upstream_unconfigured");
  });

  test("answers the same way on a route with no parameters to guard", async ({ request }) => {
    const response = await request.get("/api/movies", { failOnStatusCode: false });
    expect(response.status()).toBe(503);
    expect((await body(response)).error?.code).toBe("upstream_unconfigured");
  });
});

/*
 * The seat map is polled on a timer by the browser, and every one of those polls
 * has to reach the Worker to be worth making. A cacheable answer would let the browser
 * serve its own copy back for the whole max-age and the refresh would silently become a
 * no-op, with no test failing and nothing visibly wrong: the map would just stop moving
 *
 * Asserted on the 400, since that is the one seat response reachable without a key, and
 * `jsonError` and `json` share the same default
 */
test("seats answers uncacheable, so a polling client always reaches the Worker", async ({
  request,
}) => {
  const response = await request.get("/api/seats?theatreId=1&showtimeId=abc", {
    failOnStatusCode: false,
  });
  expect(response.status()).toBe(400);
  expect(response.headers()["cache-control"]).toBe("no-store");
});

test.describe("the error envelope", () => {
  /*
   * Every failure carries a correlation id, so a bug report and a Worker log line can be
   * joined on one value. Asserted as a non-empty string rather than a shape, since the
   * edge supplies a cf-ray and a local run supplies a uuid
   */
  test("carries a request id on every failure", async ({ request }) => {
    for (const path of ["/api/showtimes", "/api/movies", "/api/seats?theatreId=1"]) {
      const parsed = await body(await request.get(path, { failOnStatusCode: false }));
      /*
       * The shape, not truthiness. `toBeTruthy` on a possibly-absent field passes for
       * any non-empty string and says nothing about whether it could be quoted back,
       * and `not.toBe("")` passes when the key is missing entirely
       */
      expect(parsed.error?.requestId, path).toMatch(/^[0-9a-zA-Z-]{8,}$/);
      expect(parsed.error?.code, path).toMatch(/^[a-z_]+$/);
      expect((parsed.error?.message ?? "").length, path).toBeGreaterThan(10);
    }
  });
});
