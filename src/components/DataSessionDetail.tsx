import { useEffect, useState } from "react";
import { ArrowLeft, Wifi, Activity, Radio } from "lucide-react";
import type { DataCallRow, TraceLogRow } from "@/lib/api";
import { fetchTracelogValues } from "@/lib/api";

interface Props {
  sessionId: string;
  tests: DataCallRow[];
  onBack: () => void;
  database: string;
}

function formatTs(ts: string | null | undefined): string {
  if (!ts) return "N/A";
  const d = new Date(ts);
  if (isNaN(d.getTime())) return ts;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())} ${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

function testInfo(row: DataCallRow): string {
  if (row.testType === "Ping")
    return row.host
      ? `Host=${row.host}, RTT=${row.pingRttAvg ?? "N/A"}ms`
      : `RTT=${row.pingRttAvg ?? "N/A"}ms`;
  if (row.testType === "HTTPBrowser")
    return row.host
      ? `Host=${row.host} Throughput=${row.throughputKbps != null ? (row.throughputKbps / 1000).toFixed(2) : "N/A"} Mbit/s`
      : "";
  if (row.testType === "Capacity")
    return `Sustainable Throughput=${row.capacityThroughputKbps != null ? (row.capacityThroughputKbps / 1000).toFixed(3) : "N/A"} Mbit/s`;
  if (row.testType === "YouTube Video Streaming")
    return `Stream: ${row.status ?? ""}, VQAvg=${row.youtubeMos ?? "N/A"}`;
  return row.status ?? "";
}

function statusColor(row: DataCallRow): string {
  const s = (row.scoringStatus ?? row.status ?? "").toLowerCase();
  if (s.includes("fail") || s === "f") return "text-red-400";
  if (s === "a" || s.includes("success") || s.includes("complet")) return "text-green-400";
  return "text-muted-foreground";
}

function rowClass(row: DataCallRow): string {
  if (row.isValid === 0) return "bg-red-500/20 border-red-500/30";
  const s = (row.scoringStatus ?? row.status ?? "").toLowerCase();
  if (s.includes("fail") || s === "f") return "bg-orange-500/15 border-orange-500/30";
  return "";
}

const TECH_COLORS: Record<string, string> = {
  "5G": "bg-purple-500/20 text-purple-300 border-purple-500/40",
  "NR": "bg-purple-500/20 text-purple-300 border-purple-500/40",
  "LTE": "bg-blue-500/20 text-blue-300 border-blue-500/40",
  "4G": "bg-blue-500/20 text-blue-300 border-blue-500/40",
  "UMTS": "bg-yellow-500/20 text-yellow-300 border-yellow-500/40",
  "3G": "bg-yellow-500/20 text-yellow-300 border-yellow-500/40",
  "GSM": "bg-green-500/20 text-green-300 border-green-500/40",
  "2G": "bg-green-500/20 text-green-300 border-green-500/40",
};

function techColor(tech: string): string {
  const key = Object.keys(TECH_COLORS).find(k => tech.toUpperCase().includes(k));
  return key ? TECH_COLORS[key] : "bg-muted text-muted-foreground border-border";
}

export default function DataSessionDetail({ sessionId, tests, onBack, database }: Props) {
  const first = tests[0];
  const passCount = tests.filter(r => {
    const s = (r.scoringStatus ?? r.status ?? "").toLowerCase();
    return s === "a" || s.includes("success") || s.includes("complet");
  }).length;
  const failCount = tests.filter(r => {
    const s = (r.scoringStatus ?? r.status ?? "").toLowerCase();
    return s.includes("fail") || s === "f";
  }).length;

  // Technology distribution from tests
  const techDistribution = tests.reduce<Record<string, number>>((acc, r) => {
    const t = r.technology ?? r.startTechnology ?? "Unknown";
    acc[t] = (acc[t] ?? 0) + 1;
    return acc;
  }, {});
  const techEntries = Object.entries(techDistribution).sort((a, b) => b[1] - a[1]);
  const maxTechCount = techEntries[0]?.[1] ?? 1;

  // TraceLog
  const [tracelogValues, setTracelogValues] = useState<TraceLogRow[]>([]);
  const [tracelogLoading, setTracelogLoading] = useState(false);

  useEffect(() => {
    if (!database || !sessionId) return;
    setTracelogLoading(true);
    fetchTracelogValues(database, sessionId)
      .then(res => setTracelogValues(res.tracelogValues || []))
      .catch(() => setTracelogValues([]))
      .finally(() => setTracelogLoading(false));
  }, [database, sessionId]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>
        <div className="h-4 w-px bg-border" />
        <Wifi className="h-4 w-4 text-primary" />
        <span className="text-sm font-semibold text-foreground">Data Session Detail</span>
      </div>

      {/* Session Summary Card */}
      <div className="bg-card border border-border rounded-lg p-4 grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
        <div>
          <p className="text-muted-foreground uppercase tracking-wider text-[10px] mb-0.5">Session ID</p>
          <p className="font-mono text-foreground">{sessionId}</p>
        </div>
        <div>
          <p className="text-muted-foreground uppercase tracking-wider text-[10px] mb-0.5">Location</p>
          <p className="text-foreground">{first?.Location ?? "N/A"}</p>
        </div>
        <div>
          <p className="text-muted-foreground uppercase tracking-wider text-[10px] mb-0.5">Collection</p>
          <p className="text-foreground">{first?.CollectionName ?? "N/A"}</p>
        </div>
        <div>
          <p className="text-muted-foreground uppercase tracking-wider text-[10px] mb-0.5">Start Time</p>
          <p className="font-mono text-foreground">{formatTs(first?.callStartTimeStamp)}</p>
        </div>
        <div>
          <p className="text-muted-foreground uppercase tracking-wider text-[10px] mb-0.5">Technology</p>
          <p className="text-foreground">{first?.technology ?? first?.startTechnology ?? "N/A"}</p>
        </div>
        <div>
          <p className="text-muted-foreground uppercase tracking-wider text-[10px] mb-0.5">Tests</p>
          <p className="text-foreground">{tests.length}</p>
        </div>
        <div>
          <p className="text-muted-foreground uppercase tracking-wider text-[10px] mb-0.5">Pass / Fail</p>
          <p>
            <span className="text-green-400">{passCount}</span>
            {" / "}
            <span className="text-red-400">{failCount}</span>
          </p>
        </div>
        <div>
          <p className="text-muted-foreground uppercase tracking-wider text-[10px] mb-0.5">Session Valid</p>
          <p className={first?.isValid === 0 ? "text-red-400" : "text-green-400"}>
            {first?.isValid === 0 ? "Invalid" : "Valid"}
          </p>
        </div>
      </div>

      {/* Technology Distribution + TraceLog side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* Technology Distribution */}
        <div className="bg-card border border-border rounded-lg p-4">
          <div className="flex items-center gap-2 mb-3">
            <Radio className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold text-foreground">Technology Distribution</h2>
          </div>
          {techEntries.length === 0 ? (
            <p className="text-xs text-muted-foreground">No technology data.</p>
          ) : (
            <div className="space-y-2">
              {techEntries.map(([tech, count]) => (
                <div key={tech} className="flex items-center gap-3">
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border w-20 text-center shrink-0 ${techColor(tech)}`}>
                    {tech}
                  </span>
                  <div className="flex-1 bg-muted/40 rounded-full h-2 overflow-hidden">
                    <div
                      className="h-2 rounded-full bg-primary/70 transition-all"
                      style={{ width: `${(count / maxTechCount) * 100}%` }}
                    />
                  </div>
                  <span className="text-xs text-muted-foreground w-8 text-right shrink-0">{count}</span>
                  <span className="text-[10px] text-muted-foreground w-10 text-right shrink-0">
                    {((count / tests.length) * 100).toFixed(0)}%
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* TraceLog */}
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold text-foreground">TraceLog</h2>
            {tracelogValues.length > 0 && (
              <span className="ml-auto text-[10px] text-muted-foreground">{tracelogValues.length} entries</span>
            )}
          </div>
          {tracelogLoading ? (
            <p className="px-4 py-3 text-xs text-muted-foreground">Loading...</p>
          ) : tracelogValues.length === 0 ? (
            <p className="px-4 py-3 text-xs text-muted-foreground">No TraceLog data for this session.</p>
          ) : (
            <div className="overflow-x-auto max-h-[260px] overflow-y-auto">
              <table className="w-full text-xs text-left">
                <thead className="sticky top-0 bg-muted border-b border-border z-10">
                  <tr className="text-muted-foreground uppercase tracking-wider">
                    <th className="px-3 py-2 font-semibold whitespace-nowrap">Time</th>
                    <th className="px-3 py-2 font-semibold">Side</th>
                    <th className="px-3 py-2 font-semibold">Info</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {tracelogValues.map((val, idx) => {
                    const isCritical = val.Info != null && [
                      "No sync signal found",
                      "Task stopped",
                      "Close Engine",
                      "System Release",
                    ].some(kw => val.Info!.includes(kw));
                    return (
                      <tr
                        key={`${val.FullDate ?? idx}-${idx}`}
                        className={`transition-colors ${isCritical ? "bg-red-500/15 text-red-400" : "hover:bg-muted/40"}`}
                        style={isCritical ? { boxShadow: "inset 3px 0 0 hsl(0, 72%, 51%)" } : undefined}
                      >
                        <td className="px-3 py-1 font-mono whitespace-nowrap">{formatTs(val.FullDate)}</td>
                        <td className="px-3 py-1 font-mono">{val.Side ?? "—"}</td>
                        <td className="px-3 py-1 font-mono whitespace-pre-wrap break-words max-w-[340px]">{val.Info ?? "N/A"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Tests Table */}
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center gap-2">
          <Activity className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold text-foreground">Tests in Session</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/30 text-left text-muted-foreground uppercase tracking-wider">
                <th className="px-3 py-2 font-semibold">#</th>
                <th className="px-3 py-2 font-semibold">TestId</th>
                <th className="px-3 py-2 font-semibold">Start Time</th>
                <th className="px-3 py-2 font-semibold">Test Type</th>
                <th className="px-3 py-2 font-semibold">Direction</th>
                <th className="px-3 py-2 font-semibold">Status</th>
                <th className="px-3 py-2 font-semibold">Info</th>
              </tr>
            </thead>
            <tbody>
              {tests.map((row, idx) => {
                const info = testInfo(row);
                return (
                  <tr
                    key={`${row.TestId}-${idx}`}
                    className={`border-b border-border/60 ${rowClass(row)} transition-colors`}
                  >
                    <td className="px-3 py-2 text-muted-foreground">{idx + 1}</td>
                    <td className="px-3 py-2 font-mono text-foreground">{row.TestId ?? "N/A"}</td>
                    <td className="px-3 py-2 font-mono text-foreground whitespace-nowrap">{formatTs(row.callStartTimeStamp)}</td>
                    <td className="px-3 py-2 text-foreground font-medium">{row.testType ?? "N/A"}</td>
                    <td className="px-3 py-2 text-muted-foreground">{row.direction ?? "---"}</td>
                    <td className={`px-3 py-2 font-semibold ${statusColor(row)}`}>
                      {row.scoringStatus ?? row.status ?? "N/A"}
                    </td>
                    <td className="px-3 py-2 text-foreground max-w-[300px] truncate" title={info}>
                      {info || "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
