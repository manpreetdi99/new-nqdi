import { describe, expect, it } from "vitest";
import { parseComment } from "./labels";

describe("parseComment", () => {
  it("returns null for empty comments", () => {
    expect(parseComment(null)).toBeNull();
    expect(parseComment("   ")).toBeNull();
  });

  it.each([
    ["LC GSM", "LC_GSM", null],
    ["LC LTE (B-SIDE)", "LC_LTE", "B"],
    ["LC LTE (A-SIDE)", "LC_LTE", "A"],
    ["LQ LTE", "LQ_LTE", null],
    ["LQ GSM", "LQ_GSM", null],
    ["Low coverage LTE", "LC_LTE", null],
    ["CORE NETWORK (SIP 504)", "CORE_SIP_5XX", null],
    ["CORE NETWORK (SIP 500)", "CORE_SIP_5XX", null],
    ["CORE NETWORK (DL CHANNEL RELEASE)", "CORE_CHANNEL_RELEASE", null],
    ["CORE NETWORK (DEACTIVATE BEARER)", "CORE_BEARER", null],
    ["CORE NETWORK (DRB RELEASE 3)", "CORE_DRB_RELEASE", null],
    ["Core network", "CORE_OTHER", null],
    ["FAKE EOF", "FAKE_EOF", null],
    ["FAKE NO SYNC", "FAKE_NO_SYNC", null],
    ["FAKE UE STUCK", "FAKE_UE_STUCK", null],
    ["FAKE UE STUCK (UL DISCONNECT)", "FAKE_UE_STUCK_UL_DISCONNECT", null],
    ["Fake UE stuck(CC Disconnect missing)", "FAKE_UE_STUCK_CC_DISC_MISSING", null],
    ["Fake UE stuck(no cm service request)", "FAKE_UE_STUCK_NO_CM", null],
    ["Fake UE stuck(No Response after Paging)", "FAKE_UE_STUCK_NO_PAGING_RESPONSE", null],
    ["Fake end of file", "FAKE_EOF", null],
    ["Core Network(No paging)", "CORE_NO_PAGING", null],
    ["Core Network (DRB_to Release)", "CORE_DRB_RELEASE", null],
    ["Core Network(DL Release) to GSM", "CORE_CHANNEL_RELEASE", null],
    ["Core Network(SIP 503)", "CORE_SIP_5XX", null],
    ["Called side did not expect a call", "USER_SIDE", null],
  ])("maps %s to %s", (comment, label, side) => {
    expect(parseComment(comment)).toEqual({ raw: comment, label, side });
  });

  it("keeps unknown comments with a null label", () => {
    expect(parseComment("check later")).toEqual({ raw: "check later", label: null, side: null });
  });
});
