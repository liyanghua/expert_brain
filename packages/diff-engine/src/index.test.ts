import { describe, expect, it } from "vitest";
import { textDiff } from "./index.js";

describe("textDiff", () => {
  it("shows changes", () => {
    const d = textDiff("a\n", "a\nb\n");
    expect(d).toContain("+");
  });
});
