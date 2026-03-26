import { Phone, PhoneOff, PhoneForwarded, Clock, Signal, Gauge } from "lucide-react";
import type { CallRecord } from "@/lib/callData";

interface CallsSummaryProps {
  calls: CallRecord[];
}

const CallsSummary = ({ calls }: CallsSummaryProps) => {
  const total = calls.length;
  const completed = calls.filter((c) => c.status === "completed").length;
  const dropped = calls.filter((c) => c.status === "dropped").length;
  const failed = calls.filter((c) => c.status === "failed").length;
  const avgMos = total > 0
    ? calls.reduce((s, c) => s + c.avgMos, 0) / total
    : 0;
  const avgDuration = total > 0
    ? Math.round(calls.reduce((s, c) => s + c.duration_s, 0) / total)
    : 0;
  const avgLatency = total > 0
    ? calls.reduce((s, c) => s + c.latency, 0) / total
    : 0;

  const items = [
    { label: "Total Calls", value: total, icon: Phone, color: "text-primary", bg: "bg-primary/10" },
    { label: "Completed", value: completed, icon: Phone, color: "text-success", bg: "bg-success/10" },
    { label: "Dropped", value: dropped, icon: PhoneOff, color: "text-warning", bg: "bg-warning/10" },
    { label: "Failed", value: failed, icon: PhoneForwarded, color: "text-destructive", bg: "bg-destructive/10" },
    { label: "Avg MOS", value: avgMos.toFixed(2), icon: Signal, color: "text-accent", bg: "bg-accent/10" },
    { label: "Avg Duration", value: `${Math.floor(avgDuration / 60)}m ${avgDuration % 60}s`, icon: Clock, color: "text-chart-4", bg: "bg-chart-4/10" },
    { label: "Avg Latency", value: `${avgLatency.toFixed(0)}ms`, icon: Gauge, color: "text-chart-5", bg: "bg-chart-5/10" },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
      {items.map((item) => (
        <div
          key={item.label}
          className="bg-card border border-border rounded-lg px-3 py-2.5 flex items-center gap-2.5"
        >
          <div className={`${item.bg} rounded-md p-1.5`}>
            <item.icon className={`h-3.5 w-3.5 ${item.color}`} />
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{item.label}</p>
            <p className="text-sm font-bold font-mono text-foreground">{item.value}</p>
          </div>
        </div>
      ))}
    </div>
  );
};

export default CallsSummary;
