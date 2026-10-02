import { describe, expect, it } from "vitest";
import {
  CATEGORY_COL,
  MODE_COL,
  OPERATOR_COL,
  OTHER_LABEL,
  ROWS_COL,
  SCOPE_COL,
  aggregate,
  allowedAggs,
  bucketTime,
  cdfKey,
  defaultAgg,
  deriveDimensions,
  distribution,
  makeAccessor,
  measureFromColumn,
  parseTime,
  profileColumns,
  suggestCharts,
  toShares,
  type Row,
} from "@/lib/chartSemantics";

const setup = (rows: Row[]) => {
  const columns = Object.keys(rows[0]);
  const derived = deriveDimensions(columns, rows);
  const get = makeAccessor(derived);
  const profiles = profileColumns(columns, rows, derived);
  const profile = (col: string) => profiles.find((p) => p.col === col)!;
  return { derived, get, profiles, profile };
};

describe("profileColumns — ρόλοι", () => {
  it("το alev 'Avg' (= AVG*COUNT) ζευγαρώνει με το 'Num' και βγαίνει Σ Avg / Σ Num", () => {
    // HTTP BROWSING p1 RAW: μία γραμμή ανά (operator, status, URL)
    const rows: Row[] = [
      { ASideLocation: "Cosmote Data A", Status: "Successful", Num: 10, Avg: 20, MinVal: 1, MaxVal: 3, StdVal: 0.5 },
      { ASideLocation: "Cosmote Data A", Status: "Successful", Num: 30, Avg: 90, MinVal: 2, MaxVal: 4, StdVal: 0.4 },
      { ASideLocation: "Cosmote Data A", Status: "Failed", Num: 5, Avg: null, MinVal: null, MaxVal: null, StdVal: null },
      { ASideLocation: "Vodafone Data A", Status: "Successful", Num: 4, Avg: 4, MinVal: 1, MaxVal: 1, StdVal: 0 },
    ];
    const { get, profile } = setup(rows);

    expect(profile("Avg").role).toBe("sum");
    expect(profile("Avg").denomCol).toBe("Num");
    expect(defaultAgg(profile("Avg"))).toBe("ratio");
    expect(profile("Num").role).toBe("count");
    expect(profile("MinVal").role).toBe("min");
    expect(profile("MaxVal").role).toBe("max");
    expect(profile("StdVal").role).toBe("spread");

    const res = aggregate(rows, {
      x: OPERATOR_COL, xMode: "category", get, sort: "operator",
      measures: [measureFromColumn(profile("Avg"), "ratio", "avg")],
    });
    expect(res.rows.map((r) => r.__x)).toEqual(["COSMOTE", "VODAFONE"]);
    // (20 + 90) / (10 + 30) = 2.75 — το Failed group (Avg κενό) ΔΕΝ αραιώνει τον μέσο
    expect(res.rows[0].avg).toBeCloseTo(2.75);
    expect(res.rows[1].avg).toBeCloseTo(1);
  });

  it("ήδη-μέσοι όροι σταθμίζονται με το πλήθος της γραμμής, όχι απλό AVG", () => {
    const rows: Row[] = [
      { Location: "Cosmote Free A", EARFCN: 1850, samples: 900, avg_rsrp: -80, bad_call_pct: 1 },
      { Location: "Cosmote Free A", EARFCN: 6300, samples: 100, avg_rsrp: -110, bad_call_pct: 10 },
    ];
    const { get, profile } = setup(rows);

    expect(profile("EARFCN").role).toBe("dimension");
    expect(profile("samples").role).toBe("count");
    expect(profile("avg_rsrp").role).toBe("mean");
    expect(profile("avg_rsrp").weightCol).toBe("samples");
    expect(profile("bad_call_pct").role).toBe("percent");
    expect(allowedAggs(profile("avg_rsrp"))).not.toContain("sum");

    const res = aggregate(rows, {
      x: "Location", xMode: "category", get,
      measures: [measureFromColumn(profile("avg_rsrp"), "wavg", "w"), measureFromColumn(profile("avg_rsrp"), "avg", "plain")],
    });
    expect(res.rows[0].w).toBeCloseTo(-83); // (−80·900 − 110·100) / 1000
    expect(res.rows[0].plain).toBeCloseTo(-95); // το λάθος νούμερο που έδινε το απλό AVG
  });

  it("0/1 flags, ids και raw dBm", () => {
    const rows: Row[] = [
      { SessionId: 101, ASideLocation: "Nova Free A", CallAttemps: 1, CallCompleted: 1, CallDropped: 0, CallFailed: 0, Callconnected: 1, RSRP: -90 },
      { SessionId: 102, ASideLocation: "Nova Free A", CallAttemps: 1, CallCompleted: 0, CallDropped: 1, CallFailed: 0, Callconnected: 1, RSRP: -100 },
      { SessionId: 103, ASideLocation: "Nova Free A", CallAttemps: 1, CallCompleted: 0, CallDropped: 0, CallFailed: 1, Callconnected: 0, RSRP: -105 },
      { SessionId: 104, ASideLocation: "Nova Free A", CallAttemps: 1, CallCompleted: 1, CallDropped: 0, CallFailed: 0, Callconnected: 1, RSRP: -95 },
    ];
    const { get, profile, profiles } = setup(rows);

    expect(profile("SessionId").role).toBe("id");
    expect(profile("CallDropped").role).toBe("flag");
    expect(defaultAgg(profile("CallDropped"))).toBe("rate");
    expect(profile("RSRP").unit).toBe("dBm");
    expect(allowedAggs(profile("RSRP"))).not.toContain("sum");

    const suggestions = suggestCharts(profiles, rows, get);
    const csr = suggestions.find((s) => s.id === "voice-csr")!;
    const dcr = suggestions.find((s) => s.id === "voice-dcr-afr")!;
    expect(csr.x).toBe(OPERATOR_COL);

    const res = aggregate(rows, { x: csr.x, xMode: "category", get, measures: [...csr.measures, ...dcr.measures] });
    expect(res.rows[0].csr).toBeCloseTo(50); // 2 completed / 4 attempts
    expect(res.rows[0].dcr).toBeCloseTo(100 / 3); // 1 dropped / 3 connected
    expect(res.rows[0].afr).toBeCloseTo(25); // 1 failed / 4 attempts
  });
});

