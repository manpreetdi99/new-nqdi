/**
 * Χρωματικές κλίμακες του Query Map (ported από τα Python panels) και τα
 * helpers που τις διαβάζουν: χρώμα ανά τιμή, κλειδί bucket για το legend,
 * μετρητές ανά bucket και δυναμικός χρωματισμός PCI.
 */
import type { CellValue } from "@/types/benchmark";

// ── Color schemes (ported from Python panel_data.py / panel_free.py / panel_gsm.py) ─
export type RangeBucket = { min: number; max: number; color: string; label: string };
export type CategoryEntry = { value: string; color: string };

export interface RangeScheme {
  type: "range";
  label: string;
  suggestCol: string;
  buckets: RangeBucket[];
}
export interface CategoryScheme {
  type: "category";
  label: string;
  suggestCol: string;
  categories: CategoryEntry[];
  defaultColor: string;
}
export type ColorScheme = RangeScheme | CategoryScheme;

export const COLOR_SCHEMES: Record<string, ColorScheme> = {
  rsrp_data: {
    type: "range",
    label: "RSRP – DATA panel (dBm)",
    suggestCol: "rsrp",
    buckets: [
      { min: -50, max: -30, color: "#3E0480", label: "-50 to -30" },
      { min: -65, max: -50, color: "#7F00D3", label: "-65 to -50" },
      { min: -75, max: -65, color: "#7E3D3E", label: "-75 to -65" },
      { min: -85, max: -75, color: "#FE0707", label: "-85 to -75" },
      { min: -95, max: -85, color: "#0808FE", label: "-95 to -85" },
      { min: -105, max: -95, color: "#B1FEFC", label: "-105 to -95" },
      { min: -120, max: -105, color: "#14FE14", label: "-120 to -105" },
      { min: -160, max: -120, color: "#FEFE25", label: "-160 to -120" },
    ],
  },
  rsrp_free: {
    type: "range",
    label: "RSRP – FREE panel (dBm)",
    suggestCol: "rsrp",
    buckets: [
      { min: -50, max: -30, color: "#035E03", label: "-50 to -30" },
      { min: -65, max: -50, color: "#00ff00", label: "-65 to -50" },
      { min: -75, max: -65, color: "#99ff00", label: "-75 to -65" },
      { min: -85, max: -75, color: "#00ffff", label: "-85 to -75" },
      { min: -95, max: -85, color: "#ffff00", label: "-95 to -85" },
      { min: -105, max: -95, color: "#ff9900", label: "-105 to -95" },
      { min: -120, max: -105, color: "#ff0000", label: "-120 to -105" },
      { min: -150, max: -120, color: "#800000", label: "-150 to -120" },
    ],
  },
  dl_throughput: {
    type: "range",
    label: "DL Throughput (kbps)",
    suggestCol: "DLThrpt",
    buckets: [
      { min: 350000, max: 1000000, color: "#3F007D", label: "350.000–1.000.000" },
      { min: 100000, max: 350000,  color: "#7A0A00", label: "100.000–350.000" },
      { min: 50000,  max: 100000,  color: "#FF0000", label: "50.000–100.000" },
      { min: 20000,  max: 50000,   color: "#FF8A00", label: "20.000–50.000" },
      { min: 5000,   max: 20000,   color: "#0076FF", label: "5.000–20.000" },
      { min: 350,    max: 5000,    color: "#00EEFF", label: "350–5.000" },
      { min: 0,      max: 350,     color: "#00FF00", label: "0–350" },
    ],
  },
  ul_throughput: {
    type: "range",
    label: "UL Throughput (kbps)",
    suggestCol: "ULThrpt",
    buckets: [
      { min: 150000, max: 500000, color: "#3F007D", label: "150.000–500.000" },
      { min: 30000,  max: 150000, color: "#7A0A00", label: "30.000–150.000" },
      { min: 15000,  max: 30000,  color: "#FF0000", label: "15.000–30.000" },
      { min: 5000,   max: 15000,  color: "#FF8A00", label: "5.000–15.000" },
      { min: 350,    max: 5000,   color: "#0076FF", label: "350–5.000" },
      { min: 0,      max: 350,    color: "#00FF00", label: "0–350" },
    ],
  },
  rxlevsub_gsm: {
    type: "range",
    label: "RxLevSub – GSM (dBm)",
    suggestCol: "RxLevSub",
    buckets: [
      { min: -69,  max: 0,    color: "#5e0000", label: "-69 to 0" },
      { min: -72,  max: -69,  color: "#ff0000", label: "-72 to -69" },
      { min: -82,  max: -72,  color: "#ff8000", label: "-82 to -72" },
      { min: -90,  max: -82,  color: "#0000ff", label: "-90 to -82" },
      { min: -100, max: -90,  color: "#00ffff", label: "-100 to -90" },
      { min: -140, max: -100, color: "#00ff00", label: "-140 to -100" },
    ],
  },
  rxqualsub_gsm: {
    type: "range",
    label: "RxQualSub – GSM (0–7)",
    suggestCol: "RxQualSub",
    buckets: [
      { min: 0, max: 1, color: "#00ff00",  label: "0 (best)" },
      { min: 1, max: 2, color: "#80ff00",  label: "1" },
      { min: 2, max: 3, color: "#ffff00",  label: "2" },
      { min: 3, max: 4, color: "#ffcc00",  label: "3" },
      { min: 4, max: 5, color: "#ff8000",  label: "4" },
      { min: 5, max: 6, color: "#ff4000",  label: "5" },
      { min: 6, max: 7, color: "#ff0000",  label: "6" },
      { min: 7, max: 8, color: "#800000",  label: "7 (worst)" },
    ],
  },
  mos_lq: {
    type: "range",
    label: "MOS / LQ (1–5)",
    suggestCol: "LQ",
    buckets: [
      { min: 4.0, max: 5.1, color: "#00ff00",  label: "4.0 – 5.0 (Excellent)" },
      { min: 3.6, max: 4.0, color: "#80ff00",  label: "3.6 – 4.0 (Good)" },
      { min: 3.1, max: 3.6, color: "#ffff00",  label: "3.1 – 3.6 (Fair)" },
      { min: 2.6, max: 3.1, color: "#ff8000",  label: "2.6 – 3.1 (Poor)" },
      { min: 1.0, max: 2.6, color: "#ff0000",  label: "1.0 – 2.6 (Bad)" },
    ],
  },
  call_status: {
    type: "category",
    label: "Call Status",
    suggestCol: "callStatus",
    categories: [
      { value: "Completed",      color: "#00ff00" },
      { value: "Failed",         color: "#ff8000" },
      { value: "System Release", color: "#d400ff" },
      { value: "Dropped",        color: "#ff0000" },
    ],
    defaultColor: "#808080",
  },
  call_fail_drop: {
    type: "category",
    label: "Problem Calls – Drop / Fail",
    suggestCol: "status",
    categories: [
      { value: "Dropped", color: "#ff0000" },
      { value: "Failed",  color: "#ff8000" },
    ],
    defaultColor: "#808080",
  },
  cst_duration: {
    type: "range",
    label: "CST – Duration (s)",
    suggestCol: "Duration_s",
    buckets: [
      { min: 0,   max: 0.5,    color: "#006400", label: "0 – 0.5" },
      { min: 0.5, max: 1.0,    color: "#7ed957", label: "0.5 – 1.0" },
      { min: 1.0, max: 1.5,    color: "#d4a800", label: "1.0 – 1.5" },
      { min: 1.5, max: 2.0,    color: "#ff8c00", label: "1.5 – 2.0" },
      { min: 2.0, max: 3.0,    color: "#ff4500", label: "2.0 – 3.0" },
      { min: 3.0, max: 100000, color: "#c00000", label: "> 3.0" },
    ],
  },
  cst_duration_11013: {
    type: "range",
    label: "CST 11013 – Duration (s)",
    suggestCol: "Duration_s",
    buckets: [
      { min: 1.0, max: 2.0,    color: "#006400", label: "1.0 – 2.0" },
      { min: 2.0, max: 2.5,    color: "#7ed957", label: "2.0 – 2.5" },
      { min: 2.5, max: 3.0,    color: "#d4a800", label: "2.5 – 3.0" },
      { min: 3.0, max: 100000, color: "#c00000", label: "> 3.0" },
    ],
  },
  http_transfer: {
    type: "range",
    label: "HTTP Transfer / 10MB (kbps)",
    suggestCol: "throughput",
    buckets: [
      { min: 350000, max: 1000000, color: "#3F007D", label: "350.000–1.000.000" },
      { min: 100000, max: 350000,  color: "#6F0300", label: "100.000–350.000" },
      { min: 50000,  max: 100000,  color: "#FF0000", label: "50.000–100.000" },
      { min: 20000,  max: 50000,   color: "#FF7A00", label: "20.000–50.000" },
      { min: 5000,   max: 20000,   color: "#0072FF", label: "5.000–20.000" },
      { min: 350,    max: 5000,    color: "#00EDFF", label: "350–5.000" },
      { min: 0,      max: 350,     color: "#39FF00", label: "0–350" },
    ],
  },
  technology_free: {
    type: "category",
    label: "Technology – FREE / GSM",
    suggestCol: "technology",
    categories: [
      { value: "GSM 900",       color: "#00ffff" },
      { value: "GSM 1800",      color: "#0000ff" },
      { value: "LTE E-UTRA 1",  color: "#800000" },
      { value: "LTE E-UTRA 3",  color: "#008000" },
      { value: "LTE E-UTRA 20", color: "#ff9900" },
      { value: "LTE E-UTRA 28", color: "#800080" },
      { value: "LTE E-UTRA 7",  color: "#ff0000" },
      { value: "LTE E-UTRA 8",  color: "#A24FFF" },
    ],
    defaultColor: "#808080",
  },
  technology_data: {
    type: "category",
    label: "DATA Technology – (LTE/5G)",
    suggestCol: "technology_data",
    categories: [
      { value: "5G NR CA", color: "#045231" },
      { value: "5G NR", color: "#002d80" },
      { value: "LTE-5G NR", color: "#800080" },
      { value: "LTE CA",    color: "#ff0000" },
      { value: "LTE",       color: "#e5ff00" },
    ],
    defaultColor: "#808080",
  },
  ookla_dl: {
    type: "range",
    label: "OOKLA DL Throughput (Mbps)",
    suggestCol: "ookla_dl",
    buckets: [
      { min: 300, max: 100000, color: "#1B5E20", label: "≥ 300 Mbps" },
      { min: 100, max: 300,   color: "#8BC34A", label: "100–300 Mbps" },
      { min: 50,  max: 100,   color: "#FFEB00", label: "50–100 Mbps" },
      { min: 20,  max: 50,    color: "#FF8A00", label: "20–50 Mbps" },
      { min: 10,  max: 20,    color: "#FF0000", label: "10–20 Mbps" },
      { min: 1,   max: 10,    color: "#7A0A00", label: "1–10 Mbps" },
      { min: 0,   max: 1,     color: "#000000", label: "0–1 Mbps" },
    ],
  },
  ookla_ul: {
    type: "range",
    label: "OOKLA UL Throughput (Mbps)",
    suggestCol: "ookla_ul",
    buckets: [
      { min: 100, max: 100000, color: "#1B5E20", label: "≥ 100 Mbps" },
      { min: 50,  max: 100,   color: "#8BC34A", label: "50–100 Mbps" },
      { min: 20,  max: 50,    color: "#FFEB00", label: "20–50 Mbps" },
      { min: 5,   max: 20,    color: "#FF8A00", label: "5–20 Mbps" },
      { min: 1,   max: 5,     color: "#FF0000", label: "1–5 Mbps" },
      { min: 0,   max: 1,     color: "#000000", label: "0–1 Mbps" },
    ],
  },
  ookla_latency: {
    type: "range",
    label: "OOKLA Latency (ms)",
    suggestCol: "ookla_latency",
    buckets: [
      { min: 0,   max: 20,   color: "#035E03", label: "0–20 ms (εξαιρετικό)" },
      { min: 20,  max: 50,   color: "#00FF00", label: "20–50 ms" },
      { min: 50,  max: 100,  color: "#FEFE25", label: "50–100 ms" },
      { min: 100, max: 200,  color: "#FF8A00", label: "100–200 ms" },
      { min: 200, max: 500,  color: "#FF0000", label: "200–500 ms" },
      { min: 500, max: 9999, color: "#7A0A00", label: "> 500 ms" },
    ],
  },
  nr5g_ssrsrp: {
    type: "range",
    label: "5G SS-RSRP (dBm)",
    suggestCol: "SS-RSRP",
    buckets: [
      { min: -44,  max: 0,    color: "#3E0480", label: "-44 to 0" },
      { min: -60,  max: -44,  color: "#035E03", label: "-60 to -44" },
      { min: -70,  max: -60,  color: "#00ff00", label: "-70 to -60" },
      { min: -80,  max: -70,  color: "#99ff00", label: "-80 to -70" },
      { min: -90,  max: -80,  color: "#00ffff", label: "-90 to -80" },
      { min: -100, max: -90,  color: "#ffff00", label: "-100 to -90" },
      { min: -110, max: -100, color: "#ff9900", label: "-110 to -100" },
      { min: -156, max: -110, color: "#ff0000", label: "-156 to -110" },
    ],
  },
  lte_rsrq: {
    type: "range",
    label: "LTE Scanner RSRQ (dB)",
    suggestCol: "RSRQ",
    buckets: [
      { min: -3,  max: 0,   color: "#3E0480", label: "-3 to 0 (εξαιρετικό)" },
      { min: -6,  max: -3,  color: "#035E03", label: "-6 to -3" },
      { min: -10, max: -6,  color: "#00ff00", label: "-10 to -6" },
      { min: -13, max: -10, color: "#ffff00", label: "-13 to -10" },
      { min: -16, max: -13, color: "#ff9900", label: "-16 to -13" },
      { min: -20, max: -16, color: "#ff0000", label: "-20 to -16" },
      { min: -40, max: -20, color: "#800000", label: "< -20 (πολύ χαμηλό)" },
    ],
  },
  rxlev_scanner_gsm: {
    type: "range",
    label: "GSM Scanner RxLev (dBm)",
    suggestCol: "RxLev",
    buckets: [
      { min: -50, max: 0,    color: "#3E0480", label: "≥ -50 (εξαιρετικό)" },
      { min: -60, max: -50,  color: "#035E03", label: "-50 to -60" },
      { min: -70, max: -60,  color: "#00ff00", label: "-60 to -70" },
      { min: -80, max: -70,  color: "#99ff00", label: "-70 to -80" },
      { min: -90, max: -80,  color: "#ffff00", label: "-80 to -90" },
      { min: -100, max: -90, color: "#ff9900", label: "-90 to -100" },
      { min: -110, max: -100, color: "#ff0000", label: "-100 to -110" },
      { min: -200, max: -110, color: "#800000", label: "< -110 (πολύ χαμηλό)" },
    ],
  },
  pci_lte: {
    // Categories are computed dynamically per-query (see buildDynamicPciCategories):
    // the N most-sampled PCI values each get a distinct color; every other PCI
    // falls through to defaultColor. Static placeholder here just for suggestCol.
    type: "category",
    label: "PCI (top values by sample count)",
    suggestCol: "PCI",
    categories: [],
    defaultColor: "#808080",
  },
  nr5g_sssinr: {
    type: "range",
    label: "5G SS-SINR (dB)",
    suggestCol: "SS-SINR",
    buckets: [
      { min: 20,  max: 50,  color: "#3E0480", label: "≥20 dB" },
      { min: 13,  max: 20,  color: "#035E03", label: "13–20 dB" },
      { min: 0,   max: 13,  color: "#00ff00", label: "0–13 dB" },
      { min: -3,  max: 0,   color: "#ffff00", label: "-3–0 dB" },
      { min: -10, max: -3,  color: "#ff9900", label: "-10–(-3) dB" },
      { min: -23, max: -10, color: "#ff0000", label: "-23–(-10) dB" },
    ],
  },
};

