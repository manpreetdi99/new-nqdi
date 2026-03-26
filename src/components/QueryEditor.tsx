import { useState } from "react";
import { Play, Plus, X, Database } from "lucide-react";
import { Button } from "@/components/ui/button";
import { motion, AnimatePresence } from "framer-motion";

interface QueryEditorProps {
  onRunQueries: (queries: string[]) => void;
  isRunning: boolean;
}

const SAMPLE_QUERIES = [
  "SELECT region, AVG(latency_ms) as avg_latency, COUNT(*) as samples FROM network_measurements GROUP BY region ORDER BY avg_latency",
  "SELECT operator, test_type, PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY throughput_mbps) as p95_throughput FROM benchmarks GROUP BY operator, test_type",
  "SELECT DATE_TRUNC('hour', measured_at) as hour, AVG(download_speed) as avg_dl, AVG(upload_speed) as avg_ul FROM speed_tests WHERE measured_at > NOW() - INTERVAL '24 hours' GROUP BY hour ORDER BY hour",
];

const QueryEditor = ({ onRunQueries, isRunning }: QueryEditorProps) => {
  const [queries, setQueries] = useState<string[]>([SAMPLE_QUERIES[0]]);

  const addQuery = () => {
    const nextSample = SAMPLE_QUERIES[queries.length % SAMPLE_QUERIES.length];
    setQueries([...queries, nextSample]);
  };

  const removeQuery = (index: number) => {
    if (queries.length > 1) {
      setQueries(queries.filter((_, i) => i !== index));
    }
  };

  const updateQuery = (index: number, value: string) => {
    const updated = [...queries];
    updated[index] = value;
    setQueries(updated);
  };

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
          <Button variant="outline" size="sm" onClick={addQuery}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Add Query
          </Button>
          <Button
            size="sm"
            onClick={() => onRunQueries(queries)}
            disabled={isRunning || queries.some((q) => !q.trim())}
            className="glow-primary"
          >
            <Play className="h-3.5 w-3.5 mr-1" />
            {isRunning ? "Running..." : "Run Benchmark"}
          </Button>
        </div>
      </div>

      <AnimatePresence>
        {queries.map((query, index) => (
          <motion.div
            key={index}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="relative group"
          >
            <div className="flex items-start gap-2">
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
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
};

export default QueryEditor;
