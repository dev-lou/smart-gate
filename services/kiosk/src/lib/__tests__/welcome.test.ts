import { describe, expect, it } from "vitest";

import { shouldAnnounceWelcome, WELCOME_REPEAT_MS } from "../scanPolicy";

describe("welcome announcement", () => {
  it("greets the first arrival", () => {
    expect(shouldAnnounceWelcome(null, "s1", 1_000)).toBe(true);
    expect(shouldAnnounceWelcome({ id: "", at: 0 }, "s1", 1_000)).toBe(true);
  });

  it("greets a different student immediately, even right after the last one", () => {
    expect(shouldAnnounceWelcome({ id: "s1", at: 10_000 }, "s2", 10_050)).toBe(true);
  });

  it("does not repeat for the same student standing still", () => {
    expect(shouldAnnounceWelcome({ id: "s1", at: 10_000 }, "s1", 10_500)).toBe(false);
    expect(
      shouldAnnounceWelcome({ id: "s1", at: 10_000 }, "s1", 10_000 + WELCOME_REPEAT_MS - 1),
    ).toBe(false);
  });

  it("greets the same student again once they have been standing there a while", () => {
    expect(shouldAnnounceWelcome({ id: "s1", at: 10_000 }, "s1", 10_000 + WELCOME_REPEAT_MS)).toBe(
      true,
    );
  });

  it("treats a cleared greeting (visitor walked on) as a new arrival", () => {
    expect(shouldAnnounceWelcome({ id: "", at: 0 }, "s1", 20_000)).toBe(true);
  });
});
