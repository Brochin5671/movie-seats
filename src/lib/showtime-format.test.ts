import { describe, expect, it } from "vitest";
import type { Session } from "@/lib/cineplex/types";
import {
  dayKey,
  formatDayLabel,
  formatTimeLabel,
  groupSessionsByDay,
  matchesDayQuery,
  updatedAtLabel,
} from "./showtime-format";

/*
 * The point of this module is that it never builds a Date from the value
 *
 * An offsetless string cannot prove that on its own: ES parses one as local time, so it
 * round-trips identically in every zone and a naive `new Date(v).toLocaleTimeString()`
 * agrees with the correct answer everywhere. The offset-bearing pairs below are the
 * guard, and they come in opposite signs on purpose, so no single zone can satisfy both
 * halves. Vitest pins no timezone, and a zone-dependent guard is worse than none: it
 * goes green on CI and red only on somebody's laptop
 */

describe("formatDayLabel", () => {
  it.each([
    ["2026-08-02T18:45:00", "Sun Aug 2"],
    ["2025-07-14T19:10:00", "Mon Jul 14"],
    ["2026-08-02T23:10:00", "Sun Aug 2"],
    ["2026-08-02T00:30:00", "Sun Aug 2"],
    ["2026-01-01T12:00:00", "Thurs Jan 1"],
    ["2026-12-31T23:59:00", "Thurs Dec 31"],
  ])("%s reads %s", (value, expected) => {
    expect(formatDayLabel(value)).toBe(expected);
  });

  // The forms this site uses, which Intl does not produce: it gives Tue and Thu
  it("uses the four-letter weekday abbreviations, not Intl's three", () => {
    expect(formatDayLabel("2026-08-04T10:00:00")).toBe("Tues Aug 4");
    expect(formatDayLabel("2026-08-06T10:00:00")).toBe("Thurs Aug 6");
  });
});

describe("formatTimeLabel", () => {
  it.each([
    ["2026-08-02T19:10:00", "7:10 PM"],
    ["2026-08-02T23:10:00", "11:10 PM"],
    ["2026-08-02T00:00:00", "12:00 AM"],
    ["2026-08-02T12:00:00", "12:00 PM"],
    ["2026-08-02T00:05:00", "12:05 AM"],
    ["2026-08-02T09:00:00", "9:00 AM"],
  ])("%s reads %s", (value, expected) => {
    expect(formatTimeLabel(value)).toBe(expected);
  });
});

/*
 * An offset-bearing string is not what upstream sends, but it is what somebody will
 * paste in while debugging. The wall clock as written is still the right answer, and a
 * Date-based implementation would shift it
 */
describe("a value that carries an offset", () => {
  /*
   * Both signs. A Date-based reading shifts one way for a negative offset and the other
   * way for a positive one, so a pair like this has no zone in which both survive
   */
  it.each([
    ["2026-08-02T19:10:00-04:00", "7:10 PM"],
    ["2026-08-02T19:10:00+04:00", "7:10 PM"],
    ["2026-08-02T19:10:00Z", "7:10 PM"],
  ])("%s still reads its own wall clock as %s", (value, expected) => {
    expect(formatTimeLabel(value)).toBe(expected);
  });

  it.each([
    ["2026-08-02T23:10:00-11:00", "Sun Aug 2"],
    ["2026-08-02T01:10:00+13:00", "Sun Aug 2"],
  ])("%s still reads its own calendar day as %s", (value, expected) => {
    expect(formatDayLabel(value)).toBe(expected);
  });
});

describe("unparseable input", () => {
  it("reads empty rather than NaN", () => {
    expect(formatDayLabel("")).toBe("");
    expect(formatTimeLabel("not a date")).toBe("");
  });

  /*
   * Two digits is not the same as a valid value. Hour 24 formatted as "12:00 PM" on the
   * wrong day, and month 13 indexed past the month table and read "undefined": both are
   * worse than reading empty, because they look like answers
   */
  it.each([
    ["2026-08-02T24:00:00", "hour 24"],
    ["2026-08-02T25:30:00", "hour 25"],
    ["2026-13-02T10:00:00", "month 13"],
    ["2026-08-32T10:00:00", "day 32"],
    ["2026-08-02T10:60:00", "minute 60"],
  ])("rejects %s (%s) rather than guessing", (value) => {
    expect(formatTimeLabel(value)).toBe("");
    expect(formatDayLabel(value)).toBe("");
  });
});

