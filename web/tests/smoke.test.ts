import { describe, it, expect } from "vitest";

describe("test infra", () => {
  it("loads vitest globals", () => {
    expect(1 + 1).toBe(2);
  });
});
