import { motion } from "framer-motion";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar,
  Legend, AreaChart, Area,
} from "recharts";
import type { BenchmarkResult, CellValue } from "@/types/benchmark";
import { CHART_PALETTE, LEGEND_WRAPPER_STYLE, DEFAULTS, AXIS_STYLE, GRID_STYLE } from "@/lib/chartStyles";

interface BenchmarkChartsProps {
  results: BenchmarkResult[];
}

const COUNT_COL_PATTERN = /^(count|total|calls|cnt|num|n_|rows)/i;
const AVG_COL_PATTERN = /^(avg|mean|mos|rate|pct|percent|ratio|score)/i;

const pickGroupedValueCol = (numCols: string[]) =>
  numCols.find((c) => AVG_COL_PATTERN.test(c)) ??
  numCols.find((c) => !COUNT_COL_PATTERN.test(c)) ??
  numCols[0];

// Pivot rows shaped like (collection, location, value) into one row per
// collection with one column per location, so collection becomes the
// primary grouping and location the side-by-side bars within it.
const buildGroupedData = (
  data: Record<string, CellValue>[],
  primaryCol: string,
  secondaryCol: string,
  valueCol: string
) => {
  const primaryOrder: string[] = [];
  const secondaryOrder: string[] = [];
  const rows = new Map<string, Record<string, CellValue>>();

  data.forEach((row) => {
    const primary = String(row[primaryCol] ?? "");
    const secondary = String(row[secondaryCol] ?? "");
    if (!rows.has(primary)) {
      rows.set(primary, { [primaryCol]: primary });
      primaryOrder.push(primary);
    }
    if (!secondaryOrder.includes(secondary)) secondaryOrder.push(secondary);
    rows.get(primary)![secondary] = row[valueCol];
  });

  return {
    data: primaryOrder.map((p) => rows.get(p)!),
    series: secondaryOrder,
  };
};

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload) return null;
  return (
    <div className="bg-popover border border-border rounded-md px-3 py-2 shadow-lg text-xs">
      <p className="font-medium text-foreground mb-1">{label}</p>
      {payload.map((entry: any, i: number) => (
        <p key={i} style={{ color: entry.color }} className="font-mono">
          {entry.name}: {typeof entry.value === "number" ? entry.value.toLocaleString("el-GR", { maximumFractionDigits: 2 }) : entry.value}
        </p>
      ))}
    </div>
  );
};

