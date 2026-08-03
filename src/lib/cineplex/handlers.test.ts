import { env } from "cloudflare:workers";
import type { APIContext } from "astro";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * The seat route end to end, with only `fetch` and the Cache API stubbed
 *
 * `respond.test.ts` pins what an error turns into and `cached-fetch.test.ts` pins what
 * gets thrown, but between them sit the `Promise.all` over two upstream calls and
 * `getCached`'s stale-on-error branch. Nothing was proving that a 404 from `seat-layout`
 * actually survives that middle and reaches the client as a 404, and the stale branch is
 * one config value away from turning it into a 200
 */

// The real stub resolves the key unset, which is the path every other test wants. This
// one needs the opposite: a key present, so the handler gets as far as the upstream
vi.mock("astro:env/server", () => ({
  CINEPLEX_API_KEY: "test-key",
  GOOGLE_SITE_VERIFICATION: undefined,
  getSecret: () => undefined,
}));

const { getSeats } = await import("./handlers");
const { TTL } = await import("./upstream");

/** Same shape as the Workers Cache API, keyed on the URL, bodies kept as text */
function installCache() {
  const store = new Map<string, { body: string; headers: Record<string, string> }>();
  vi.stubGlobal("caches", {
    default: {
      match: async (req: Request) => {
        const hit = store.get(req.url);
        return hit ? new Response(hit.body, { headers: hit.headers }) : undefined;
      },
      put: async (req: Request, res: Response) => {
        store.set(req.url, {
          body: await res.text(),
          headers: Object.fromEntries(res.headers.entries()),
        });
      },
    },
  });
}

/*
 * One seat, and one availability entry for it. A layout with seats and an empty
 * availability map is a failed join rather than a sold-out house, and `toSeatMap` throws
 * on it, so a fixture missing the entry would take every case that reaches the join down
 * the error path. The 404 cases never get that far: the layout leg throws first
 */
const SEAT = { id: "1_1_1", column: 0, label: "A1", type: "Standard" };
const LAYOUT = {
  totalRows: 1,
  totalColumns: 2,
  standardSeats: { top: 0, rowCount: 1, rows: [{ physicalNumber: 1, label: "A", seats: [SEAT] }] },
};
const AVAILABILITY = { seatAvailabilities: { [SEAT.id]: "Available" }, isSoldOut: false };

/** Answers per upstream path, so the two halves of the pair can disagree */
const upstream = (layoutStatus: number) =>
  vi.fn(async (url: string) => {
    if (url.includes("seat-layout")) {
      return layoutStatus === 200
        ? new Response(JSON.stringify(LAYOUT), { status: 200 })
        : new Response("Showtime with id 1 cannot be found.", {
            status: layoutStatus,
            statusText: "Not Found",
          });
    }
    // Measured against the live API: availability answers 200 with an empty map for an
    // id that does not exist, so the layout is the only half that can reject
    return new Response(JSON.stringify(AVAILABILITY), { status: 200 });
  });

const call = (showtimeId: number) =>
  getSeats({
    request: new Request(
      `https://movie-seats.test/api/seats?theatreId=7249&showtimeId=${showtimeId}`,
    ),
    url: new URL(`https://movie-seats.test/api/seats?theatreId=7249&showtimeId=${showtimeId}`),
  } as APIContext) as Promise<Response>;

