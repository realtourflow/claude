/**
 * autoTaskDueDate (#187) — stage-relative default due dates for auto-tasks.
 *
 * Contract: base offset in days per stage entered
 *   active_search 7 · offer_active 2 · under_contract 7 · pre_close 3 ·
 *   closing 1 · post_close 7 · (unknown stage → 7)
 * adjusted by priority: high = ceil(base/2) (min 1), medium = base, low = 2×base.
 */
import { describe, it, expect } from "vitest";
import { autoTaskDueDate, isValidDueDateString } from "@/lib/task-due-dates";

// Local-midnight anchor so expectations are timezone-stable.
const FROM = new Date(2026, 6, 10); // July 10, 2026

describe("autoTaskDueDate", () => {
  it("uses the stage base offset for medium priority", () => {
    expect(autoTaskDueDate("active_search", "medium", FROM)).toBe("2026-07-17");
    expect(autoTaskDueDate("offer_active", "medium", FROM)).toBe("2026-07-12");
    expect(autoTaskDueDate("under_contract", "medium", FROM)).toBe("2026-07-17");
    expect(autoTaskDueDate("pre_close", "medium", FROM)).toBe("2026-07-13");
    expect(autoTaskDueDate("closing", "medium", FROM)).toBe("2026-07-11");
    expect(autoTaskDueDate("post_close", "medium", FROM)).toBe("2026-07-17");
  });

  it("halves the offset for high priority (never below 1 day)", () => {
    expect(autoTaskDueDate("under_contract", "high", FROM)).toBe("2026-07-14"); // ceil(7/2)=4
    expect(autoTaskDueDate("offer_active", "high", FROM)).toBe("2026-07-11"); // ceil(2/2)=1
    expect(autoTaskDueDate("closing", "high", FROM)).toBe("2026-07-11"); // min 1
  });

  it("doubles the offset for low priority", () => {
    expect(autoTaskDueDate("pre_close", "low", FROM)).toBe("2026-07-16"); // 3*2=6
    expect(autoTaskDueDate("post_close", "low", FROM)).toBe("2026-07-24"); // 7*2=14
  });

  it("falls back to 7 days for an unknown stage", () => {
    expect(autoTaskDueDate("intake", "medium", FROM)).toBe("2026-07-17");
  });

  it("rolls over month boundaries correctly", () => {
    expect(autoTaskDueDate("post_close", "low", new Date(2026, 6, 25))).toBe(
      "2026-08-08"
    );
  });

  it("always produces a string the API accepts", () => {
    for (const stage of ["active_search", "closing", "whatever"]) {
      for (const priority of ["high", "medium", "low"]) {
        expect(isValidDueDateString(autoTaskDueDate(stage, priority))).toBe(true);
      }
    }
  });
});
