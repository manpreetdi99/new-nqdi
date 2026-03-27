import { motion } from "framer-motion";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar,
  Legend, AreaChart, Area,
} from "recharts";
import type { BenchmarkResult } from "@/types/benchmark";

interface BenchmarkChartsProps {
  results: BenchmarkResult[];
}

const CHART_COLORS = [
  "hsl(162, 72%, 46%)",
  "hsl(200, 80%, 55%)",
  "hsl(45, 93%, 58%)",
  "hsl(280, 65%, 60%)",
  "hsl(0, 72%, 55%)",
];

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

  const categoryColumn = (result: BenchmarkResult) =>
    result.columns.find((col) =>
      result.data.some((row) => typeof row[col] === "string")
    ) || result.columns[0];

  return (
    <div className="space-y-6">
      {results.map((result, idx) => {
        const numCols = numericColumns(result);
        const catCol = categoryColumn(result);
        if (numCols.length === 0) return null;

        const chartType = numCols.length >= 3 ? "radar" : result.data.length > 8 ? "area" : "bar";

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

            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                {chartType === "radar" ? (
                  <RadarChart data={result.data}>
                    <PolarGrid stroke="hsl(220, 14%, 18%)" />
                    <PolarAngleAxis dataKey={catCol} tick={{ fill: "hsl(215, 12%, 50%)", fontSize: 11 }} />
                    <PolarRadiusAxis tick={{ fill: "hsl(215, 12%, 50%)", fontSize: 10 }} />
                    {numCols.slice(0, 3).map((col, i) => (
                      <Radar
                        key={col}
                        name={col}
                        dataKey={col}
                        stroke={CHART_COLORS[i]}
                        fill={CHART_COLORS[i]}
                        fillOpacity={0.15}
                      />
                    ))}
                    <Legend wrapperStyle={{ fontSize: 11, color: "hsl(215, 12%, 50%)" }} />
                    <Tooltip content={<CustomTooltip />} />
                  </RadarChart>
                ) : chartType === "area" ? (
                  <AreaChart data={result.data}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(220, 14%, 18%)" />
                    <XAxis dataKey={catCol} tick={{ fill: "hsl(215, 12%, 50%)", fontSize: 11 }} />
                    <YAxis tick={{ fill: "hsl(215, 12%, 50%)", fontSize: 11 }} />
                    {numCols.map((col, i) => (
                      <Area
                        key={col}
                        type="monotone"
                        dataKey={col}
                        stroke={CHART_COLORS[i]}
                        fill={CHART_COLORS[i]}
                        fillOpacity={0.1}
                        strokeWidth={2}
                      />
                    ))}
                    <Legend wrapperStyle={{ fontSize: 11, color: "hsl(215, 12%, 50%)" }} />
                    <Tooltip content={<CustomTooltip />} />
                  </AreaChart>
                ) : (
                  <BarChart data={result.data}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(220, 14%, 18%)" />
                    <XAxis dataKey={catCol} tick={{ fill: "hsl(215, 12%, 50%)", fontSize: 11 }} />
                    <YAxis tick={{ fill: "hsl(215, 12%, 50%)", fontSize: 11 }} />
                    {numCols.map((col, i) => (
                      <Bar
                        key={col}
                        dataKey={col}
                        fill={CHART_COLORS[i]}
                        radius={[4, 4, 0, 0]}
                        fillOpacity={0.85}
                      />
                    ))}
                    <Legend wrapperStyle={{ fontSize: 11, color: "hsl(215, 12%, 50%)" }} />
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
