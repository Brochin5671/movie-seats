import { describe, expect, it } from "vitest";
import {
  filmIdsFrom,
  theatreIdsFrom,
  toMovies,
  toSeatMap,
  toSessions,
  toTheatres,
} from "./projections";
import type { RawSeatArea, RawSeatLayout, RawSeatRow, RawShowtimeTheatre, RawTheatre } from "./raw";

/*
 * Literal payloads, shaped after real responses. These cover the parts of the upstream
 * format that are wrong in a way nothing else would notice: a merge that silently drops
 * a label, a filter that lets a past showtime through, a join that reads the wrong
 * field. All of it is pure, so none of it needs a fetch
 */

function showtimes(
  experiences: { types: string[] | null; sessions: Record<string, unknown>[] }[],
): RawShowtimeTheatre[] {
  return [
    {
      theatreId: 7249,
      dates: [
        {
          movies: [
            {
              id: 37997,
              experiences: experiences.map((experience) => ({
                experienceTypes: experience.types,
                // biome-ignore lint/suspicious/noExplicitAny: literal fixture, narrowed by the projector
                sessions: experience.sessions as any,
              })),
            },
          ],
        },
      ],
    },
  ];
}

const baseSession = {
  vistaSessionId: 1,
  auditorium: "Aud 12",
  showStartDateTime: "2026-08-02T18:45:00",
  seatsRemaining: 245,
  isSoldOut: false,
  isInThePast: false,
  isReservedSeating: true,
};

describe("toSessions", () => {
  /*
   * The measured shape of the real feed: one screening repeats once per experience
   * group, and `experienceTypes` lives on the group rather than the session. Keeping
   * either row alone loses a format label, which is the whole reason this merges
   */
  it("merges experience labels across duplicate rows of one screening", () => {
    /*
     * Disjoint groups, not a superset. With `["3D"]` then `["3D","D-BOX"]` a merge and a
     * last-wins overwrite produce the same answer, so the assertion cannot tell them
     * apart
     */
    const result = toSessions(
      showtimes([
        { types: ["3D"], sessions: [baseSession] },
        { types: ["D-BOX"], sessions: [baseSession] },
      ]),
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.experiences).toEqual(["3D", "D-BOX"]);
  });

  it("keeps distinct screenings apart", () => {
    const result = toSessions(
      showtimes([
        {
          types: ["Regular"],
          sessions: [baseSession, { ...baseSession, vistaSessionId: 2, auditorium: "IMAX #1" }],
        },
      ]),
    );
    expect(result.map((s) => s.sessionId)).toEqual([1, 2]);
  });

  it("drops screenings that have already started", () => {
    const result = toSessions(
      showtimes([
        {
          types: ["Regular"],
          sessions: [{ ...baseSession, vistaSessionId: 9, isInThePast: true }, baseSession],
        },
      ]),
    );
    expect(result.map((s) => s.sessionId)).toEqual([1]);
  });

  /*
   * null is unreserved seating, not a sold-out house. Coercing it to 0 would read as
   * "no seats left" everywhere downstream
   */
  it("keeps a null seat count as null", () => {
    const result = toSessions(
      showtimes([{ types: null, sessions: [{ ...baseSession, seatsRemaining: null }] }]),
    );
    expect(result[0]?.seatsRemaining).toBeNull();
  });

  /*
   * The stream arrives grouped by experience, not by time, so an evening 3D group can
   * precede an afternoon Standard group. Unsorted, the picker lists 7:10 PM above
   * 1:00 PM under one day heading
   */
  it("returns sessions in chronological order across experience groups", () => {
    const at = (id: number, start: string) => ({
      ...baseSession,
      vistaSessionId: id,
      showStartDateTime: start,
    });
    const result = toSessions(
      showtimes([
        { types: ["3D"], sessions: [at(1, "2026-08-02T19:10:00"), at(2, "2026-08-02T21:30:00")] },
        {
          types: ["Regular"],
          sessions: [at(3, "2026-08-02T13:00:00"), at(4, "2026-08-02T16:00:00")],
        },
      ]),
    );
    expect(result.map((s) => s.start)).toEqual([
      "2026-08-02T13:00:00",
      "2026-08-02T16:00:00",
      "2026-08-02T19:10:00",
      "2026-08-02T21:30:00",
    ]);
  });

  it("carries the wall clock through untouched", () => {
    const result = toSessions(showtimes([{ types: [], sessions: [baseSession] }]));
    expect(result[0]?.start).toBe("2026-08-02T18:45:00");
  });
});