const BenchmarkCharts = ({ results }: BenchmarkChartsProps) => {
  if (results.length === 0) return null;

  const numericColumns = (result: BenchmarkResult) =>
    result.columns.filter((col) =>
      result.data.some((row) => typeof row[col] === "number")
    );

  const categoricalColumns = (result: BenchmarkResult) =>
    result.columns.filter((col) =>
      result.data.some((row) => typeof row[col] === "string")
    );

  const categoryColumn = (result: BenchmarkResult) =>
    categoricalColumns(result)[0] || result.columns[0];

  return (
    <div className="space-y-6">
      {results.map((result, idx) => {
        const numCols = numericColumns(result);
        const catCol = categoryColumn(result);
        if (numCols.length === 0) return null;

        const catCols = categoricalColumns(result);
        const isGrouped = catCols.length >= 2;
        const groupedValueCol = isGrouped ? pickGroupedValueCol(numCols) : undefined;
        const grouped = isGrouped && groupedValueCol
          ? buildGroupedData(result.data, catCols[0], catCols[1], groupedValueCol)
          : null;

        const chartType = grouped ? "grouped-bar" : numCols.length >= 3 ? "radar" : result.data.length > 8 ? "area" : "bar";

        return (
          <motion.div
            key={result.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.15 }}
            className="bg-card border border-border rounded-lg p-4"
          >
            <div className="flex items-center gap-2 mb-4">
              <span className="text-xs font-mono bg-accent/10 text-accent px-2 py-0.5 rounded">
                Q{idx + 1}
              </span>
              <span className="text-sm font-medium text-foreground">
                {result.queryLabel}
              </span>
            </div>

            <div className={grouped ? "" : "h-96"} style={grouped ? { height: Math.max(384, grouped.data.length * 96) } : undefined}>
              <ResponsiveContainer width="100%" height="100%">
                {chartType === "grouped-bar" && grouped ? (
                  <BarChart
                    data={grouped.data}
                    layout="vertical"
                    margin={{ left: 8, right: 12, top: 4, bottom: 4 }}
                    barCategoryGap="35%"
                    barGap={14}
                  >
                    <CartesianGrid {...GRID_STYLE} />
                    <XAxis
                      type="number"
                      domain={groupedValueCol?.toLowerCase().includes("mos") ? [0, 5] : undefined}
                      {...AXIS_STYLE}
                    />
                    <YAxis type="category" dataKey={catCols[0]} {...AXIS_STYLE} width={200} />
                    {grouped.series.map((s, i) => (
                      <Bar
                        key={s}
                        dataKey={s}
                        name={s}
                        barSize={36}
                        fill={CHART_PALETTE[i % CHART_PALETTE.length]}
                        radius={[0, 4, 4, 0]}
                        fillOpacity={DEFAULTS.barFillOpacity}
                      />
                    ))}
                    <Legend wrapperStyle={LEGEND_WRAPPER_STYLE} />
                    <Tooltip content={<CustomTooltip />} cursor={{ fill: "hsl(220, 14%, 14%)" }} />
                  </BarChart>
                ) : chartType === "radar" ? (
                  <RadarChart data={result.data}>
                      <PolarGrid stroke={GRID_STYLE.stroke} strokeDasharray={GRID_STYLE.strokeDasharray} />
                      <PolarAngleAxis dataKey={catCol} {...AXIS_STYLE} />
                      <PolarRadiusAxis {...AXIS_STYLE} />
                    {numCols.slice(0, 3).map((col, i) => (
                      <Radar
                        key={col}
                        name={col}
                        dataKey={col}
                        stroke={CHART_PALETTE[i % CHART_PALETTE.length]}
                        fill={CHART_PALETTE[i % CHART_PALETTE.length]}
                        fillOpacity={DEFAULTS.radarFillOpacity}
                      />
                    ))}
                    <Legend wrapperStyle={{ fontSize: 11, color: "hsl(215, 12%, 50%)" }} />
                    <Tooltip content={<CustomTooltip />} />
                  </RadarChart>
                ) : chartType === "area" ? (
                  <AreaChart data={result.data}>
                    <CartesianGrid {...GRID_STYLE} />
                    <XAxis dataKey={catCol} {...AXIS_STYLE} />
                    <YAxis {...AXIS_STYLE} />
                    {numCols.map((col, i) => (
                      <Area
                        key={col}
                        type="monotone"
                        dataKey={col}
                        stroke={CHART_PALETTE[i % CHART_PALETTE.length]}
                        fill={CHART_PALETTE[i % CHART_PALETTE.length]}
                        fillOpacity={DEFAULTS.areaFillOpacity}
                        strokeWidth={DEFAULTS.strokeWidth}
                      />
                    ))}
                    <Legend wrapperStyle={LEGEND_WRAPPER_STYLE} />
                    <Tooltip content={<CustomTooltip />} />
                  </AreaChart>
                ) : (
                  <BarChart data={result.data}>
                    <CartesianGrid {...GRID_STYLE} />
                    <XAxis dataKey={catCol} {...AXIS_STYLE} />
                    <YAxis {...AXIS_STYLE} />
                    {numCols.map((col, i) => (
                      <Bar
                        key={col}
                        dataKey={col}
                        fill={CHART_PALETTE[i % CHART_PALETTE.length]}
                        radius={[4, 4, 0, 0]}
                        fillOpacity={DEFAULTS.barFillOpacity}
                      />
                    ))}
                    <Legend wrapperStyle={LEGEND_WRAPPER_STYLE} />
                    <Tooltip content={<CustomTooltip />} cursor={{ fill: "hsl(220, 14%, 14%)" }} />
                  </BarChart>
                )}
              </ResponsiveContainer>
            </div>
          </motion.div>
        );
      })}
    </div>
  );
};

export default BenchmarkCharts;
