import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getCached, UpstreamStatusError } from "./cached-fetch";

/*
 * A minimal in-memory stand-in for the Workers Cache API. happy-dom has no
 * `caches`, and the real one is not available under Vitest, so the store is
 * modelled here: match/put keyed on the request URL, which is what the helper
 * relies on. Bodies are kept as text so a Response can be rebuilt per read
 * (a Response body can only be consumed once)
 */
function installCache() {
  const store = new Map<string, { body: string; headers: Record<string, string> }>();
  const cache = {
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
  };
  vi.stubGlobal("caches", { default: cache });
  return store;
}

const URL_A = "https://api.example.com/v1/items";
const ok = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

describe("getCached", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // console.error is the deliberate operator-facing signal; silence it in tests
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("fetches upstream on a cold cache and returns fresh data", async () => {
    installCache();
    const fetchMock = vi.fn().mockResolvedValue(ok({ n: 1 }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await getCached<{ n: number }>(URL_A);
    expect(res).toEqual({ data: { n: 1 }, stale: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("serves a second caller from cache without hitting upstream", async () => {
    installCache();
    const fetchMock = vi.fn().mockResolvedValue(ok({ n: 1 }));
    vi.stubGlobal("fetch", fetchMock);

    await getCached(URL_A);
    const second = await getCached<{ n: number }>(URL_A);
    // the whole point: many visitors, one upstream call
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(second).toEqual({ data: { n: 1 }, stale: false });
  });

  it("refetches once the freshness window has elapsed", async () => {
    installCache();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(ok({ n: 1 }))
      .mockResolvedValueOnce(ok({ n: 2 }));
    vi.stubGlobal("fetch", fetchMock);

    await getCached(URL_A, { maxAge: 60 });
    vi.setSystemTime(Date.now() + 61_000);
    const res = await getCached<{ n: number }>(URL_A, { maxAge: 60 });
    expect(res).toEqual({ data: { n: 2 }, stale: false });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("serves stale when the upstream fails after the entry went stale", async () => {
    installCache();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(ok({ n: 1 }))
      .mockRejectedValue(new Error("upstream down"));
    vi.stubGlobal("fetch", fetchMock);

    await getCached(URL_A, { maxAge: 60 });
    vi.setSystemTime(Date.now() + 61_000);
    const res = await getCached<{ n: number }>(URL_A, { maxAge: 60 });
    expect(res).toEqual({ data: { n: 1 }, stale: true });
  });

  it("treats a non-2xx upstream as a failure and serves stale", async () => {
    installCache();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(ok({ n: 1 }))
      /*
       * A valid JSON body on the 503, deliberately. With unparseable content the parse
       * throws inside the same try and reaches the stale branch anyway, so the test
       * passes whether or not the status is ever checked
       */
      .mockResolvedValue(
        new Response(JSON.stringify({ n: 99 }), {
          status: 503,
          statusText: "Service Unavailable",
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await getCached(URL_A, { maxAge: 60 });
    vi.setSystemTime(Date.now() + 61_000);
    const res = await getCached<{ n: number }>(URL_A, { maxAge: 60 });
    expect(res.stale).toBe(true);
    expect(res.data).toEqual({ n: 1 });
  });

  it("logs at error level when it serves stale, so an outage stays visible", async () => {
    installCache();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(ok({ n: 1 }))
      .mockRejectedValue(new Error("upstream down"));
    vi.stubGlobal("fetch", fetchMock);

    await getCached(URL_A, { maxAge: 60 });
    vi.setSystemTime(Date.now() + 61_000);
    await getCached(URL_A, { maxAge: 60 });
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("serving stale"), expect.anything());
  });

  it("throws on a cold miss, so a broken upstream is never rendered as empty", async () => {
    installCache();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("upstream down")));
    await expect(getCached(URL_A)).rejects.toThrow("upstream down");
  });

  it("throws instead of serving stale when staleIfError is 0", async () => {
    installCache();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(ok({ n: 1 }))
      .mockRejectedValue(new Error("upstream down"));
    vi.stubGlobal("fetch", fetchMock);

    await getCached(URL_A, { maxAge: 60, staleIfError: 0 });
    vi.setSystemTime(Date.now() + 61_000);
    await expect(getCached(URL_A, { maxAge: 60, staleIfError: 0 })).rejects.toThrow(
      "upstream down",
    );
  });

  it("stops serving stale once the stale budget is exhausted", async () => {
    installCache();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(ok({ n: 1 }))
      .mockRejectedValue(new Error("upstream down"));
    vi.stubGlobal("fetch", fetchMock);

    await getCached(URL_A, { maxAge: 60, staleIfError: 600 });
    // past maxAge + staleIfError: the payload is too old to be worth serving
    vi.setSystemTime(Date.now() + 700_000);
    await expect(getCached(URL_A, { maxAge: 60, staleIfError: 600 })).rejects.toThrow(
      "upstream down",
    );
  });

  it("keeps the credential out of the cache key but still sends it upstream", async () => {
    installCache();
    const fetchMock = vi.fn().mockResolvedValue(ok({ n: 1 }));
    vi.stubGlobal("fetch", fetchMock);

    await getCached(URL_A, { init: { headers: { authorization: "Bearer secret" } } });
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer secret");

    // a second call with no credential still hits the same entry, proving the key is URL-only
    const second = await getCached(URL_A);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(second.data).toEqual({ n: 1 });
  });

  it("works with no Cache API at all, always going upstream", async () => {
    // Node and the unit-test environment have no `caches`; the helper must not throw
    vi.stubGlobal("caches", undefined);
    const fetchMock = vi.fn().mockResolvedValue(ok({ n: 1 }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await getCached(URL_A)).toEqual({ data: { n: 1 }, stale: false });
    expect(await getCached(URL_A)).toEqual({ data: { n: 1 }, stale: false });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  /*
   * The status has to survive the throw, or a caller cannot tell "you asked for something
   * that does not exist" from "the upstream fell over", and both come back as one 502
   *
   * Cold cache deliberately. With a stale entry stored this call takes the stale branch
   * and resolves instead of rejecting, so a warmed-cache version of this test would
   * assert nothing about the error at all
   */
  it("rejects a non-2xx with the status attached", async () => {
    installCache();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("nope", { status: 404, statusText: "Not Found" })),
    );

    const error = await getCached(URL_A).catch((thrown: unknown) => thrown);
    // `instanceof`, not a message match: `toThrow(/upstream 404/)` passes for a plain
    // Error too, so it would go green the moment the class was dropped
    expect(error).toBeInstanceOf(UpstreamStatusError);
    expect((error as UpstreamStatusError).status).toBe(404);
  });

  it("aborts a hung upstream instead of blocking the render", async () => {
    installCache();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
          }),
      ),
    );
    const pending = getCached(URL_A, { timeoutMs: 5_000 });
    const assertion = expect(pending).rejects.toThrow("aborted");
    await vi.advanceTimersByTimeAsync(5_001);
    await assertion;
  });

  /*
   * 204 is a success, not an error. It is how an upstream says "the query was valid
   * and nothing matched", and `JSON.parse("")` throws, so the naive reading turns a
   * legitimate empty result into a failure. These three pin the parts that were
   * separately wrong, because the first assertion alone passes on a half fix
   */
  describe("a 204 upstream", () => {
    const noContent = () => new Response("", { status: 204 });

    it("resolves as null rather than throwing", async () => {
      installCache();
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(noContent()));

      await expect(getCached<unknown[] | null>(URL_A)).resolves.toEqual({
        data: null,
        stale: false,
      });
    });

    it("does not serve the previous payload in its place", async () => {
      installCache();
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(ok([{ id: 1 }]))
        .mockResolvedValueOnce(noContent());
      vi.stubGlobal("fetch", fetchMock);

      await getCached(URL_A, { maxAge: 60 });
      vi.setSystemTime(Date.now() + 61_000);
      /*
       * The dangerous failure, and the reason `stale` is asserted too. The parse
       * throw used to land in the stale-on-error branch, so "nothing matched" came
       * back as the last payload that did match. For this app that is one theatre's
       * showtimes rendered under another theatre's name
       */
      await expect(getCached<unknown[] | null>(URL_A, { maxAge: 60 })).resolves.toEqual({
        data: null,
        stale: false,
      });
    });

    it("leaves the entry readable for the rest of the TTL", async () => {
      installCache();

      const fetchMock = vi.fn().mockResolvedValue(noContent());
      vi.stubGlobal("fetch", fetchMock);
      await getCached(URL_A, { maxAge: 60 });
      /*
       * The stored empty body is read back through a path that sits outside every
       * try, so a throw there is unconditional: the endpoint stays broken until the
       * entry expires, not just for the one caller who hit the 204
       *
       * The call count is what makes this about the stored entry. Without it, skipping
       * the write on a 204 and going upstream again produces the same answer
       */
      await expect(getCached<unknown[] | null>(URL_A, { maxAge: 60 })).resolves.toEqual({
        data: null,
        stale: false,
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });
});
