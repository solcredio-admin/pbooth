import { describe, expect, it } from "vitest";
import { cell, csv } from "./csv.js";

describe("csv", () => {
  it("quotes, and never lets a name become a formula", () => {
    expect(cell('Café, "Uno"')).toBe('"Café, ""Uno"""');
    expect(cell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(cell("@x")).toBe("'@x");
    expect(cell(-150)).toBe("-150"); // numbers stay numbers
    expect(cell(null)).toBe("");
    expect(csv([["a", 1], ["b", 2]])).toBe("\ufeffa,1\r\nb,2\r\n");
  });
});
