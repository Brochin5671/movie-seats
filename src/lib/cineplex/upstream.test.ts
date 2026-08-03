import { describe, expect, it } from "vitest";
import { TTL, theatricalUrl, ticketingUrl } from "./upstream";

/*
 * The URL builders and the freshness table. `fetchUpstream` itself is not tested here:
 * under Vitest the `astro:env/server` stub resolves the key as unset, so the only path
 * reachable is the MissingKeyError one, which the integration specs assert against a
 * real server instead
 */

describe("theatricalUrl", () => {
  // Required on every theatrical call; omitting it is a 400 from the gateway
  it("always carries the language", () => {
    expect(theatricalUrl("movies/bookable")).toContain("language=en");
  });

  it("appends the params it is given", () => {
    const url = new URL(theatricalUrl("showtimes", { locationId: 7249, filmId: 37997 }));
    expect(url.searchParams.get("locationId")).toBe("7249");
    expect(url.searchParams.get("filmId")).toBe("37997");
  });

  /*
   * Dropped rather than sent empty. `filmId=` is not the same query as no filmId, and
   * upstream answers the two differently
   */
  it("drops an undefined param instead of sending it empty", () => {
    const url = new URL(theatricalUrl("showtimes", { locationId: 7249, filmId: undefined }));
    expect(url.searchParams.has("filmId")).toBe(false);
  });

  it("tolerates a leading slash on the path", () => {
    expect(theatricalUrl("/theatres")).toBe(theatricalUrl("theatres"));
  });
});

describe("ticketingUrl", () => {
  it("builds a seat path without a query", () => {
    expect(ticketingUrl("theatre/1/showtime/2/seat-layout")).toBe(
      "https://apis.cineplex.com/prod/ticketing/api/v1/theatre/1/showtime/2/seat-layout",
    );
  });
});

/*
 * The credential must never reach the URL. `getCached` keys its cache on the URL alone
 * precisely so the key in the headers is excluded, and a key in the query string would
 * both defeat that and land in every access log on the way
 */
describe("the api key never appears in a url", () => {
  it.each([
    theatricalUrl("movies/bookable"),
    theatricalUrl("showtimes", { locationId: 1, filmId: 2 }),
    ticketingUrl("theatre/1/showtime/2/seat-availability"),
  ])("%s carries only the documented params", (url) => {
    const params = [...new URL(url).searchParams.keys()];
    expect(params).not.toContain("subscription-key");
    expect(
      params.every((name) => ["language", "locationId", "filmId", "date"].includes(name)),
    ).toBe(true);
  });
});

describe("freshness table", () => {
  /*
   * Seat data and showtimes refuse to serve stale. Everywhere else a day-old answer
   * beats an error page, but a stale seat map shows seats that have since been sold,
   * which is worse than saying nothing
   */
  it.each([
    ["showtimes", TTL.showtimes],
    ["seatLayout", TTL.seatLayout],
    ["seatAvailability", TTL.seatAvailability],
  ])("%s has no stale budget", (_name, entry) => {
    expect((entry as { staleIfError?: number }).staleIfError).toBe(0);
  });

  // The film-wide call will not finish inside the 5s default
  it("gives the film-wide narrowing call a longer timeout", () => {
    expect(TTL.narrowByFilm.timeoutMs).toBeGreaterThan(5_000);
  });

  // Availability, not layout: the layout leg is structural and outlives it, so comparing
  // against that one would stop saying anything about live data
  it("caches the catalogue far longer than the live seat data", () => {
    expect(TTL.movies.maxAge).toBeGreaterThan(TTL.seatAvailability.maxAge);
    expect(TTL.theatres.maxAge).toBeGreaterThan(TTL.movies.maxAge);
  });
});
