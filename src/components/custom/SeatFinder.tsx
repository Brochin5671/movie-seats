"use client";

/**
 * @fileoverview The whole page as one island
 *
 * Every visible region is a projection of the same three selections, so splitting this
 * would mean a shared store and a hydration cost per island. The children are separated
 * for testing, not for hydration
 *
 * Two invariants run through it, both written as state rather than inferred. A selection
 * commits one render before the effect that acts on it, so anything derived from the
 * selection alone is wrong for that frame: `seatsForSession` and `sessionsForPair` record
 * what the data on hand actually belongs to, and every gate reads those
 */

import { SearchIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/elements/Alert";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/elements/Empty";
import { Skeleton } from "@/components/elements/Skeleton";
import {
  Combobox,
  ComboboxCollection,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxLabel,
  ComboboxList,
} from "@/components/forms/Combobox";
import { Field, FieldLabel } from "@/components/forms/Field";
import { Stack } from "@/components/layouts/Stack";
import { useMediaQuery } from "@/hooks/use-media-query";
import type { Movie, SeatMap as SeatMapData, Session, Theatre } from "@/lib/cineplex/types";
import { ApiError, api, isAbortError } from "@/lib/cineplex-client";
import { optimalSeatIds } from "@/lib/seating";
import {
  groupSessionsByDay,
  matchesDayQuery,
  sessionOptionLabel,
  updatedAtLabel,
} from "@/lib/showtime-format";
import {
  formatDistance,
  type Point,
  sortByDistance,
  theatreDistanceKm,
} from "@/lib/theatre-distance";
import { CapacityMeter } from "./CapacityMeter";
import { SeatLegend } from "./SeatLegend";
import { SeatMap } from "./SeatMap";
import { ShowtimeCard } from "./ShowtimeCard";

/**
 * Run a request, and ignore its result if the selection moved on
 *
 * Two guards for two windows: aborting cancels a request in flight, and the `aborted`
 * check after each await covers a response that settled before React re-ran the effect,
 * since aborting does not unqueue a continuation the settled promise already scheduled
 */
function useAbortableEffect(run: (signal: AbortSignal) => Promise<void>, deps: unknown[]) {
  useEffect(() => {
    const controller = new AbortController();
    /*
     * `void`, not a `.catch`: every caller handles its own failures in a `try`, so only a
     * bug reaches here and a bug belongs on a global channel. `.catch(console.error)` was
     * measured and rejected, exiting 0 without the default reporter even printing it.
     * Neither is as loud as the sync throw this replaced, which failed the provoking test
     * by name, and `void` drops the error if it settles after the file's last test
     */
    void run(controller.signal);
    return () => controller.abort();
  }, deps);
}

/**
 * Whether `active` has been true for longer than `delayMs`
 *
 * Both routes are cached server-side, so a warm request settles in tens of milliseconds
 * and a placeholder painted for that long reads as a glitch. Delaying only the visible
 * part means the common path shows nothing while a genuinely slow one still explains
 * itself. 250ms is Nielsen's 0.1s limit: past it an action has stopped feeling
 * instantaneous, which is the earliest a placeholder is honest
 */
function useDelayedFlag(active: boolean, delayMs: number) {
  const [elapsed, setElapsed] = useState(false);
  useEffect(() => {
    if (!active) {
      setElapsed(false);
      return;
    }
    const timer = setTimeout(() => setElapsed(true), delayMs);
    return () => clearTimeout(timer);
  }, [active, delayMs]);
  return elapsed;
}

/**
 * Options for the one position request this page makes
 *
 * High accuracy off: a theatre list sorts at kilometre scale, and GPS costs battery and
 * seconds to answer a question a cell fix already answers. `maximumAge` accepts a fix up to
 * five minutes old, since nobody moves between theatres inside one visit
 *
 * The timeout is a chosen bound rather than a measured one, and has to be set at all because
 * the spec's default is `Infinity`: without it a request that never resolves never ends
 */
const POSITION_OPTIONS: PositionOptions = {
  enableHighAccuracy: false,
  timeout: 10_000,
  maximumAge: 300_000,
};

/**
 * The reader's position, asked for once when the island mounts
 *
 * Nearest-first is the default rather than something to press for, so this runs on mount and
 * there is no control. The cost, taken deliberately: a denial has no retry affordance on the
 * page, and recovering means the browser's own site settings
 *
 * Failure is silent. Nothing moved, so there is nothing to announce, and a reader who just
 * refused the prompt does not need telling what they did
 *
 * Once only. A repeat on any later event would put an auto-updating region under SC 2.2.2,
 * which this is outside of precisely because it fires a single time after hydration
 *
 * `navigator.geolocation` is read for truthiness rather than with `in`: happy-dom defines the
 * property as null, so the key is present and dereferencing it throws
 */
function useGeolocation(): Point | null {
  const [origin, setOrigin] = useState<Point | null>(null);

  useEffect(() => {
    if (!navigator.geolocation) return;
    let current = true;
    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (!current) return;
        setOrigin({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });
      },
      // Denied, unavailable or timed out all mean the same thing here: no reordering
      () => {},
      POSITION_OPTIONS,
    );
    return () => {
      current = false;
    };
  }, []);

  return origin;
}

