import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import wranglerRaw from "../../../wrangler.jsonc?raw";
import { enforceRateLimit, RETRY_AFTER_SECONDS } from "./rate-limit";

/*
 * `cloudflare:workers` is aliased to a stub with an empty `env`, which is the shape this
 * module has to survive. A case that wants a limiter assigns one and clears it after
 *
 * Vitest is the only context where the binding is genuinely missing. Measured, not
 * assumed: miniflare simulates `ratelimit` locally, so `astro dev` and `astro preview`
 * both enforce for real, keyed on `127.0.0.1` for every caller
 */

const request = (ip: string | null = "203.0.113.7") =>
  new Request("https://movie-seats.test/api/seats?theatreId=7249&showtimeId=1", {
    headers: ip ? { "CF-Connecting-IP": ip } : {},
  });

// `env` is typed as a fully-populated `Env`, since that is true inside a Worker. Outside
// one every binding is absent, which is exactly the case the last two tests cover
const bindings = env as Partial<Env>;

const bindLimiter = (
  limit: (options: { key: string }) => Promise<{ success: boolean }>,
  name: "UPSTREAM_LIMITER" | "HEAVY_LIMITER" = "UPSTREAM_LIMITER",
) => {
  bindings[name] = { limit } as unknown as RateLimit;
};

afterEach(() => {
  delete bindings.UPSTREAM_LIMITER;
  delete bindings.HEAVY_LIMITER;
});

describe("enforceRateLimit", () => {
  it("lets a caller under the limit through", async () => {
    bindLimiter(async () => ({ success: true }));
    expect(await enforceRateLimit(request(), "seats")).toBeNull();
  });

  it("answers 429 with a Retry-After once the limit is hit", async () => {
    bindLimiter(async () => ({ success: false }));
    const response = await enforceRateLimit(request(), "seats");
    expect(response?.status).toBe(429);
    // The status alone does not say how long, so a client that guesses keeps hammering
    expect(response?.headers.get("Retry-After")).toBe("60");
    const body = (await response?.json()) as { error: { code: string } };
    expect(body.error.code).toBe("rate_limited");
  });

  /*
   * Separate counters, so the cheap route cannot spend the expensive route's budget. One
   * namespace with a prefixed key is what the binding offers, and asserting the key is
   * the only way to see it, since both buckets answer identically from the outside
   */
  it("charges a different counter per bucket, keyed on the caller", async () => {
    const limit = vi.fn(async (_options: { key: string }) => ({ success: true }));
    bindLimiter(limit);
    await enforceRateLimit(request(), "seats");
    await enforceRateLimit(request(), "showtimes");
    expect(limit.mock.calls.map((call) => call[0].key)).toEqual([
      "seats:203.0.113.7",
      "showtimes:203.0.113.7",
    ]);
  });

  /*
   * The expensive route counts against its own binding, not the shared one. One limit
   * cannot serve both: thirty a minute is generous for a seat map and hundreds of
   * megabytes a minute of upstream egress for the film-wide one
   */
  it("charges the heavy binding for the film-wide route", async () => {
    const shared = vi.fn(async (_options: { key: string }) => ({ success: true }));
    const heavy = vi.fn(async (_options: { key: string }) => ({ success: true }));
    bindLimiter(shared);
    bindLimiter(heavy, "HEAVY_LIMITER");

    await enforceRateLimit(request(), "narrow-theatres");
    expect(heavy).toHaveBeenCalledTimes(1);
    expect(shared).not.toHaveBeenCalled();
  });

  /*
   * A routed /64 is the smallest block a customer routinely gets, so keying on the full
   * /128 hands one cheap VPS 2^64 separate budgets. Cloudflare's own Rate Limiting Rules
   * offer an IP-with-mask-/64 characteristic for this; the Workers binding does not
   */
  it("counts an IPv6 caller by its /64, not its full address", async () => {
    const limit = vi.fn(async (_options: { key: string }) => ({ success: true }));
    bindLimiter(limit);
    await enforceRateLimit(request("2001:db8:1234:5678:aaaa:bbbb:cccc:dddd"), "seats");
    await enforceRateLimit(request("2001:db8:1234:5678:1111:2222:3333:4444"), "seats");

    const keys = limit.mock.calls.map((call) => call[0].key);
    expect(keys[0]).toBe("seats:2001:db8:1234:5678::");
    // ...and two addresses in one /64 land on one counter, which is the whole point
    expect(new Set(keys).size).toBe(1);
  });

  /*
   * The limiter is I/O-shaped and this is called outside `respond`'s try, so a rejection
   * would escape the route. Astro answers that by re-rendering with the middleware
   * skipped, which ships the error page with no security headers
   */
  it("lets the request through when the limiter itself throws", async () => {
    bindLimiter(() => Promise.reject(new Error("binding exploded")));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await enforceRateLimit(request(), "seats")).toBeNull();
  });

  /*
   * Degrading open. Nothing off Cloudflare's edge sets the IP header, and Vitest has no
   * binding, so refusing on either would break the one environment that is not production
   */
  it("passes through when there is no binding, loudly", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(bindings.UPSTREAM_LIMITER).toBeUndefined();
    expect(await enforceRateLimit(request(), "seats")).toBeNull();
    // Silence here would mean a dropped binding or a namespace_id collision leaves every
    // route uncapped with nothing to notice it
    expect(logged.mock.calls.flat().join(" ")).toContain("UPSTREAM_LIMITER");
  });

  it("passes through when the request carries no client IP", async () => {
    const limit = vi.fn(async (_options: { key: string }) => ({ success: false }));
    bindLimiter(limit);
    expect(await enforceRateLimit(request(null), "seats")).toBeNull();
    // ...without consulting the limiter, since there is nothing to key it on
    expect(limit).not.toHaveBeenCalled();
  });
});

/*
 * The two numbers live in two files and mean the same thing, so nothing but a comparison
 * keeps them together. Changing `period` to 10 in wrangler.jsonc leaves `Retry-After`
 * telling every client to wait six times too long, and no other test would notice
 */
describe("the advertised Retry-After", () => {
  // JSONC, so the comments have to go before JSON.parse will read it. Read through Vite's
  // `?raw`, the same way the security-header parity test reads `public/_headers`
  const config = JSON.parse(
    wranglerRaw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, ""),
  ) as { ratelimits: { name: string; simple: { limit: number; period: number } }[] };

  it("matches the period the binding is actually configured with", () => {
    // Guards the loop: an empty or renamed block would make it vacuous
    expect(config.ratelimits.map((entry) => entry.name)).toEqual([
      "UPSTREAM_LIMITER",
      "HEAVY_LIMITER",
    ]);
    for (const entry of config.ratelimits) {
      expect(entry.simple.period, entry.name).toBe(RETRY_AFTER_SECONDS);
    }
  });

  // ...and the expensive route really is capped harder than the rest, which is the only
  // reason a second binding exists at all
  it("caps the film-wide route below the shared one", () => {
    const limitOf = (name: string) =>
      config.ratelimits.find((entry) => entry.name === name)?.simple.limit ?? 0;

    expect(limitOf("HEAVY_LIMITER")).toBeGreaterThan(0);
    expect(limitOf("HEAVY_LIMITER")).toBeLessThan(limitOf("UPSTREAM_LIMITER"));
  });
});
