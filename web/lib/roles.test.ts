import { describe, it, expect } from "vitest";
import { AuthError, requireRole, hasRole } from "@/lib/roles";

describe("hasRole", () => {
  it("returns true when there is overlap", () => {
    expect(hasRole(["agent"], ["agent", "admin"])).toBe(true);
  });

  it("returns false when there is no overlap", () => {
    expect(hasRole(["buyer"], ["agent", "admin"])).toBe(false);
  });

  it("returns false for empty user roles", () => {
    expect(hasRole([], ["agent"])).toBe(false);
  });

  it("returns false for empty allowed roles (defensive)", () => {
    expect(hasRole(["agent"], [])).toBe(false);
  });
});

describe("requireRole", () => {
  it("returns silently when the user has an allowed role", () => {
    expect(() => requireRole(["agent"], ["agent", "admin"])).not.toThrow();
  });

  it("throws AuthError(403) when the user has no allowed role", () => {
    try {
      requireRole(["buyer"], ["agent", "admin"]);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(AuthError);
      expect((err as AuthError).status).toBe(403);
    }
  });

  it("throws AuthError(403) when the user has no roles", () => {
    expect(() => requireRole([], ["agent"])).toThrow(AuthError);
  });
});
