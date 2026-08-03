import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, api } from "./cineplex-client";

/*
 * The error path, and one header on it
 *
 * The happy path is a `fetch` and a `json()` and is not worth a test. What is worth one is
 * `Retry-After`: the client pauses its own polling for whatever the limiter asks, so a
 * misread here is a pause a thousand times too short or a wait that never ends, and neither
 * shows up anywhere else. The component tier constructs `ApiError` directly and so never
 * exercises the parse
 */

const respondWith = (status: number, headers: Record<string, string> = {}) =>
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { code: "rate_limited", message: "Slow down." } }), {
          status,
          headers,
        }),
    ),
  );

const seatsError = async () => {
  try {
    await api.seats(1, 2);
  } catch (error) {
    return error as ApiError;
  }
  throw new Error("expected the request to reject");
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ApiError", () => {
  it("carries the status, the code and the message from the envelope", async () => {
    respondWith(429);
    const error = await seatsError();
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(429);
    expect(error.code).toBe("rate_limited");
    expect(error.message).toBe("Slow down.");
  });

  it("reads Retry-After as seconds and reports it in milliseconds", async () => {
    respondWith(429, { "Retry-After": "45" });
    // 45, not 45000: a client that forwards the raw number pauses for 45ms
    expect((await seatsError()).retryAfterMs).toBe(45_000);
  });

  /*
   * Null rather than zero on every unusable value, so a caller can tell "the server said
   * nothing" from "the server said wait no time at all" and pick its own fallback. Zero
   * would read as a licence to retry immediately
   */
  it.each([
    ["absent", {}],
    ["empty", { "Retry-After": "" }],
    ["an HTTP date", { "Retry-After": "Wed, 21 Oct 2026 07:28:00 GMT" }],
    ["zero", { "Retry-After": "0" }],
    ["negative", { "Retry-After": "-5" }],
  ])("reports no window when Retry-After is %s", async (_name, headers) => {
    respondWith(429, headers);
    expect((await seatsError()).retryAfterMs).toBeNull();
  });
});
