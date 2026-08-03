// Setup for the `browser` Vitest project (real Chromium via Playwright).
//
// Importing the global stylesheet pulls in Tailwind v4 and the design tokens,
// so getComputedStyle() in browser tests reflects the real rendered styles
// (layout, focus rings, hover colors) rather than browser defaults
import "@/styles/global.css";
// jest-dom matchers (toBeVisible, toHaveClass, ...) also work against the real
// DOM here. vitest-browser-react auto-cleans the rendered tree between tests,
// so no afterEach(cleanup) is needed (unlike the happy-dom setup)
import "@testing-library/jest-dom/vitest";
