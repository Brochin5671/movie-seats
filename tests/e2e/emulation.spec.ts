import { expect, test } from "@playwright/test";

/*
 * `page.emulateMedia` takes `reducedMotion` and `forcedColors` directly, avoiding the
 * typing limits of `test.use()` for these
 *
 * Only the focus indicator is here. A "does the page render" case under each emulation
 * asserted nothing the rest of the suite does not already cover harder: `accessibility`
 * runs a full axe scan under reduced motion, and `seat-finder` reads computed strokes off
 * every seat state under forced colors
 */

test.describe("Forced colors (Windows high-contrast)", () => {
  /*
   * The focus indicator has to survive forced colors, and most of the library's
   * indicators do not: a `ring-*` box-shadow is not painted in that mode at all,
   * and border-color is forced to the same system colour focused or not, so
   * `focus-visible:border-ring` produces no visible change either
   *
   * Measured on a Button before this was fixed: focusing changed border,
   * box-shadow, background, colour and text-decoration by nothing, and the
   * outline resolved to `none` in both states. Every interactive element on the
   * page took focus with no indicator
   *
   * This asserts a painted outline rather than "some property differs", because a
   * difference in a property that is not rendered is what the old state had
   */
  test("a focused button paints an outline under forced colors", async ({ page }) => {
    await page.emulateMedia({ forcedColors: "active" });
    /*
     * The 404 page, not the home page. Its "Go Home" link is the one
     * `data-slot="button"` inside `main` that no page rewrite can take away, and the
     * indicator under test is page-independent. Pointing this at `/` couples it to
     * whatever that page happens to render
     */
    await page.goto("/nonexistent-page");

    // Scoped to main and to a visible one: the first [data-slot="button"] in the
    // document is a disabled control, which is hidden at
    // this viewport and cannot take focus
    const button = page.locator('main [data-slot="button"]:visible').first();
    await expect(button).toBeVisible();

    const outlineOf = () =>
      button.evaluate((el) => {
        const cs = getComputedStyle(el);
        return {
          style: cs.outlineStyle,
          width: cs.outlineWidth,
          offset: cs.outlineOffset,
          /*
           * The colour matters as much as the width. Tailwind's outline-hidden
           * reserves `2px solid transparent`, and it only becomes an indicator
           * because forced-colors mode forces the colour to a system one. Without
           * this a reserved-but-invisible outline would pass identically
           */
          transparent: cs.outlineColor === "rgba(0, 0, 0, 0)" || cs.outlineColor === "transparent",
        };
      });

    // Unfocused it draws nothing, which is what makes the focused case a signal
    expect((await outlineOf()).style).toBe("none");

    await button.focus();
    /*
     * Polls the whole resolved outline rather than waiting on `style` and then
     * reading `width`. Button carries `transition-all`, so outline-width animates
     * from its resting 3px to the focused 2px: a poll that returns as soon as the
     * style stops being "none" samples the width mid-transition and reads 3
     *
     * 2px at 2px offset is what Tailwind's `outline-hidden` reserves inside its
     * `forced-colors: active` block, which is the whole reason that utility is on
     * this component
     */
    await expect
      .poll(outlineOf)
      .toEqual({ style: "solid", width: "2px", offset: "2px", transparent: false });
  });
});