describe("deriveDimensions — splits των A-LEVEL", () => {
  it("Operator / Mode από το ASideLocation, Scope / Κατηγορία από το CollectionName", () => {
    const rows: Row[] = [
      { ASideLocation: "Cosmote GSM A", CollectionName: "DT_ATHENS_MAJOR CITIES_2026H2" },
      { ASideLocation: "Vodafone Free A", CollectionName: "DT_PATRA_MOTORWAYS_2026H1" },
    ];
    const { derived, get } = setup(rows);
    expect(derived.map((d) => d.key)).toEqual([OPERATOR_COL, MODE_COL, SCOPE_COL, CATEGORY_COL]);
    expect(get(rows[0], OPERATOR_COL)).toBe("COSMOTE");
    expect(get(rows[0], MODE_COL)).toBe("GSM");
    expect(get(rows[1], MODE_COL)).toBe("FREE");
    expect(get(rows[0], SCOPE_COL)).toBe("2026H2");
    expect(get(rows[1], CATEGORY_COL)).toBe("MOTORWAYS");
  });

  it("δεν ξαναβγάζει Operator όταν η στήλη είναι ήδη καθαρός operator", () => {
    const rows: Row[] = [{ Operator: "COSMOTE" }, { Operator: "VODAFONE" }];
    expect(deriveDimensions(["Operator"], rows).map((d) => d.key)).not.toContain(OPERATOR_COL);
  });
});

