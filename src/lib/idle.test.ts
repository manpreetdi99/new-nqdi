import { describe, expect, it } from "vitest";

import { IDLE_LIMIT_MS, PING_INTERVAL_MS, isIdle, shouldPing } from "./idle";

describe("isIdle", () => {
  it("is false just under the limit", () => {
    expect(isIdle(0, IDLE_LIMIT_MS - 1)).toBe(false);
  });

  it("is true exactly at the 30 minute limit", () => {
    expect(isIdle(0, IDLE_LIMIT_MS)).toBe(true);
  });

  it("is true after a long sleep even if no timer fired", () => {
    expect(isIdle(1_000, 1_000 + 3 * IDLE_LIMIT_MS)).toBe(true);
  });
});

describe("shouldPing", () => {
  it("does not ping when the user has not been active since the last ping", () => {
    expect(shouldPing(1_000, 2_000, 2_000 + PING_INTERVAL_MS)).toBe(false);
  });

  it("does not ping again before the interval has passed", () => {
    expect(shouldPing(5_000, 1_000, 1_000 + PING_INTERVAL_MS - 1)).toBe(false);
  });

  it("pings when active since the last ping and the interval has passed", () => {
    expect(shouldPing(5_000, 1_000, 1_000 + PING_INTERVAL_MS)).toBe(true);
  });
});
