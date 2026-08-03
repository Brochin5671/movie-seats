/*
 * Brand identity. The layout, the SEO component, the JSON-LD builders and
 * astro.config.mjs (the `site` URL and the favicon name) all read from here, so a
 * change propagates site-wide
 *
 * CONFIGURE: `url` is the workers.dev address the Worker deploys to. The subdomain is
 * account-level, so confirm it in the Cloudflare dashboard before launch
 */

export interface FooterSocial {
  href: string;
  icon: string;
  label: string;
}

export const brand = {
  name: "Movie Seats",
  shortName: "Movie Seats",
  url: "https://movie-seats.brochin5671.workers.dev",
  logo: "/og-logo.png",
  description: "See which seats are available for a Cineplex showtime before you book.",
  founder: "Maxim Brochin",
} as const;

/*
 * Per-page meta descriptions, the copy the SEO component renders into search results
 * and social cards. The build snapshot bounds these to 50 to 200 characters, which is
 * roughly the window Google renders
 */
export const pageMeta = {
  defaultDescription: "Live seat availability for Cineplex showtimes, in your browser.",
  home: "Pick a theatre, a movie and a showtime, then see exactly which seats are still available before you book. Live seat maps for Cineplex.",
} as const;

/*
 * SEO identity: the <title> builder, the SEO component and the JSON-LD all read this
 * `tagline` is the homepage title suffix. An empty `twitterHandle` omits the
 * twitter:site and :creator tags rather than emitting empty ones
 */
export const siteSeo = {
  tagline: "Plan your movie experience!",
  locale: "en_US",
  twitterHandle: "",
  ogImage: { width: 1200, height: 630, type: "image/png" },
  defaultAuthor: brand.founder,
} as const;

/*
 * The `<html lang>` value, derived from siteSeo.locale so the two cannot drift
 * og:locale wants the underscored form (`en_US`) and `lang` wants a BCP 47 tag
 * (`en-US`), which is the whole reason they were written separately and then
 * disagreed
 */
export const htmlLang = siteSeo.locale.replace("_", "-");

/*
 * Resolved site identity. Consumers read `site`, never `brand` directly, so the
 * PUBLIC_SITE_* build overrides apply everywhere
 *
 * `email` and `sameAs` are absent rather than empty: the org JSON-LD omits a missing
 * key, where an empty string would publish a blank contact
 */
export const site = {
  name: import.meta.env.PUBLIC_SITE_NAME || brand.name,
  shortName:
    import.meta.env.PUBLIC_SITE_SHORT_NAME || import.meta.env.PUBLIC_SITE_NAME || brand.shortName,
  url: import.meta.env.PUBLIC_SITE_URL || brand.url,
  logo: brand.logo,
  description: import.meta.env.PUBLIC_SITE_DESCRIPTION || brand.description,
  founder: brand.founder,
  // `??` not `||`: an explicitly empty tagline means no title suffix, where `||`
  // would fall back to the default and re-add one
  tagline: import.meta.env.PUBLIC_SITE_TAGLINE ?? siteSeo.tagline,
} as const;

/*
 * Gated to dev, so outside dev a direct /500 hit renders the 404 page instead of
 * advertising an error route. Real 500s always render, and /404 is unaffected
 */
export const previewErrorPages = import.meta.env.DEV;

// No footer on this page, so no social links. The type stays for whoever adds one
export const socials: FooterSocial[] = [];