describe("aggregate", () => {
  it("split + 100% stack: τα μερίδια κάθε X αθροίζουν 100", () => {
    const rows: Row[] = [
      { op: "A", status: "Completed" },
      { op: "A", status: "Completed" },
      { op: "A", status: "Dropped" },
      { op: "B", status: "Completed" },
    ];
    const res = aggregate(rows, {
      x: "op", xMode: "category", split: "status", get: (r, c) => r[c],
      measures: [{ id: "n", col: ROWS_COL, agg: "count" }],
    });
    const shares = toShares(res);
    expect(shares[0]["n‖Completed"]).toBeCloseTo(66.667, 2);
    expect(shares[0]["n‖Dropped"]).toBeCloseTo(33.333, 2);
    expect(shares[1]["n‖Completed"]).toBe(100);
  });

  it("πολλές κατηγορίες → top-N + «Άλλα» με σωστό aggregate", () => {
    const rows: Row[] = Array.from({ length: 40 }, (_, i) => ({ cell: `C${i}`, v: i < 5 ? 10 : 1 }));
    rows.push(...Array.from({ length: 4 }, () => ({ cell: "C0", v: 10 })));
    const res = aggregate(rows, {
      x: "cell", xMode: "category", get: (r, c) => r[c], maxCategories: 10, sort: "value",
      measures: [{ id: "s", col: "v", agg: "sum" }],
    });
    expect(res.rows).toHaveLength(10);
    expect(res.rows[res.rows.length - 1].__x).toBe(OTHER_LABEL);
    expect(res.foldedCategories).toBe(31);
    const total = res.rows.reduce((acc, r) => acc + (r.s as number), 0);
    expect(total).toBe(5 * 10 + 35 + 40); // τίποτα δεν χάνεται στο fold
  });

  it("median / P10 / P90", () => {
    const rows: Row[] = Array.from({ length: 11 }, (_, i) => ({ k: "x", v: i * 10 }));
    const res = aggregate(rows, {
      x: "k", xMode: "category", get: (r, c) => r[c],
      measures: [{ id: "p50", col: "v", agg: "median" }, { id: "p10", col: "v", agg: "p10" }, { id: "p90", col: "v", agg: "p90" }],
    });
    expect(res.rows[0]).toMatchObject({ p50: 50, p10: 10, p90: 90 });
  });
});

describe("distribution", () => {
  it("PDF αθροίζει 100% και το CDF τελειώνει στο 100%", () => {
    const rows: Row[] = [1.05, 2.3, 2.34, 3.9, 4.1, 4.4].map((mos, i) => ({ g: i % 2 ? "A" : "B", mos }));
    const dist = distribution(rows, (r, c) => r[c], "mos", { split: "g", binWidth: 0.1 });
    for (const g of dist.groups) {
      const pdf = dist.rows.reduce((acc, r) => acc + ((r[g] as number) ?? 0), 0);
      expect(pdf).toBeCloseTo(100);
      expect(dist.cdfRows[0][cdfKey(g)]).toBe(0);
      expect(dist.cdfRows[dist.cdfRows.length - 1][cdfKey(g)]).toBeCloseTo(100);
    }
    expect(dist.binWidth).toBe(0.1);
    // Το CDF σημείο ενός bin κάθεται στο άνω όριο: ≤ 2.4 περιλαμβάνει τα 2.30 / 2.34 (bin 2.3–2.4)
    const at24 = dist.cdfRows.find((r) => Math.abs((r.__x as number) - 2.4) < 1e-9)!;
    expect(at24[cdfKey("A")]).toBeCloseTo(100 / 3); // A = [2.3, 3.9, 4.4]
    expect(at24[cdfKey("B")]).toBeCloseTo(200 / 3); // B = [1.05, 2.34, 4.1]
  });
});

describe("χρόνος", () => {
  it("διαβάζει ISO με microseconds και dd.mm.yyyy", () => {
    expect(parseTime("2026-06-25T11:48:58.123000")).toBe(new Date(2026, 5, 25, 11, 48, 58, 123).getTime());
    expect(parseTime("25.06.2026")).toBe(new Date(2026, 5, 25).getTime());
    expect(parseTime("Cosmote")).toBeNull();
  });

  it("το ημερήσιο bucket ξεκινάει στα τοπικά μεσάνυχτα", () => {
    const t = new Date(2026, 5, 25, 23, 30).getTime();
    expect(bucketTime(t, 86_400_000)).toBe(new Date(2026, 5, 25).getTime());
  });
});
