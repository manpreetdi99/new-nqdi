import { motion } from "framer-motion";
import { Phone, PhoneOff, PhoneForwarded, Clock, Signal, ChevronRight } from "lucide-react";
import type { CallRecord } from "@/lib/callData";

interface CallsListProps {
  calls: CallRecord[];
  onSelectCall: (call: CallRecord) => void;
}

const statusConfig = {
  completed: { icon: Phone, color: "text-success", bg: "bg-success/10", label: "Completed" },
  dropped: { icon: PhoneOff, color: "text-warning", bg: "bg-warning/10", label: "Dropped" },
  failed: { icon: PhoneForwarded, color: "text-destructive", bg: "bg-destructive/10", label: "Failed" },
};

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}m ${secs}s`;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("el-GR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

const CallsList = ({ calls, onSelectCall }: CallsListProps) => {
  return (
    <div className="space-y-1">
      {/* Header row */}
      <div className="grid grid-cols-[2.5rem_1fr_1fr_1fr_1fr_5rem_5rem_2rem] gap-2 px-4 py-2 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold border-b border-border">
        <span></span>
        <span>Call ID</span>
        <span>Time</span>
        <span>Operator / Region</span>
        <span>Type / Tech</span>
        <span className="text-right">Duration</span>
        <span className="text-right">MOS</span>
        <span></span>
      </div>

      {calls.map((call, idx) => {
        const cfg = statusConfig[call.status];
        const StatusIcon = cfg.icon;

        return (
          <motion.div
            key={call.id}
            initial={{ opacity: 0, x: -5 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: idx * 0.02 }}
            onClick={() => onSelectCall(call)}
            className="grid grid-cols-[2.5rem_1fr_1fr_1fr_1fr_5rem_5rem_2rem] gap-2 px-4 py-2.5 items-center rounded-md cursor-pointer hover:bg-muted/40 transition-colors group border border-transparent hover:border-border"
          >
            <div className={`${cfg.bg} rounded-md p-1.5 flex items-center justify-center`}>
              <StatusIcon className={`h-3.5 w-3.5 ${cfg.color}`} />
            </div>

            <span className="text-xs font-mono text-foreground">{call.callId}</span>

            <span className="text-xs text-muted-foreground">{formatTime(call.startTime)}</span>

            <div>
              <span className="text-xs text-foreground">{call.operator}</span>
              <span className="text-xs text-muted-foreground ml-1.5">· {call.region}</span>
            </div>

            <div className="flex items-center gap-1.5">
              <span className="text-xs text-foreground">{call.callType}</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-secondary text-secondary-foreground">
                {call.technology}
              </span>
            </div>

            <span className="text-xs font-mono text-foreground text-right">
              {formatDuration(call.duration_s)}
            </span>

            <span className={`text-xs font-mono text-right ${
              call.avgMos >= 3.5 ? "text-success" : call.avgMos >= 2.5 ? "text-warning" : "text-destructive"
            }`}>
              {call.avgMos > 0 ? call.avgMos.toFixed(1) : "—"}
            </span>

            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
          </motion.div>
        );
      })}
    </div>
  );
};

export default CallsList;
