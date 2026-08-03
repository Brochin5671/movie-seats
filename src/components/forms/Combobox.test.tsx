import { render, screen } from "@testing-library/react";
import { SearchIcon } from "lucide-react";
import { describe, expect, it } from "vitest";
import { Combobox, ComboboxInput } from "./Combobox";

// Combobox wraps Base UI's Combobox. These tests cover our composition wiring
// (the named disclosure button, disabled propagation, the showTrigger toggle),
// not Base UI's filtering/keyboard internals

describe("Combobox", () => {
  it("renders an input with role combobox and a named disclosure button", () => {
    render(
      <Combobox items={["Apple", "Banana"]}>
        <ComboboxInput aria-label="Fruit" />
      </Combobox>,
    );
    expect(screen.getByRole("combobox", { name: "Fruit" })).toHaveAttribute(
      "data-slot",
      "input-group-control",
    );
    expect(screen.getByRole("button", { name: "Show suggestions" })).toBeInTheDocument();
  });

  it("disables the input and the disclosure button when disabled", () => {
    render(
      <Combobox items={["Apple"]}>
        <ComboboxInput aria-label="Fruit" disabled />
      </Combobox>,
    );
    expect(screen.getByRole("combobox", { name: "Fruit" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Show suggestions" })).toBeDisabled();
  });

  /*
   * Icon-only, and Base UI supplies no default name, so an unnamed clear button would
   * fail axe's button-name rule on every page that opts into it
   */
  it("names the clear button when showClear is set", () => {
    render(
      <Combobox items={["Apple"]} defaultValue="Apple">
        <ComboboxInput aria-label="Fruit" showClear />
      </Combobox>,
    );
    expect(screen.getByRole("button", { name: "Clear selection" })).toBeInTheDocument();
  });

  /*
   * The chevron is the default and stays the default. A field that filters as you type
   * passes its own glyph; the name does not move with it, because the button still opens
   * the list. `lucide-<name>` is the class every lucide icon carries, so it is the icon's
   * identity rather than a styling detail
   */
  it("draws the chevron by default and the icon it is given otherwise", () => {
    const glyph = () =>
      screen.getByRole("button", { name: "Show suggestions" }).querySelector("svg");

    const { rerender } = render(
      <Combobox items={["Apple"]}>
        <ComboboxInput aria-label="Fruit" />
      </Combobox>,
    );
    expect(glyph()).toHaveClass("lucide-chevron-down");

    rerender(
      <Combobox items={["Apple"]}>
        <ComboboxInput aria-label="Fruit" triggerIcon={SearchIcon} />
      </Combobox>,
    );
    expect(glyph()).toHaveClass("lucide-search");
  });

  it("hides the disclosure button when showTrigger is false", () => {
    render(
      <Combobox items={["Apple"]}>
        <ComboboxInput aria-label="Fruit" showTrigger={false} />
      </Combobox>,
    );
    expect(screen.queryByRole("button", { name: "Show suggestions" })).toBeNull();
  });
});
