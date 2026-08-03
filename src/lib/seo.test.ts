import { describe, expect, it } from "vitest";
import { buildAbsoluteURL, buildCanonicalURL, buildMetaTitle } from "./seo";

describe("buildMetaTitle", () => {
  it("suffixes the brand after a page title", () => {
    expect(buildMetaTitle("About", "Acme")).toBe("About - Acme");
  });

  it("leads with brand + tagline for the homepage (no title)", () => {
    expect(buildMetaTitle(undefined, "Acme", "We build things")).toBe("Acme - We build things");
  });

  it("falls back to just the brand when there is no tagline", () => {
    expect(buildMetaTitle(undefined, "Acme")).toBe("Acme");
  });
});

describe("buildCanonicalURL", () => {
  const site = new URL("https://example.com");

  it("constructs canonical from pathname", () => {
    expect(buildCanonicalURL("/about", site)).toBe("https://example.com/about");
  });

  it("handles root path", () => {
    expect(buildCanonicalURL("/", site)).toBe("https://example.com/");
  });
});

describe("buildAbsoluteURL", () => {
  const site = new URL("https://example.com");

  it("resolves a relative image path against the site", () => {
    expect(buildAbsoluteURL("/og-logo.png", site)).toBe("https://example.com/og-logo.png");
  });

  it("leaves an already-absolute URL untouched", () => {
    expect(buildAbsoluteURL("https://cdn.example.com/a.png", site)).toBe(
      "https://cdn.example.com/a.png",
    );
  });

  /*
   * `new URL(path, base)` ignores the base whenever `path` has its own scheme, so
   * these used to pass straight through into canonical, og:image and
   * twitter:image. The error message names the offending input, because a bare
   * throw at build time on a generated path is hard to trace back
   */
  it.each([
    ["javascript:alert(1)", "a script scheme"],
    ["data:text/html,<script>alert(1)</script>", "a data url"],
    ["file:///etc/passwd", "a local file"],
  ])("throws on %s (%s)", (path) => {
    expect(() => buildAbsoluteURL(path, site)).toThrow(/non-http\(s\) URL/);
  });

  /*
   * Pins what a scheme check cannot do, so the limit is recorded rather than
   * assumed. A protocol-relative path adopts the site's scheme and retargets the
   * host, producing a perfectly valid https URL on someone else's origin. It is
   * accepted because an absolute URL on another host is a supported input (a CDN
   * for social images), so rejecting the retarget would reject the feature
   */
  it("accepts a protocol-relative path, resolving it against the site scheme", () => {
    expect(buildAbsoluteURL("//cdn.example.net/a.png", site)).toBe("https://cdn.example.net/a.png");
  });
});
