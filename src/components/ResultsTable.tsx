import { motion } from "framer-motion";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

export interface BenchmarkResult {
  id: string;
  queryLabel: string;
  executionTime: number;
  rowsReturned: number;
  data: Record<string, string | number>[];
  columns: string[];
}

interface ResultsTableProps {
  results: BenchmarkResult[];
}

const ResultsTable = ({ results }: ResultsTableProps) => {
  if (results.length === 0) return null;

  return (
    <div className="space-y-6">
      {results.map((result, idx) => (
        <motion.div
          key={result.id}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: idx * 0.1 }}
          className="bg-card border border-border rounded-lg overflow-hidden"
        >
          {/* Header */}
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-xs font-mono bg-primary/10 text-primary px-2 py-0.5 rounded">
                Q{idx + 1}
              </span>
              <span className="text-sm font-medium text-foreground">{result.queryLabel}</span>
            </div>
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                {result.executionTime < 100 ? (
                  <TrendingDown className="h-3 w-3 text-success" />
                ) : result.executionTime < 500 ? (
                  <Minus className="h-3 w-3 text-warning" />
                ) : (
                  <TrendingUp className="h-3 w-3 text-destructive" />
                )}
                {result.executionTime}ms
              </span>
              <span>{result.rowsReturned} rows</span>
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  {result.columns.map((col) => (
                    <th
                      key={col}
                      className="text-left px-4 py-2 text-muted-foreground font-semibold uppercase tracking-wider"
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.data.map((row, rowIdx) => (
                  <tr
                    key={rowIdx}
                    className="border-b border-border/50 hover:bg-muted/20 transition-colors"
                  >
                    {result.columns.map((col) => (
                      <td key={col} className="px-4 py-2 font-mono text-foreground">
                        {typeof row[col] === "number"
                          ? (row[col] as number).toLocaleString("el-GR", {
                              maximumFractionDigits: 2,
                            })
                          : row[col]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </motion.div>
      ))}
    </div>
  );
};

export default ResultsTable;