describe("groupSessionsByDay", () => {
  const session = (id: number, start: string): Session => ({
    sessionId: id,
    auditorium: "Aud 1",
    start,
    experiences: [],
    seatsRemaining: 10,
    isSoldOut: false,
  });

  it("groups by calendar day and labels each group", () => {
    const days = groupSessionsByDay([
      session(1, "2026-08-02T19:10:00"),
      session(2, "2026-08-02T21:45:00"),
      session(3, "2026-08-03T13:30:00"),
    ]);
    expect(days.map((d) => d.label)).toEqual(["Sun Aug 2", "Mon Aug 3"]);
    expect(days.map((d) => d.items.length)).toEqual([2, 1]);
  });

  /*
   * Upstream order is already chronological, and this module has deliberately not
   * parsed the value into anything comparable, so preserving order beats re-sorting
   */
  it("preserves the order it was given", () => {
    const days = groupSessionsByDay([
      session(1, "2026-08-02T21:45:00"),
      session(2, "2026-08-02T19:10:00"),
    ]);
    expect(days[0]?.items.map((s) => s.sessionId)).toEqual([1, 2]);
  });

  it("keys on the date part alone", () => {
    expect(dayKey("2026-08-02T19:10:00")).toBe("2026-08-02");
  });
});

/*
 * The search the picker actually needs
 *
 * A week of screenings is a dozen times a day, so typing a time is no faster than reading
 * the list. Typing a date is what narrows it, and matching only the day label is what
 * makes that true
 */
describe("matchesDayQuery", () => {
  const on = (start: string): Session => ({
    sessionId: 1,
    auditorium: "Aud 1",
    start,
    experiences: [],
    seatsRemaining: 10,
    isSoldOut: false,
  });
  const aug2 = on("2026-08-02T18:45:00");
  const aug3 = on("2026-08-03T18:45:00");

  it("matches the day the session falls on", () => {
    expect(matchesDayQuery(aug3, "Aug 3")).toBe(true);
  });

  /*
   * The case that a `return true` would survive, and the reason the two above and below
   * are not enough on their own: one constant satisfies each of them separately
   */
  it("does not match a different day", () => {
    expect(matchesDayQuery(aug2, "Aug 3")).toBe(false);
  });

  it("does not match a time, which is what the search is not for", () => {
    expect(matchesDayQuery(aug3, "6:45")).toBe(false);
  });

  it("ignores case and surrounding space, since a reader types neither carefully", () => {
    expect(matchesDayQuery(aug3, "  mon aug 3 ")).toBe(true);
  });

  // An empty query is not a filter; Base UI skips it anyway, but a false here would
  // empty the list on the way back from a cleared search
  it("matches everything on an empty query", () => {
    expect(matchesDayQuery(aug2, "")).toBe(true);
  });
});

/*
 * The two things that break a twelve-hour clock: `% 12` reading midnight and noon as 0,
 * and an unpadded minute or second. Local time throughout, which is correct here and the
 * opposite of every case above, so the fixtures are built with the local constructor
 * rather than parsed from a string
 */
describe("updatedAtLabel", () => {
  const at = (hours: number, minutes: number, seconds: number) =>
    new Date(2026, 7, 2, hours, minutes, seconds).getTime();

  it.each([
    [at(14, 3, 22), "Updated since 2:03:22 PM"],
    [at(0, 0, 0), "Updated since 12:00:00 AM"],
    [at(12, 0, 0), "Updated since 12:00:00 PM"],
    [at(11, 59, 59), "Updated since 11:59:59 AM"],
    [at(9, 5, 7), "Updated since 9:05:07 AM"],
  ])("reads as %s", (value, expected) => {
    expect(updatedAtLabel(value)).toBe(expected);
  });
});
