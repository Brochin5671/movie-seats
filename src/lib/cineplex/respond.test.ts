import { describe, expect, it, vi } from "vitest";
import { UpstreamStatusError } from "@/lib/api/cached-fetch";
import { requireIntParam, respond } from "./respond";
import { MissingKeyError } from "./upstream";

/*
 * The parameter guards and the error mapping, which are the branches every route shares
 * The routes themselves are orchestration and are covered by the integration specs
 * against a real server; what is worth testing here is what each failure turns into,
 * because a client branches on the code and an operator branches on the status
 */

const request = () => new Request("https://movie-seats.test/api/seats");
const url = (query: string) => new URL(`https://movie-seats.test/api/seats${query}`);

describe("requireIntParam", () => {
  it("reads an integer parameter", () => {
    const result = requireIntParam(request(), url("?theatreId=7249"), "theatreId");
    expect(result).toEqual({ ok: true, value: 7249 });
  });

  it.each([
    ["", "absent"],
    ["?theatreId=", "present but empty"],
  ])("rejects a %s parameter as missing (%s)", async (query) => {
    const result = requireIntParam(request(), url(query), "theatreId");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(400);
    const body = (await result.response.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("missing_param");
    // names the parameter, so the caller knows which one to add
    expect(body.error.message).toContain("theatreId");
  });

  /*
   * Integer, not merely numeric. These go into an upstream path, and `Number("1.5")` is
   * a perfectly good number that is not an id
   */
  it.each(["?theatreId=abc", "?theatreId=1.5", "?theatreId=1e21"])(
    "rejects %s as not an integer",
    async (query) => {
      const result = requireIntParam(request(), url(query), "theatreId");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.response.status).toBe(400);
      const body = (await result.response.json()) as { error: { code: string } };
      expect(body.error.code).toBe("invalid_param");
    },
  );

  it("accepts a negative integer, since rejecting it is the upstream's job", () => {
    expect(requireIntParam(request(), url("?theatreId=-5"), "theatreId")).toEqual({
      ok: true,
      value: -5,
    });
  });
});

describe("respond", () => {
  it("serialises what the loader returns", async () => {
    const response = await respond(request(), async () => [{ id: 1 }]);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([{ id: 1 }]);
  });

  /*
   * On the success path too, which is the one nothing else can see: the integration tier
   * has no API key so it only ever reaches the 400, and the e2e tier stubs these routes at
   * the browser. A cacheable answer here would let a browser serve its own copy back for
   * the whole max-age, so the seat map's background refresh would quietly stop
   * fetching and the map would just stop moving, with no test failing
   */
  it("answers uncacheable, so a polling client always reaches the Worker", async () => {
    const response = await respond(request(), async () => [{ id: 1 }]);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  /*
   * An unset key gets its own status, separate from an upstream failure. 503 with a
   * named code is what lets an operator tell "nobody configured this" from "Cineplex is
   * down" without reading logs, and it is why the route does not answer an empty list
   */
  it("answers an unset key with 503 and a distinct code", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await respond(request(), async () => {
      throw new MissingKeyError();
    });
    expect(response.status).toBe(503);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("upstream_unconfigured");
  });

  it("answers any other failure with 502", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await respond(request(), async () => {
      throw new Error("upstream 401 Unauthorized");
    });
    expect(response.status).toBe(502);
    const body = (await response.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("upstream_unavailable");
    // the upstream's own words stay in the log, not in the response
    expect(body.error.message).not.toContain("401");
  });

  /*
   * The rotated-key case has to reach an operator. `getCached` already phrases it as
   * `upstream 401 Unauthorized`, so logging the original is enough and no error string
   * needs parsing
   */
  it("logs the original failure so a rotated key is diagnosable", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    await respond(request(), async () => {
      throw new Error("upstream 401 Unauthorized");
    });
    expect(logged.mock.calls.flat().join(" ")).toContain("401");
  });

  it("carries a request id on every failure", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await respond(request(), async () => {
      throw new Error("boom");
    });
    const body = (await response.json()) as { error: { requestId: string } };
    expect(body.error.requestId).toMatch(/[0-9a-f-]{8,}/);
  });

  /*
   * An upstream 404 means different things per route, so the mapping is opt-in
   *
   * On the seat route the caller named a showtime that does not exist, which is their
   * problem and a 404. On the catalogue routes the path is ours, so a 404 means Cineplex
   * moved an endpoint, and telling the client "not found" would report an outage as a
   * normal empty result
   */
  describe("an upstream 404", () => {
    const SEAT_LAYOUT = "https://api.test/theatre/1/showtime/2/seat-layout";
    const notFound = async () => {
      throw new UpstreamStatusError(404, "Not Found", SEAT_LAYOUT);
    };
    const opted = { notFoundMessage: "No such showtime.", notFoundFrom: "seat-layout" };

    it("stays a 502 on a route that did not opt in", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const response = await respond(request(), notFound);
      expect(response.status).toBe(502);
      const body = (await response.json()) as { error: { code: string } };
      expect(body.error.code).toBe("upstream_unavailable");
    });

    it("becomes a 404 on a route that opted in", async () => {
      vi.spyOn(console, "info").mockImplementation(() => {});
      const response = await respond(request(), notFound, opted);
      expect(response.status).toBe(404);
      const body = (await response.json()) as { error: { code: string; message: string } };
      expect(body.error.code).toBe("not_found");
      expect(body.error.message).toBe("No such showtime.");
    });

    /*
     * Status, not class. Matching on `instanceof UpstreamStatusError` alone would send
     * every upstream failure on the seat route back as a 404, so a Cineplex outage would
     * read as "that showtime does not exist" and nobody would be paged
     */
    it("does not swallow a 500 on the same route", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const response = await respond(
        request(),
        async () => {
          throw new UpstreamStatusError(500, "Internal Server Error", SEAT_LAYOUT);
        },
        opted,
      );
      expect(response.status).toBe(502);
    });

    /*
     * A route can make several upstream calls and only some address the caller's own
     * resource. Matching on status alone would let a 404 from any of them wear the
     * message written for one, so a moved endpoint would read to the client as a bad id
     */
    it("stays a 502 when the 404 came from a different upstream call", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const response = await respond(
        request(),
        async () => {
          throw new UpstreamStatusError(404, "Not Found", "https://api.test/seat-availability");
        },
        opted,
      );
      expect(response.status).toBe(502);
    });

    /*
     * Logged, but not as an outage. Asserting only the absence of `console.error` would
     * also pass if nothing were logged at all, and then a run of these would be invisible
     *
     * The URL is the part worth keeping: the message is the same six words for every 404,
     * so without it a scraper enumerating ids and a Cineplex endpoint that has moved
     * produce identical logs
     */
    it("logs the resource below error level, since a bad id is routine", async () => {
      const errored = vi.spyOn(console, "error").mockImplementation(() => {});
      const informed = vi.spyOn(console, "info").mockImplementation(() => {});
      await respond(
        request(),
        async () => {
          throw new UpstreamStatusError(404, "Not Found", SEAT_LAYOUT);
        },
        opted,
      );
      expect(errored).not.toHaveBeenCalled();
      expect(informed.mock.calls.flat().join(" ")).toContain("seat-layout");
    });
  });
});
