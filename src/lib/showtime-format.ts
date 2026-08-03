/**
 * @fileoverview Showtime labels, formatted without ever building a Date from the value
 *
 * `showStartDateTime` is the theatre's wall clock and carries no offset, so
 * `new Date("2026-08-02T18:45:00")` parses it as the *viewer's* local time. A Vancouver
 * user browsing a Toronto theatre would then see a 7:10 PM show as 4:10 PM, which will
 * not match their ticket. Reading the fields off the string is what makes that
 * impossible rather than merely avoided
 */

import type { Session } from "@/lib/cineplex/types";

const WALL_CLOCK = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/;

/*
 * Written out rather than derived. Intl's short weekday gives "Tue" and "Thu", and the
 * forms wanted here are "Tues" and "Thurs"
 */
const WEEKDAYS = ["Sun", "Mon", "Tues", "Wed", "Thurs", "Fri", "Sat"] as const;
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

function parse(value: string): WallClock | null {
  const match = WALL_CLOCK.exec(value);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match;
  const at = {
    year: Number(year),
    month: Number(month),
    day: Number(day),
    hour: Number(hour),
    minute: Number(minute),
  };
  /*
   * The pattern matches two digits, which is not the same as a valid time. Hour 24 would
   * otherwise format as 12:00 PM on the wrong day, and month 13 would index past the
   * table and read "undefined". Out of range is unparseable, not silently wrong
   */
  const inRange =
    at.month >= 1 &&
    at.month <= 12 &&
    at.day >= 1 &&
    at.day <= 31 &&
    at.hour <= 23 &&
    at.minute <= 59;
  return inRange ? at : null;
}

/**
 * `Tues Jul 14`
 *
 * The weekday comes from `Date.UTC`, which is arithmetic on the numbers rather than a
 * reading of them, so no local zone can reach it
 */
export function formatDayLabel(value: string): string {
  const at = parse(value);
  if (!at) return "";
  const weekday = WEEKDAYS[new Date(Date.UTC(at.year, at.month - 1, at.day)).getUTCDay()];
  return `${weekday} ${MONTHS[at.month - 1]} ${at.day}`;
}

/** `7:10 PM`, with 0 and 12 both reading as 12 */
export function formatTimeLabel(value: string): string {
  const at = parse(value);
  if (!at) return "";
  const meridiem = at.hour < 12 ? "AM" : "PM";
  const hour = at.hour % 12 === 0 ? 12 : at.hour % 12;
  return `${hour}:${String(at.minute).padStart(2, "0")} ${meridiem}`;
}

/** The date part alone, which is what the day grouping keys on */
export function dayKey(value: string): string {
  return value.slice(0, 10);
}

/**
 * What one showtime reads as in the picker
 *
 * The time alone, unless another screening that day starts at the same minute. The
 * dedupe deliberately keeps two same-time sessions apart when they are genuinely
 * different screenings (two auditoriums, two formats), and rendering both as a bare
 * "7:10 PM" leaves the reader picking blind
 */
export function sessionOptionLabel(session: Session, withinDay: Session[]): string {
  const time = formatTimeLabel(session.start);
  const clashes = withinDay.filter((other) => other.start === session.start).length > 1;
  return clashes ? `${time} · ${session.auditorium}` : time;
}

/**
 * One day's screenings
 *
 * The array is called `items` because that is the key Base UI's combobox recognises: its
 * `isGroupedItems` test is `'items' in items[0]`, and under any other name the days are
 * filtered as if they were leaf items rather than unpacked. That is what made typing in
 * the picker empty the list, and it still would: `matchesDayQuery` below would be handed
 * day objects, whose `start` is undefined, so nothing would ever match
 */
export interface SessionDay {
  key: string;
  label: string;
  items: Session[];
}

/**
 * Whether a session belongs to a day the reader is searching for
 *
 * Matches the day label only. There are a dozen or more times per day and typing one is
 * no faster than reading down the list, so the search that earns its place is the one
 * that narrows a week to a date
 */
export function matchesDayQuery(session: Session, query: string): boolean {
  const wanted = query.trim().toLowerCase();
  if (wanted === "") return true;
  return formatDayLabel(session.start).toLowerCase().includes(wanted);
}

/**
 * When the seat map on screen last arrived
 *
 * The one function here that reads a `Date` in the viewer's own zone, and the only one that
 * should: this is their clock rather than a theatre's, so the local reading is the correct
 * one. Everything above takes an offsetless theatre string and must never resolve it that
 * way; `formatDayLabel` builds a `Date` too, but only through `Date.UTC` as arithmetic
 *
 * A wall-clock time rather than an age, so it stays true without being re-derived: a map
 * that stops refreshing goes on naming the last moment it did
 */
export function updatedAtLabel(atMs: number): string {
  const clock = new Date(atMs);
  const hours = clock.getHours();
  const meridiem = hours < 12 ? "AM" : "PM";
  const pad = (value: number) => String(value).padStart(2, "0");
  const hour = hours % 12 === 0 ? 12 : hours % 12;
  return `Updated since ${hour}:${pad(clock.getMinutes())}:${pad(clock.getSeconds())} ${meridiem}`;
}

/**
 * Sessions grouped into days, in the order they arrive
 *
 * Order is preserved rather than re-established here, because `toSessions` has already
 * sorted chronologically. It has to: the upstream stream is grouped by experience, not
 * by time, so the order this receives is only correct because something upstream made
 * it so
 */
export function groupSessionsByDay(sessions: Session[]): SessionDay[] {
  const days = new Map<string, SessionDay>();
  for (const session of sessions) {
    const key = dayKey(session.start);
    const day = days.get(key);
    if (day) day.items.push(session);
    else days.set(key, { key, label: formatDayLabel(session.start), items: [session] });
  }
  return [...days.values()];
}
