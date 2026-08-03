/*
 * Test stub for the `astro:env/server` virtual module. Vitest has no Astro
 * plugin to provide that module, so `vitest.config.ts` aliases it here for any
 * source file under test that imports typed env vars (e.g. GOOGLE_SITE_VERIFICATION). They resolve unset, so tests exercise the unset path;
 * the real module is provided by Astro at build/runtime
 */

export const GOOGLE_SITE_VERIFICATION: string | undefined = undefined;
export const CINEPLEX_API_KEY: string | undefined = undefined;

export function getSecret(_key: string): string | undefined {
  return undefined;
}
