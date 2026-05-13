import { ArrowLeft, Wifi, Activity } from "lucide-react";
import type { DataCallRow } from "@/lib/api";

interface Props {
  sessionId: string;
  tests: DataCallRow[];
  onBack: () => void;
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

export default function DataSessionDetail({ sessionId, tests, onBack }: Props) {
  const first = tests[0];
  const passCount = tests.filter(r => {
    const s = (r.scoringStatus ?? r.status ?? "").toLowerCase();
    return s === "a" || s.includes("success") || s.includes("complet");
  }).length;
  const failCount = tests.filter(r => {
    const s = (r.scoringStatus ?? r.status ?? "").toLowerCase();
    return s.includes("fail") || s === "f";
  }).length;

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
