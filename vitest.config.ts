import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { playwright } from "@vitest/browser-playwright";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

export default defineConfig({
  /*
   * tsconfigPaths picks up the `@/*` alias from tsconfig.json so paths have one source of
   * truth; tailwindcss compiles `@/styles/global.css` for the browser project so its
   * computed-style assertions reflect the real design tokens
   */
  plugins: [tsconfigPaths(), tailwindcss()],
  /*
   * Force a single React instance across the prebundle. Without this, the browser project
   * loads one React via vitest-browser-react and another via @base-ui's optimized chunks,
   * and Base UI's hooks (useRef/useId in @base-ui/utils) read a null dispatcher
   * ("Cannot read properties of null")
   */
  resolve: {
    dedupe: ["react", "react-dom"],
    /*
     * Two virtual modules that only exist in the real runtime. `astro:env/server` is
     * Astro's, and Vitest has no Astro plugin; `cloudflare:workers` is workerd's, and is
     * how bindings are reached now that `Astro.locals.runtime.env` is gone. Both stubs
     * resolve everything unset, which is the path the unconfigured tests exercise
     */
    alias: {
      "astro:env/server": fileURLToPath(
        new URL("./src/test/stubs/astro-env-server.ts", import.meta.url),
      ),
      "cloudflare:workers": fileURLToPath(
        new URL("./src/test/stubs/cloudflare-workers.ts", import.meta.url),
      ),
    },
  },
  optimizeDeps: {
    include: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "@base-ui/react"],
  },
  test: {
    testTimeout: 5_000,
    // Auto-isolation: cleans up spies, env stubs, and global stubs between tests
    // so isolation never depends on a test remembering to clean up
    restoreMocks: true,
    unstubEnvs: true,
    unstubGlobals: true,
    // Block stray .only commits from passing CI; allow locally for focused debugging
    allowOnly: !process.env.CI,
    // Show full assertion diffs in failures (default truncates at 40 chars)
    chaiConfig: { truncateThreshold: 0 },
    // Inline PR annotations on test failures when running on GitHub Actions runners
    reporters: process.env.GITHUB_ACTIONS ? ["default", "github-actions"] : ["default"],
    coverage: {
      provider: "v8",
      include: ["src/lib/**", "src/components/**/*.tsx"],
      exclude: ["src/components/**/*.astro", "**/*.test.*"],
      /*
       * CONFIGURE: a baseline, not a mandate. The floors sit under measured on purpose, so a
       * refactor can move without going red while a real regression still fails the CI
       * `tests` job. Last measured at 92.49 / 89.50 / 88.84 / 94.73
       *
       * Restate that reading when it moves and leave the floors alone unless a measurement
       * demands it. No gap is written out here: every previous attempt to name one went stale
       * the next time a test was added, and a stale derivation is the thing this file's own
       * rules warn about. Re-measure with `pnpm test:coverage`
       *
       * Up from 82 / 80 / 74 / 83 after the library prune: what is left is almost all code
       * this site renders, so the ratio of tested to shipped went up without a test being
       * added. Some route lines still read as uncovered because their only exercise is the
       * Playwright `integration` project, which `test:coverage` does not run
       */
      thresholds: {
        statements: 87,
        branches: 83,
        functions: 83,
        lines: 90,
      },
    },
    projects: [
      {
        // Unit tests: pure-function and module tests in `.test.ts` files
        // Same happy-dom + setup as `components` so both share fixtures
        extends: true,
        test: {
          name: "unit",
          environment: "happy-dom",
          include: ["src/**/*.test.ts"],
          setupFiles: ["./vitest.setup.ts"],
        },
      },
      {
        /*
         * Component tests: React components in `.test.tsx` files (RTL). Split from `unit`
         * so the script-to-project mapping is one to one, and excluding
         * `*.browser.test.tsx` so those run only in the `browser` project below
         */
        extends: true,
        test: {
          name: "components",
          environment: "happy-dom",
          include: ["src/**/*.test.tsx"],
          exclude: ["src/**/*.browser.test.tsx"],
          setupFiles: ["./vitest.setup.ts"],
        },
      },
      {
        /*
         * Browser-mode component tests: real Chromium via the Playwright provider, for
         * behaviour happy-dom cannot render: layout, hover, focus rings, scroll, and any
         * assertion against a computed style
         */
        extends: true,
        test: {
          name: "browser",
          include: ["src/**/*.browser.test.tsx"],
          setupFiles: ["./vitest.setup.browser.ts"],
          browser: {
            enabled: true,
            provider: playwright(),
            headless: true,
            instances: [{ browser: "chromium" }],
          },
        },
      },
      {
        // Build snapshot tests: parse dist/*.html with Cheerio in node
        // Requires a prior `pnpm build`. No DOM, no setup file
        extends: true,
        test: {
          name: "build",
          environment: "node",
          include: ["tests/build/**/*.test.ts"],
        },
      },
    ],
  },
});