describe("toMovies", () => {
  it("normalises an empty poster url to null", () => {
    const [withPoster, without] = toMovies([
      {
        id: 1,
        name: "A",
        runtimeInMinutes: 100,
        genres: ["Drama"],
        releaseDate: "2026-01-01",
        mediumPosterImageUrl: "https://mediafiles.cineplex.com/a.jpg",
        isNowPlaying: true,
        isComingSoon: false,
      },
      {
        id: 2,
        name: "B",
        runtimeInMinutes: 90,
        genres: null,
        releaseDate: "2026-02-01",
        mediumPosterImageUrl: "",
        isNowPlaying: false,
        isComingSoon: true,
      },
    ]);
    expect(withPoster?.posterUrl).toBe("https://mediafiles.cineplex.com/a.jpg");
    // null, not "": an empty src re-requests the current page in some browsers
    expect(without?.posterUrl).toBeNull();
    expect(without?.genres).toEqual([]);
  });
});

describe("toTheatres", () => {
  const theatre = (id: number, name: string): RawTheatre => ({
    theatreId: id,
    theatreName: name,
    location: {
      geoLocation: { latitude: 43.6, longitude: -79.4 },
      city: "Toronto",
      provinceCode: "ON",
      distanceToOriginInMeters: 1200,
    },
  });

  /*
   * Three groups, and a theatre can sit in more than one: a favourite is plausibly also
   * nearby. Flattening without deduping shows it twice in the select
   */
  it("flattens the three groups and keeps each theatre once", () => {
    const result = toTheatres({
      favouriteTheatres: [theatre(1, "Yonge")],
      nearbyTheatres: [theatre(1, "Yonge"), theatre(2, "Queensway")],
      otherTheatres: [theatre(3, "Scarborough")],
    });
    expect(result.map((t) => t.id)).toEqual([1, 2, 3]);
  });

  /*
   * The duplicate resolves to the copy that knows the distance. Only the nearby group
   * carries one, so preferring the first occurrence would drop it for every theatre
   * that is also a favourite
   */
  it("prefers the group that carries a distance", () => {
    const favourite = theatre(1, "Yonge");
    favourite.location.distanceToOriginInMeters = null;
    const result = toTheatres({
      favouriteTheatres: [favourite],
      nearbyTheatres: [theatre(1, "Yonge")],
    });
    expect(result).toHaveLength(1);
    expect(result[0]?.distanceMeters).toBe(1200);
  });

  it("keeps a missing distance as null rather than zero", () => {
    const raw = theatre(4, "Somewhere");
    raw.location.distanceToOriginInMeters = null;
    // zero is a real distance, so it must not be what an absent one turns into
    expect(toTheatres({ otherTheatres: [raw] })[0]?.distanceMeters).toBeNull();
  });

  /*
   * Same argument, one property up. Zero is a real coordinate: coerced to it, a theatre with
   * no location sorts from the Gulf of Guinea and draws a confident 6600 km beside its name
   * instead of no distance at all
   */
  it("keeps an absent coordinate as null rather than zero", () => {
    const raw = theatre(5, "Nowhere");
    raw.location.geoLocation = null;
    expect(toTheatres({ otherTheatres: [raw] })[0]).toMatchObject({
      latitude: null,
      longitude: null,
    });
  });

  it("carries a real coordinate through untouched", () => {
    expect(toTheatres({ otherTheatres: [theatre(6, "Toronto")] })[0]).toMatchObject({
      latitude: 43.6,
      longitude: -79.4,
    });
  });
});

describe("narrowing extractors", () => {
  const feed: RawShowtimeTheatre[] = [
    {
      theatreId: 10,
      dates: [
        {
          movies: [
            { id: 1, experiences: [] },
            { id: 2, experiences: [] },
          ],
        },
      ],
    },
    { theatreId: 11, dates: [{ movies: [{ id: 2, experiences: [] }] }] },
  ];

  it("collects each film id once across theatres and dates", () => {
    expect(filmIdsFrom(feed)).toEqual([1, 2]);
  });

  it("collects each theatre id once", () => {
    expect(theatreIdsFrom(feed)).toEqual([10, 11]);
  });
});