const errorMessage = (error: unknown) =>
  error instanceof ApiError ? error.message : "Something went wrong loading showtime data.";

/** Identifies the pair a showtime list belongs to, so a stale list cannot pass for a new one */
const pairKey = (theatre: Theatre, movie: Movie) => `${theatre.id}:${movie.id}`;

/** Long enough that a warm cache never paints one, short enough to beat a slow network */
export const SKELETON_DELAY_MS = 250;

/**
 * How often the map refetches on its own
 *
 * 2 of the 30 requests a minute the seats bucket allows one address, so about fifteen idle
 * tabs fit behind an IPv6 /64, which the limiter collapses to one counter. The control below
 * is the other spender: at its cooldown a reader pressing steadily adds 6 a minute, so a
 * worst-case tab is 8 and only three of those fit. Above the availability TTL too, so no
 * refetch is handed an entry it already holds, which `SeatFinder.test.tsx` pins against `TTL`
 */
export const SEAT_REFRESH_MS = 30_000;

/**
 * The floor on how often the refresh control may reach the server
 *
 * The availability TTL, in milliseconds. A second press inside that window is answered from
 * the Worker's own cache with the bytes already on screen, so it spends a request from the
 * bucket and shows nothing new. Written out rather than imported, because `TTL` lives in a
 * module that reaches `astro:env/server` and importing it here would pull server code into
 * the browser bundle; `SeatFinder.test.tsx` holds the two together instead
 */
export const MANUAL_REFRESH_COOLDOWN_MS = 10_000;

/**
 * How long an attempt may stay in flight before it is given up on
 *
 * Half an interval, so a stalled request costs the tick it started on and not the one
 * after as well. Nothing else bounds a browser fetch that hangs: the timeout in
 * `cached-fetch` is on the Worker's call to Cineplex, not on the browser's call to us
 */
export const REFRESH_ABANDON_MS = SEAT_REFRESH_MS / 2;

/**
 * How long to sit out after a 429 when the response carried no `Retry-After`
 *
 * A fallback, not a copy of the limiter's window: `ApiError.retryAfterMs` carries the real
 * one, so this applies only to a 429 from something other than our own limiter
 */
const RATE_LIMIT_FALLBACK_PAUSE_MS = 60_000;

/**
 * The longest a 429 may suppress refreshing
 *
 * Wall clock, not a multiple of the interval: what bounds this is how long a reader will sit
 * in front of a map that has stopped moving, and that does not change when the interval
 * does. Past five minutes a held refresh is indistinguishable from the page having broken
 */
export const RATE_LIMIT_MAX_PAUSE_MS = 5 * 60_000;

