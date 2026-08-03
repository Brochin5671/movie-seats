// @ts-check

/*
 * Adapter: swap to deploy elsewhere. Each is a one-line change
 *   Cloudflare (current): import cloudflare from "@astrojs/cloudflare"
 *   Vercel:               import vercel from "@astrojs/vercel"
 *   Netlify:              import netlify from "@astrojs/netlify"
 *   Node (self-hosted):   import node from "@astrojs/node"
 * `imageService: "compile"` is Cloudflare-specific (free-plan compatible)
 * Other adapters use sharp by default - drop the option on swap
 */
import cloudflare from "@astrojs/cloudflare";
import react from "@astrojs/react";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, envField, fontProviders } from "astro/config";
import expressiveCode from "astro-expressive-code";
import favicons from "astro-favicons";
import { brand } from "./src/lib/site-config.ts";

// Build timestamp used as the sitemap `lastmod` (see the sitemap() serialize).
const buildDate = new Date().toISOString();

// https://astro.build/config
export default defineConfig({
  // Astro enables `security.checkOrigin` by default, which validates the Origin header
  // on POST/PUT/PATCH/DELETE to SSR routes. Free CSRF protection on top of the CSP
  adapter: cloudflare({ imageService: "compile" }),
  // CONFIGURE: this site uses no Astro sessions, so the memory driver keeps the
  // Cloudflare adapter from provisioning an unused SESSION KV namespace on every
  // deploy. For durable sessions, remove this line, create a KV namespace, and
  // pin a SESSION binding with its id in wrangler.jsonc
  session: { driver: { entrypoint: "unstorage/drivers/memory" } },
  integrations: [
    /*
     * Expressive Code renders every markdown/MDX code fence (frames, titles,
     * copy button). The CodeBlock composite uses Shiki directly with the same
     * github themes, so fenced and component-rendered code stay visually in
     * sync. Themes follow the site's .dark class toggle, not the OS
     * preference. Keep this before any mdx() integration if one is added later
     */
    expressiveCode({
      themes: ["github-light", "github-dark"],
      themeCssSelector: (theme) => (theme.type === "dark" ? ".dark" : ":root:not(.dark)"),
      useDarkModeMediaQuery: false,
      styleOverrides: {
        borderRadius: "var(--radius)",
      },
      plugins: [
        /*
         * a11y: Expressive Code's <pre> scrolls horizontally for long lines
         * but, unlike Shiki's own output, ships no tabindex, so keyboard
         * users can't scroll it (axe scrollable-region-focusable, WCAG 2.1.1)
         * Add tabindex="0" to every rendered <pre>
         */
        {
          name: "pre-keyboard-scroll",
          hooks: {
            postprocessRenderedBlock: ({ renderData }) => {
              /** @param {any} node */
              const walk = (node) => {
                if (node?.type === "element" && node.tagName === "pre") {
                  node.properties = { ...node.properties, tabIndex: 0 };
                }
                for (const child of node?.children ?? []) walk(child);
              };
              walk(renderData.blockAst);
            },
          },
        },
      ],
    }),
    react(),
    sitemap({
      // Exclude the /404 + /500 error pages
      filter: (page) => !/\/(404|500)\/?$/.test(page),
      // CONFIGURE: stamp every entry with the build time as a baseline lastmod
      // For per-page accuracy (e.g. a post's updatedDate), look `item.url` up
      // against your content dates here and fall back to the build date
      serialize(item) {
        item.lastmod = buildDate;
        return item;
      },
    }),
    /*
     * astro-favicons reads `public/favicon.svg` as the source and generates
     * the full icon set (16+ PNG sizes, ICO, manifest) at build time
     *
     * Brand name + short name come from src/lib/site-config.ts (single source)
     *
     * `public/favicon.svg` is the brand mark: the lucide armchair on the ink field,
     * matching the OG image. astro-favicons rasterizes the PNG variants
     * (16/32/48/180/192/512) from it at build time
     */
    favicons({
      name: process.env.PUBLIC_SITE_NAME || brand.name,
      short_name:
        process.env.PUBLIC_SITE_SHORT_NAME || process.env.PUBLIC_SITE_NAME || brand.shortName,
      // The ink field the favicon and the OG image both sit on, so the browser chrome
      // and the installed splash match the mark rather than the page background
      themes: ["#270e0e"],
      /*
       * The PWA splash background, same ink. The generator's own default is #fff, which
       * flashes white before a dark app paints, and this page is dark
       * (`class="dark"` in Layout.astro)
       */
      background: "#270e0e",
    }),
  ],
  // Production URL (sitemap, canonical, OG): brand.url for consumers, or the
  // PUBLIC_SITE_URL build env for the demo (cd.yml)
  site: process.env.PUBLIC_SITE_URL || brand.url,

  /*
   * Brand font via Astro's native Fonts API. The cssVariable feeds Tailwind's
   * --font-sans token (see global.css) and is rendered with <Font> in the
   * layouts; preloaded fonts are optimized into the build, no manual @font-face
   *
   * Chillax, self-hosted. The local provider rather than the Fontshare API because
   * `font-src` is `'self'` in the CSP, so a remote face would be blocked; serving the
   * file ourselves also removes a third-party request from the critical path
   *
   * The variable face covers weights 200 to 700, which is the whole published range
   */
  fonts: [
    {
      provider: fontProviders.local(),
      name: "Chillax",
      cssVariable: "--font-brand",
      options: {
        variants: [
          {
            weight: "200 700",
            style: "normal",
            src: ["./src/assets/fonts/chillax-variable.woff2"],
          },
        ],
      },
    },
  ],

  /*
   * Type-safe env vars (astro:env). Read server secrets with
   * `import { CINEPLEX_API_KEY } from "astro:env/server"`, public client vars
   * from "astro:env/client". Local values live in `.dev.vars` (gitignored);
   * production secrets are set with `wrangler secret put`
   */
  env: {
    schema: {
      // Public value baked into the static page head at build time (set in the build env)
      GOOGLE_SITE_VERIFICATION: envField.string({
        context: "server",
        access: "public",
        optional: true,
      }),
      /*
       * Optional, not required, and the distinction matters. `Layout.astro` imports
       * `astro:env/server` on every page, and a required-but-unset secret throws when
       * that module is evaluated, so the whole site 500s rather than the one route
       * that needs the key. The Playwright harness deletes the built `.dev.vars` on
       * purpose, which makes unset the guaranteed state under `pnpm test:e2e`
       *
       * Unset is answered `503 upstream_unconfigured` by the routes instead
       */
      CINEPLEX_API_KEY: envField.string({
        context: "server",
        access: "secret",
        optional: true,
      }),
      // Public client vars use: envField.string({ context: "client", access: "public" })
    },
  },

  vite: {
    plugins: [tailwindcss()],
    optimizeDeps: {
      /*
       * Pre-bundle the React island dependencies so Vite optimizes them at
       * startup instead of discovering them on first hydration mid-session. A
       * mid-session re-optimization forces a full reload that races the
       * Cloudflare (workerd) SSR render and briefly nulls React's shared
       * dispatcher, producing a flood of "Invalid hook call / Cannot read
       * properties of null (useContext)" dev errors (dev-only; the production
       * build is prebuilt and unaffected). Keep in sync
       * with the deps imported by React islands under src/components: add a
       * specifier here when a new island starts importing one
       */
      include: [
        // Astro's env runtime (astro:env/server), pulled in during SSR by
        // Layout.astro and the contact endpoint; discovered late otherwise
        "astro/env/runtime",
        // Core island deps: icons, forms, and the cn()/cva class helpers
        "lucide-react",
        "zod",
        "class-variance-authority",
        "clsx",
        "tailwind-merge",
        // @base-ui/react primitives behind the surviving islands
        "@base-ui/react",
        "@base-ui/react/button",
        "@base-ui/react/input",
        "@base-ui/react/merge-props",
        "@base-ui/react/meter",
        "@base-ui/react/popover",
        "@base-ui/react/separator",
        "@base-ui/react/use-render",
      ],
    },
    // astro-favicons' virtual module needs the SSR dep optimizer to skip
    // prebundling its middleware
    ssr: {
      optimizeDeps: {
        exclude: ["astro-favicons/middleware"],
      },
    },
  },
});