describe("toSeatMap", () => {
  const seat = (id: string, column: number, label: string, type = "Standard") => ({
    id,
    column,
    label,
    type,
  });
  const row = (
    physicalNumber: number,
    label: string,
    seats: ReturnType<typeof seat>[],
  ): RawSeatRow => ({ number: 0, physicalNumber, label, seats });
  /*
   * `columnCount` defaults to the widest column the rows actually use, and `areaWidth` to the
   * same, which is what every standard area reports. Both are named where placement matters
   */
  const area = (
    top: number,
    rows: RawSeatRow[],
    extent: { left?: number; columnCount?: number; areaWidth?: number } = {},
  ): RawSeatArea => {
    const columnCount =
      extent.columnCount ??
      Math.max(0, ...rows.flatMap((r) => (r.seats ?? []).map((s) => s.column + 1)));
    return {
      left: extent.left ?? 0,
      top,
      // Equal to the seat count unless a case is about a block of wider chairs
      areaWidth: extent.areaWidth ?? columnCount,
      columnCount,
      rowCount: rows.length,
      rows,
    };
  };

  /*
   * Shaped after theatre 7249 Aud 12: a two-row D-BOX block lands on rows the standard area
   * holds open for it, so index 2 is a placeholder and index 1 is a real aisle
   */
  const layout: RawSeatLayout = {
    totalRows: 4,
    totalColumns: 6,
    standardSeats: area(
      0,
      [
        row(5, "AA", [seat("1_4_1", 0, "AA1"), seat("1_4_2", 2, "AA2", "Wheelchair")]),
        row(4, "", []),
        row(3, "", []),
        row(2, "B", [seat("1_2_1", 1, "B1"), seat("1_2_2", 3, "B2", "Companion")]),
      ],
      { columnCount: 6 },
    ),
    dboxSeats: area(2, [row(1, "C", [seat("2_1_1", 0, "C1")])], { left: 4, columnCount: 1 }),
  };

  const availability = {
    seatAvailabilities: {
      "1_4_1": "Available",
      "1_4_2": "Occupied",
      "1_2_1": "Available",
      "2_1_1": "Available",
    },
    isSoldOut: false,
  };

  it("joins availability onto the layout by seat id", () => {
    const map = toSeatMap(layout, availability);
    const seats = map.rows.flatMap((r) => r.seats);
    expect(seats.find((s) => s.id === "1_4_1")?.occupied).toBe(false);
    expect(seats.find((s) => s.id === "1_4_2")?.occupied).toBe(true);
  });

  /*
   * Not `=== "Occupied"`. Only two statuses have been observed, so a third one, or an
   * id the availability map simply omits, has to fail towards occupied: over-reporting
   * shows a free seat as taken, the other way round sells a seat that is gone
   */
  it("counts a seat missing from availability as occupied", () => {
    const map = toSeatMap(layout, availability);
    // "1_2_2" is in the layout and absent from the map above
    expect(map.rows.flatMap((r) => r.seats).find((s) => s.id === "1_2_2")?.occupied).toBe(true);
  });

  it("counts the totals from the joined seats", () => {
    const map = toSeatMap(layout, availability);
    expect(map.total).toBe(5);
    expect(map.occupied).toBe(2);
  });

  /*
   * `top` indexes `standardSeats.rows`, and the block lands **on** that row rather than in
   * front of it. Splicing left the placeholder standing as an 8px aisle beside the block it
   * was holding the space for, which is the gap a reader sees under every D-BOX row
   */
  it("merges a non-standard area into the row its top index names", () => {
    const map = toSeatMap(layout, availability);
    expect(map.rows.map((r) => r.label)).toEqual(["AA", null, "C", "B"]);
    // The placeholder is consumed rather than kept, so the block adds no row of its own
    expect(map.rows).toHaveLength(layout.standardSeats?.rows?.length ?? 0);
  });

  /*
   * Upstream never types a seat `Dbox`; the area it sits in is the only record of it
   * Reading `seat.type` alone paints every D-BOX seat as standard
   */
  it("takes D-BOX from the area and the accessible kinds from the seat", () => {
    const kinds = Object.fromEntries(
      toSeatMap(layout, availability)
        .rows.flatMap((r) => r.seats)
        .map((s) => [s.id, s.kind]),
    );
    expect(kinds["2_1_1"]).toBe("Dbox");
    expect(kinds["1_4_2"]).toBe("Wheelchair");
    expect(kinds["1_2_2"]).toBe("Companion");
    expect(kinds["1_4_1"]).toBe("Standard");
  });

  /*
   * Two non-standard areas. Each `top` indexes the standard list as the layout described it,
   * and an overlay never moves the rows a later one is measured against
   */
  it("places two overlay areas at the indices the layout named", () => {
    const twoAreas: RawSeatLayout = {
      totalRows: 6,
      totalColumns: 4,
      standardSeats: area(0, [
        row(6, "A", [seat("a", 0, "A1")]),
        row(5, "", []),
        row(4, "B", [seat("b", 0, "B1")]),
        row(3, "C", [seat("c", 0, "C1")]),
        row(2, "", []),
        row(1, "D", [seat("d", 0, "D1")]),
      ]),
      dboxSeats: area(1, [row(9, "DBX", [seat("x", 0, "X1")])]),
      balconySeats: area(4, [row(8, "BAL", [seat("y", 0, "Y1")])]),
    };
    /*
     * One availability entry per seat, which is what every measured auditorium returned.
     * An empty map against a layout that has seats is a failed join and now throws, so a
     * fixture that omitted them would fail this case for a reason that is not about rows
     */
    const map = toSeatMap(twoAreas, {
      seatAvailabilities: {
        a: "Available",
        b: "Available",
        c: "Available",
        d: "Occupied",
        x: "Available",
        y: "Available",
      },
      isSoldOut: false,
    });
    expect(map.rows.map((r) => r.label)).toEqual(["A", "DBX", "B", "C", "BAL", "D"]);
    // and the row counts still add up to what the layout declared
    expect(map.rows).toHaveLength(twoAreas.totalRows);
  });

  it("marks an aisle by having no seats and no label", () => {
    const aisle = toSeatMap(layout, availability).rows[1];
    expect(aisle?.seats).toEqual([]);
    expect(aisle?.label).toBeNull();
  });

  /*
   * Placement, against the numbers Scotiabank Theatre Toronto AVX #2 actually returned
   *
   * `totalColumns: 32`, and its D-BOX area reports `left: 6, columnCount: 16,
   * columnWidth: 1.25, areaWidth: 20, top: 18`. Every seat in the block arrives at an
   * area-local column starting from 0, and row O of the standard area holds the seven seats
   * at the walls that share the row with it: O1 to O4 at columns 0 to 3, O30 to O32 at 29
   * to 31. Trimmed to the load-bearing values; the full house is 22 rows
   */
  describe("a D-BOX block in a real mixed row", () => {
    const wall = (label: string, column: number) => seat(`w${column}`, column, label);
    const recliner = (index: number) => seat(`d${index}`, index, `O${index + 7}`);
    const block = Array.from({ length: 16 }, (_, index) => recliner(index));

    const scotiabank: RawSeatLayout = {
      totalRows: 22,
      totalColumns: 32,
      standardSeats: area(
        0,
        [
          row(5, "N", [wall("N1", 0), wall("N32", 31)]),
          row(4, "O", [
            wall("O1", 0),
            wall("O2", 1),
            wall("O3", 2),
            wall("O4", 3),
            wall("O30", 29),
            wall("O31", 30),
            wall("O32", 31),
          ]),
        ],
        { columnCount: 32 },
      ),
      dboxSeats: area(1, [row(2, "O", block)], { left: 6, columnCount: 16, areaWidth: 20 }),
    };
    const allAvailable = {
      seatAvailabilities: Object.fromEntries(
        [...block, ...(scotiabank.standardSeats?.rows ?? []).flatMap((r) => r.seats ?? [])].map(
          (s) => [s.id, "Available"],
        ),
      ),
      isSoldOut: false,
    };

    /*
     * `left` plus half the slack the wider chairs leave: the block covers 20 house columns
     * with 16 seats in it, so 16 cells centred on `6 + 20 / 2` start at column 8. Left at
     * the area's own numbering the block starts at 0 and collides with O1
     */
    it("offsets the block into the house's own columns", () => {
      const rowO = toSeatMap(scotiabank, allAvailable).rows[1];
      const columns = (rowO?.seats ?? []).filter((s) => s.kind === "Dbox").map((s) => s.column);
      expect(columns).toEqual([8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23]);
    });

    // A standard area reports left 0 and an areaWidth equal to its seat count, so it sits still
    it("leaves the standard seats where the layout put them", () => {
      const rowO = toSeatMap(scotiabank, allAvailable).rows[1];
      const columns = (rowO?.seats ?? []).filter((s) => s.kind === "Standard").map((s) => s.column);
      expect(columns).toEqual([0, 1, 2, 3, 29, 30, 31]);
    });

    /*
     * The two areas share one row, so an offset that is even slightly wrong puts two seats in
     * one grid cell and one of them is painted over
     */
    it("gives every seat in the merged row its own column, in reading order", () => {
      const rowO = toSeatMap(scotiabank, allAvailable).rows[1];
      const columns = (rowO?.seats ?? []).map((s) => s.column);
      expect(new Set(columns).size).toBe(columns.length);
      expect(columns).toEqual([...columns].sort((a, b) => a - b));
      expect(rowO?.seats).toHaveLength(23);
    });

    /*
     * `physicalNumber` restarts at 1 in every area, so the merged row keeps the standard
     * area's. That is also what stops a merged house holding two rows numbered the same
     */
    it("keeps the standard row's physical number through the merge", () => {
      expect(toSeatMap(scotiabank, allAvailable).rows[1]?.physicalNumber).toBe(4);
    });
  });

  /*
   * Odd slack, which is where the rounding earns its place
   *
   * Vaughan AVX #11: `left: 10, areaWidth: 14, columnCount: 11`, so the centred start is
   * 11.5. React writes `gridColumnStart` unitless, `grid-column-start: 11.5` is invalid, and
   * an invalid declaration takes the whole inline style with it: every seat in the block
   * would fall into auto-placement. The mixed-row fixture above has even slack and cannot
   * see this
   */
  it("rounds an offset that lands between columns", () => {
    const block = Array.from({ length: 11 }, (_, index) =>
      seat(`g${index}`, index, `G${index + 11}`),
    );
    const vaughan: RawSeatLayout = {
      totalRows: 16,
      totalColumns: 33,
      standardSeats: area(0, [row(4, "G", [seat("g-wall", 0, "G1")])], { columnCount: 33 }),
      dboxSeats: area(0, [row(2, "G", block)], { left: 10, columnCount: 11, areaWidth: 14 }),
    };
    const map = toSeatMap(vaughan, {
      seatAvailabilities: Object.fromEntries(
        [...block, { id: "g-wall" }].map((s) => [s.id, "Available"]),
      ),
      isSoldOut: false,
    });
    const columns = (map.rows[0]?.seats ?? [])
      .filter((s) => s.kind === "Dbox")
      .map((s) => s.column);
    expect(columns).toEqual([12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22]);
    for (const column of columns) expect(Number.isInteger(column)).toBe(true);
  });

  /*
   * `top` is clamped into the standard list, which the splice this replaced also did
   *
   * Unclamped, a negative one wraps: the block's first row lands past the back of the house
   * and its second merges into the front row, so the block is split and reversed
   */
  it.each([
    // `rows` is the count after projection: 3 when the block merged into standard rows that
    // already existed, 5 when it missed every one of them and was appended instead
    [-1, "floored to the front row", 3, 0],
    [1.4, "rounded to the row it is nearest", 3, 1],
    [99, "appended past the back row", 5, 3],
  ])("keeps an overlay whose top is %s in one piece (%s)", (top, _name, rowCount, firstDbox) => {
    /*
     * Two rows in the block, which is what makes the negative case visible: unfloored, index
     * 0 reads `rows[-1]`, misses, and is appended to the back, while index 1 reads `rows[0]`
     * and merges into the front row. One block, both ends of the auditorium, reversed
     *
     * A fractional top is real: upstream sends `18.0` rather than `18`, so a value that ever
     * arrived genuinely fractional would index nothing and quietly append instead of merging
     */
    const house: RawSeatLayout = {
      totalRows: 3,
      totalColumns: 4,
      standardSeats: area(0, [
        row(3, "A", [seat("a", 0, "A1")]),
        row(2, "B", [seat("b", 0, "B1")]),
        row(1, "C", [seat("c", 0, "C1")]),
      ]),
      dboxSeats: area(top, [
        row(2, "D", [seat("d1", 1, "D1")]),
        row(1, "E", [seat("d2", 1, "E1")]),
      ]),
    };
    const map = toSeatMap(house, {
      seatAvailabilities: {
        a: "Available",
        b: "Available",
        c: "Available",
        d1: "Available",
        d2: "Available",
      },
      isSoldOut: false,
    });
    // No seat lost, wherever it lands
    expect(map.total).toBe(5);
    expect(map.rows).toHaveLength(rowCount);

    // ...and the block's two rows stay next to each other, in the order the layout sent them
    const at = map.rows
      .map((r, index) => (r.seats.some((s) => s.kind === "Dbox") ? index : -1))
      .filter((index) => index >= 0);
    expect(at).toEqual([firstDbox, firstDbox + 1]);
    expect(map.rows[firstDbox]?.seats.map((s) => s.id)).toContain("d1");
  });

  // A column below zero is not a missing seat but a wrong one: negative grid lines are valid
  // CSS and count back from the end, so the block would be drawn at the far right
  it("never places a seat left of the first column", () => {
    const skewed: RawSeatLayout = {
      totalRows: 1,
      totalColumns: 8,
      standardSeats: area(0, [row(1, "", [])], { columnCount: 8 }),
      // areaWidth under columnCount, which upstream sends as an all-zero extent on an
      // unpopulated area and has never been seen on a populated one
      dboxSeats: area(0, [row(1, "A", [seat("a", 0, "A1")])], { columnCount: 6, areaWidth: 0 }),
    };
    const map = toSeatMap(skewed, {
      seatAvailabilities: { a: "Available" },
      isSoldOut: false,
    });
    expect(map.rows[0]?.seats[0]?.column).toBe(0);
  });

  /*
   * A 204 upstream reaches the projector as null on both halves, and that is the
   * "nothing matched" case rather than a failure
   */
  it("returns an empty map when the upstream had no content", () => {
    expect(toSeatMap(null, null)).toEqual({
      rows: [],
      totalColumns: 0,
      total: 0,
      occupied: 0,
      isSoldOut: false,
    });
  });

  /*
   * An availability map with nothing in it against a layout that has seats
   *
   * A seat absent from the map counts occupied, which is the right reading of one missing
   * id and the wrong reading of all of them: it turns "we could not tell" into a confident
   * sold-out house. The three shapes below all reach it, and `isSoldOut` is the only thing
   * upstream sends that separates a failed join from a house with nothing left to sell
   */
  describe("an empty availability map", () => {
    const oneSeat: RawSeatLayout = {
      totalRows: 1,
      totalColumns: 1,
      standardSeats: area(0, [row(1, "A", [seat("a", 0, "A1")])]),
    };

    it.each([
      ["an empty map", { seatAvailabilities: {}, isSoldOut: false }],
      ["a null map", { seatAvailabilities: null, isSoldOut: false }],
      ["no availability at all", null],
      /*
       * The one that emptiness alone would miss. A payload keyed for a different showtime
       * is not empty, misses on every id just the same, and draws the same red FULL house
       */
      [
        "a map keyed for another showtime",
        { seatAvailabilities: { zz: "Available" }, isSoldOut: false },
      ],
    ])("throws rather than reading %s as a full house", (_name, availability) => {
      expect(() => toSeatMap(oneSeat, availability)).toThrow(/seat availability was empty/);
    });

    // ...and one id it does answer for is enough to show the join worked, whatever the
    // rest of the map is missing
    it("renders when even one layout seat appears in the map", () => {
      const map = toSeatMap(oneSeat, { seatAvailabilities: { a: "Available" }, isSoldOut: false });
      expect(map).toMatchObject({ total: 1, occupied: 0 });
    });

    // ...unless upstream says so itself, which is the one case the reading is right for
    it("reads it as a full house when upstream says the screening is sold out", () => {
      const map = toSeatMap(oneSeat, { seatAvailabilities: {}, isSoldOut: true });
      expect(map).toMatchObject({ total: 1, occupied: 1, isSoldOut: true });
    });
  });
});

describe("empty upstream responses", () => {
  it("project to empty lists rather than throwing", () => {
    expect(toMovies(null)).toEqual([]);
    expect(toTheatres(null)).toEqual([]);
    expect(toSessions(null)).toEqual([]);
    expect(filmIdsFrom(null)).toEqual([]);
    expect(theatreIdsFrom(null)).toEqual([]);
  });
});
