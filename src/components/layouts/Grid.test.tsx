import { render } from "@testing-library/react";
import { expectAxisWired, variantAxes } from "@tests/fixtures/cva-matrix";
import { describe, expect, it } from "vitest";
import { Grid, GridItem, gridVariants } from "./Grid";

// Real rendered layout (resolved grid tracks, responsive reflow at breakpoints,
// auto-fit track counts) is covered in Grid.browser.test.tsx. These happy-dom
// tests cover the resolveCols branching logic and structural wiring, not the
// emitted class strings as a stand-in for the layout they produce. The CVA
// style axes (gap/flow/align/justify) are checked via the factory matrix
describe("gridVariants", () => {
  for (const axis of variantAxes(gridVariants)) {
    it(`wires the ${axis} axis`, () => expectAxisWired(gridVariants, axis));
  }
});

describe("Grid", () => {
  it("treats a plain number as fixed tracks at every width", () => {
    const { getByText } = render(<Grid cols={4}>x</Grid>);
    const node = getByText("x");
    expect(node).toHaveClass("grid-cols-4");
    expect(node.className).not.toMatch(/(sm|md|lg|xl):grid-cols/);
  });

  it("expands a responsive object into per-breakpoint classes", () => {
    const { getByText } = render(<Grid cols={{ base: 1, md: 2, lg: 3 }}>x</Grid>);
    const node = getByText("x");
    expect(node).toHaveClass("grid-cols-1");
    expect(node).toHaveClass("md:grid-cols-2");
    expect(node).toHaveClass("lg:grid-cols-3");
    expect(node).not.toHaveClass("sm:grid-cols-2");
    expect(node).not.toHaveClass("xl:grid-cols-3");
  });

  it("emits only the breakpoints present in a partial object", () => {
    const { getByText } = render(<Grid cols={{ md: 2 }}>x</Grid>);
    const node = getByText("x");
    expect(node).toHaveClass("md:grid-cols-2");
    expect(node).not.toHaveClass("grid-cols-2");
    expect(node).not.toHaveClass("grid-cols-3");
  });

  it("clamps out-of-range column counts to 12", () => {
    const { getByText } = render(<Grid cols={20}>x</Grid>);
    expect(getByText("x")).toHaveClass("grid-cols-12");
  });

  it("uses container-query variants and a wrapper when container is set", () => {
    const { getByText } = render(
      <Grid cols={{ base: 1, md: 3 }} container>
        x
      </Grid>,
    );
    const node = getByText("x");
    expect(node).toHaveClass("grid-cols-1");
    expect(node).toHaveClass("@md:grid-cols-3");
    expect(node).not.toHaveClass("md:grid-cols-3");
    expect(node.parentElement).toHaveClass("@container");
    expect(node.parentElement).toHaveAttribute("data-slot", "grid-container");
  });

  it("renders no wrapper when container is false", () => {
    const { getByText } = render(<Grid cols={2}>x</Grid>);
    expect(getByText("x").parentElement).not.toHaveClass("@container");
  });

  it("honors the fill mode for intrinsic columns", () => {
    const { getByText } = render(
      <Grid minColWidth="10rem" fill="auto-fill">
        x
      </Grid>,
    );
    expect(getByText("x").style.gridTemplateColumns).toBe("repeat(auto-fill, minmax(10rem, 1fr))");
  });

  it("lets minColWidth override cols and skips the container wrapper", () => {
    const { getByText } = render(
      <Grid cols={4} minColWidth="12rem" container>
        x
      </Grid>,
    );
    const node = getByText("x");
    expect(node.style.gridTemplateColumns).toBe("repeat(auto-fit, minmax(12rem, 1fr))");
    expect(node).not.toHaveClass("grid-cols-4");
    expect(node.parentElement).not.toHaveClass("@container");
  });

  it("renders a div by default", () => {
    const { getByText } = render(<Grid>x</Grid>);
    expect(getByText("x").tagName).toBe("DIV");
  });

  it("renders as another element when asked", () => {
    const { getByText } = render(<Grid as="dl">x</Grid>);
    const node = getByText("x");
    expect(node.tagName).toBe("DL");
    // retagging must not cost the grid its own classes
    expect(node).toHaveClass("grid");
    expect(node).toHaveAttribute("data-slot", "grid");
  });

  it("retags the grid, not the container-query wrapper", () => {
    // a dl whose parent is the @container div: the wrapper must stay a div so
    // `as` never inserts a stray element into the list
    const { getByText } = render(
      <Grid as="dl" container cols={{ md: 2 }}>
        x
      </Grid>,
    );
    const node = getByText("x");
    expect(node.tagName).toBe("DL");
    expect(node.parentElement?.tagName).toBe("DIV");
    expect(node.parentElement).toHaveClass("@container");
  });

  it("lets className override the generated column tracks", () => {
    // the documented escape hatch for track lists `cols` cannot express
    const { getByText } = render(
      <Grid as="dl" className="grid-cols-[auto_1fr]">
        x
      </Grid>,
    );
    const node = getByText("x");
    expect(node).toHaveClass("grid-cols-[auto_1fr]");
    expect(node).not.toHaveClass("grid-cols-3");
  });
});

describe("GridItem", () => {
  it("applies a fixed column span", () => {
    const { getByText } = render(<GridItem span={3}>x</GridItem>);
    expect(getByText("x")).toHaveClass("col-span-3");
  });

  it("expands a responsive span and supports full", () => {
    const { getByText } = render(<GridItem span={{ base: "full", md: 6 }}>x</GridItem>);
    const node = getByText("x");
    expect(node).toHaveClass("col-span-full");
    expect(node).toHaveClass("md:col-span-6");
  });

  it("applies a row span", () => {
    const { getByText } = render(<GridItem rowSpan={2}>x</GridItem>);
    expect(getByText("x")).toHaveClass("row-span-2");
  });

  it("uses container-query variants for span", () => {
    const { getByText } = render(
      <GridItem span={{ md: 4 }} container>
        x
      </GridItem>,
    );
    const node = getByText("x");
    expect(node).toHaveClass("@md:col-span-4");
    expect(node).not.toHaveClass("md:col-span-4");
  });

  it("emits no placement classes when no props are set", () => {
    const { getByText } = render(<GridItem>x</GridItem>);
    expect(getByText("x").className).not.toMatch(/col-span|row-span/);
  });
});
