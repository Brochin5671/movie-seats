/**
 * @fileoverview Cached server-side fetch for SSR data, with stale-on-error
 *
 * Every one of the six Cineplex routes goes through here, via
 * `src/lib/cineplex/upstream.ts`, so this is hot-path library surface rather than an
 * opt-in helper. Change it with the same care as anything else under `src/lib/`
 *
 * An awaited fetch in frontmatter blocks the whole render, so caching collapses
 * many visitors into one upstream call and serving stale keeps the page up when
 * the upstream fails. The Workers Cache API ignores stale-while-revalidate and
 * stale-if-error, so entries carry a long physical TTL while their logical
 * freshness lives in a private header this module owns. Serving stale logs at
 * error level so the outage is visible in Workers logs; a cold miss cannot
 * serve stale, so a genuinely broken upstream still throws
 */

/** Marks when an entry was stored, so logical freshness survives the physical TTL */
const STORED_AT = "x-cached-at";

export interface CachedFetchOptions {
  /** Seconds the cached payload is considered fresh. Default 60. */
  maxAge?: number;
  /**
   * Seconds past freshness a stale payload may still be served when the upstream
   * call fails. Default 86400 (24h). Set 0 to fail visibly instead, which is the
   * right choice when showing old data is worse than showing an error
   */
  staleIfError?: number;
  /** Abort the upstream call after this many ms. Default 5000. */
  timeoutMs?: number;
  /** Forwarded upstream. Put the API key here; it never becomes part of the cache key */
  init?: RequestInit;
}

export interface CachedResult<T> {
  /**
   * The parsed body
   *
   * `null` when the upstream answered 204, which is a success carrying no content. Declare
   * `T` as nullable at the call site if the endpoint can produce one
   */
  data: T;
  /** True when the upstream call failed and a previously stored payload was served */
  stale: boolean;
}

const DEFAULTS = { maxAge: 60, staleIfError: 86_400, timeoutMs: 5_000 };

/**
 * A non-2xx answer, carrying the status and the URL so a caller can tell the cases apart
 *
 * A plain Error loses the status, and the difference matters: 404 usually means the
 * caller asked for something that does not exist, which is their problem, while 5xx is
 * the upstream's. The URL is what makes the log actionable. Without it every 404 reads
 * `upstream 404 Not Found` and there is no way to tell one scraper enumerating ids from
 * an endpoint that has moved. Callers that do not care can keep catching `Error`
 */
export class UpstreamStatusError extends Error {
  constructor(
    readonly status: number,
    statusText: string,
    readonly url = "",
  ) {
    super(`upstream ${status} ${statusText}`);
    this.name = "UpstreamStatusError";
  }
}

/*
 * A 204 is a legal 2xx carrying no body, and `JSON.parse("")` throws. Left alone that
 * throw would land "the query was fine and nothing matched" in the stale-on-error branch,
 * handing the caller the *previous* payload, and the empty body is stored first so every
 * read for the rest of the TTL would throw too. Parsing empty as null keeps no-content on
 * the success path; callers declare `T` as nullable and coalesce
 */
const parseBody = <T>(body: string): T => (body === "" ? (null as T) : (JSON.parse(body) as T));

/*
 * Cache API is absent in Node and unit tests, so callers there always go
 * upstream. Prefer Cloudflare's `caches.default`, else the web-standard
 * `caches.open()`, rather than assuming a host
 */
const openCache = async (): Promise<Cache | undefined> => {
  if (typeof caches === "undefined") return undefined;
  const cloudflareDefault = (caches as CacheStorage & { default?: Cache }).default;
  return cloudflareDefault ?? (await caches.open("ssr-api"));
};

/*
 * Key on the URL alone; the upstream credential in `init.headers` is excluded,
 * so every visitor shares one entry. Correct only because the site holds a
 * single first-party key and all visitors get identical data. Never use this
 * for per-visitor data, or one reader's payload is served to the next
 */
const cacheKey = (url: string) => new Request(url, { method: "GET" });

async function fetchUpstream(url: string, opts: Required<CachedFetchOptions>): Promise<Response> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), opts.timeoutMs);
  try {
    const res = await fetch(url, { ...opts.init, signal: abort.signal });
    if (!res.ok) throw new UpstreamStatusError(res.status, res.statusText, url);
    return res;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch JSON with a cache in front and stale-on-error behind
 *
 * Resolves with the parsed body and whether it was served stale. Throws when the
 * upstream fails and nothing usable is stored, so a broken upstream is never
 * silently rendered as empty
 */
export async function getCached<T>(
  url: string,
  options: CachedFetchOptions = {},
): Promise<CachedResult<T>> {
  const opts = { ...DEFAULTS, init: {}, ...options } as Required<CachedFetchOptions>;
  const cache = await openCache();
  const key = cacheKey(url);
  const stored = await cache?.match(key);

  if (stored) {
    const storedAt = Number(stored.headers.get(STORED_AT) ?? 0);
    const ageSeconds = (Date.now() - storedAt) / 1000;
    if (ageSeconds < opts.maxAge) return { data: parseBody<T>(await stored.text()), stale: false };
  }

  try {
    const fresh = await fetchUpstream(url, opts);
    const body = await fresh.clone().text();
    if (cache) {
      /*
       * Physical lifetime = freshness + stale budget, so the entry is still
       * retrievable once logically stale. The parsed body is returned, never
       * this Response, so the long max-age never reaches a browser
       */
      const keepFor = opts.maxAge + opts.staleIfError;
      await cache.put(
        key,
        new Response(body, {
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": `public, max-age=${keepFor}`,
            [STORED_AT]: String(Date.now()),
          },
        }),
      );
    }
    return { data: parseBody<T>(body), stale: false };
  } catch (error) {
    if (stored) {
      const storedAt = Number(stored.headers.get(STORED_AT) ?? 0);
      const ageSeconds = (Date.now() - storedAt) / 1000;
      /*
       * Strictly less-than, so `staleIfError: 0` needs no separate guard: this
       * branch only runs once the entry is already stale (a fresh one returned
       * above), so a zero budget can never be satisfied
       */
      if (ageSeconds < opts.maxAge + opts.staleIfError) {
        // loud to the operator, invisible to the reader: this is the only signal
        // that the upstream is down while pages still render
        console.error(
          `[cached-fetch] serving stale for ${url} (age ${Math.round(ageSeconds)}s):`,
          error,
        );
        return { data: parseBody<T>(await stored.text()), stale: true };
      }
    }
    throw error;
  }
}
