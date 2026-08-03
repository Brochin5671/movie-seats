import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * `test:coverage` runs the `unit` and `components` projects, not `browser`
 * Including `browser` was measured and moves the numbers by +0.28 statements and
 * +0.00 branches, because every module with a `*.browser.test.tsx` today also has
 * a happy-dom sibling that already covers it. It would also mean instrumenting the
 * screenshot assertions and running that tier twice per CI run, which buys flake
 * rather than signal
 *
 * The hole that leaves is a future one: a module whose only test is a browser test
 * is fully exercised and still scores zero, and the gate cannot see it. This closes
 * that by requiring the sibling, so the browser tier stays additive coverage rather
 * than becoming the sole coverage for anything
 *
 * If a module genuinely cannot be tested in happy-dom, the answer is to add
 * `--project=browser` to `test:coverage` and install Chromium in the CI `tests`
 * job, not to delete this
 */

/*
 * Rooted at `src/`, not `src/components/`. The browser project's include is
 * `src/**` and `src/lib/**` is inside the coverage include too, so a
 * `src/lib/thing.browser.test.tsx` standing as the only test for `src/lib/thing.ts`
 * is exactly the hole this closes and would sit outside a components-only walk
 */
const SRC_DIR = join(import.meta.dirname, "..");

function walk(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...walk(path));
    else if (entry.name.endsWith(".browser.test.tsx")) found.push(path);
  }
  return found;
}

/*
 * The module a browser test covers. `.astro` is deliberately absent: coverage
 * excludes `src/components/**\/*.astro` outright, so one can never be a hole here
 */
function moduleFor(testPath: string): string | undefined {
  const base = testPath.replace(/\.browser\.test\.tsx$/, "");
  return [".tsx", ".ts"].map((ext) => `${base}${ext}`).find((path) => existsSync(path));
}

/*
 * Either extension counts. `unit` collects `.test.ts` and `components` collects
 * `.test.tsx`, and `test:coverage` runs both, so a non-React module covered by a
 * `.test.ts` sibling is just as visible to the gate. Checking only `.test.tsx`
 * would fail on `HeaderMobile`, which already pairs a `.tsx` module with a
 * `.test.ts`
 */
function hasHappyDomSibling(testPath: string): boolean {
  const base = testPath.replace(/\.browser\.test\.tsx$/, "");
  return existsSync(`${base}.test.ts`) || existsSync(`${base}.test.tsx`);
}

describe("browser-tier coverage", () => {
  const browserTests = walk(SRC_DIR);

  /*
   * Guards the assertion below: an empty list would satisfy it while finding nothing
   * Counts the module-naming subset, because that is what the assertion iterates. A
   * tree whose browser tests were all cross-cutting would pass a bare length check
   * and still assert nothing
   */
  it("finds the browser tests it is asserting about", () => {
    expect(browserTests.length).toBeGreaterThan(0);
    const moduleNaming = browserTests.filter((path) => moduleFor(path) !== undefined);
    expect(moduleNaming.length).toBeGreaterThan(0);
  });

  /*
   * Scoped to browser tests that name a module. A cross-cutting one, such as the
   * focus-outline test that checks resolved CSS across several components, has no
   * module of its own and so cannot be the sole coverage for anything
   */
  it("every module-specific browser test has a happy-dom sibling the gate can see", () => {
    const orphaned = browserTests.filter(
      (path) => moduleFor(path) !== undefined && !hasHappyDomSibling(path),
    );
    expect(
      orphaned.map((path) => path.replace(`${SRC_DIR}/`, "")),
      "these modules are exercised only in the browser project, which test:coverage does not run",
    ).toEqual([]);
  });
});
