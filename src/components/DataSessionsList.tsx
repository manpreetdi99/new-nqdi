import { motion } from "framer-motion";
import { Wifi, WifiOff, AlertTriangle, ChevronRight } from "lucide-react";
import type { DataCallRow } from "@/lib/api";

export interface DataSessionItem {
  sessionId: string;
  first: DataCallRow;
  tests: DataCallRow[];
  passCount: number;
  failCount: number;
}

interface DataSessionsListProps {
  sessions: DataSessionItem[];
  selectedSessionId: string | null;
  onSelectSession: (sessionId: string) => void;
}

function formatTs(ts: string | null | undefined): string {
  if (!ts) return "N/A";
  const d = new Date(ts);
  if (isNaN(d.getTime())) return ts;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function sessionStatus(item: DataSessionItem): "invalid" | "fail" | "ok" {
  if (item.first?.isValid === 0) return "invalid";
  if (item.failCount > 0) return "fail";
  return "ok";
}

const statusConfig = {
  invalid: { icon: WifiOff,      color: "text-red-400",    bg: "bg-red-500/15",    label: "Invalid" },
  fail:    { icon: AlertTriangle, color: "text-orange-400", bg: "bg-orange-500/15", label: "Has Failures" },
  ok:      { icon: Wifi,          color: "text-green-400",  bg: "bg-green-500/15",  label: "OK" },
};

const DataSessionsList = ({ sessions, selectedSessionId, onSelectSession }: DataSessionsListProps) => {
  return (
    <div className="space-y-0.5">
      {/* Header */}
      <div className="grid grid-cols-[2.5rem_1fr_1fr_1fr_1fr_4rem_5rem_2rem] gap-2 px-4 py-2 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold border-b border-border">
        <span />
        <span>Session ID</span>
        <span>Start Time</span>
        <span>Location / Collection</span>
        <span>Technology</span>
        <span className="text-right">Tests</span>
        <span className="text-center">Pass / Fail</span>
        <span />
      </div>

      {sessions.map((item, idx) => {
        const status = sessionStatus(item);
        const cfg = statusConfig[status];
        const StatusIcon = cfg.icon;
        const isSelected = selectedSessionId === item.sessionId;

        return (
          <motion.div
            key={item.sessionId}
            initial={{ opacity: 0, x: -5 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: idx * 0.02 }}
            onClick={() => onSelectSession(item.sessionId)}
            className={`grid grid-cols-[2.5rem_1fr_1fr_1fr_1fr_4rem_5rem_2rem] gap-2 px-4 py-2.5 items-center rounded-md cursor-pointer transition-colors group border ${
              isSelected
                ? "bg-primary/10 border-primary/40"
                : "border-transparent hover:bg-muted/40 hover:border-border"
            }`}
          >
            {/* Status icon */}
            <div className={`${cfg.bg} rounded-md p-1.5 flex items-center justify-center`}>
              <StatusIcon className={`h-3.5 w-3.5 ${cfg.color}`} />
            </div>

            {/* Session ID */}
            <span className="text-xs font-mono text-foreground truncate">{item.sessionId}</span>

            {/* Start Time */}
            <span className="text-xs text-muted-foreground whitespace-nowrap">
              {formatTs(item.first?.callStartTimeStamp)}
            </span>

            {/* Location / Collection */}
            <div className="min-w-0">
              <span className="text-xs text-foreground truncate block">{item.first?.Location ?? "N/A"}</span>
              <span className="text-[10px] text-muted-foreground truncate block">{item.first?.CollectionName ?? ""}</span>
            </div>

            {/* Technology */}
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-secondary text-secondary-foreground truncate">
                {item.first?.technology ?? item.first?.startTechnology ?? "N/A"}
              </span>
            </div>

            {/* Tests count */}
            <span className="text-xs font-mono text-foreground text-right">{item.tests.length}</span>

            {/* Pass / Fail */}
            <span className="text-xs font-mono text-center">
              <span className="text-green-400">{item.passCount}</span>
              <span className="text-muted-foreground"> / </span>
              <span className="text-red-400">{item.failCount}</span>
            </span>

            {/* Chevron */}
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
          </motion.div>
        );
      })}
    </div>
  );
};

export default DataSessionsList;
