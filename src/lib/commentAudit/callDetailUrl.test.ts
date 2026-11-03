import { describe, expect, it } from "vitest";
import { callDetailUrl } from "./callDetailUrl";

describe("callDetailUrl", () => {
  it("builds the Call Detail URL with database, collection and call", () => {
    const url = callDetailUrl("THESSALONIKI_26H2", 261993005082, "SAL_THESSALONIKI_MAJOR CITIES_2026H2");
    const params = new URLSearchParams(url.split("?")[1]);
    expect(url.startsWith("/?")).toBe(true);
    expect(Object.fromEntries(params)).toEqual({
      db: "THESSALONIKI_26H2",
      tab: "calls",
      sub: "detail",
      call: "261993005082",
      collections: "SAL_THESSALONIKI_MAJOR CITIES_2026H2",
    });
  });

  it("omits the collection when it is unknown", () => {
    expect(callDetailUrl("DEMO", "1", null)).toBe("/?db=DEMO&tab=calls&sub=detail&call=1");
  });
});
