export const CHART_PALETTE = [
  "hsl(162, 72%, 46%)",
  "hsl(200, 80%, 55%)",
  "hsl(45, 93%, 58%)",
  "hsl(280, 65%, 60%)",
  "hsl(0, 72%, 55%)",
  "hsl(30, 90%, 55%)",
  "hsl(340, 75%, 58%)",
  "hsl(120, 55%, 48%)",
];

export const AXIS_STYLE = {
  tick: { fontSize: 10, fill: "hsl(var(--muted-foreground))" },
} as const;

export const GRID_STYLE = {
  strokeDasharray: "3 3",
  stroke: "hsl(var(--border))",
  opacity: 0.4,
} as const;

export const LEGEND_WRAPPER_STYLE = { fontSize: 11, color: "hsl(215, 12%, 50%)" };

/** Χρώμα ανά RAT για τις μπάρες τεχνολογίας (LTE μπλε, GSM ροζ/σομόν, NR μωβ, 3G τιρκουάζ). */
export function technologyColor(name: string | null | undefined): string {
  const t = (name ?? "").toUpperCase();
  if (!t) return "#475569";
  if (t.includes("NR") || t.includes("5G")) return "#a855f7";
  if (t.includes("CA")) return "#1d4ed8";
  if (t.includes("LTE") || t.includes("E-UTRA")) return "#3b82f6";
  if (t.includes("WCDMA") || t.includes("UMTS") || t.includes("HSPA") || t.includes("3G")) return "#14b8a6";
  if (t.includes("GSM") || t.includes("GPRS") || t.includes("EDGE") || t.includes("2G")) return "#fb7185";
  return "#64748b";
}

export const DEFAULTS = {
  areaFillOpacity: 0.1,
  radarFillOpacity: 0.15,
  barFillOpacity: 0.85,
  strokeWidth: 2,
};
