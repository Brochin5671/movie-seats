import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Movie, Session, Theatre } from "@/lib/cineplex/types";
import { ApiError } from "@/lib/cineplex-client";

/*
 * The orchestration, with the network stubbed at the client module. What is worth
 * testing here is the wiring between selections: which control is reachable, what
 * survives a clear, and what happens on the failure path, which is the only path the
 * e2e suite ever sees because its preview server has no API key
 */

const theatres: Theatre[] = [
  {
    id: 1,
    name: "Galaxy Barrie",
    city: "Barrie",
    province: "ON",
    latitude: 0,
    longitude: 0,
    distanceMeters: null,
  },
  {
    id: 2,
    name: "Scotiabank Toronto",
    city: "Toronto",
    province: "ON",
    latitude: 0,
    longitude: 0,
    distanceMeters: null,
  },
];

const movies: Movie[] = [
  {
    id: 10,
    name: "Spider-Man",
    runtimeInMinutes: 145,
    genres: [],
    releaseDate: "2026-07-31",
    posterUrl: null,
    isNowPlaying: true,
    isComingSoon: false,
  },
  {
    id: 20,
    name: "Dune",
    runtimeInMinutes: 155,
    genres: [],
    releaseDate: "2026-06-01",
    posterUrl: null,
    isNowPlaying: true,
    isComingSoon: false,
  },
];

/*
 * `vi.hoisted`, because `vi.mock` is lifted above every other statement in the file and
 * a factory closing over a plain `const` reads it before initialisation
 */
const api = vi.hoisted(() => ({
  theatres: vi.fn(),
  movies: vi.fn(),
  moviesAtTheatre: vi.fn(),
  theatresForMovie: vi.fn(),
  showtimes: vi.fn(),
  seats: vi.fn(),
}));

vi.mock("@/lib/cineplex-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/cineplex-client")>();
  return { ...actual, api };
});

const {
  SeatFinder,
  MANUAL_REFRESH_COOLDOWN_MS,
  RATE_LIMIT_MAX_PAUSE_MS,
  SEAT_REFRESH_MS,
  SKELETON_DELAY_MS,
} = await import("./SeatFinder");
const { TTL } = await import("@/lib/cineplex/upstream");

/** One screening, for cases that need the showtime select to have something in it */
const aShowtime: Session = {
  sessionId: 1,
  auditorium: "Aud 1",
  start: "2026-08-02T19:10:00",
  experiences: [],
  seatsRemaining: 5,
  isSoldOut: false,
};

/** ...and a second one to swap to, reading "9:30 PM" in the picker */
const twoShowtimes = [aShowtime, { ...aShowtime, sessionId: 2, start: "2026-08-02T21:30:00" }];

const pick = async (user: ReturnType<typeof userEvent.setup>, id: string, label: string) => {
  await user.click(screen.getByRole("combobox", { name: id }));
  await user.click(await screen.findByRole("option", { name: label }));
};

/** A ten seat row with the first `occupied` of them taken, so the meter reads n/10 */
const house = (occupied: number) => ({
  rows: [
    {
      label: "A",
      physicalNumber: 1,
      seats: Array.from({ length: 10 }, (_, index) => ({
        id: `a${index}`,
        label: `A${index + 1}`,
        column: index,
        kind: "Standard" as const,
        occupied: index < occupied,
      })),
    },
  ],
  totalColumns: 10,
  total: 10,
  occupied,
  isSoldOut: false,
});

/**
 * Through the three selects and up to a rendered map
 *
 * Picks by label, so whatever `api.showtimes` is mocked with has to contain `aShowtime`
 * or the option never appears and the case dies on an opaque `findByRole` timeout
 */
const chooseAShowtime = async (user: ReturnType<typeof userEvent.setup>) => {
  await pick(user, "Theatres", "Galaxy Barrie");
  await pick(user, "Movies", "Spider-Man");
  await waitFor(() => expect(screen.getByRole("combobox", { name: "Showtimes" })).toBeEnabled());
  await pick(user, "Showtimes", "7:10 PM");
};

beforeEach(() => {
  // `reset`, not `clear`: `clearAllMocks` leaves a `mockResolvedValueOnce` queue in place, so
  // an unconsumed once-value from a failed case is handed to the next one
  vi.resetAllMocks();
  api.theatres.mockResolvedValue(theatres);
  api.movies.mockResolvedValue(movies);
  api.moviesAtTheatre.mockResolvedValue({ filmIds: [10] });
  api.theatresForMovie.mockResolvedValue({ theatreIds: [1, 2] });
  api.showtimes.mockResolvedValue([]);
  // An empty house, not `null`. `api.seats` resolves a `SeatMap`, and a null default
  // reaches `result.occupied` and throws a TypeError that surfaces as a generic error
  api.seats.mockResolvedValue({
    rows: [],
    totalColumns: 0,
    total: 0,
    occupied: 0,
    isSoldOut: false,
  });
});

