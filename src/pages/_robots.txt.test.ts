import { describe, expect, it } from "vitest";
import { getRobotsTxt } from "@/pages/robots.txt";

/*
 * The site is deliberately not crawled. Asserted rather than assumed, because
 * "Disallow: /" and "Allow: /" differ by three characters and mean opposite things
 */

describe("getRobotsTxt", () => {
  const output = getRobotsTxt();

  it("disallows every path for every crawler", () => {
    expect(output).toContain("User-agent: *");
    expect(output).toContain("Disallow: /");
  });

  // The specific mistake this guards: `Allow: /` and `Disallow: /` differ by three
  // characters and mean opposite things
  it("allows nothing", () => {
    expect(output).not.toContain("Allow: /");
  });

  /*
   * A sitemap points a crawler at the pages the rest of the file just told it to skip
   * The generated file still exists, it is simply not advertised
   */
  it("advertises no sitemap", () => {
    expect(output).not.toContain("Sitemap:");
  });
});
