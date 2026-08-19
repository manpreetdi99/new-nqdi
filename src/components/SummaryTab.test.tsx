import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import SummaryTab from "./SummaryTab";
import type { AllCallsRow, DataCallRow, TechnologyMixRow } from "@/lib/api";

const call = (overrides: Partial<AllCallsRow>): AllCallsRow => ({
  Location: "Cosmote Free A",
  SessionId: "1",
  callMode: null,
  callType: null,
  technology: "LTE E-UTRA 3",
  callDir: "A->B",
  status: "completed",
  setupTime: null,
  CollectionName: null,
  callDuration: null,
  callStartTimeStamp: null,
  Avg_mos: null,
  latitude: null,
  longitude: null,
  comment: null,
  ...overrides,
});

describe("SummaryTab", () => {
  it("renders a Technology mix row with the per-band shares, not just 2G/3G/4G/5G", () => {
    const rows: AllCallsRow[] = [
      ...Array.from({ length: 5 }, () => call({ technology: "GSM 900" })),
      ...Array.from({ length: 5 }, () => call({ technology: "GSM 1800" })),
    ];

    render(<SummaryTab allCallsRows={rows} dataCallsRows={[] as DataCallRow[]} />);

    expect(screen.getByText("Technology mix")).toBeInTheDocument();
    expect(screen.getAllByText(/GSM 900/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/GSM 1800/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("50.0%").length).toBeGreaterThan(0);
  });

  it("prefers the real per-sample technologyMixRows over the coarse AllCallsRow.technology field", () => {
    // Χοντρικό technology στα calls — αν αυτό ήταν η πηγή, θα βλέπαμε "GSM" 100%.
    const rows: AllCallsRow[] = Array.from({ length: 3 }, () =>
      call({ Location: "Cosmote GSM A", technology: "GSM" }),
    );
    // Το πραγματικό per-sample mix (/api/technology_mix) λέει 99.9% / 0.1%.
    const technologyMixRows: TechnologyMixRow[] = [
      { location: "Cosmote GSM A", technology: "GSM 900", samples: 999 },
      { location: "Cosmote GSM A", technology: "GSM 1800", samples: 1 },
    ];

    render(<SummaryTab allCallsRows={rows} dataCallsRows={[] as DataCallRow[]} technologyMixRows={technologyMixRows} />);

    expect(screen.getAllByText(/GSM 900/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/GSM 1800/).length).toBeGreaterThan(0);
    // 99.9% / 0.1% (the real per-sample split) — not the coarse-technology fallback,
    // which would have put every sample under a single "GSM" bucket at 100%.
    expect(screen.getAllByText("99.9%").length).toBeGreaterThan(0);
    expect(screen.getAllByText("0.1%").length).toBeGreaterThan(0);
    expect(screen.queryByText(/^GSM$/)).not.toBeInTheDocument();
  });
});
