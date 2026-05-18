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

export const DEFAULTS = {
  areaFillOpacity: 0.1,
  radarFillOpacity: 0.15,
  barFillOpacity: 0.85,
  strokeWidth: 2,
};