// ── Color lookup helpers ──────────────────────────────────────────────────────
export function colorForValue(scheme: ColorScheme, val: CellValue): string {
  if (scheme.type === "range") {
    const n = Number(val);
    if (isNaN(n)) return "#808080";
    for (const b of scheme.buckets) {
      if (n >= b.min && n < b.max) return b.color;
    }
    return "#808080";
  }
  // category
  const str = String(val ?? "").trim();
  const entry = scheme.categories.find((c) => c.value === str);
  return entry ? entry.color : scheme.defaultColor;
}

// ── Legend bucket/category key for a raw value (drives legend click-to-filter) ─
export function bucketKeyForValue(scheme: ColorScheme, val: CellValue): string | null {
  if (scheme.type === "range") {
    const n = Number(val);
    if (isNaN(n)) return null;
    const b = scheme.buckets.find((bb) => n >= bb.min && n < bb.max);
    return b ? b.label : null;
  }
  const str = String(val ?? "").trim();
  return str || null;
}

// ── Aggregate-mode color (normalized rank 0–1) ────────────────────────────────
export function bubbleColor(rank: number): { fill: string; stroke: string } {
  if (rank >= 0.8) return { fill: "#ef4444", stroke: "#dc2626" };
  if (rank >= 0.6) return { fill: "#f97316", stroke: "#ea580c" };
  if (rank >= 0.4) return { fill: "#eab308", stroke: "#ca8a04" };
  if (rank >= 0.2) return { fill: "#22c55e", stroke: "#16a34a" };
  return { fill: "#3b82f6", stroke: "#2563eb" };
}

