/// <reference types="astro/client" />

// Build-time brand overrides set in cd.yml; unset locally, so the `site` resolver in
// site-config.ts falls back to `brand`
interface ImportMetaEnv {
  readonly PUBLIC_SITE_URL?: string;
  readonly PUBLIC_SITE_NAME?: string;
  readonly PUBLIC_SITE_SHORT_NAME?: string;
  readonly PUBLIC_SITE_TAGLINE?: string;
  readonly PUBLIC_SITE_DESCRIPTION?: string;
}

/*
 * Cloudflare bindings are reached with `import { env } from "cloudflare:workers"`, not
 * through `Astro.locals`: `locals.runtime.env` was removed in Astro v6, and the adapter's
 * `Runtime` is now just `{ cfContext }`. `Env` is typed in `worker-configuration.d.ts`,
 * which `pnpm generate-types` writes from `wrangler.jsonc`
 *
 * The module only exists inside a Worker, so `astro dev`, Vitest and `astro preview` have
 * no bindings at all and anything reading one has to cope with its absence
 */
