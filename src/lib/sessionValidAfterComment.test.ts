import { describe, expect, it } from "vitest";
import { sessionValidAfterComment } from "@/lib/api";

// Ίδιος κανόνας με το /api/calls/comment (backend/routers/calls.py): req.comment.lower().startswith("fake")
describe("sessionValidAfterComment", () => {
  it("marks comments starting with 'fake' (any case) as invalid", () => {
    expect(sessionValidAfterComment("fake call")).toBe(0);
    expect(sessionValidAfterComment("FAKE")).toBe(0);
    expect(sessionValidAfterComment("Fake event - no audio")).toBe(0);
  });

  it("marks everything else as valid, like the backend (no trim)", () => {
    expect(sessionValidAfterComment("")).toBe(1);
    expect(sessionValidAfterComment("drop due to coverage")).toBe(1);
    expect(sessionValidAfterComment("not fake")).toBe(1);
    expect(sessionValidAfterComment(" fake")).toBe(1);
  });
});