export const BUBBLE_TIERS = [
  { label: "Πολύ Υψηλό",  fill: "#ef4444", min: 0.8 },
  { label: "Υψηλό",       fill: "#f97316", min: 0.6 },
  { label: "Μέτριο",      fill: "#eab308", min: 0.4 },
  { label: "Χαμηλό",      fill: "#22c55e", min: 0.2 },
  { label: "Πολύ Χαμηλό", fill: "#3b82f6", min: -Infinity },
] as const;

export function bubbleTierLabel(rank: number): string {
  return (BUBBLE_TIERS.find((t) => rank >= t.min) ?? BUBBLE_TIERS[BUBBLE_TIERS.length - 1]).label;
}


// ── Compute bucket counters for legend ───────────────────────────────────────
export function computeBucketCounters(
  rows: Record<string, CellValue>[],
  valueCol: string,
  scheme: ColorScheme,
): Map<string, number> {
  const counters = new Map<string, number>();
  if (scheme.type === "range") {
    for (const b of scheme.buckets) counters.set(b.label, 0);
    for (const row of rows) {
      const n = Number(row[valueCol]);
      if (isNaN(n)) continue;
      const bucket = scheme.buckets.find((b) => n >= b.min && n < b.max);
      if (bucket) counters.set(bucket.label, (counters.get(bucket.label) ?? 0) + 1);
    }
  } else {
    for (const c of scheme.categories) counters.set(c.value, 0);
    for (const row of rows) {
      const str = String(row[valueCol] ?? "").trim();
      counters.set(str, (counters.get(str) ?? 0) + 1);
    }
  }
  return counters;
}

// ── Dynamic PCI coloring: the N most-sampled PCI values get distinct colors; ──
// everything else falls back to the scheme's defaultColor (no fixed 1-99/100-199… bands).
export const DYNAMIC_PCI_COLORS = [
  "#e6194b", "#3cb44b", "#ffe119", "#4363d8", "#f58231",
  "#911eb4", "#46f0f0", "#f032e6", "#bcf60c", "#008080",
];

export function buildDynamicPciCategories(rows: Record<string, CellValue>[], valueCol: string): CategoryEntry[] {
  if (!valueCol) return [];
  const counts = new Map<string, number>();
  for (const row of rows) {
    const raw = row[valueCol];
    if (raw === null || raw === undefined || raw === "") continue;
    const key = String(raw).trim();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, DYNAMIC_PCI_COLORS.length)
    .map(([value], i) => ({ value, color: DYNAMIC_PCI_COLORS[i] }));
}