describe("SeatFinder", () => {
  /*
   * The real disabled attribute, not a visual state: the control has to be out of the
   * tab order, and only the attribute achieves that
   */
  it("keeps showtimes disabled until a theatre and a movie are both chosen", async () => {
    const user = userEvent.setup();
    // A pair with times to offer, so what is under test is the two selections rather than
    // the separate rule that an empty list leaves the control disabled
    api.showtimes.mockResolvedValue([aShowtime]);
    render(<SeatFinder />);
    const showtimes = await screen.findByRole("combobox", { name: "Showtimes" });
    expect(showtimes).toBeDisabled();

    await pick(user, "Theatres", "Galaxy Barrie");
    expect(showtimes).toBeDisabled();

    await pick(user, "Movies", "Spider-Man");
    await waitFor(() => expect(showtimes).toBeEnabled());
  });

  /*
   * A magnifier on all three, never a chevron: every one of these filters as you type, and
   * the glyph is the only thing that says so. All three triggers exist at boot, including
   * the showtime one, which is disabled but still rendered and still named
   */
  it("marks every select as a search rather than a picker", async () => {
    render(<SeatFinder />);
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Theatres" })).toBeEnabled());

    const glyphs = screen
      .getAllByRole("button", { name: "Show suggestions" })
      .map((trigger) => trigger.querySelector("svg")?.getAttribute("class") ?? "");
    expect(glyphs).toHaveLength(3);
    for (const glyph of glyphs) expect(glyph).toContain("lucide-search");
  });

  /*
   * The placeholders are the only copy on the page telling a first-time reader what to do:
   * the `h1` is screen-reader-only and there is no other prose. Two cases, because the
   * showtime placeholder has four branches and only one of them is reachable at boot
   */
  it("says what to do with each select at boot", async () => {
    render(<SeatFinder />);
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Theatres" })).toBeEnabled());

    expect(screen.getByRole("combobox", { name: "Theatres" })).toHaveAttribute(
      "placeholder",
      "Pick a theatre",
    );
    expect(screen.getByRole("combobox", { name: "Movies" })).toHaveAttribute(
      "placeholder",
      "Pick a movie",
    );
    // The showtime select is disabled here, so it names the thing standing in the way
    expect(screen.getByRole("combobox", { name: "Showtimes" })).toHaveAttribute(
      "placeholder",
      "Pick a theatre and a movie first",
    );
  });

  it("says what to do with the showtime select once it has something to offer", async () => {
    const user = userEvent.setup();
    api.showtimes.mockResolvedValue([aShowtime]);
    render(<SeatFinder />);
    await pick(user, "Theatres", "Galaxy Barrie");
    await pick(user, "Movies", "Spider-Man");

    const showtimes = screen.getByRole("combobox", { name: "Showtimes" });
    await waitFor(() => expect(showtimes).toBeEnabled());
    expect(showtimes).toHaveAttribute("placeholder", "Pick a showtime, or search by date");
  });

  it("narrows the movie list to what plays at the chosen theatre", async () => {
    const user = userEvent.setup();
    render(<SeatFinder />);
    await pick(user, "Theatres", "Galaxy Barrie");

    await user.click(await screen.findByRole("combobox", { name: "Movies" }));
    await waitFor(async () => {
      expect(await screen.findByRole("option", { name: "Spider-Man" })).toBeInTheDocument();
      expect(screen.queryByRole("option", { name: "Dune" })).not.toBeInTheDocument();
    });
  });

  /*
   * The expensive call is only ever made on a real selection. Prefetching it would mean
   * a megabytes-large upstream request on page load, for every visitor
   */
  it("does not make the film-wide narrowing call before a movie is chosen", async () => {
    render(<SeatFinder />);
    await screen.findByRole("combobox", { name: "Theatres" });
    expect(api.theatresForMovie).not.toHaveBeenCalled();
  });

  it("re-disables showtimes when the theatre is cleared", async () => {
    const user = userEvent.setup();
    api.showtimes.mockResolvedValue([aShowtime]);
    render(<SeatFinder />);
    await pick(user, "Theatres", "Galaxy Barrie");
    await pick(user, "Movies", "Spider-Man");
    const showtimes = await screen.findByRole("combobox", { name: "Showtimes" });
    await waitFor(() => expect(showtimes).toBeEnabled());

    // the input's own clear button, which is what a reader actually reaches for
    const [clearTheatre] = screen.getAllByRole("button", { name: "Clear selection" });
    if (clearTheatre) await user.click(clearTheatre);
    await waitFor(() => expect(showtimes).toBeDisabled());
  });

  it("shows an empty state, not an error, when the pair has no screenings", async () => {
    const user = userEvent.setup();
    render(<SeatFinder />);
    await pick(user, "Theatres", "Galaxy Barrie");
    await pick(user, "Movies", "Spider-Man");

    expect(await screen.findByText("No screenings")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("reports an unreachable API rather than an empty catalogue", async () => {
    api.theatres.mockRejectedValue(new ApiError(503, "upstream_unconfigured", "Not configured."));
    api.movies.mockRejectedValue(new ApiError(503, "upstream_unconfigured", "Not configured."));
    render(<SeatFinder />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Not configured.");
  });

  /*
   * `waitForHydration` polls `[data-pending]` document-wide with a ten second cap, so a
   * marker left standing on an error path stalls every a11y, smoke and emulation spec at
   * once, not just this component
   *
   * Asserted on the showtimes path, where the marker genuinely renders and a failure can
   * genuinely strand it. The boot path cannot show this: its error replaces the whole
   * tree with an Alert, so nothing carrying `data-pending` was ever mounted and the
   * count is zero however the code behaves
   */
  it("clears the pending marker when a showtime fetch fails", async () => {
    const user = userEvent.setup();
    api.showtimes.mockRejectedValue(new ApiError(502, "upstream_unavailable", "Upstream is down."));
    const { container } = render(<SeatFinder />);

    await pick(user, "Theatres", "Galaxy Barrie");
    await pick(user, "Movies", "Spider-Man");

    expect(await screen.findByRole("alert")).toHaveTextContent("Upstream is down.");
    await waitFor(() => expect(container.querySelectorAll("[data-pending]")).toHaveLength(0));
  });

  // ...and it really is present while the request is in flight, or the test above is
  // measuring the absence of something that never appears
  it("marks the pending region while showtimes are loading", async () => {
    const user = userEvent.setup();
    api.showtimes.mockImplementationOnce(() => new Promise(() => {}));
    const { container } = render(<SeatFinder />);

    await pick(user, "Theatres", "Galaxy Barrie");
    await pick(user, "Movies", "Spider-Man");

    await waitFor(() =>
      expect(container.querySelectorAll("[data-pending]").length).toBeGreaterThan(0),
    );
  });

  /*
   * A failed seat load used to outlive the selection that caused it: only the sessions
   * effect cleared the error, so the alert stayed on screen over the next showtime that
   * loaded fine, and over an empty page after the movie was cleared
   */
  it("clears a seat-load error once a later showtime loads", async () => {
    const user = userEvent.setup();
    api.showtimes.mockResolvedValue(twoShowtimes);
    api.seats
      .mockRejectedValueOnce(new ApiError(502, "upstream_unavailable", "Upstream is down."))
      .mockResolvedValueOnce({
        rows: [],
        totalColumns: 0,
        total: 0,
        occupied: 0,
        isSoldOut: false,
      });

    render(<SeatFinder />);
    await pick(user, "Theatres", "Galaxy Barrie");
    await pick(user, "Movies", "Spider-Man");
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Showtimes" })).toBeEnabled());

    await pick(user, "Showtimes", "7:10 PM");
    expect(await screen.findByRole("alert")).toHaveTextContent("Upstream is down.");

    await pick(user, "Showtimes", "9:30 PM");
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });

  /*
   * Switching the movie must take the previous pair's times with it. Left listed while
   * the new ones load, one can be chosen and the card renders the new movie's title over
   * the old screening, booking link included
   *
   * Two halves, because there are now two things standing between the reader and that:
   * the control is disabled for as long as its own list is loading, and the list behind
   * it was emptied before the request went out. Asserting only the first would pass on a
   * build that keeps the stale sessions in state behind a disabled control
   */
  it("drops the previous showtimes while a new pair is loading", async () => {
    const user = userEvent.setup();
    const spiderShowtime = {
      sessionId: 1,
      auditorium: "Aud 1",
      start: "2026-08-02T19:10:00",
      experiences: [],
      seatsRemaining: 5,
      isSoldOut: false,
    };
    let resolveDune: (sessions: Session[]) => void = () => {};
    api.moviesAtTheatre.mockResolvedValue({ filmIds: [10, 20] });
    api.showtimes
      .mockResolvedValueOnce([spiderShowtime])
      .mockImplementationOnce(() => new Promise<Session[]>((resolve) => (resolveDune = resolve)));

    render(<SeatFinder />);
    await pick(user, "Theatres", "Galaxy Barrie");
    await pick(user, "Movies", "Spider-Man");
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Showtimes" })).toBeEnabled());
    await user.click(screen.getByRole("combobox", { name: "Showtimes" }));
    expect(await screen.findByRole("option", { name: "7:10 PM" })).toBeInTheDocument();
    // close it: an open popup takes the rest of the page out of the tree
    await user.keyboard("{Escape}");

    // the second movie's showtimes are held open, so the first movie's must not linger
    await pick(user, "Movies", "Dune");

    /*
     * Out of reach while its own list loads, which is where the loading state belongs.
     * Enabled, this control offers a list that is either stale or empty and answers a
     * search with "No showtimes"
     */
    const showtimes = screen.getByRole("combobox", { name: "Showtimes" });
    await waitFor(() => expect(showtimes).toBeDisabled());
    expect(showtimes).toHaveAttribute("placeholder", "Loading showtimes");

    /*
     * ...and Dune's times replace Spider-Man's rather than joining them. Re-opened before
     * asserting, since with the popup shut no option is in the tree and the absence of
     * this one would hold whatever the state does. The 7:10 PM found in the first phase
     * is what makes that absence mean something
     */
    resolveDune([{ ...spiderShowtime, sessionId: 2, start: "2026-08-02T21:30:00" }]);
    await waitFor(() => expect(showtimes).toBeEnabled());
    await user.click(showtimes);
    expect(await screen.findByRole("option", { name: "9:30 PM" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "7:10 PM" })).not.toBeInTheDocument();
  });

  /*
   * Swapping showtimes brings the map back into view; the first pick does not move the
   * page
   *
   * The negative half is the fragile one. With `api.seats` resolving null there is no map
   * to scroll to and no ref to call, so "was not called" would be true whatever the code
   * does. Both halves run against a real seat map for that reason
   *
   * And the count is of scrolls to the map, not of scrolls. Base UI brings the selected
   * option into view when the picker reopens, on `Element.prototype.scrollIntoView` like
   * everything else, and a bare call count is satisfied by that alone: it stayed green
   * with the seat map's own scroll disabled outright
   */
  describe("scrolling to the seat map", () => {
    const oneSeat = {
      rows: [
        {
          label: "A",
          physicalNumber: 1,
          seats: [{ id: "a1", label: "A1", column: 0, kind: "Standard" as const, occupied: false }],
        },
      ],
      totalColumns: 1,
      total: 1,
      occupied: 0,
      isSoldOut: false,
    };

    it("stays put on the first pick and scrolls on the second", async () => {
      const user = userEvent.setup();
      const scrollIntoView = vi
        .spyOn(Element.prototype, "scrollIntoView")
        .mockImplementation(() => {});
      /** Only the calls whose receiver is the element wrapping the map and its legend */
      const mapScrolls = () =>
        scrollIntoView.mock.contexts.filter(
          (target) => target instanceof HTMLElement && target.querySelector('[data-slot="seat"]'),
        ).length;
      api.showtimes.mockResolvedValue(twoShowtimes);
      // A fresh object per call, which is what `response.json()` gives. Handing back one
      // shared object makes the second load `Object.is` equal to the first, so `seats`
      // never changes identity and the effect that scrolls never re-runs
      api.seats.mockImplementation(async () => structuredClone(oneSeat));

      render(<SeatFinder />);
      await pick(user, "Theatres", "Galaxy Barrie");
      await pick(user, "Movies", "Spider-Man");
      await waitFor(() =>
        expect(screen.getByRole("combobox", { name: "Showtimes" })).toBeEnabled(),
      );

      await pick(user, "Showtimes", "7:10 PM");
      // the map really rendered, so the absence below is about the scroll and not the map
      await screen.findByRole("img", { name: /^A1,/ });
      expect(mapScrolls()).toBe(0);

      await pick(user, "Showtimes", "9:30 PM");
      await waitFor(() => expect(mapScrolls()).toBe(1));
    });
  });

  /*
   * A slow first selection must not overwrite a fast second one. Aborting alone does
   * not cover this: the first promise has already resolved by the time the effect
   * re-runs, so the guard inside the callback is what actually discards it
   */
  it("ignores a narrowing response that a newer selection has superseded", async () => {
    const user = userEvent.setup();
    let resolveFirst: ((value: { filmIds: number[] }) => void) | undefined;
    api.moviesAtTheatre
      .mockImplementationOnce(
        () =>
          new Promise<{ filmIds: number[] }>((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValueOnce({ filmIds: [20] });

    render(<SeatFinder />);
    await pick(user, "Theatres", "Galaxy Barrie");
    await pick(user, "Theatres", "Scotiabank Toronto");

    // the stale answer lands after the newer selection has already been made
    resolveFirst?.({ filmIds: [10] });

    await user.click(await screen.findByRole("combobox", { name: "Movies" }));
    await waitFor(async () => {
      expect(await screen.findByRole("option", { name: "Dune" })).toBeInTheDocument();
      expect(screen.queryByRole("option", { name: "Spider-Man" })).not.toBeInTheDocument();
    });
  });

  /*
   * The seat map refreshes on a timer, and everything it deliberately does not do
   *
   * Fake timers throughout: `testTimeout` is five seconds, so a real half-minute
   * interval is not testable, and `userEvent` awaits a real timer of its own unless it is
   * told which clock to advance. `restoreMocks` does not cover timers, hence the afterEach
   */
  describe("refreshing the seat map", () => {
    const setup = () => userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    /*
     * `shouldAdvanceTime`, so the fake clock also creeps forward with real time. Testing
     * Library decides whether to drive the clock itself by looking for a `jest` global,
     * finds none under Vitest, and so builds every `waitFor` out of timers it believes are
     * real. Frozen, those never fire and every wait in this block runs to the timeout
     */
    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      api.showtimes.mockResolvedValue([aShowtime]);
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    /*
     * The interval has to stay above the server's availability TTL or every other poll is
     * handed the entry it already holds. Two modules state that in prose from opposite
     * sides and nothing joined them: raising the TTL to 20s would quietly halve the real
     * refresh rate with the map still appearing to move. A relationship, not a pair of
     * equal constants, so editing either side reddens it
     */
    it("polls less often than the server keeps availability fresh", () => {
      expect(TTL.seatAvailability.maxAge * 1000).toBeLessThan(SEAT_REFRESH_MS);
    });

    /*
     * The cooldown is the availability TTL, which is why a press inside it is refused: the
     * Worker would answer from its own cache with the bytes already on screen, spending a
     * request from the bucket to show nothing
     *
     * A drift pin, not a behavioural test, and it cannot be verified by mutation the usual
     * way, because editing either constant is the whole failure it exists to catch. The
     * behaviour it names is covered by the two press cases below
     */
    it("holds a press for exactly as long as the server keeps availability", () => {
      expect(MANUAL_REFRESH_COOLDOWN_MS).toBe(TTL.seatAvailability.maxAge * 1000);
    });

    it("refetches on the interval and renders what changed", async () => {
      const user = setup();
      api.seats.mockResolvedValueOnce(house(3)).mockResolvedValueOnce(house(5));

      render(<SeatFinder />);
      await chooseAShowtime(user);
      expect(await screen.findByText("3/10")).toBeInTheDocument();

      await vi.advanceTimersByTimeAsync(SEAT_REFRESH_MS);
      expect(await screen.findByText("5/10")).toBeInTheDocument();
    });

    /*
     * The one that protects every other spec in the suite. `waitForHydration` polls
     * `[data-pending]` document-wide, so a marker that comes back on every tick
     * does not slow this component down, it stalls every a11y, smoke and emulation run
     */
    it("raises no pending marker while a refresh is in flight", async () => {
      const user = setup();
      api.seats.mockResolvedValueOnce(house(3)).mockImplementationOnce(() => new Promise(() => {}));

      const { container } = render(<SeatFinder />);
      await chooseAShowtime(user);
      expect(await screen.findByText("3/10")).toBeInTheDocument();

      await vi.advanceTimersByTimeAsync(SEAT_REFRESH_MS);
      // Through `waitFor`, which carries the act boundary that flushes a render queued
      // from a timer. Read straight after the advance, the DOM below is the one from
      // before the refresh started and every assertion on it is vacuous
      await waitFor(() => expect(api.seats).toHaveBeenCalledTimes(2));

      // Still mounted, which is what a pending flag would undo, and the positive half of
      // the two absences under it
      expect(screen.getByText("3/10")).toBeInTheDocument();
      expect(container.querySelectorAll("[data-pending]")).toHaveLength(0);
      expect(container.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(0);
    });

    /*
     * A blip is not worth throwing the map away for. The reader keeps the last good one
     * and the age line is what tells them it stopped moving
     */
    it("keeps the last good map when a refresh fails", async () => {
      const user = setup();
      api.seats
        .mockResolvedValueOnce(house(3))
        .mockRejectedValueOnce(new ApiError(502, "upstream_unavailable", "Upstream is down."));

      render(<SeatFinder />);
      await chooseAShowtime(user);
      expect(await screen.findByText("3/10")).toBeInTheDocument();

      await vi.advanceTimersByTimeAsync(SEAT_REFRESH_MS);
      // `waitFor` for its act boundary, so the rejection's handler has been rendered
      // through before the map below is read
      await waitFor(() => expect(api.seats).toHaveBeenCalledTimes(2));

      expect(screen.getByText("3/10")).toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    /*
     * A backgrounded tab that keeps polling burns the same quota as one somebody is
     * reading. Three halves, and the last two are what stop the guard being deleted along
     * with everything it protects: the label has to keep telling the truth while hidden,
     * and the poll has to come back on its own once the tab does
     *
     * Returning does not refetch, deliberately. An immediate fetch there is an amplifier,
     * since the interval keeps its own phase and alternating hide and show doubles the rate
     */
    it("pauses while the tab is hidden, keeps the label honest, and resumes", async () => {
      const user = setup();
      const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(false);
      // One shared object across calls, which is safe only because this case asserts call
      // counts: React bails out on the equal reference, so nothing here depends on a render
      api.seats.mockResolvedValue(house(3));

      render(<SeatFinder />);
      await chooseAShowtime(user);
      expect(await screen.findByText("3/10")).toBeInTheDocument();
      expect(api.seats).toHaveBeenCalledTimes(1);

      hidden.mockReturnValue(true);
      await vi.advanceTimersByTimeAsync(SEAT_REFRESH_MS * 4);
      expect(api.seats).toHaveBeenCalledTimes(1);
      /*
       * ...and the timestamp is untouched by any of that, which is what makes it honest
       * while hidden: it names when the map arrived, so four skipped ticks change nothing
       * about it and there is no age to go stale
       */
      expect(screen.getByText(/^Updated since /)).toBeInTheDocument();

      hidden.mockReturnValue(false);
      document.dispatchEvent(new Event("visibilitychange"));
      await waitFor(() => expect(api.seats).toHaveBeenCalledTimes(1));

      // the next tick picks it back up without the reader doing anything
      await vi.advanceTimersByTimeAsync(SEAT_REFRESH_MS);
      await waitFor(() => expect(api.seats).toHaveBeenCalledTimes(2));
    });

    /*
     * A screening with unreserved seating has a map with no seats in it, and refetching one
     * is a request that can never say anything. Invisible too: the freshness line the tick
     * updates renders only beside a map that has seats
     */
    it("does not poll a screening that has no seat map", async () => {
      const user = setup();
      api.seats.mockResolvedValue({ ...house(0), rows: [], total: 0, totalColumns: 0 });

      render(<SeatFinder />);
      await chooseAShowtime(user);
      expect(await screen.findByText("No seat map")).toBeInTheDocument();

      await vi.advanceTimersByTimeAsync(60_000);
      expect(api.seats).toHaveBeenCalledTimes(1);
    });

    /*
     * A 404 on refresh is the one answer that is not a blip, and it is the answer a
     * showtime pulled from sale eventually gives. Swallowed with the rest, the map painted
     * before it stays on screen for the rest of the session, ageing but never corrected
     */
    it("clears the map when a refresh says the showtime is gone", async () => {
      const user = setup();
      api.seats
        .mockResolvedValueOnce(house(3))
        .mockRejectedValue(new ApiError(404, "not_found", "That showtime is not available."));

      render(<SeatFinder />);
      await chooseAShowtime(user);
      expect(await screen.findByText("3/10")).toBeInTheDocument();

      await vi.advanceTimersByTimeAsync(SEAT_REFRESH_MS);
      expect(await screen.findByRole("alert")).toHaveTextContent("That showtime is not available.");
      expect(screen.queryByText("3/10")).not.toBeInTheDocument();
      /*
       * ...and the selection goes with it. Base UI fires no change for an equal value, so a
       * showtime left selected over a cleared map cannot be re-picked, and there is no
       * other way back
       */
      expect(screen.getByRole("combobox", { name: "Showtimes" })).toHaveValue("");
    });

    /*
     * An alert about a showtime must not outlive the showtime. Only the two selects above
     * used to clear it, so clearing this one left "Could not load this showtime" standing
     * with nothing selected and nothing under it to be about
     */
    it("takes the seat error away when the showtime is cleared", async () => {
      const user = setup();
      api.seats.mockRejectedValue(new ApiError(502, "upstream_unavailable", "Upstream is down."));

      render(<SeatFinder />);
      await chooseAShowtime(user);
      expect(await screen.findByRole("alert")).toHaveTextContent("Upstream is down.");

      const [, , clearShowtime] = screen.getAllByRole("button", { name: "Clear selection" });
      if (clearShowtime) await user.click(clearShowtime);
      await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    });

    /*
     * A 429 with no `Retry-After` still pauses, on the local fallback. Without it null
     * reads as zero and the client polls straight back into a limiter that just said no
     */
    it("falls back to a fixed pause when the 429 carries no window", async () => {
      const user = setup();
      api.seats
        .mockResolvedValueOnce(house(3))
        .mockRejectedValueOnce(new ApiError(429, "rate_limited", "Too many requests."))
        .mockResolvedValue(house(5));

      render(<SeatFinder />);
      await chooseAShowtime(user);
      expect(await screen.findByText("3/10")).toBeInTheDocument();

      await vi.advanceTimersByTimeAsync(SEAT_REFRESH_MS);
      await waitFor(() => expect(api.seats).toHaveBeenCalledTimes(2));

      // three ticks inside the fallback minute, none of which may spend a token
      await vi.advanceTimersByTimeAsync(45_000);
      expect(api.seats).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(SEAT_REFRESH_MS);
      await waitFor(() => expect(api.seats).toHaveBeenCalledTimes(3));
    });

    /*
     * The limiter counts per address, not per showtime, so a 429 the reader's own pick
     * earned has to stop the timer too. Without it the next map that loads starts polling
     * straight into a bucket that already said no, and spends what is left of it
     */
    it("carries a pause earned by the reader's own pick into the next map", async () => {
      const user = setup();
      api.showtimes.mockResolvedValue(twoShowtimes);
      api.seats
        .mockRejectedValueOnce(new ApiError(429, "rate_limited", "Too many.", 45_000))
        .mockResolvedValue(house(3));

      render(<SeatFinder />);
      await chooseAShowtime(user);
      expect(await screen.findByRole("alert")).toHaveTextContent("Too many.");

      // a second pick succeeds, so a map is on screen and the timer is running
      await pick(user, "Showtimes", "9:30 PM");
      expect(await screen.findByText("3/10")).toBeInTheDocument();
      expect(api.seats).toHaveBeenCalledTimes(2);

      // ...but the window the first pick earned is still open, so the tick spends no token
      await vi.advanceTimersByTimeAsync(SEAT_REFRESH_MS);
      expect(api.seats).toHaveBeenCalledTimes(2);

      // the tick after the window closes is the first one that goes out
      await vi.advanceTimersByTimeAsync(SEAT_REFRESH_MS);
      await waitFor(() => expect(api.seats).toHaveBeenCalledTimes(3));
    });

    /*
     * Occupancy falls when a hold expires, and a negative delta would read as seats being
     * un-sold. The floor takes it back to silence rather than to a number
     */
    it("says nothing when the house empties rather than fills", async () => {
      const user = setup();
      api.seats
        .mockResolvedValueOnce(house(5))
        .mockResolvedValueOnce(house(2))
        .mockResolvedValue(house(7));

      render(<SeatFinder />);
      await chooseAShowtime(user);
      expect(await screen.findByText("5/10")).toBeInTheDocument();

      await vi.advanceTimersByTimeAsync(SEAT_REFRESH_MS);
      await waitFor(() => expect(screen.getByText("2/10")).toBeInTheDocument());
      expect(screen.getByRole("status").textContent).toBe("");

      // ...still counted from arrival, so it is the climb past that which gets said
      await vi.advanceTimersByTimeAsync(SEAT_REFRESH_MS);
      await waitFor(() =>
        expect(screen.getByRole("status")).toHaveTextContent("2 seats sold since this map loaded"),
      );
    });

    /*
     * The window is whatever an intermediary put in a header, and the hold outlives the
     * selection, so an unclamped day-long one would stop the page updating for good. Asked
     * for a day, capped at `RATE_LIMIT_MAX_PAUSE_MS`
     */
    it("caps how long a Retry-After may suppress the refresh", async () => {
      const user = setup();
      api.seats
        .mockResolvedValueOnce(house(3))
        .mockRejectedValueOnce(new ApiError(429, "rate_limited", "Too many.", 86_400_000))
        .mockResolvedValue(house(5));

      render(<SeatFinder />);
      await chooseAShowtime(user);
      expect(await screen.findByText("3/10")).toBeInTheDocument();

      await vi.advanceTimersByTimeAsync(SEAT_REFRESH_MS);
      await waitFor(() => expect(api.seats).toHaveBeenCalledTimes(2));

      // Stopping two intervals short of the cap, so the window is still open however the
      // two constants are set relative to each other
      await vi.advanceTimersByTimeAsync(RATE_LIMIT_MAX_PAUSE_MS - SEAT_REFRESH_MS * 2);
      expect(api.seats).toHaveBeenCalledTimes(2);

      // ...and past it the map starts moving again, rather than never
      await vi.advanceTimersByTimeAsync(SEAT_REFRESH_MS * 3);
      await waitFor(() => expect(screen.getByText("5/10")).toBeInTheDocument());
    });

    /*
     * One attempt at a time, and none outliving half an interval
     *
     * Nothing bounds a browser request that hangs, so without the abandon timeout one
     * stalled fetch holds the only slot forever. The bound is half an interval rather than
     * a whole one so that the stall costs the tick it started on and not the one after:
     * armed a moment after its own tick, a full-interval timeout always fires just late
     */
    it("abandons a stalled refresh rather than blocking every one after it", async () => {
      const user = setup();
      // Rejects on abort, the way `fetch` does. The case for a stub that ignores its
      // signal is separate, below, because only the slot being emptied saves that one
      api.seats
        .mockResolvedValueOnce(house(3))
        .mockImplementationOnce(
          (_theatreId: number, _showtimeId: number, signal?: AbortSignal) =>
            new Promise((_resolve, reject) => {
              signal?.addEventListener("abort", () =>
                reject(new DOMException("Aborted", "AbortError")),
              );
            }),
        )
        .mockResolvedValue(house(6));

      render(<SeatFinder />);
      await chooseAShowtime(user);
      expect(await screen.findByText("3/10")).toBeInTheDocument();

      await vi.advanceTimersByTimeAsync(SEAT_REFRESH_MS);
      await waitFor(() => expect(api.seats).toHaveBeenCalledTimes(2));

      /*
       * Three quarters of an interval: past any bound worth having, and comfortably short
       * of the next tick. Derived from the interval rather than from `REFRESH_ABANDON_MS`,
       * because advancing by the constant under test moves the test along with it and a
       * bound raised to a whole interval would still pass
       */
      await vi.advanceTimersByTimeAsync(SEAT_REFRESH_MS * 0.75);
      // giving up is not itself a refetch
      expect(api.seats).toHaveBeenCalledTimes(2);

      /*
       * A press, not the next tick: it lands inside the interval the stall started in, so
       * it can only go out if the slot was already free. Against a whole-interval bound the
       * abandon has not fired yet and this press does nothing
       */
      await user.click(screen.getByRole("button", { name: "Refresh the seat map" }));
      await waitFor(() => expect(screen.getByText("6/10")).toBeInTheDocument());
    });

    /*
     * ...and the same for a request that never settles at all
     *
     * The case above uses a stub that rejects on abort, the way `fetch` does, so its
     * `finally` frees the slot whether or not the abandon does. A wrapper or a polyfill
     * that ignores its signal never settles, and then emptying the slot in the abandon is
     * the only thing standing between one stalled fetch and a page that never refreshes
     */
    it("gives up on a request that ignores its abort signal", async () => {
      const user = setup();
      api.seats
        .mockResolvedValueOnce(house(3))
        .mockImplementationOnce(() => new Promise(() => {}))
        .mockResolvedValue(house(6));

      render(<SeatFinder />);
      await chooseAShowtime(user);
      expect(await screen.findByText("3/10")).toBeInTheDocument();

      await vi.advanceTimersByTimeAsync(SEAT_REFRESH_MS);
      await waitFor(() => expect(api.seats).toHaveBeenCalledTimes(2));

      await vi.advanceTimersByTimeAsync(SEAT_REFRESH_MS * 0.75);
      await user.click(screen.getByRole("button", { name: "Refresh the seat map" }));
      await waitFor(() => expect(screen.getByText("6/10")).toBeInTheDocument());
    });

    /*
     * A press that cannot go out must not look as though it did
     *
     * The slot is checked in `requestRefresh` as well as inside `refreshSeats`. Without the
     * outer check the press still takes a cooldown and dims the control, so the reader is
     * told to wait ten seconds for a request that was never made
     */
    it("takes no cooldown for a press that the in-flight guard refuses", async () => {
      const user = setup();
      api.seats.mockResolvedValueOnce(house(3)).mockImplementation(() => new Promise(() => {}));

      render(<SeatFinder />);
      await chooseAShowtime(user);
      expect(await screen.findByText("3/10")).toBeInTheDocument();

      await vi.advanceTimersByTimeAsync(SEAT_REFRESH_MS);
      await waitFor(() => expect(api.seats).toHaveBeenCalledTimes(2));

      const refresh = screen.getByRole("button", { name: "Refresh the seat map" });
      expect(refresh).not.toHaveAttribute("aria-disabled");
      await user.click(refresh);
      await act(async () => {});
      expect(api.seats).toHaveBeenCalledTimes(2);
      expect(refresh).not.toHaveAttribute("aria-disabled");
    });

    /*
     * The slot is a ref now, shared between the timer and the control, so it no longer
     * starts empty on every effect run the way the effect-scoped variable it replaced did
     *
     * This stub ignores its signal and never settles, which the real client does not do
     * but a wrapper or a polyfill could. The only thing that frees the slot then is the
     * effect cleanup emptying it: without that, the attempt abandoned by the swap holds it
     * for the life of the page and every later tick returns early with nothing to say so
     */
    it("frees the refresh slot when a swap abandons an attempt that never settles", async () => {
      const user = setup();
      api.showtimes.mockResolvedValue(twoShowtimes);
      api.seats
        .mockResolvedValueOnce(house(3))
        .mockImplementationOnce(() => new Promise(() => {}))
        .mockResolvedValue(house(6));

      render(<SeatFinder />);
      await chooseAShowtime(user);
      expect(await screen.findByText("3/10")).toBeInTheDocument();

      // a refresh goes out and is still open, and unabortable, when the reader swaps
      await vi.advanceTimersByTimeAsync(SEAT_REFRESH_MS);
      await waitFor(() => expect(api.seats).toHaveBeenCalledTimes(2));
      await pick(user, "Showtimes", "9:30 PM");
      expect(await screen.findByText("6/10")).toBeInTheDocument();

      await vi.advanceTimersByTimeAsync(SEAT_REFRESH_MS);
      await waitFor(() => expect(api.seats).toHaveBeenCalledTimes(4));
    });

    /*
     * A refresh that settles after the reader has moved on must not land. Aborting alone
     * does not cover it: the promise has already resolved by the time the effect re-runs,
     * so the check inside the callback is the only thing that discards it. Without it the
     * map is stamped with the previous showtime and the whole block unmounts
     */
    it("discards a refresh that settles after the showtime changed", async () => {
      const user = setup();
      let landLate: (map: ReturnType<typeof house>) => void = () => {};
      api.seats
        .mockResolvedValueOnce(house(3))
        .mockImplementationOnce(() => new Promise((resolve) => (landLate = resolve)))
        .mockResolvedValue(house(8));
      // A different time, not just a different auditorium: two screenings at the same
      // minute both render with an auditorium suffix, and the first pick stops matching
      api.showtimes.mockResolvedValue(twoShowtimes);

      render(<SeatFinder />);
      await chooseAShowtime(user);
      expect(await screen.findByText("3/10")).toBeInTheDocument();

      // a refresh goes out and is still open when the reader picks the other showtime
      await vi.advanceTimersByTimeAsync(SEAT_REFRESH_MS);
      await waitFor(() => expect(api.seats).toHaveBeenCalledTimes(2));
      await pick(user, "Showtimes", "9:30 PM");
      expect(await screen.findByText("8/10")).toBeInTheDocument();

      landLate(house(3));
      /*
       * `act`, not `waitFor`. A `waitFor` whose condition is already true resolves on its
       * first synchronous check, which runs before the flush at its exit, so it reads the
       * DOM from before the late answer arrived and passes whatever the code did. Only an
       * assertion that has to *become* true is safe inside one
       */
      await act(async () => {});
      expect(screen.getByText("8/10")).toBeInTheDocument();
      expect(screen.queryByText("3/10")).not.toBeInTheDocument();
    });

    /*
     * A wall-clock time stays true without being re-derived, which is the whole reason it
     * is one: a map that stops refreshing goes on naming the last moment it did, and the
     * reader compares that against their own clock. Re-stamping it on a failed refresh
     * would be the lie, so failing refreshes must leave it exactly where it was
     */
    it("keeps naming the last successful update while every refresh fails", async () => {
      const user = setup();
      api.seats.mockResolvedValueOnce(house(3)).mockRejectedValue(new Error("offline"));

      render(<SeatFinder />);
      await chooseAShowtime(user);
      const arrived = await screen.findByText(/^Updated since /);
      const stamp = arrived.textContent;

      await vi.advanceTimersByTimeAsync(SEAT_REFRESH_MS * 4);
      await waitFor(() => expect(api.seats).toHaveBeenCalledTimes(5));
      expect(screen.getByText(/^Updated since /).textContent).toBe(stamp);
    });

    /*
     * ...and a successful one does move it. The pair is what makes either half mean
     * something: on its own the case above passes on a label that never changes at all
     */
    it("re-stamps the time when a refresh lands", async () => {
      const user = setup();
      api.seats.mockResolvedValueOnce(house(3)).mockResolvedValue(house(4));

      render(<SeatFinder />);
      await chooseAShowtime(user);
      const stamp = (await screen.findByText(/^Updated since /)).textContent;

      // A minute, so the reading has to differ whatever second the run started on
      await vi.advanceTimersByTimeAsync(60_000);
      await waitFor(() => expect(screen.getByText("4/10")).toBeInTheDocument());
      expect(screen.getByText(/^Updated since /).textContent).not.toBe(stamp);
    });

    /*
     * The limiter's own window, read off the response rather than restated in the client
     *
     * Not the 60 the limiter actually sends: a client holding its own copy of the window
     * passes a test built around 60 and pauses for the wrong interval the moment the
     * server's period changes
     */
    it("sits out the window the limiter asked for, then resumes", async () => {
      const user = setup();
      api.seats
        .mockResolvedValueOnce(house(3))
        /*
         * One and a half intervals rather than a whole number of them, so the window closes
         * strictly between two ticks. Landing it on a tick boundary makes the resume depend
         * on `Date.now()` against the deadline to the millisecond, which `shouldAdvanceTime`
         * then decides by however much real time the machine spent
         */
        .mockRejectedValueOnce(
          new ApiError(429, "rate_limited", "Too many requests.", SEAT_REFRESH_MS * 1.5),
        )
        .mockResolvedValue(house(5));

      render(<SeatFinder />);
      await chooseAShowtime(user);
      expect(await screen.findByText("3/10")).toBeInTheDocument();

      await vi.advanceTimersByTimeAsync(SEAT_REFRESH_MS);
      await waitFor(() => expect(api.seats).toHaveBeenCalledTimes(2));

      // the tick inside the window is refused
      await vi.advanceTimersByTimeAsync(SEAT_REFRESH_MS);
      expect(api.seats).toHaveBeenCalledTimes(2);

      // ...and the next one, well past the window, resumes without any interaction
      await vi.advanceTimersByTimeAsync(SEAT_REFRESH_MS);
      await waitFor(() => expect(api.seats).toHaveBeenCalledTimes(3));
    });

    /*
     * A seat's whole state is in its accessible name, so seats selling under a virtual
     * cursor is silent. Both boundaries, since the singular is the half a bare `+ " seats"`
     * would keep green
     */
    it("announces what sold, in the singular and the plural", async () => {
      const user = setup();
      api.seats
        .mockResolvedValueOnce(house(3))
        .mockResolvedValueOnce(house(4))
        .mockResolvedValueOnce(house(6));

      render(<SeatFinder />);
      await chooseAShowtime(user);
      // Mounted and empty, which is what lets it announce at all, and `textContent` rather
      // than `toHaveTextContent("")`, which every string satisfies
      expect(await screen.findByText("3/10")).toBeInTheDocument();
      expect(screen.getByRole("status").textContent).toBe("");

      await vi.advanceTimersByTimeAsync(SEAT_REFRESH_MS);
      await waitFor(() =>
        expect(screen.getByRole("status")).toHaveTextContent("1 seat sold since this map loaded"),
      );

      await vi.advanceTimersByTimeAsync(SEAT_REFRESH_MS);
      await waitFor(() =>
        expect(screen.getByRole("status")).toHaveTextContent("3 seats sold since this map loaded"),
      );
    });

    describe("the refresh control", () => {
      const refresh = () => screen.getByRole("button", { name: "Refresh the seat map" });

      it("fetches on a press, without waiting for the interval", async () => {
        const user = setup();
        api.seats.mockResolvedValueOnce(house(3)).mockResolvedValue(house(6));

        render(<SeatFinder />);
        await chooseAShowtime(user);
        expect(await screen.findByText("3/10")).toBeInTheDocument();

        await user.click(refresh());
        await waitFor(() => expect(screen.getByText("6/10")).toBeInTheDocument());
        expect(api.seats).toHaveBeenCalledTimes(2);
      });

      /*
       * The whole point of the cooldown. Without it a held-down control spends the bucket
       * at whatever rate the pointer repeats, and every one of those requests is answered
       * from the Worker's cache with what is already on screen
       */
      it("refuses a second press inside the cooldown and takes one after it", async () => {
        const user = setup();
        api.seats.mockResolvedValue(house(3));

        render(<SeatFinder />);
        await chooseAShowtime(user);
        expect(await screen.findByText("3/10")).toBeInTheDocument();

        await user.click(refresh());
        await waitFor(() => expect(api.seats).toHaveBeenCalledTimes(2));

        await user.click(refresh());
        await user.click(refresh());
        // `act`, not `waitFor`: "still 2" is already true, so a wait would resolve on its
        // first synchronous probe and pass however the guard behaves
        await act(async () => {});
        expect(api.seats).toHaveBeenCalledTimes(2);

        await vi.advanceTimersByTimeAsync(MANUAL_REFRESH_COOLDOWN_MS);
        await user.click(refresh());
        await waitFor(() => expect(api.seats).toHaveBeenCalledTimes(3));
      });

      /*
       * `aria-disabled` rather than `disabled`, so the control keeps focus and still
       * announces itself. Both edges, because the attribute going up is worthless if
       * nothing takes it down again: the hold lapses on its own timer, with no interaction
       */
      it("marks itself unavailable while held, and clears when the hold lapses", async () => {
        const user = setup();
        api.seats.mockResolvedValue(house(3));

        render(<SeatFinder />);
        await chooseAShowtime(user);
        expect(await screen.findByText("3/10")).toBeInTheDocument();
        expect(refresh()).not.toHaveAttribute("aria-disabled");

        await user.click(refresh());
        await waitFor(() => expect(refresh()).toHaveAttribute("aria-disabled", "true"));
        // Still reachable, which is the difference from a real `disabled` attribute
        expect(refresh()).not.toBeDisabled();

        await vi.advanceTimersByTimeAsync(MANUAL_REFRESH_COOLDOWN_MS);
        await waitFor(() => expect(refresh()).not.toHaveAttribute("aria-disabled"));
      });

      /*
       * A wall clock can move backwards, and the release has to survive it
       *
       * An NTP correction or a resume from suspend puts the deadline back in the future
       * under a timer already armed for it. The release then correctly declines, and if it
       * simply returned there would be nothing left to try again: the interval heals itself
       * because it re-reads the clock every tick, but the control never would
       */
      it("re-arms the release when the clock steps backwards under a hold", async () => {
        const user = setup();
        api.seats.mockResolvedValue(house(3));

        render(<SeatFinder />);
        await chooseAShowtime(user);
        expect(await screen.findByText("3/10")).toBeInTheDocument();

        await user.click(refresh());
        await waitFor(() => expect(refresh()).toHaveAttribute("aria-disabled", "true"));

        vi.setSystemTime(Date.now() - MANUAL_REFRESH_COOLDOWN_MS);
        // the timer the press armed fires here, finds the deadline still ahead, and declines
        await vi.advanceTimersByTimeAsync(MANUAL_REFRESH_COOLDOWN_MS);
        expect(refresh()).toHaveAttribute("aria-disabled", "true");

        // ...and the replacement it armed is what eventually lets go
        await vi.advanceTimersByTimeAsync(MANUAL_REFRESH_COOLDOWN_MS);
        await waitFor(() => expect(refresh()).not.toHaveAttribute("aria-disabled"));
      });

      /*
       * Coming back to the tab re-checks the hold; it does not drop one
       *
       * The listener exists because a background tab throttles timers to a minute, so the
       * lapse can fire long after its deadline and the control would sit dimmed until
       * something else re-rendered. Releasing unconditionally there is the tempting
       * shortcut, and it would hand the limiter the requests a 429 had just refused
       */
      it("does not drop a live hold when the tab comes back", async () => {
        const user = setup();
        api.seats.mockResolvedValue(house(3));

        render(<SeatFinder />);
        await chooseAShowtime(user);
        expect(await screen.findByText("3/10")).toBeInTheDocument();

        await user.click(refresh());
        await waitFor(() => expect(refresh()).toHaveAttribute("aria-disabled", "true"));

        document.dispatchEvent(new Event("visibilitychange"));
        await act(async () => {});
        expect(refresh()).toHaveAttribute("aria-disabled", "true");
      });

      /*
       * One hold, read by both. A 429 the timer earned has to close the control too, or the
       * reader hands the limiter exactly the requests it just refused
       */
      it("is held by a 429 the interval earned, not just by its own cooldown", async () => {
        const user = setup();
        api.seats
          .mockResolvedValueOnce(house(3))
          .mockRejectedValueOnce(
            new ApiError(429, "rate_limited", "Too many.", SEAT_REFRESH_MS * 4),
          )
          .mockResolvedValue(house(9));

        render(<SeatFinder />);
        await chooseAShowtime(user);
        expect(await screen.findByText("3/10")).toBeInTheDocument();

        await vi.advanceTimersByTimeAsync(SEAT_REFRESH_MS);
        await waitFor(() => expect(refresh()).toHaveAttribute("aria-disabled", "true"));

        await user.click(refresh());
        await act(async () => {});
        expect(api.seats).toHaveBeenCalledTimes(2);
      });

      /*
       * A longer hold arriving over a shorter one has to re-arm the timer that clears it
       *
       * One press does both: it takes the cooldown first, then its own request comes back
       * 429 and extends the deadline well past it. If the lapse timer keyed on a boolean
       * rather than on the deadline it would not re-run, the cooldown's timer would fire
       * and correctly decline to release, and nothing would ever arm another: the control
       * would stay dimmed for the rest of the session
       */
      it("clears a hold that was extended while an earlier one was running", async () => {
        const user = setup();
        const longWindow = SEAT_REFRESH_MS * 4;
        api.seats
          .mockResolvedValueOnce(house(3))
          .mockRejectedValue(new ApiError(429, "rate_limited", "Too many.", longWindow));

        render(<SeatFinder />);
        await chooseAShowtime(user);
        expect(await screen.findByText("3/10")).toBeInTheDocument();

        await user.click(refresh());
        await waitFor(() => expect(refresh()).toHaveAttribute("aria-disabled", "true"));

        // past the cooldown the press took, but nowhere near the window the 429 asked for
        await vi.advanceTimersByTimeAsync(MANUAL_REFRESH_COOLDOWN_MS * 2);
        expect(refresh()).toHaveAttribute("aria-disabled", "true");

        await vi.advanceTimersByTimeAsync(longWindow);
        await waitFor(() => expect(refresh()).not.toHaveAttribute("aria-disabled"));
      });

      /*
       * ...and the reverse: a shorter hold arriving over a longer one must not shorten it
       *
       * Only the selection path can do this, because it goes out even while held, so a
       * pick's 429 can name a window shorter than the one already running. Without the
       * `Math.max` the long window collapses to the short one and the next map polls
       * straight back into a limiter that has not finished refusing
       */
      it("keeps the longer of two holds when a shorter one arrives over it", async () => {
        const user = setup();
        api.showtimes.mockResolvedValue(twoShowtimes);
        api.seats
          .mockResolvedValueOnce(house(3))
          .mockRejectedValueOnce(
            new ApiError(429, "rate_limited", "Too many.", RATE_LIMIT_MAX_PAUSE_MS),
          )
          .mockRejectedValueOnce(new ApiError(429, "rate_limited", "Too many.", 1_000))
          .mockResolvedValue(house(9));

        render(<SeatFinder />);
        await chooseAShowtime(user);
        expect(await screen.findByText("3/10")).toBeInTheDocument();

        // the long hold, earned by the timer
        await vi.advanceTimersByTimeAsync(SEAT_REFRESH_MS);
        await waitFor(() => expect(api.seats).toHaveBeenCalledTimes(2));

        // ...then a pick, which always goes out, comes back asking for a much shorter one
        await pick(user, "Showtimes", "9:30 PM");
        await waitFor(() => expect(api.seats).toHaveBeenCalledTimes(3));
        expect(await screen.findByRole("alert")).toHaveTextContent("Too many.");

        // back to a map, and the long window is still the one in force
        await pick(user, "Showtimes", "7:10 PM");
        expect(await screen.findByText("9/10")).toBeInTheDocument();
        await vi.advanceTimersByTimeAsync(SEAT_REFRESH_MS * 4);
        expect(api.seats).toHaveBeenCalledTimes(4);
      });

      /*
       * A press must not raise the marker every e2e spec's hydration wait polls, and must
       * not paint a placeholder over a map that is already on screen
       *
       * Read while the request is still open, which is the only moment a flag could be up.
       * Read after it lands instead and any flag is already down, so the assertion passes
       * however the code behaves: that is what this case looked like before, and adding
       * `seatsPending` to the press left it green
       */
      it("raises no pending marker and no skeleton", async () => {
        const user = setup();
        api.seats.mockResolvedValueOnce(house(3)).mockImplementation(() => new Promise(() => {}));

        const { container } = render(<SeatFinder />);
        await chooseAShowtime(user);
        expect(await screen.findByText("3/10")).toBeInTheDocument();

        await user.click(refresh());
        await waitFor(() => expect(api.seats).toHaveBeenCalledTimes(2));
        expect(container.querySelectorAll("[data-pending]")).toHaveLength(0);

        // ...and still nothing once the placeholder delay has run out
        await vi.advanceTimersByTimeAsync(SKELETON_DELAY_MS * 2);
        expect(container.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(0);
        expect(screen.getByText("3/10")).toBeInTheDocument();
      });
    });

    /*
     * A warm cache settles in tens of milliseconds and a placeholder painted for that long
     * is a flicker. The marker still goes up at once, since the hydration wait depends on
     * it, so the two halves are asserted apart
     */
    it("holds the skeleton back while marking the region pending", async () => {
      const user = setup();
      api.seats.mockImplementation(() => new Promise(() => {}));

      const { container } = render(<SeatFinder />);
      await chooseAShowtime(user);

      /*
       * Read straight out of the act flush that the pick above ends with, with no polling
       * wait in between. `shouldAdvanceTime` ties the fake clock to the real one, so any
       * `waitFor` here spends part of the delay this case exists to measure, and on a
       * loaded machine it spends all of it
       */
      expect(container.querySelectorAll("[data-pending]")).toHaveLength(1);
      expect(container.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(0);

      await vi.advanceTimersByTimeAsync(SKELETON_DELAY_MS);
      await waitFor(() =>
        expect(container.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(1),
      );
      expect(container.querySelectorAll("[data-pending]")).toHaveLength(1);
    });
  });

  /*
   * The selection fetch carries the same two abort guards the refresh does, and until now
   * only the refresh's copies were exercised: both of these mutations survived a full run
   * before these cases existed. Real timers here, because neither case involves the
   * interval and `shouldAdvanceTime` only makes the waits race the machine
   */
  describe("swapping showtimes while a seat fetch is open", () => {
    it("ignores a seat response for the showtime the reader moved off", async () => {
      const user = userEvent.setup();
      let landLate: (map: ReturnType<typeof house>) => void = () => {};
      api.showtimes.mockResolvedValue(twoShowtimes);
      api.seats
        .mockImplementationOnce(() => new Promise((resolve) => (landLate = resolve)))
        .mockResolvedValue(house(8));

      render(<SeatFinder />);
      await chooseAShowtime(user);
      await pick(user, "Showtimes", "9:30 PM");
      expect(await screen.findByText("8/10")).toBeInTheDocument();

      landLate(house(3));
      // `act`, not `waitFor`: a condition already true resolves on the first synchronous
      // probe, before the flush at the wait's exit, so it would read the pre-landing DOM
      await act(async () => {});
      /*
       * The surviving map, not the absence of the stale one. One meter renders one string,
       * so "3/10 is gone" cannot fail on its own. Writing the stale map also writes its
       * `seatsForSession`, which stops matching the selected showtime, so the whole block
       * unmounts and this is what catches it
       */
      expect(screen.getByText("8/10")).toBeInTheDocument();
    });

    it("keeps the pending marker up when the abandoned request settles", async () => {
      const user = userEvent.setup();
      let landLate: (map: ReturnType<typeof house>) => void = () => {};
      api.showtimes.mockResolvedValue(twoShowtimes);
      api.seats
        .mockImplementationOnce(() => new Promise((resolve) => (landLate = resolve)))
        .mockImplementation(() => new Promise(() => {}));

      const { container } = render(<SeatFinder />);
      await chooseAShowtime(user);
      await pick(user, "Showtimes", "9:30 PM");
      expect(container.querySelectorAll("[data-pending]")).toHaveLength(1);

      landLate(house(3));
      await act(async () => {});
      // The abandoned request's `finally` must not clear a flag the request that replaced
      // it is still relying on, or the hydration wait in every e2e spec resolves early
      expect(container.querySelectorAll("[data-pending]")).toHaveLength(1);
    });
  });
});