export function SeatFinder() {
  const [theatres, setTheatres] = useState<Theatre[] | null>(null);
  const [movies, setMovies] = useState<Movie[] | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const origin = useGeolocation();
  const [theatreListOpen, setTheatreListOpen] = useState(false);
  /*
   * The position, held back until the theatre list is closed
   *
   * Base UI tracks the highlighted option as a plain index and its `aria-activedescendant`
   * is built from that index, so reordering an open list moves the highlight onto a
   * different theatre while the id it reports stays byte-identical: nothing announces, and
   * the next Enter selects somewhere the reader never aimed at. The reorder is worth having
   * and the reader looking at the list is worth not disturbing, so it waits for the close
   */
  const [sortOrigin, setSortOrigin] = useState<Point | null>(null);
  useEffect(() => {
    if (!theatreListOpen) setSortOrigin(origin);
  }, [origin, theatreListOpen]);

  const [theatre, setTheatre] = useState<Theatre | null>(null);
  const [movie, setMovie] = useState<Movie | null>(null);
  const [session, setSession] = useState<Session | null>(null);

  const [allowedFilmIds, setAllowedFilmIds] = useState<Set<number> | null>(null);
  const [allowedTheatreIds, setAllowedTheatreIds] = useState<Set<number> | null>(null);

  const [sessions, setSessions] = useState<Session[] | null>(null);
  /*
   * Which pair `sessions` holds times for, written in the same batch as the times. Same
   * reason as `seatsForSession`: choosing a new movie commits before the effect that clears
   * the list, so for one frame the previous pair's times are listed and selectable
   */
  const [sessionsForPair, setSessionsForPair] = useState<string | null>(null);
  // Like `seatsForSession`, the frame it guards is one commit wide and no wait in the
  // component tier can land inside it. Deliberately uncovered, not covered by proxy
  const [sessionsPending, setSessionsPending] = useState(false);
  const [seats, setSeats] = useState<SeatMapData | null>(null);
  /*
   * Which showtime `seats` holds the map for. State rather than a ref, written in the same
   * batch as `seats`, so no render can read one without the other
   *
   * The gap it closes: `chooseSession` only sets `session`, and the effect that clears the
   * map runs after that render commits, so for one frame the card names the new showtime
   * over the old one's map, meter and scroll target. That frame is one commit wide and no
   * wait in the component tier lands in it: deliberately uncovered, not covered by proxy
   */
  const [seatsForSession, setSeatsForSession] = useState<number | null>(null);
  const [seatsPending, setSeatsPending] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [freshness, setFreshness] = useState<string | null>(null);
  /*
   * When refreshing may resume, or 0 for none. State, so the control un-dims itself and the
   * lapse timer re-arms on a longer hold; mirrored into a ref because the interval callback
   * is installed once per selection and would close over a stale copy. Adding it to that
   * effect's deps instead is not an option: setting a hold would re-run the effect and its
   * cleanup would abort the request the press had just started
   */
  const [heldUntil, setHeldUntil] = useState(0);

  const booting = theatres === null && movies === null && bootError === null;

  const seatMapRef = useRef<HTMLDivElement>(null);
  /** The showtime a swap armed a scroll for, spent when that showtime's seats render */
  const scrollToSession = useRef<number | null>(null);
  /** How full the house was when this map arrived, the baseline the sr-only count reads */
  const occupiedOnArrival = useRef(0);
  /*
   * Nothing may refresh before this, whether a tick or a press. Outlives a selection on
   * purpose, since the bucket is keyed per address rather than per showtime
   */
  const heldUntilRef = useRef(0);
  /** The one refresh allowed in flight, so a press and a tick cannot both be out */
  const refreshAttempt = useRef<AbortController | null>(null);
  const prefersReducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");

  // Both catalogues load unfiltered, so either select can be used first
  useAbortableEffect(async (signal) => {
    try {
      const [loadedTheatres, loadedMovies] = await Promise.all([
        api.theatres(signal),
        api.movies(signal),
      ]);
      if (signal.aborted) return;
      setTheatres(loadedTheatres);
      setMovies(loadedMovies);
    } catch (error) {
      if (isAbortError(error) || signal.aborted) return;
      // Cleared so the pending marker cannot outlive the request. Under the e2e
      // harness the key is stripped, so this is the only path that ever runs
      setTheatres([]);
      setMovies([]);
      setBootError(errorMessage(error));
    }
  }, []);

  // Picking a theatre narrows the movie list. Cheap, and it genuinely narrows
  useAbortableEffect(
    async (signal) => {
      if (!theatre) {
        setAllowedFilmIds(null);
        return;
      }
      try {
        const result = await api.moviesAtTheatre(theatre.id, signal);
        if (signal.aborted) return;
        setAllowedFilmIds(new Set(result.filmIds));
      } catch (error) {
        // A failed narrowing leaves the full list rather than an empty one: showing
        // everything is a smaller lie than showing nothing
        if (!isAbortError(error) && !signal.aborted) setAllowedFilmIds(null);
      }
    },
    [theatre],
  );

  /*
   * ...and picking a movie narrows the theatres. Only on an actual selection, never
   * prefetched: this is the film-wide upstream call, and for a wide release it eliminates
   * about three theatres out of 152
   */
  useAbortableEffect(
    async (signal) => {
      if (!movie) {
        setAllowedTheatreIds(null);
        return;
      }
      try {
        const result = await api.theatresForMovie(movie.id, signal);
        if (signal.aborted) return;
        setAllowedTheatreIds(new Set(result.theatreIds));
      } catch (error) {
        if (!isAbortError(error) && !signal.aborted) setAllowedTheatreIds(null);
      }
    },
    [movie],
  );

  // Showtimes need both, which is the same rule the API enforces at its boundary
  useAbortableEffect(
    async (signal) => {
      if (!theatre || !movie) {
        setSessions(null);
        setSessionsForPair(null);
        setSessionsPending(false);
        return;
      }
      /*
       * Cleared before the request, not after it. Left in place, the previous pair's
       * times stay listed and selectable while the new ones load, and choosing one
       * renders the new movie's title over the old screening, down to its booking link
       */
      const pair = pairKey(theatre, movie);
      setSessions(null);
      setSessionsForPair(null);
      setSession(null);
      setSessionsPending(true);
      setDetailError(null);
      try {
        const result = await api.showtimes(theatre.id, movie.id, signal);
        if (signal.aborted) return;
        setSessions(result);
        setSessionsForPair(pair);
      } catch (error) {
        if (isAbortError(error) || signal.aborted) return;
        setSessions([]);
        setSessionsForPair(pair);
        setDetailError(errorMessage(error));
      } finally {
        // In `finally`, so the error path clears it too. A pending marker left
        // standing blocks the hydration wait in every e2e spec, not just this one
        if (!signal.aborted) setSessionsPending(false);
      }
    },
    [theatre, movie],
  );

  /** Hold refreshing off for `ms`, keeping whichever deadline is further out */
  const holdRefresh = (ms: number) => {
    heldUntilRef.current = Math.max(heldUntilRef.current, Date.now() + ms);
    setHeldUntil(heldUntilRef.current);
  };

  /*
   * Drop the hold once its deadline has passed, and never before
   *
   * Guarded on the clock rather than just clearing, because more than one thing calls this
   * and they can land in the same batch: a release queued by a lapsing cooldown would
   * otherwise, applied after a 429 set a fresh hold, re-open a control the limiter closed
   */
  const releaseHoldIfLapsed = () => {
    if (Date.now() < heldUntilRef.current) return;
    heldUntilRef.current = 0;
    setHeldUntil(0);
  };
  const refreshHeld = heldUntil > 0;

  /*
   * Sit out the window the limiter asked for, read off its own `Retry-After` rather than a
   * copy of the period kept here. Both the timer and the reader's picks feed it, since the
   * bucket counts per address and does not care which made the request
   *
   * Clamped, because the window is whatever an intermediary put in a header: Cloudflare
   * mitigations run to a day, and the hold outlives the selection, so one such answer would
   * disable refresh for the rest of the page's life
   */
  const holdIfRateLimited = (error: unknown) => {
    if (!(error instanceof ApiError) || error.status !== 429) return;
    const asked = error.retryAfterMs ?? RATE_LIMIT_FALLBACK_PAUSE_MS;
    holdRefresh(Math.min(asked, RATE_LIMIT_MAX_PAUSE_MS));
  };

  /** Every field that describes the map on screen, so none can outlive the others */
  const clearSeats = () => {
    setSeats(null);
    setSeatsForSession(null);
    setFreshness(null);
    occupiedOnArrival.current = 0;
  };

  useAbortableEffect(
    async (signal) => {
      if (!theatre || !session) {
        clearSeats();
        setSeatsPending(false);
        return;
      }
      // Cleared here too: only the sessions effect used to reset it, so a failed seat
      // load left its alert on screen over the next showtime that loaded fine
      setDetailError(null);
      setSeatsPending(true);
      try {
        const result = await api.seats(theatre.id, session.sessionId, signal);
        if (signal.aborted) return;
        setSeats(result);
        setSeatsForSession(session.sessionId);
        occupiedOnArrival.current = result.occupied;
        setFreshness(updatedAtLabel(Date.now()));
      } catch (error) {
        if (isAbortError(error) || signal.aborted) return;
        clearSeats();
        // Same reasoning as the refresh path below: a showtime left selected over a
        // cleared map cannot be re-picked, because Base UI fires no change for an equal
        // value. The clear button is still a way out; this saves the reader finding it
        if (error instanceof ApiError && error.status === 404) setSession(null);
        setDetailError(errorMessage(error));
        /*
         * A pick the reader made always goes out, even while paused, because refusing
         * silently would leave them with nothing and no reason. It still records the
         * pause, so the timer stops rather than spending the rest of the budget
         */
        holdIfRateLimited(error);
      } finally {
        if (!signal.aborted) setSeatsPending(false);
      }
    },
    [theatre, session],
  );

  /*
   * The same request the selection made, with none of its side effects
   *
   * Shared by the timer and the control, so the two cannot both be in flight and a press
   * counts against the same hold a 429 sets. The selection is a parameter rather than read
   * from state, so the interval hands it the pair its own effect run captured
   *
   * Touches nothing but the data: no `seatsPending`, so no skeleton and no `data-pending`
   * recurring on a timer to stall every e2e spec; no `detailError`, so a blip leaves the
   * last good map up rather than an alert; no scroll
   */
  const refreshSeats = async (forTheatre: Theatre, forSession: Session) => {
    // Here rather than with the timer's other guards, because a press comes through this
    // function too and would otherwise start a second attempt, overwrite the slot, and
    // leave the first unreachable by the cleanup that aborts it
    if (refreshAttempt.current) return;
    const attempt = new AbortController();
    refreshAttempt.current = attempt;
    /*
     * Freed here as well as aborted. Aborting frees the slot only by way of the rejection
     * reaching `finally`, and a request that ignores its signal never settles at all: one
     * such fetch would hold the only slot for the life of the page, with every later tick
     * and press returning early and nothing to say so
     */
    const abandonTimer = setTimeout(() => {
      attempt.abort();
      if (refreshAttempt.current === attempt) refreshAttempt.current = null;
    }, REFRESH_ABANDON_MS);
    try {
      const result = await api.seats(forTheatre.id, forSession.sessionId, attempt.signal);
      // Aborting does not un-schedule a continuation that already settled, so without
      // this a refresh for the previous showtime lands under the new one's card
      if (attempt.signal.aborted) return;
      setSeats(result);
      // `occupiedOnArrival` deliberately not restamped: it is the baseline the sr-only
      // count is measured from, and moving it here silences that region for good
      setFreshness(updatedAtLabel(Date.now()));
    } catch (error) {
      if (isAbortError(error) || attempt.signal.aborted) return;
      // A 404 is the one answer that is not a blip: the showtime has stopped existing and
      // the map is a claim about nothing. Everything else is swallowed, so a transient
      // failure leaves the last good map up with the timestamp to say it stopped moving
      if (error instanceof ApiError && error.status === 404) {
        clearSeats();
        // The selection goes too. Base UI fires no change for an equal value, so
        // re-picking the showtime that just vanished is a no-op and the clear button is
        // the only way out; the alert survives because only `chooseSession` clears it
        setSession(null);
        setDetailError(error.message);
        return;
      }
      holdIfRateLimited(error);
    } finally {
      clearTimeout(abandonTimer);
      // Identity, not a bare clear: the cleanup below empties the slot when a selection
      // changes, so a late attempt must not take the one its replacement is holding
      if (refreshAttempt.current === attempt) refreshAttempt.current = null;
    }
  };

  /*
   * Both guards read live values rather than `refreshHeld`, which is a render-time copy.
   * The slot is checked here as well as inside `refreshSeats`, so a press that could not go
   * out does not take a cooldown and dim the control as though it had
   */
  const requestRefresh = () => {
    if (!theatre || !session) return;
    if (Date.now() < heldUntilRef.current || refreshAttempt.current) return;
    holdRefresh(MANUAL_REFRESH_COOLDOWN_MS);
    void refreshSeats(theatre, session);
  };

  /*
   * ...and on a timer, because seats sell while the map is open
   *
   * SC 2.2.2 wants a pause, stop or hide control over content that updates on its own, and
   * the refresh button is none of those. Its auto-updating clause reaches content
   * "presented in parallel with other content", and the map is what the reader came for
   * rather than a ticker beside it; failing that, the essential exception covers it on the
   * ground a scoreboard stands on. The update moves no focus, reflows no control, and stops
   * on a hidden tab. AGENTS.md carries the same reasoning, since nothing enforces it
   *
   * Keyed on `refreshable` as a boolean, so a successful refresh does not tear the interval
   * down and rebuild it, and neither a failed first load nor an unreserved screening starts
   * one. Without the `total` half the latter polls forever for a map that cannot exist, and
   * invisibly, since the timestamp it updates renders only beside a map that has seats
   */
  /** The map on screen belongs to the showtime named above it, so the two can be rendered */
  const mapMatchesSession = seats !== null && seatsForSession === session?.sessionId;
  /** ...and it has seats, so there is something a refresh could change */
  const refreshable = mapMatchesSession && seats.total > 0;
  useEffect(() => {
    if (!theatre || !session || !refreshable) return;
    const tick = () => {
      if (document.hidden || Date.now() < heldUntilRef.current) return;
      void refreshSeats(theatre, session);
    };
    const timer = setInterval(tick, SEAT_REFRESH_MS);
    /*
     * Un-dims the control on the way back, and does not refetch. An immediate fetch here is
     * what turns tab switching into an amplifier: the interval keeps its own phase, so
     * alternating hide and show doubles the rate. It is needed because a background tab
     * throttles timers to a minute, so the lapse below can fire long after its deadline
     */
    document.addEventListener("visibilitychange", releaseHoldIfLapsed);
    return () => {
      clearInterval(timer);
      /*
       * Emptied as well as aborted. As an effect-scoped variable this slot started empty on
       * every run; as a ref it does not, so an attempt that never settles would hold it for
       * the life of the page and every later tick would return early with nothing to say so
       */
      refreshAttempt.current?.abort();
      refreshAttempt.current = null;
      document.removeEventListener("visibilitychange", releaseHoldIfLapsed);
    };
  }, [theatre, session, refreshable]);

  /*
   * Drops the hold the moment it lapses, so the control does not stay dimmed until whatever
   * re-renders next. Keyed on the deadline rather than a boolean, which is the whole reason
   * it is state: a longer hold changes the value, so this re-runs and re-arms with the new
   * remaining time. Against a boolean nothing changes, the effect does not re-run, and the
   * original timer fires early to find nothing left to do
   */
  useEffect(() => {
    if (heldUntil === 0) return;
    /*
     * Re-armed rather than abandoned when the release declines. A clock stepped backwards
     * by an NTP correction or a resume from sleep puts the deadline back in the future, and
     * returning here would leave the hold set with no timer behind it: the interval heals
     * itself because it re-reads the clock every tick, but the control never would
     */
    const tryRelease = () => {
      releaseHoldIfLapsed();
      if (Date.now() < heldUntilRef.current) arm();
    };
    let timer: ReturnType<typeof setTimeout>;
    const arm = () => {
      timer = setTimeout(tryRelease, Math.max(heldUntilRef.current - Date.now(), 0));
    };
    arm();
    return () => clearTimeout(timer);
  }, [heldUntil]);

  /*
   * Plain filters over lists the client already holds, and the theatres then ordered by how
   * far away they are. Filter first, so the sort only ever runs over what is on screen
   *
   * `sortByDistance` returns its input untouched while there is no position, which is both
   * the server render and every client render before the prompt is answered: the API's own
   * order stands until the reader's own is available
   */
  const visibleTheatres = sortByDistance(
    allowedTheatreIds
      ? (theatres ?? []).filter((entry) => allowedTheatreIds.has(entry.id))
      : (theatres ?? []),
    sortOrigin,
  );
  /*
   * Whether the ordering above is actually the reader's own: at least one theatre has to
   * carry coordinates, or nothing moved and no distance is drawn
   *
   * Measured against the whole list rather than the visible one, which is what keeps this
   * from flipping. Read off `visibleTheatres` it changes as a movie narrows the list, and a
   * live region whose text goes away and comes back announces itself again every time
   */
  const sorted =
    sortOrigin !== null &&
    (theatres ?? []).some((entry) => theatreDistanceKm(entry, sortOrigin) !== null);
  const visibleMovies = allowedFilmIds
    ? (movies ?? []).filter((entry) => allowedFilmIds.has(entry.id))
    : (movies ?? []);

  const bothChosen = Boolean(theatre && movie);
  /*
   * The list on hand was fetched for the pair currently selected. Everything downstream
   * reads this rather than `sessions` alone, so the one commit between choosing a movie and
   * the effect clearing the list offers nothing rather than the previous pair's times
   */
  const sessionsMatchPair =
    sessions !== null && theatre !== null && movie !== null
      ? sessionsForPair === pairKey(theatre, movie)
      : false;
  const days = groupSessionsByDay(sessionsMatchPair && sessions ? sessions : []);
  // Once, here, because the map and the legend have to agree on it
  const recommended = optimalSeatIds(seats?.rows ?? []);
  const noScreenings = sessionsMatchPair && sessions?.length === 0 && !detailError;
  const seatSkeletonDue = useDelayedFlag(seatsPending, SKELETON_DELAY_MS);

  /*
   * What the refresh changed, for a reader who cannot see it change
   *
   * Every seat carries its status in its accessible name, so a seat read as "available"
   * becomes "occupied" under a virtual cursor with nothing said. Counted from the arrival
   * of this showtime's map rather than from the last tick, because a delta that happens to
   * repeat a number is a string that does not change, and an unchanged string is never
   * announced. Occupancy can fall, when a hold expires, and the `> 0` test at the render
   * site is what keeps a negative from being read out as seats un-selling
   */
  const soldSinceArrival = (seats?.occupied ?? 0) - occupiedOnArrival.current;

  /*
   * Out of reach until it has this pair's list, taken from the list rather than from the
   * pending flag. Both `bothChosen` and a change of movie commit one frame before the effect
   * sets that flag, and a flag-derived gate leaves the control enabled in that frame over
   * whatever the previous pair left behind
   */
  const showtimesLoading = bothChosen && !sessionsMatchPair;
  const showtimePlaceholder = !bothChosen
    ? "Pick a theatre and a movie first"
    : showtimesLoading
      ? "Loading showtimes"
      : days.length === 0
        ? // Disabled once the list lands empty, so the placeholder must not go on inviting
          // a choice. Reachable two ways: nothing playing, and a showtimes fetch that failed
          "No showtimes for this pair"
        : "Pick a showtime, or search by date";

  /*
   * Swapping between two showtimes brings the map back into view, and only a swap: the
   * first pick already leaves the map below the select being looked at, and a clear has
   * nothing to scroll to. Armed here and spent once the seats land, since the target does
   * not exist until then
   *
   * It holds the showtime rather than a boolean because a background refresh for the
   * previous one can land inside the gap the swap opens. Against a boolean that scrolls to
   * the old map and spends the flag, so the swap the reader made never scrolls at all
   */
  const chooseSession = (next: Session | null) => {
    scrollToSession.current = next !== null && session !== null ? next.sessionId : null;
    setSession(next);
    /*
     * Cleared here as well as in the two selects above. Only the `theatre && session` path
     * used to reset it, so clearing the showtime left "Could not load this showtime" on
     * screen with no showtime selected and nothing under it to be about
     */
    setDetailError(null);
  };

  useEffect(() => {
    if (scrollToSession.current === null || scrollToSession.current !== seatsForSession) return;
    scrollToSession.current = null;
    seatMapRef.current?.scrollIntoView({
      // `useMediaQuery` reports false on its first render, before the effect syncs. Safe
      // here only because this fires on a swap, long after mount
      behavior: prefersReducedMotion ? "auto" : "smooth",
      block: "start",
    });
  }, [seats, prefersReducedMotion]);

  // Clearing either select has to take everything downstream with it
  const chooseTheatre = (next: Theatre | null) => {
    setTheatre(next);
    setSession(null);
    setDetailError(null);
  };
  const chooseMovie = (next: Movie | null) => {
    setMovie(next);
    setSession(null);
    setDetailError(null);
  };

  if (bootError) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Showtimes are unavailable</AlertTitle>
        <AlertDescription>{bootError}</AlertDescription>
      </Alert>
    );
  }

  return (
    <Stack gap="lg" data-pending={booting || undefined}>
      <Stack direction={{ base: "vertical", md: "horizontal" }} gap="default">
        <Field className="flex-1">
          <FieldLabel htmlFor="theatre-select">Theatres</FieldLabel>
          <Combobox
            items={visibleTheatres}
            value={theatre}
            onValueChange={chooseTheatre}
            onOpenChange={setTheatreListOpen}
            itemToStringLabel={(entry: Theatre) => entry.name}
            isItemEqualToValue={(a: Theatre, b: Theatre) => a.id === b.id}>
            {/*
             * A magnifier rather than a chevron: all three fields filter as you type, and
             * a chevron reads as a fixed-list picker. It shows only while the field is
             * empty, since `showClear` puts a clear button in the same slot the moment a
             * value lands, which is also the moment there is nothing left to search
             */}
            <ComboboxInput
              id="theatre-select"
              placeholder={booting ? "Loading theatres" : "Pick a theatre"}
              disabled={booting}
              triggerIcon={SearchIcon}
              showClear
            />
            <ComboboxContent>
              <ComboboxEmpty>No theatres match</ComboboxEmpty>
              <ComboboxList>
                {(entry: Theatre) => {
                  const km = theatreDistanceKm(entry, sortOrigin);
                  return (
                    /*
                     * The distance rides in the option's children, never in
                     * `itemToStringLabel`. That feeds both the input's value after a choice
                     * and Base UI's own filter, so a distance there would make "2 km" a
                     * search term over a number that moves, and would write a stale one into
                     * the field
                     */
                    <ComboboxItem key={entry.id} value={entry}>
                      {entry.name}
                      {km === null ? null : (
                        <span className="ml-auto pl-3 text-xs text-muted-foreground tabular-nums">
                          {formatDistance(km)}
                        </span>
                      )}
                    </ComboboxItem>
                  );
                }}
              </ComboboxList>
            </ComboboxContent>
          </Combobox>
          {/*
           * Mounted empty from first render, because a live region added at the same time as
           * its text announces nothing. The list can reorder under a reader who is already in
           * it, so the reorder is the thing worth saying
           *
           * A fixed string on purpose. It is announced exactly once, on the empty-to-text
           * change when the position lands, and naming the nearest theatre instead would
           * re-announce every time picking a movie narrowed the list to a different one
           *
           * Gated on the sort having something to do, not just on the position arriving: a
           * one-theatre list, or one where upstream sent no coordinates at all, would
           * otherwise claim an ordering nobody could see
           */}
          <span role="status" data-slot="theatres-status" className="sr-only">
            {sorted ? "Theatres sorted by distance, nearest first." : ""}
          </span>
        </Field>

        <Field className="flex-1">
          <FieldLabel htmlFor="movie-select">Movies</FieldLabel>
          <Combobox
            items={visibleMovies}
            value={movie}
            onValueChange={chooseMovie}
            itemToStringLabel={(entry: Movie) => entry.name}
            isItemEqualToValue={(a: Movie, b: Movie) => a.id === b.id}>
            <ComboboxInput
              id="movie-select"
              placeholder={booting ? "Loading movies" : "Pick a movie"}
              disabled={booting}
              triggerIcon={SearchIcon}
              showClear
            />
            <ComboboxContent>
              <ComboboxEmpty>No movies match</ComboboxEmpty>
              <ComboboxList>
                {(entry: Movie) => (
                  <ComboboxItem key={entry.id} value={entry}>
                    {entry.name}
                  </ComboboxItem>
                )}
              </ComboboxList>
            </ComboboxContent>
          </Combobox>
        </Field>
      </Stack>

      {/*
       * Sized to match one of the two selects above and centred under them. Those sit in a
       * `Stack` at `gap="default"` (16px) with `flex-1` each, so each is `calc(50% - 0.5rem)`
       * of this column; full width would make the third control read as more important than
       * the two it depends on. `md:` only, since below that the Stack is vertical and all
       * three are full width. A browser test compares the rendered widths, because this
       * arithmetic breaks silently if that gap ever changes
       *
       * `|| undefined` rather than the bare boolean: React serializes `data-pending={false}`
       * as the string "false", which still matches `[data-pending]`, and the hydration wait
       * every a11y and smoke spec runs through would never resolve
       */}
      <Field
        className="w-full md:mx-auto md:w-[calc(50%-0.5rem)]"
        data-pending={sessionsPending || undefined}>
        <FieldLabel htmlFor="showtime-select">Showtimes</FieldLabel>
        <Combobox
          items={days}
          value={session}
          onValueChange={chooseSession}
          itemToStringLabel={(entry: Session) => sessionOptionLabel(entry, sessions ?? [])}
          // Search the dates, not the times. A week of screenings is a dozen times a day,
          // so narrowing to a date is the only thing typing usefully does here
          filter={matchesDayQuery}
          isItemEqualToValue={(a: Session, b: Session) => a.sessionId === b.sessionId}>
          {/*
           * The real disabled attribute, not a visual state: it reaches the input and the
           * trigger, so the control is genuinely out of the tab order. Disabled whenever it
           * has nothing to offer, which is where the loading state belongs, since left
           * enabled it answers a search with "No showtimes" whether the list is loading,
           * belongs to the previous pair, came back empty, or failed
           */}
          <ComboboxInput
            id="showtime-select"
            placeholder={showtimePlaceholder}
            disabled={!bothChosen || days.length === 0}
            triggerIcon={SearchIcon}
            showClear
          />
          <ComboboxContent>
            <ComboboxEmpty>No showtimes</ComboboxEmpty>
            <ComboboxList>
              {(day: (typeof days)[number]) => (
                <ComboboxGroup key={day.key} items={day.items}>
                  <ComboboxLabel>{day.label}</ComboboxLabel>
                  <ComboboxCollection>
                    {/*
                     * `day.items` is the *filtered* subset, since Base UI hands the render
                     * callback a group clone. Safe only because the filter is all-or-nothing
                     * per day: per-session, a day narrowed to one of two same-time screenings
                     * would silently lose the auditorium suffix that tells them apart
                     */}
                    {(entry: Session) => (
                      <ComboboxItem key={entry.sessionId} value={entry}>
                        {sessionOptionLabel(entry, day.items)}
                      </ComboboxItem>
                    )}
                  </ComboboxCollection>
                </ComboboxGroup>
              )}
            </ComboboxList>
          </ComboboxContent>
        </Combobox>
      </Field>

      {detailError ? (
        <Alert variant="destructive">
          <AlertTitle>Could not load this showtime</AlertTitle>
          <AlertDescription>{detailError}</AlertDescription>
        </Alert>
      ) : null}

      {/* A pair with nothing playing is an empty state, not an error */}
      {noScreenings ? (
        <Empty variant="outline">
          <EmptyHeader>
            <EmptyTitle>No screenings</EmptyTitle>
            <EmptyDescription>
              {movie?.name} is not playing at {theatre?.name} right now. Try another theatre or
              another movie.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : null}

      {/*
       * On the movie alone, so the poster confirms the pick before a showtime is chosen
       * Suppressed for a pair with nothing playing, or a card with two placeholder lines
       * would sit directly above the "No screenings" block saying the opposite
       */}
      {movie && !noScreenings ? (
        <ShowtimeCard movie={movie} theatre={theatre} session={session} />
      ) : null}

      {/*
       * The marker goes up at once and the placeholder waits. Both live inside the pending
       * branch: mounted unconditionally the marker would stall the hydration wait forever.
       * `hidden` as a class is the house idiom and the attribute would do as well; either
       * resolves to `display: none`, so no box is generated, the surrounding `gap` skips it,
       * and `querySelector` still finds it
       */}
      {seatsPending ? (
        seatSkeletonDue ? (
          <Skeleton className="h-64 w-full" data-pending />
        ) : (
          <span className="hidden" data-pending />
        )
      ) : null}

      {/*
       * Both blocks below wait for the map to match the showtime named above them, not just
       * for a map to exist. The swap opens a frame where the card is the new showtime and
       * the map is still the old one, and it is committed, so a slow device paints it
       */}
      {mapMatchesSession && seats.total === 0 && !seatsPending ? (
        <Empty variant="outline">
          <EmptyHeader>
            <EmptyTitle>No seat map</EmptyTitle>
            <EmptyDescription>
              This screening has no reserved seating, so there is no map to show.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : null}

      {mapMatchesSession && seats.total > 0 && !seatsPending ? (
        <Stack gap="default">
          <CapacityMeter
            map={seats}
            freshness={freshness}
            onRefresh={requestRefresh}
            refreshHeld={refreshHeld}
          />
          {/*
           * The legend reads as the map's own footer, and `recommended` is derived once
           * above so the two cannot disagree about which seats are green. `gap="none"` is
           * load-bearing rather than a default restated: `Stack`'s default is 16px and these
           * two surfaces are rounded to meet, so any gap breaks the seam they are shaped
           * for. A browser test measures that they still touch
           */}
          <Stack ref={seatMapRef} gap="none">
            <SeatMap map={seats} recommended={recommended} className="rounded-b-none" />
            <SeatLegend map={seats} recommended={recommended} className="rounded-t-none" />
          </Stack>
          {/*
           * Mounted empty from the moment the map is, because a live region added at the
           * same time as its text announces nothing. `role="status"` implies polite and
           * atomic, so neither is restated
           */}
          <span role="status" data-slot="seats-status" className="sr-only">
            {soldSinceArrival > 0
              ? `${soldSinceArrival} seat${soldSinceArrival === 1 ? "" : "s"} sold since this map loaded`
              : ""}
          </span>
        </Stack>
      ) : null}
    </Stack>
  );
}
