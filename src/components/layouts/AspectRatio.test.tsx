import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AspectRatio } from "./AspectRatio";

describe("AspectRatio", () => {
  it("sets --ratio CSS custom property from the ratio prop", () => {
    const { getByText } = render(<AspectRatio ratio={1}>x</AspectRatio>);
    const node = getByText("x") as HTMLElement;
    expect(node.style.getPropertyValue("--ratio")).toBe("1");
  });

  it("applies aspect-(--ratio) utility + relative positioning", () => {
    const { getByText } = render(<AspectRatio ratio={4 / 3}>x</AspectRatio>);
    const node = getByText("x");
    expect(node).toHaveClass("relative");
    expect(node).toHaveClass("aspect-(--ratio)");
  });
});
