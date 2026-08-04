import { readFileSync } from "node:fs";
import { load } from "cheerio";
import { describe, expect, it } from "vitest";
import { site } from "../../src/lib/site-config";
import { distPath } from "../fixtures/site-pages";

/*
 * The masthead is server-rendered, so the build tier is where it can be read at all: the
 * island below it never mounts here, and the mark and the tagline are both outside it
 *
 * The tagline reaches the page from `site-config` rather than being written into the markup,
 * so this is also what catches the two falling out of step
 *
 * Every assertion is on a scalar. A failed one holding a cheerio node prints the whole
 * document through its circular parent references, and vitest runs out of heap rather than
 * reporting the failure
 */

const home = () => load(readFileSync(distPath("/"), "utf8"));

/** The mark, which leads the landmark. The island below it server-renders icons of its own */
const markClass = () => {
  const $ = home();
  return $("main svg[aria-hidden='true']").first().attr("class") ?? "";
};

describe("the home page masthead", () => {
  it("renders the tagline from site-config", () => {
    const $ = home();
    const matches = $("main p").filter((_, element) => $(element).text().trim() === site.tagline);
    // Non-empty first, or an empty tagline in config would match an empty paragraph
    expect(site.tagline).not.toBe("");
    expect(matches.length).toBe(1);
  });

  /*
   * The mark is decoration and says nothing the tagline does not, so it stays out of the
   * accessibility tree. It also has to be the small one: `SeatMark` defaults to the `size-20`
   * the error pages draw, and a masthead at that size is the header this page does not want
   */
  it("draws the mark small and hidden from assistive tech", () => {
    expect(markClass().split(/\s+/)).toContain("size-8");
    expect(markClass().split(/\s+/)).not.toContain("size-20");
  });

  /*
   * The tagline is decoration, not the page's title. Promoted to the heading it would leave
   * the only `h1` disagreeing with the tab, and `page-has-heading-one` is satisfied either
   * way, so nothing else would notice
   */
  it("keeps the only heading screen-reader-only and naming the brand", () => {
    const $ = home();
    expect($("h1").length).toBe(1);
    expect($("h1").text()).toBe(site.name);
    expect($("h1").attr("class")?.split(/\s+/)).toContain("sr-only");
  });

  /*
   * Inside the landmark, or axe's `region` rule fires on content outside every landmark
   *
   * Walks the tagline's own ancestors rather than counting what `main` contains. A count is
   * satisfied by the island's markup below, and `body > p` cannot fail at all, because the
   * layout wraps everything in a div whatever happens to the masthead
   */
  it("puts the masthead inside the main landmark", () => {
    const $ = home();
    // Selected from the whole document, or the walk below only restates the selector
    const tagline = $("p").filter((_, element) => $(element).text().trim() === site.tagline);
    expect(tagline.length).toBe(1);
    expect(tagline.parents("main").length).toBe(1);

    const mark = $("svg[aria-hidden='true']").first();
    expect(mark.parents("main").length).toBe(1);
  });
});