describe("getSeats", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /*
   * That the route consults the limiter at all, and where in the sequence
   *
   * `rate-limit.test.ts` exercises the function in isolation, so deleting the two lines
   * that call it from this handler leaves every one of those tests green. The ordering
   * matters too: a request that fails a parameter guard must not spend a token, or a
   * flood of malformed requests exhausts the budget for the valid ones
   */
  describe("the rate limiter", () => {
    const bind = (success: boolean) => {
      const limit = vi.fn(async (_options: { key: string }) => ({ success }));
      (env as Partial<Env>).UPSTREAM_LIMITER = { limit } as unknown as RateLimit;
      return limit;
    };
    const withIp = (url: string) =>
      getSeats({
        request: new Request(url, { headers: { "CF-Connecting-IP": "203.0.113.7" } }),
        url: new URL(url),
      } as APIContext) as Promise<Response>;

    afterEach(() => {
      delete (env as Partial<Env>).UPSTREAM_LIMITER;
    });

    it("is consulted once for a well-formed request", async () => {
      installCache();
      vi.stubGlobal("fetch", upstream(200));
      const limit = bind(true);

      const url = "https://movie-seats.test/api/seats?theatreId=7249&showtimeId=328227";
      expect((await withIp(url)).status).toBe(200);
      expect(limit).toHaveBeenCalledTimes(1);
      expect(limit.mock.calls[0]?.[0].key).toBe("seats:203.0.113.7");
    });

    it("turns a caller over the limit away with 429", async () => {
      installCache();
      const fetchMock = upstream(200);
      vi.stubGlobal("fetch", fetchMock);
      bind(false);

      const url = "https://movie-seats.test/api/seats?theatreId=7249&showtimeId=328227";
      expect((await withIp(url)).status).toBe(429);
      // ...before reaching upstream, which is the entire point of the cap
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("is not consulted when a parameter guard already rejected the request", async () => {
      installCache();
      vi.stubGlobal("fetch", upstream(200));
      const limit = bind(true);

      const url = "https://movie-seats.test/api/seats?theatreId=abc&showtimeId=328227";
      expect((await withIp(url)).status).toBe(400);
      expect(limit).not.toHaveBeenCalled();
    });
  });

  it("answers 404 when the upstream has no such showtime", async () => {
    installCache();
    vi.stubGlobal("fetch", upstream(404));

    const response = await call(1);
    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("not_found");
  });

  /*
   * The scoping is per route, and within the route it is per leg only by accident of
   * which one can fail. `seat-layout` is the one that answers 404 for an unknown id;
   * `seat-availability` answers 200 with an empty map. If that ever changes, or a third
   * call joins the `Promise.all`, its 404 would silently inherit the seat route's
   * "not available" message and a broken endpoint would read as a bad id
   */
  it("reports a 404 from the availability leg as an outage, not a bad id", async () => {
    installCache();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.includes("seat-availability")
          ? new Response("gone", { status: 404, statusText: "Not Found" })
          : new Response(JSON.stringify(LAYOUT), { status: 200 }),
      ),
    );

    const response = await call(328227);
    expect(response.status).toBe(502);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("upstream_unavailable");
  });

  it("still answers 200 for a showtime that does exist", async () => {
    installCache();
    vi.stubGlobal("fetch", upstream(200));
    // ...or the case above passes on a handler that 404s unconditionally
    expect((await call(328227)).status).toBe(200);
  });

  /*
   * The one that pins `staleIfError: 0` on both seat legs
   *
   * With any stale budget at all, a 404 lands in `getCached`'s stale branch and the
   * caller is handed the last seat map that worked. For this route that is the previous
   * showtime's seats rendered under a showtime that does not exist, answered 200
   */
  it("does not serve a stale seat map when the showtime disappears", async () => {
    installCache();
    const fetchMock = upstream(200);
    vi.stubGlobal("fetch", fetchMock);
    expect((await call(328227)).status).toBe(200);

    // Derived, not literal: the layout is the leg that 404s, so its window is the one
    // that has to lapse before the next call goes upstream and sees it
    vi.setSystemTime(Date.now() + (TTL.seatLayout.maxAge + 1) * 1000);
    vi.stubGlobal("fetch", upstream(404));

    expect((await call(328227)).status).toBe(404);
  });

  /*
   * The pair that made the split safe to have
   *
   * The two legs expire independently now, so a layout can be served from cache while
   * availability comes back fresh and empty, which is what a showtime pulled from sale
   * answers. Joined naively that is not an error, it is every seat reading occupied: a red
   * FULL house, dated just now, for a screening that no longer exists. An honest 502 is the
   * floor, and the 200 beside it is what stops the guard being satisfied by refusing
   * everything
   */
  const withAvailability = (body: unknown) =>
    vi.fn(async (url: string) =>
      url.includes("seat-availability")
        ? new Response(JSON.stringify(body), { status: 200 })
        : new Response(JSON.stringify(LAYOUT), { status: 200 }),
    );

  it("answers an outage, not a sold-out house, when availability comes back empty", async () => {
    installCache();
    vi.stubGlobal("fetch", withAvailability({ seatAvailabilities: {}, isSoldOut: false }));

    const response = await call(328227);
    expect(response.status).toBe(502);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("upstream_unavailable");
  });

  /*
   * ...unless upstream says the house is sold out, which is the one thing that tells an
   * empty map apart from a failed join. Without this pair the guard reads as "an empty map
   * is always an error", and a sold-out screening, the case the answer is least in doubt
   * about, would be the one the site called broken
   */
  it("renders a sold-out house rather than erroring on its empty map", async () => {
    installCache();
    vi.stubGlobal("fetch", withAvailability({ seatAvailabilities: {}, isSoldOut: true }));

    const response = await call(328227);
    expect(response.status).toBe(200);
    const map = (await response.json()) as { total: number; occupied: number };
    expect(map).toMatchObject({ total: 1, occupied: 1 });
  });

  /*
   * The two legs are cached apart, which is what makes a polling client affordable
   *
   * Both counts are load-bearing. Asserting only the availability count passes a mutation
   * that caches nothing at all; asserting only the layout count passes one that caches
   * everything forever. Together they fail whichever way the two TTLs are collapsed
   */
  it("refetches availability but not the layout when a refresh lands 30s later", async () => {
    installCache();
    const fetchMock = upstream(200);
    vi.stubGlobal("fetch", fetchMock);
    expect((await call(328227)).status).toBe(200);

    // Above the 10s availability window and inside the 60s layout one
    vi.setSystemTime(Date.now() + 30_000);
    expect((await call(328227)).status).toBe(200);

    const paths = fetchMock.mock.calls.map(([url]) => url);
    expect(paths.filter((url) => url.includes("seat-layout"))).toHaveLength(1);
    expect(paths.filter((url) => url.includes("seat-availability"))).toHaveLength(2);
  });
});
