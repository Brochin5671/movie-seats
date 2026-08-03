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
  const area = (top: number, rows: RawSeatRow[]): RawSeatArea => ({
    top,
    rowCount: rows.length,
    rows,
  });

  const layout: RawSeatLayout = {
    totalRows: 4,
    totalColumns: 6,
    standardSeats: area(0, [
      row(4, "AA", [seat("1_4_1", 0, "AA1"), seat("1_4_2", 2, "AA2", "Wheelchair")]),
      row(3, "", []),
      row(2, "B", [seat("1_2_1", 1, "B1"), seat("1_2_2", 3, "B2", "Companion")]),
    ]),
    dboxSeats: area(2, [row(1, "C", [seat("2_1_1", 4, "C1")])]),
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
   * `top` is a row index, so the D-BOX block splices into the standard list rather than
   * appending. Read as a pixel offset the rows come out in the wrong order, which puts
   * the screen at the wrong end of the map
   */
  it("splices a non-standard area in at its top index", () => {
    const map = toSeatMap(layout, availability);
    expect(map.rows.map((r) => r.label)).toEqual(["AA", null, "C", "B"]);
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
   * Two non-standard areas, which is where a naive splice goes wrong: inserting the
   * D-BOX block first shifts every index the balcony's `top` was measured against, so
   * the balcony lands `dbox.rowCount` rows too close to the screen
   */
  it("places two spliced areas at the indices the layout named", () => {
    const twoAreas: RawSeatLayout = {
      totalRows: 6,
      totalColumns: 4,
      standardSeats: area(0, [
        row(4, "A", [seat("a", 0, "A1")]),
        row(3, "B", [seat("b", 0, "B1")]),
        row(2, "C", [seat("c", 0, "C1")]),
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
    expect(map.rows.map((r) => r.label)).toEqual(["A", "DBX", "B", "C", "D", "BAL"]);
    // and the row counts still add up to what the layout declared
    expect(map.rows).toHaveLength(twoAreas.totalRows);
  });

  it("marks an aisle by having no seats and no label", () => {
    const aisle = toSeatMap(layout, availability).rows[1];
    expect(aisle?.seats).toEqual([]);
    expect(aisle?.label).toBeNull();
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
