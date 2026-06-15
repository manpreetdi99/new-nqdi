import { useState, useRef, useEffect } from "react";
import { Play, CheckCircle2, Loader2, Terminal, Map, ArrowLeft } from "lucide-react";

interface LogEntry {
  time: string;
  message: string;
  level: "info" | "success" | "error";
}

interface ValidationTabProps {
  databases: string[];
  defaultDatabase: string;
  collectionNames: string[];
  collectionsLoading: boolean;
  onDatabaseChange: (db: string) => void;
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://192.168.10.44:8000";

function now() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
}

export default function ValidationTab({
  databases,
  defaultDatabase,
  collectionNames,
  collectionsLoading,
  onDatabaseChange,
}: ValidationTabProps) {
  const [selectedDb, setSelectedDb] = useState(defaultDatabase);
  const [selectedCollection, setSelectedCollection] = useState("");
  const [gpxPath, setGpxPath] = useState("");
  const [bypassGpx, setBypassGpx] = useState(false);
  const [maxWorkers, setMaxWorkers] = useState(6);
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([
    { time: now(), message: "System ready. Select database and collection to begin.", level: "info" },
  ]);
  const [outputPath, setOutputPath] = useState<string | null>(null);
  const [mapHtml, setMapHtml] = useState<string | null>(null);

  const terminalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [logs]);

  useEffect(() => {
    setSelectedDb(defaultDatabase);
  }, [defaultDatabase]);

  const addLog = (message: string, level: LogEntry["level"] = "info") => {
    setLogs((prev) => [...prev, { time: now(), message, level }]);
  };

  const handleDbChange = (db: string) => {
    setSelectedDb(db);
    setSelectedCollection("");
    setOutputPath(null);
    setMapHtml(null);
    onDatabaseChange(db);
  };

  const handleRun = async () => {
    if (!selectedDb) { addLog("Aborted: Select a database first.", "error"); return; }
    if (!selectedCollection) { addLog("Aborted: Select a collection first.", "error"); return; }

    setRunning(true);
    setOutputPath(null);
    setMapHtml(null);
    addLog(`Starting map generation for collection: ${selectedCollection}`, "info");
    addLog(`Database: ${selectedDb} | Workers: ${maxWorkers}`, "info");
    if (!bypassGpx && gpxPath) {
      addLog(`GPX: ${gpxPath}`, "info");
    } else if (bypassGpx) {
      addLog("GPX: Bypassed (SQL points only)", "info");
    } else {
      addLog("GPX: None (auto-detect or SQL fallback)", "info");
    }

    try {
      const res = await fetch(`${API_BASE_URL}/api/run_map`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          database: selectedDb,
          collection: selectedCollection,
          gpx_path: bypassGpx ? "" : gpxPath,
          max_workers: maxWorkers,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        addLog(`Error: ${data.detail || data.message || "Unknown server error"}`, "error");
      } else {
        (data.logs ?? []).forEach((line: string) => {
          const lower = line.toLowerCase();
          const level: LogEntry["level"] =
            lower.includes("error") || lower.includes("fail") ? "error"
            : lower.includes("done") || lower.includes("success") || lower.includes("written") ? "success"
            : "info";
          addLog(line, level);
        });

        if (data.output_path) {
          setOutputPath(data.output_path);
          addLog(`Map saved to: ${data.output_path}`, "success");
        }
        if (data.html_content) {
          setMapHtml(data.html_content);
          addLog("Map loaded into preview.", "success");
        }
      }
    } catch (err: any) {
      addLog(`Network error: ${err.message ?? "Cannot reach Python server"}`, "error");
    } finally {
      setRunning(false);
    }
  };

  const levelColor: Record<LogEntry["level"], string> = {
    info: "text-blue-400",
    success: "text-green-400",
    error: "text-red-400",
  };

  const levelIcon: Record<LogEntry["level"], string> = {
    info: "ℹ",
    success: "✔",
    error: "✖",
  };

  // ── Full-screen map view ──────────────────────────────────────────────────
  if (mapHtml && !running) {
    return (
      <div className="flex flex-col" style={{ height: "calc(100vh - 110px)" }}>
        {/* Thin top bar */}
        <div className="flex items-center gap-3 px-3 py-1.5 bg-card border border-border rounded-t-lg shrink-0">
          <button
            type="button"
            onClick={() => setMapHtml(null)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            New Run
          </button>
          <div className="h-3 w-px bg-border" />
          <Map className="h-3.5 w-3.5 text-primary shrink-0" />
          <span className="text-xs font-medium text-foreground truncate">{selectedCollection}</span>
          {outputPath && (
            <>
              <div className="h-3 w-px bg-border" />
              <CheckCircle2 className="h-3.5 w-3.5 text-green-400 shrink-0" />
              <span className="text-[11px] text-green-400 font-mono truncate">{outputPath}</span>
            </>
          )}
        </div>

        {/* Map iframe — fills all remaining height */}
        <iframe
          key={outputPath ?? "map"}
          srcDoc={mapHtml}
          sandbox="allow-scripts allow-same-origin"
          className="w-full flex-1 border-0 border-x border-b border-border rounded-b-lg"
          title="Generated validation map"
        />
      </div>
    );
  }

  // ── Config + log view ─────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* Config card */}
      <div className="bg-card border border-border rounded-lg p-5 space-y-5">
        <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Map className="h-4 w-4 text-primary" />
          VALIDATION SWISSQUAL — Map Generator
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">1. Database</label>
            <select
              value={selectedDb}
              onChange={(e) => handleDbChange(e.target.value)}
              className="w-full bg-muted border border-border rounded-md px-3 py-2 text-sm"
              disabled={running}
            >
              <option value="">Select database...</option>
              {databases.map((db) => <option key={db} value={db}>{db}</option>)}
            </select>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">2. Collection</label>
            <select
              value={selectedCollection}
              onChange={(e) => setSelectedCollection(e.target.value)}
              className="w-full bg-muted border border-border rounded-md px-3 py-2 text-sm"
              disabled={running || !selectedDb}
            >
              <option value="">Select collection...</option>
              {collectionsLoading && <option disabled>Loading...</option>}
              {!collectionsLoading && collectionNames.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </div>

          <div className="md:col-span-2">
            <label className="text-xs font-medium text-muted-foreground block mb-1">3. GPX File Path (optional)</label>
            <div className="flex gap-2 items-center">
              <input
                type="text"
                value={gpxPath}
                onChange={(e) => setGpxPath(e.target.value)}
                placeholder={bypassGpx ? "— Bypassed —" : "e.g. \\\\server\\share\\route.gpx"}
                disabled={bypassGpx || running}
                className="flex-1 bg-muted border border-border rounded-md px-3 py-2 text-sm disabled:opacity-50"
              />
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none whitespace-nowrap">
                <input
                  type="checkbox"
                  checked={bypassGpx}
                  onChange={(e) => setBypassGpx(e.target.checked)}
                  disabled={running}
                  className="h-3.5 w-3.5"
                />
                Bypass GPX
              </label>
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">4. Threads (max_workers)</label>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={1}
                max={16}
                value={maxWorkers}
                onChange={(e) => setMaxWorkers(Number(e.target.value))}
                disabled={running}
                className="flex-1 accent-primary"
              />
              <span className="text-sm font-mono w-6 text-center">{maxWorkers}</span>
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5">6–10 is usually optimal</p>
          </div>
        </div>

        <div className="flex items-center gap-3 pt-1">
          <button
            type="button"
            onClick={handleRun}
            disabled={running || !selectedDb || !selectedCollection}
            className="flex items-center gap-2 px-5 py-2.5 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {running ? (
              <><Loader2 className="h-4 w-4 animate-spin" />Running…</>
            ) : (
              <><Play className="h-4 w-4" />RUN MAP GENERATOR</>
            )}
          </button>
        </div>
      </div>

      {/* Terminal log */}
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-muted/40">
          <Terminal className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">System Log</span>
          <button
            type="button"
            onClick={() => setLogs([{ time: now(), message: "Log cleared.", level: "info" }])}
            className="ml-auto text-[10px] px-2 py-0.5 rounded border border-border bg-muted hover:bg-muted/70"
          >
            Clear
          </button>
        </div>
        <div
          ref={terminalRef}
          className="h-72 overflow-y-auto bg-[#1e1e1e] p-4 space-y-0.5 font-mono text-[11px] leading-relaxed"
        >
          {logs.map((entry, i) => (
            <div key={i} className="flex gap-2">
              <span className="text-[#868e96] shrink-0">[{entry.time}]</span>
              <span className={`shrink-0 ${levelColor[entry.level]}`}>{levelIcon[entry.level]}</span>
              <span className={levelColor[entry.level]}>{entry.message}</span>
            </div>
          ))}
          {running && (
            <div className="flex gap-2 items-center">
              <span className="text-[#868e96] shrink-0">[{now()}]</span>
              <Loader2 className="h-3 w-3 text-blue-400 animate-spin shrink-0" />
              <span className="text-blue-400 animate-pulse">Processing, please wait…</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
