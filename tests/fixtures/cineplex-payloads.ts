/**
 * @fileoverview Deterministic stand-ins for the six API routes, shaped after real
 * responses
 *
 * The e2e suite serves these through `page.route()` rather than calling Cineplex. Three
 * reasons, in order: the preview server has no API key by design, real showtimes change
 * every day so no assertion about them could be stable, and pointing the suite at a
 * third-party API would send it real traffic on every run
 *
 * The house below is small but not simple. It carries an aisle, a wheelchair space, a
 * companion seat, a D-BOX row spliced in behind the standard rows, occupied seats, and
 * a front third that is deliberately not the only place with seats free
 */

export const theatres = [
  {
    id: 7249,
    name: "Galaxy Cinemas Barrie",
    city: "Barrie",
    province: "ON",
    latitude: 44.325548,
    longitude: -79.685753,
    distanceMeters: null,
  },
  {
    id: 7400,
    name: "Scotiabank Theatre Toronto",
    city: "Toronto",
    province: "ON",
    latitude: 43.6455,
    longitude: -79.3903,
    distanceMeters: null,
  },
];

export const movies = [
  {
    id: 37997,
    name: "Spider-Man: Brand New Day",
    runtimeInMinutes: 145,
    genres: ["Action", "Adventure"],
    releaseDate: "2026-07-31T00:00:00",
    posterUrl: null,
    isNowPlaying: true,
    isComingSoon: false,
  },
  {
    id: 41111,
    name: "A Quiet Matinee",
    runtimeInMinutes: 96,
    genres: ["Drama"],
    releaseDate: "2026-05-02T00:00:00",
    posterUrl: null,
    isNowPlaying: true,
    isComingSoon: false,
  },
];

/** Two days, so the showtime select has more than one group to render */
export const sessions = [
  {
    sessionId: 326227,
    auditorium: "Aud 12",
    start: "2026-08-02T18:45:00",
    experiences: ["3D", "D-BOX"],
    seatsRemaining: 12,
    isSoldOut: false,
  },
  {
    sessionId: 326228,
    auditorium: "Aud 12",
    start: "2026-08-02T21:30:00",
    experiences: ["Regular"],
    seatsRemaining: 40,
    isSoldOut: false,
  },
  {
    sessionId: 326301,
    auditorium: "IMAX #1",
    start: "2026-08-03T13:15:00",
    experiences: ["IMAX"],
    seatsRemaining: 80,
    isSoldOut: false,
  },
];

const seat = (id: string, column: number, label: string, kind: string, occupied: boolean) => ({
  id,
  label,
  column,
  kind,
  occupied,
});

export const seatMap = {
  rows: [
    {
      label: "AA",
      physicalNumber: 4,
      seats: [
        seat("1_4_1", 0, "AA1", "Standard", false),
        seat("1_4_2", 1, "AA2", "Wheelchair", false),
        seat("1_4_3", 2, "AA3", "Companion", false),
        seat("1_4_4", 4, "AA4", "Standard", true),
      ],
    },
    // an aisle, which must render as a gap and announce nothing
    { label: null, physicalNumber: 3, seats: [] },
    {
      label: "B",
      physicalNumber: 2,
      seats: [
        seat("1_2_1", 0, "B1", "Standard", false),
        seat("1_2_2", 1, "B2", "Standard", true),
        seat("1_2_3", 2, "B3", "Standard", false),
        seat("1_2_4", 3, "B4", "Standard", false),
      ],
    },
    {
      label: "C",
      physicalNumber: 1,
      seats: [seat("2_1_1", 1, "C1", "Dbox", false), seat("2_1_2", 2, "C2", "Dbox", true)],
    },
  ],
  totalColumns: 5,
  total: 10,
  occupied: 3,
  isSoldOut: false,
};

/** The pair with nothing playing, which has to read as an empty state and not an error */
export const emptySessions: typeof sessions = [];
