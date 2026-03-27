import { motion } from "framer-motion";
import { Clock, Zap, Activity, BarChart3 } from "lucide-react";
import type { BenchmarkResult } from "@/types/benchmark";

interface StatsCardsProps {
  results: BenchmarkResult[];
  totalTime: number;
}

const StatsCards = ({ results, totalTime }: StatsCardsProps) => {
  if (results.length === 0) return null;

  const totalRows = results.reduce((sum, r) => sum + r.rowsReturned, 0);
  const avgExec = results.reduce((sum, r) => sum + r.executionTime, 0) / results.length;
  const fastestQuery = results.reduce((min, r) =>
    r.executionTime < min.executionTime ? r : min
  );

  const stats = [
    {
      label: "Total Time",
      value: `${totalTime}ms`,
      icon: Clock,
      color: "text-primary",
    },
    {
      label: "Avg Execution",
      value: `${avgExec.toFixed(0)}ms`,
      icon: Zap,
      color: "text-accent",
    },
    {
      label: "Total Rows",
      value: totalRows.toLocaleString(),
      icon: BarChart3,
      color: "text-warning",
    },
    {
      label: "Queries Run",
      value: results.length.toString(),
      icon: Activity,
      color: "text-chart-4",
    },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {stats.map((stat, i) => (
        <motion.div
          key={stat.label}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.05 }}
          className="bg-card border border-border rounded-lg p-4 flex items-center gap-3"
        >
          <div className={`${stat.color} bg-muted rounded-md p-2`}>
            <stat.icon className="h-4 w-4" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{stat.label}</p>
            <p className="text-lg font-semibold font-mono text-foreground">{stat.value}</p>
          </div>
        </motion.div>
      ))}
    </div>
  );
};

export default StatsCards;
