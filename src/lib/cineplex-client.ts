/**
 * @fileoverview The only place the browser talks to this app's API
 *
 * Typed, abortable, and one error shape. Every selection-driven call takes a signal
 * because users change selects faster than the narrowing calls resolve, and without
 * aborts a stale response lands on top of a newer one
 */

import type { Movie, SeatMap, Session, Theatre } from "@/lib/cineplex/types";

/**
 * A failure the server described, carrying the machine code from the error envelope
 *
 * `retryAfterMs` is the `Retry-After` the rate limiter sends with a 429, read off the
 * response rather than restated here. A client holding its own copy of that window is a
 * number nothing keeps true: change the limiter's period and the client goes on pausing
 * for the old one, silently
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly retryAfterMs: number | null = null,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * A request the caller cancelled, which is routine rather than a failure
 *
 * Checked by name rather than by instance: the abort reason is a `DOMException` in the
 * browser but not in every runtime the components are tested in
 */
export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

interface ErrorEnvelope {
  error?: { code?: string; message?: string };
}

/*
 * Seconds, per the HTTP-date form this API never sends. A header that is absent, empty or
 * unparseable reads as null so a caller can pick its own fallback rather than waiting zero
 */
function retryAfterMs(response: Response): number | null {
  const seconds = Number(response.headers.get("Retry-After"));
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : null;
}

async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api${path}`, { signal, headers: { Accept: "application/json" } });
  if (!response.ok) {
    // The envelope is the contract, but a proxy or a crash can still answer with
    // something else, so a failed parse must not mask the status
    const body = (await response.json().catch(() => ({}))) as ErrorEnvelope;
    throw new ApiError(
      response.status,
      body.error?.code ?? "unknown",
      body.error?.message ?? `Request failed with ${response.status}`,
      retryAfterMs(response),
    );
  }
  return (await response.json()) as T;
}

export const api = {
  movies: (signal?: AbortSignal) => get<Movie[]>("/movies", signal),
  theatres: (signal?: AbortSignal) => get<Theatre[]>("/theatres", signal),
  moviesAtTheatre: (theatreId: number, signal?: AbortSignal) =>
    get<{ filmIds: number[] }>(`/narrow/movies?theatreId=${theatreId}`, signal),
  theatresForMovie: (filmId: number, signal?: AbortSignal) =>
    get<{ theatreIds: number[] }>(`/narrow/theatres?filmId=${filmId}`, signal),
  showtimes: (theatreId: number, filmId: number, signal?: AbortSignal) =>
    get<Session[]>(`/showtimes?theatreId=${theatreId}&filmId=${filmId}`, signal),
  seats: (theatreId: number, showtimeId: number, signal?: AbortSignal) =>
    get<SeatMap>(`/seats?theatreId=${theatreId}&showtimeId=${showtimeId}`, signal),
};
