import { describe, expect, it } from "vitest";
import { canTransitionStatus } from "./state-machine.js";

describe("document status", () => {
  it("allows Draft -> Extracted", () => {
    expect(canTransitionStatus("Draft", "Extracted")).toBe(true);
  });
  it("blocks Draft -> Published", () => {
    expect(canTransitionStatus("Draft", "Published")).toBe(false);
  });
});
