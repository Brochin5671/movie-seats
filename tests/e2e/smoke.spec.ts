import { expect, test } from "@playwright/test";
import { sitePages } from "../fixtures/site-pages";

test.describe("Smoke tests", () => {
  for (const { path, name } of sitePages) {
    test(`${name} (${path}) loads with title and main content`, async ({ page }) => {
      const response = await page.goto(path);
      expect(response?.status()).toBe(200);
      await expect(page).toHaveTitle(/.+/);
      await expect(page.getByRole("main")).toBeVisible();
    });
  }

  test("404 page renders for unknown routes", async ({ page }) => {
    const response = await page.goto("/nonexistent-page");
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("link", { name: "Go Home" })).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  });

  // A direct /500 hit either previews the 500 design (previewErrorPages on) or renders
  // the 404 page (previewErrorPages off). Either way it must return a real error status
  // with a rendered body, never an empty response
  test("a direct /500 visit renders an error page, never an empty body", async ({ page }) => {
    const status = (await page.goto("/500"))?.status();
    expect([404, 500]).toContain(status);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  });

  /*
   * The site is deliberately not crawled. Served as a real file rather than a 404, since
   * a missing robots.txt is read as "crawl everything", which is the opposite instruction
   */
  test("robots.txt disallows every crawler", async ({ page }) => {
    const response = await page.goto("/robots.txt");
    expect(response?.status()).toBe(200);
    const body = await response?.text();
    expect(body).toContain("User-agent: *");
    expect(body).toContain("Disallow: /");
    // No sitemap, or the file would point at the pages it just told a crawler to skip
    expect(body).not.toContain("Sitemap:");
  });

  /*
   * Guards the global.css `:root astro-island { display: block }` rule that
   * keeps pointer events alive on iOS. The rule silently does nothing if it
   * is ever layered or loses its :root prefix, and since a rule that does
   * nothing changes no layout, only the computed value catches that
   *
   * Asserted over every island rather than one named component, so removing
   * whichever page carried the pinned one cannot quietly empty this
   * Proves the CSS landed, not that iOS behaves: Playwright's WebKit on Linux has
   * none of the iOS touch-synthesis pipeline, so triage a real report on a device
   */
  test("islands carry a layout box so iOS delivers pointer events", async ({ page }) => {
    await page.goto("/");
    const islands = page.locator("astro-island");
    // A plain count, not a retrying assertion: zero islands would make the loop
    // below vacuous, and that is the failure worth catching
    const count = await islands.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      await expect(islands.nth(i)).toHaveCSS("display", "block");
    }
  });

  test("skip-to-content link is keyboard-accessible", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Tab");
    const skipLink = page.getByRole("link", { name: "Skip to content" });
    await expect(skipLink).toBeVisible();
    await skipLink.click();
    await expect(page).toHaveURL(/#main-content/);
  });
});
