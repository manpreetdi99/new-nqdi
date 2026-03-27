import { useState } from "react";
import { Play, Plus, X, Database, Code, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { motion, AnimatePresence } from "framer-motion";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";

interface QueryEditorProps {
  onRunQueries: (queries: string[]) => void;
  isRunning: boolean;
}

type QueryMode = "default" | "builder";

interface BuilderQuery {
  selectFields: string[];
  fromTable: string;
  whereClause: string;
  groupByClause: string;
}

const SAMPLE_QUERIES = [
  "SELECT TOP 100 * FROM CallTable ORDER BY StartTime DESC",
  "SELECT Operator, COUNT(*) as TotalCalls, SUM(CASE WHEN CallStatus = 'Dropped' THEN 1 ELSE 0 END) as DroppedCalls FROM CallTable GROUP BY Operator",
  "SELECT Technology, AVG(DL_Throughput) as Avg_DL, AVG(UL_Throughput) as Avg_UL, COUNT(*) as Samples FROM CallTable GROUP BY Technology ORDER BY Avg_DL DESC",
];

const AVAILABLE_FIELDS = [
  { value: "Operator", label: "Operator" },
  { value: "Technology", label: "Technology" },
  { value: "CallType", label: "Call Type" },
  { value: "CallStatus", label: "Call Status" },
  { value: "Region", label: "Region" },
  { value: "StartTime", label: "Start Time" },
  { value: "EndTime", label: "End Time" },
  { value: "Duration", label: "Duration" },
  { value: "DL_Throughput", label: "DL Throughput" },
  { value: "UL_Throughput", label: "UL Throughput" },
  { value: "Latency", label: "Latency" },
  { value: "RSRP", label: "RSRP" },
  { value: "RSRQ", label: "RSRQ" },
  { value: "SINR", label: "SINR" },
  { value: "COUNT(*)", label: "COUNT(*)" },
  { value: "AVG(DL_Throughput)", label: "AVG(DL_Throughput)" },
  { value: "AVG(UL_Throughput)", label: "AVG(UL_Throughput)" },
  { value: "AVG(Latency)", label: "AVG(Latency)" },
  { value: "MAX(DL_Throughput)", label: "MAX(DL_Throughput)" },
  { value: "MIN(Latency)", label: "MIN(Latency)" },
];

const AVAILABLE_TABLES = [
  { value: "CallTable", label: "CallTable" },
  { value: "EventTable", label: "EventTable" },
  { value: "MeasurementTable", label: "MeasurementTable" },
  { value: "CellInfo", label: "CellInfo" },
  { value: "SignalSamples", label: "SignalSamples" },
];

const defaultBuilder: BuilderQuery = {
  selectFields: ["Operator", "AVG(DL_Throughput)"],
  fromTable: "CallTable",
  whereClause: "",
  groupByClause: "Operator",
};

function buildQueryString(b: BuilderQuery): string {
  const select = b.selectFields.length > 0 ? b.selectFields.join(", ") : "*";
  let sql = `SELECT ${select} FROM ${b.fromTable}`;
  if (b.whereClause.trim()) sql += ` WHERE ${b.whereClause.trim()}`;
  if (b.groupByClause.trim()) sql += ` GROUP BY ${b.groupByClause.trim()}`;
  return sql;
}

const QueryEditor = ({ onRunQueries, isRunning }: QueryEditorProps) => {
  const [mode, setMode] = useState<QueryMode>("default");

  // Default mode state
  const [queries, setQueries] = useState<string[]>([SAMPLE_QUERIES[0]]);

  // Builder mode state
  const [builders, setBuilders] = useState<BuilderQuery[]>([{ ...defaultBuilder }]);

  const addQuery = () => {
    if (mode === "default") {
      const nextSample = SAMPLE_QUERIES[queries.length % SAMPLE_QUERIES.length];
      setQueries([...queries, nextSample]);
    } else {
      setBuilders([...builders, { ...defaultBuilder }]);
    }
  };

  const removeQuery = (index: number) => {
    if (mode === "default") {
      if (queries.length > 1) setQueries(queries.filter((_, i) => i !== index));
    } else {
      if (builders.length > 1) setBuilders(builders.filter((_, i) => i !== index));
    }
  };

  const updateQuery = (index: number, value: string) => {
    const updated = [...queries];
    updated[index] = value;
    setQueries(updated);
  };

  const updateBuilder = (index: number, partial: Partial<BuilderQuery>) => {
    const updated = [...builders];
    updated[index] = { ...updated[index], ...partial };
    setBuilders(updated);
  };

  const toggleField = (builderIndex: number, field: string) => {
    const current = builders[builderIndex].selectFields;
    const next = current.includes(field)
      ? current.filter((f) => f !== field)
      : [...current, field];
    updateBuilder(builderIndex, { selectFields: next });
  };

  const handleRun = () => {
    if (mode === "default") {
      onRunQueries(queries);
    } else {
      onRunQueries(builders.map(buildQueryString));
    }
  };

  const allValid =
    mode === "default"
      ? queries.every((q) => q.trim())
      : builders.every((b) => b.selectFields.length > 0 && b.fromTable);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Database className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Query Editor
          </h2>
        </div>
        <div className="flex gap-2">
          {/* Mode toggle */}
          <div className="flex border border-border rounded-md overflow-hidden">
            <button
              onClick={() => setMode("default")}
              className={`px-3 py-1.5 text-xs font-medium flex items-center gap-1 transition-colors ${
                mode === "default"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:text-foreground"
              }`}
            >
              <Code className="h-3 w-3" /> SQL
            </button>
            <button
              onClick={() => setMode("builder")}
              className={`px-3 py-1.5 text-xs font-medium flex items-center gap-1 transition-colors ${
                mode === "builder"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:text-foreground"
              }`}
            >
              <Settings2 className="h-3 w-3" /> Builder
            </button>
          </div>

          <Button variant="outline" size="sm" onClick={addQuery}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Add Query
          </Button>
          <Button
            size="sm"
            onClick={handleRun}
            disabled={isRunning || !allValid}
            className="glow-primary"
          >
            <Play className="h-3.5 w-3.5 mr-1" />
            {isRunning ? "Running..." : "Run Benchmark"}
          </Button>
        </div>
      </div>

      <AnimatePresence mode="wait">
        {mode === "default" ? (
          <motion.div
            key="default"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="space-y-2"
          >
            {queries.map((query, index) => (
              <div key={index} className="relative group flex items-start gap-2">
                <span className="mt-3 text-xs font-mono text-muted-foreground w-6 text-right shrink-0">
                  Q{index + 1}
                </span>
                <textarea
                  value={query}
                  onChange={(e) => updateQuery(index, e.target.value)}
                  rows={3}
                  className="flex-1 bg-muted border border-border rounded-md px-3 py-2 font-mono text-xs text-foreground resize-none focus:outline-none focus:ring-1 focus:ring-primary/50 transition-all placeholder:text-muted-foreground"
                  placeholder="Enter SQL query..."
                  spellCheck={false}
                />
                {queries.length > 1 && (
                  <button
                    onClick={() => removeQuery(index)}
                    className="mt-2 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
            ))}
          </motion.div>
        ) : (
          <motion.div
            key="builder"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="space-y-4"
          >
            {builders.map((builder, bIdx) => (
              <div
                key={bIdx}
                className="relative group border border-border rounded-lg p-4 bg-muted/30 space-y-3"
              >
                {builders.length > 1 && (
                  <button
                    onClick={() => removeQuery(bIdx)}
                    className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}

                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-mono text-muted-foreground">Q{bIdx + 1}</span>
                </div>

                {/* SELECT - multiple choice */}
                <div className="space-y-1.5">
                  <label className="text-[11px] font-semibold uppercase tracking-wider text-primary">
                    SELECT
                  </label>
                  <Select
                    onValueChange={(val) => toggleField(bIdx, val)}
                  >
                    <SelectTrigger className="h-9 text-xs bg-muted border-border">
                      <SelectValue placeholder="Add field..." />
                    </SelectTrigger>
                    <SelectContent>
                      {AVAILABLE_FIELDS.map((f) => (
                        <SelectItem key={f.value} value={f.value}>
                          {builder.selectFields.includes(f.value) ? "✓ " : ""}
                          {f.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {builder.selectFields.map((field) => (
                      <Badge
                        key={field}
                        variant="secondary"
                        className="text-[10px] cursor-pointer hover:bg-destructive/20 hover:text-destructive transition-colors"
                        onClick={() => toggleField(bIdx, field)}
                      >
                        {field} <X className="h-2.5 w-2.5 ml-1" />
                      </Badge>
                    ))}
                  </div>
                </div>

                {/* FROM - dropdown */}
                <div className="space-y-1.5">
                  <label className="text-[11px] font-semibold uppercase tracking-wider text-primary">
                    FROM
                  </label>
                  <Select
                    value={builder.fromTable}
                    onValueChange={(val) => updateBuilder(bIdx, { fromTable: val })}
                  >
                    <SelectTrigger className="h-9 text-xs bg-muted border-border">
                      <SelectValue placeholder="Select table..." />
                    </SelectTrigger>
                    <SelectContent>
                      {AVAILABLE_TABLES.map((t) => (
                        <SelectItem key={t.value} value={t.value}>
                          {t.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* WHERE - text */}
                <div className="space-y-1.5">
                  <label className="text-[11px] font-semibold uppercase tracking-wider text-primary">
                    WHERE
                  </label>
                  <input
                    value={builder.whereClause}
                    onChange={(e) => updateBuilder(bIdx, { whereClause: e.target.value })}
                    className="w-full h-9 bg-muted border border-border rounded-md px-3 font-mono text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 transition-all placeholder:text-muted-foreground"
                    placeholder="e.g. latency_ms > 50 AND region = 'Athens'"
                    spellCheck={false}
                  />
                </div>

                {/* GROUP BY - text */}
                <div className="space-y-1.5">
                  <label className="text-[11px] font-semibold uppercase tracking-wider text-primary">
                    GROUP BY
                  </label>
                  <input
                    value={builder.groupByClause}
                    onChange={(e) => updateBuilder(bIdx, { groupByClause: e.target.value })}
                    className="w-full h-9 bg-muted border border-border rounded-md px-3 font-mono text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 transition-all placeholder:text-muted-foreground"
                    placeholder="e.g. region, operator"
                    spellCheck={false}
                  />
                </div>

                {/* Preview */}
                <div className="mt-2 p-2 bg-background/50 border border-border/50 rounded text-[10px] font-mono text-muted-foreground break-all">
                  {buildQueryString(builder)}
                </div>
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default QueryEditor;
