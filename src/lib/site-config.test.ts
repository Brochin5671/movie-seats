import { describe, expect, it } from "vitest";
import { brand, htmlLang, site, siteSeo } from "./site-config";
import { isHttpUrl } from "./url";

/*
 * Guards the values a consumer edits. Everything here is a checked-in literal, so
 * these fail at build time rather than in a browser, which is the point: a pasted
 * or typo'd URL in the brand block reaches an `href` and a JSON-LD field
 */

describe("brand urls", () => {
  it("brand.url is an absolute http(s) url", () => {
    expect(isHttpUrl(brand.url)).toBe(true);
  });

  it("the resolved site.url is an absolute http(s) url", () => {
    // Resolves through PUBLIC_SITE_URL, so a bad build env is caught here too
    expect(isHttpUrl(site.url)).toBe(true);
  });

  /*
   * logo is root-relative on purpose (`/og-logo.png`), and the structured-data
   * builder resolves it against the site url. So it must NOT be absolute, and
   * asserting the leading slash is what keeps that resolution correct
   */
  it("brand.logo is root-relative so it resolves against the site url", () => {
    expect(brand.logo.startsWith("/")).toBe(true);
    expect(isHttpUrl(brand.logo)).toBe(false);
  });

  /*
   * `<html lang>` and og:locale describe the same language in two notations, and
   * they used to be written separately: `lang="en"` hardcoded in Layout.astro
   * against `locale: "en_US"` here. Changing one and not the other is silent,
   * because neither notation is wrong on its own
   */
  it("htmlLang is the BCP 47 form of the configured locale", () => {
    /*
     * The expected value written out, not `locale.replace("_", "-")` again: that
     * restates the implementation and holds for any implementation that happens to
     * run the same expression, including a wrong one
     */
    expect(siteSeo.locale).toBe("en_US");
    expect(htmlLang).toBe("en-US");
    // A tag, not a bare word: the hyphenated form is what `lang` expects
    expect(htmlLang).toMatch(/^[a-z]{2}(-[A-Z]{2})?$/);
  });
});
