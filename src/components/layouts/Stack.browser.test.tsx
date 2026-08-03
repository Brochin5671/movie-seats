import { expect, test } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { Stack } from "./Stack";

// Browser-mode coverage: the REAL computed flex-direction, including responsive
// reflow at breakpoints. happy-dom has no layout, so Stack.test.tsx can only
// assert the resolveDirection class output

function stackEl(): HTMLElement {
  const el = document.querySelector<HTMLElement>('[data-slot="stack"]');
  if (!el) throw new Error("stack not found");
  return el;
}

test("responsive direction reflows at the md breakpoint", async () => {
  await render(<Stack direction={{ base: "vertical", md: "horizontal" }}>x</Stack>);

  await page.viewport(400, 800); // below md
  await expect.poll(() => getComputedStyle(stackEl()).flexDirection).toBe("column");

  await page.viewport(1000, 800); // above md
  await expect.poll(() => getComputedStyle(stackEl()).flexDirection).toBe("row");
});
