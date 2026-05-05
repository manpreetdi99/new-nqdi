import { useEffect, useRef, useState } from "react";
import {
  Play,
  Plus,
  X,
  Database,
  ChevronDown,
  Copy,
  Download,
  Clock,
  Rows,
  AlertCircle,
  ChevronRight,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { motion, AnimatePresence } from "framer-motion";

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────
interface QueryTab {
  id: string;
  label: string;
  sql: string;
}

interface QueryResult {
  id: string;
  label: string;
  executionTime: number;
  rowsReturned: number;
  columns: string[];
  data: Record<string, unknown>[];
  error?: string;
}

interface QueryEditorProps {
  onRunQueries: (queries: string[]) => void;
  isRunning: boolean;
  collectionNames: string[];
  collectionsLoading: boolean;
  results?: QueryResult[];
  totalTime?: number;
}

// ──────────────────────────────────────────────
// Quick-pick templates
// ──────────────────────────────────────────────
const TEMPLATES = [
  {
    label: "All calls (top 200)",
    sql: `SELECT TOP 200
  CA.SessionId,
  CA.technology,
  CA.callMode,
  CA.callType,
  CA.callDir,
  CA.callStatus,
  ROUND(CA.setupTime, 2) AS setupTime,
  (CA.callDuration / 1000) AS callDuration_s,
  FL.CollectionName,
  FL.ASideLocation AS Location
FROM CallAnalysis CA
LEFT JOIN FileList FL ON CA.FileId = FL.FileId
LEFT JOIN Sessions S  ON S.SessionId = CA.SessionId
WHERE S.Valid IN (0, 1)
ORDER BY CA.SessionId DESC`,
  },
  {
    label: "Drop / Fail summary",
    sql: `SELECT
  CA.callStatus,
  CA.callType,
  CA.technology,
  COUNT(*) AS total
FROM CallAnalysis CA
LEFT JOIN Sessions S ON S.SessionId = CA.SessionId
WHERE S.Valid IN (0, 1)
  AND (CA.callStatus LIKE '%Drop%' OR CA.callStatus LIKE '%Fail%')
GROUP BY CA.callStatus, CA.callType, CA.technology
ORDER BY total DESC`,
  },
  {
    label: "Avg setup time per technology",
    sql: `SELECT
  CA.technology,
  COUNT(*)              AS calls,
  ROUND(AVG(CA.setupTime), 2) AS avg_setup_ms,
  ROUND(MIN(CA.setupTime), 2) AS min_setup_ms,
  ROUND(MAX(CA.setupTime), 2) AS max_setup_ms
FROM CallAnalysis CA
LEFT JOIN Sessions S ON S.SessionId = CA.SessionId
WHERE S.Valid IN (0, 1)
GROUP BY CA.technology
ORDER BY avg_setup_ms`,
  },
  {
    label: "Avg MOS per collection",
    sql: `SELECT
  FL.CollectionName,
  COUNT(*)                  AS calls,
  ROUND(AVG(LQ.OptionalWB), 3) AS avg_mos,
  ROUND(MIN(LQ.OptionalWB), 3) AS min_mos,
  ROUND(MAX(LQ.OptionalWB), 3) AS max_mos
FROM CallAnalysis CA
LEFT JOIN FileList FL ON CA.FileId = FL.FileId
LEFT JOIN ResultsLQ08Avg LQ ON LQ.SessionId = CA.SessionId
WHERE LQ.OptionalWB IS NOT NULL
GROUP BY FL.CollectionName
ORDER BY avg_mos DESC`,
  },
  {
    label: "LTE signal per session",
    sql: `SELECT TOP 500
  LM.SessionId,
  LM.MsgTime,
  ROUND(LM.RSRP,  2) AS RSRP,
  ROUND(LM.RSRQ,  2) AS RSRQ,
  ROUND(LM.SINR0, 2) AS SINR0
FROM LTEMeasurementReport LM
ORDER BY LM.SessionId, LM.MsgTime`,
  },
  {
    label: "Collections in filelist",
    sql: `SELECT
  CollectionName,
  COUNT(*) AS files,
  MIN(StartTime) AS first_file,
  MAX(StartTime) AS last_file
FROM FileList
WHERE CollectionName IS NOT NULL
GROUP BY CollectionName
ORDER BY last_file DESC`,
  },
];

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────
const uid = () => Math.random().toString(36).slice(2, 8);

function exportCsv(columns: string[], data: Record<string, unknown>[], filename: string) {
  const header = columns.join(",");
  const rows = data.map((row) =>
    columns
      .map((col) => {
        const val = row[col];
        if (val === null || val === undefined) return "";
        const str = String(val);
        return str.includes(",") || str.includes('"') || str.includes("\n")
          ? `"${str.replace(/"/g, '""')}"`
          : str;
      })
      .join(","),
  );
  const blob = new Blob([[header, ...rows].join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ──────────────────────────────────────────────
// Sub-components
// ──────────────────────────────────────────────
function ResultGrid({ result }: { result: QueryResult }) {
  const [page, setPage] = useState(0);
  const pageSize = 50;
  const totalPages = Math.ceil(result.data.length / pageSize);
  const pageData = result.data.slice(page * pageSize, (page + 1) * pageSize);

  if (result.error) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
        <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span className="font-mono">{result.error}</span>
      </div>
    );
  }

  if (result.data.length === 0) {
    return (
      <p className="py-4 text-center text-xs text-muted-foreground">
        Query returned 0 rows.
      </p>
    );
  }

  return (
    <div className="space-y-1.5">
      {/* table */}
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border bg-muted/50 text-left text-muted-foreground uppercase tracking-wider">
              {result.columns.map((col) => (
                <th key={col} className="px-3 py-1.5 font-semibold whitespace-nowrap">
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageData.map((row, i) => (
              <tr
                key={i}
                className="border-b border-border/50 transition-colors hover:bg-muted/20"
              >
                {result.columns.map((col) => (
                  <td key={col} className="px-3 py-1.5 font-mono text-foreground whitespace-nowrap">
                    {row[col] === null || row[col] === undefined ? (
                      <span className="text-muted-foreground italic">NULL</span>
                    ) : (
                      String(row[col])
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* pagination */}
      {totalPages > 1 && (
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
          <button
            disabled={page === 0}
            onClick={() => setPage((p) => p - 1)}
            className="px-2 py-0.5 rounded border border-border bg-muted disabled:opacity-40 hover:bg-muted/70"
          >
            ‹ Prev
          </button>
          <span>
            Page {page + 1} / {totalPages}
          </span>
          <button
            disabled={page >= totalPages - 1}
            onClick={() => setPage((p) => p + 1)}
            className="px-2 py-0.5 rounded border border-border bg-muted disabled:opacity-40 hover:bg-muted/70"
          >
            Next ›
          </button>
          <span className="ml-auto">{result.data.length} total rows</span>
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────
// Main component
// ──────────────────────────────────────────────
const QueryEditor = ({
  onRunQueries,
  isRunning,
  results = [],
  totalTime = 0,
}: QueryEditorProps) => {
  const [tabs, setTabs] = useState<QueryTab[]>([
    { id: uid(), label: "Query 1", sql: TEMPLATES[0].sql },
  ]);
  const [activeTabId, setActiveTabId] = useState(tabs[0].id);
  const [showTemplates, setShowTemplates] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const templatesRef = useRef<HTMLDivElement>(null);

  // Close templates dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (templatesRef.current && !templatesRef.current.contains(e.target as Node)) {
        setShowTemplates(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0];

  const addTab = () => {
    const newTab: QueryTab = {
      id: uid(),
      label: `Query ${tabs.length + 1}`,
      sql: "",
    };
    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(newTab.id);
  };

  const removeTab = (id: string) => {
    if (tabs.length === 1) return;
    const idx = tabs.findIndex((t) => t.id === id);
    const newTabs = tabs.filter((t) => t.id !== id);
    setTabs(newTabs);
    if (activeTabId === id) {
      setActiveTabId(newTabs[Math.max(0, idx - 1)].id);
    }
  };

  const updateSql = (id: string, sql: string) => {
    setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, sql } : t)));
  };

  const applyTemplate = (sql: string) => {
    updateSql(activeTabId, sql);
    setShowTemplates(false);
    textareaRef.current?.focus();
  };

  const handleRun = () => {
    const sqls = tabs.map((t) => t.sql.trim()).filter(Boolean);
    if (sqls.length > 0) onRunQueries(sqls);
  };

  const handleRunActive = () => {
    const sql = activeTab.sql.trim();
    if (sql) onRunQueries([sql]);
  };

  const canRun = tabs.some((t) => t.sql.trim());

  // Map results by tab order (index)
  const resultForTab = (tabIdx: number): QueryResult | undefined => results[tabIdx];

  return (
    <div className="space-y-3">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Database className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            SQL Query Editor
          </h2>
        </div>

        <div className="flex items-center gap-2">
          {/* Templates picker */}
          <div className="relative" ref={templatesRef}>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowTemplates((v) => !v)}
              className="text-xs gap-1"
            >
              Templates <ChevronDown className="h-3 w-3" />
            </Button>
            <AnimatePresence>
              {showTemplates && (
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  className="absolute right-0 top-full z-50 mt-1 w-64 rounded-md border border-border bg-card shadow-lg overflow-hidden"
                >
                  {TEMPLATES.map((tpl) => (
                    <button
                      key={tpl.label}
                      onClick={() => applyTemplate(tpl.sql)}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-muted/60 border-b border-border/50 last:border-0 transition-colors"
                    >
                      <ChevronRight className="h-3 w-3 text-primary shrink-0" />
                      {tpl.label}
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <Button variant="outline" size="sm" onClick={addTab} className="text-xs gap-1">
            <Plus className="h-3.5 w-3.5" /> New Tab
          </Button>

          <Button
            size="sm"
            onClick={handleRun}
            disabled={isRunning || !canRun}
            className="glow-primary text-xs gap-1"
          >
            <Play className="h-3.5 w-3.5" />
            {isRunning ? "Running…" : tabs.length > 1 ? "Run All" : "Run"}
          </Button>
        </div>
      </div>

      {/* ── Tab strip ── */}
      <div className="flex items-center gap-1 border-b border-border overflow-x-auto pb-px">
        {tabs.map((tab, tabIdx) => {
          const res = resultForTab(tabIdx);
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTabId(tab.id)}
              className={`group relative flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-t-md border border-b-0 transition-colors whitespace-nowrap ${
                tab.id === activeTabId
                  ? "bg-card border-border text-foreground"
                  : "bg-muted/40 border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab.label}
              {res && !res.error && (
                <span className="text-[9px] text-success font-mono">
                  {res.rowsReturned}r
                </span>
              )}
              {res?.error && (
                <span className="text-[9px] text-destructive font-mono">err</span>
              )}
              {tabs.length > 1 && (
                <span
                  role="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeTab(tab.id);
                  }}
                  className="ml-0.5 opacity-0 group-hover:opacity-100 hover:text-destructive transition-opacity"
                >
                  <X className="h-3 w-3" />
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ── Editor area ── */}
      {tabs.map((tab, tabIdx) => {
        const res = resultForTab(tabIdx);
        return (
          <div
            key={tab.id}
            className={tab.id === activeTabId ? "space-y-3" : "hidden"}
          >
            {/* Textarea */}
            <div className="relative">
              <textarea
                ref={tab.id === activeTabId ? textareaRef : undefined}
                value={tab.sql}
                onChange={(e) => updateSql(tab.id, e.target.value)}
                rows={8}
                spellCheck={false}
                placeholder={`-- Write SQL here, e.g.:\nSELECT TOP 100 * FROM CallAnalysis ORDER BY SessionId DESC`}
                onKeyDown={(e) => {
                  // Ctrl+Enter → run active
                  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                    e.preventDefault();
                    handleRunActive();
                  }
                  // Tab → insert spaces
                  if (e.key === "Tab") {
                    e.preventDefault();
                    const ta = e.currentTarget;
                    const start = ta.selectionStart;
                    const end = ta.selectionEnd;
                    const newVal = tab.sql.substring(0, start) + "  " + tab.sql.substring(end);
                    updateSql(tab.id, newVal);
                    requestAnimationFrame(() => {
                      ta.selectionStart = ta.selectionEnd = start + 2;
                    });
                  }
                }}
                className="w-full resize-y bg-[hsl(var(--muted))] border border-border rounded-md px-4 py-3 font-mono text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/60 transition-all placeholder:text-muted-foreground leading-relaxed"
              />
              {/* copy button */}
              <button
                onClick={() => navigator.clipboard.writeText(tab.sql)}
                title="Copy SQL"
                className="absolute top-2 right-2 p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
              >
                <Copy className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="flex items-center gap-2">
              <p className="text-[10px] text-muted-foreground">
                <kbd className="px-1 py-0.5 rounded border border-border bg-muted font-mono">Ctrl+Enter</kbd>{" "}
                to run this tab ·{" "}
                <kbd className="px-1 py-0.5 rounded border border-border bg-muted font-mono">Tab</kbd>{" "}
                for indent
              </p>

              <div className="ml-auto flex items-center gap-2">
                {tab.sql.trim() && (
                  <button
                    onClick={() => updateSql(tab.id, "")}
                    className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-destructive transition-colors"
                  >
                    <Trash2 className="h-3 w-3" /> Clear
                  </button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleRunActive}
                  disabled={isRunning || !tab.sql.trim()}
                  className="h-6 text-[10px] gap-1 px-2"
                >
                  <Play className="h-3 w-3" /> Run this tab
                </Button>
              </div>
            </div>

            {/* Results */}
            <AnimatePresence>
              {res && (
                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="space-y-2"
                >
                  {/* meta bar */}
                  <div className="flex items-center gap-3 text-[10px] text-muted-foreground flex-wrap">
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {res.executionTime} ms
                    </span>
                    <span className="flex items-center gap-1">
                      <Rows className="h-3 w-3" />
                      {res.rowsReturned} rows
                    </span>
                    <Badge variant="secondary" className="text-[9px] px-1.5">
                      {res.label}
                    </Badge>

                    {!res.error && res.data.length > 0 && (
                      <button
                        onClick={() =>
                          exportCsv(res.columns, res.data, `${res.label.replace(/\s+/g, "_")}.csv`)
                        }
                        className="ml-auto flex items-center gap-1 px-2 py-0.5 rounded border border-border bg-muted hover:bg-muted/70 transition-colors"
                      >
                        <Download className="h-3 w-3" /> Export CSV
                      </button>
                    )}
                  </div>

                  <ResultGrid result={res} />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}

      {/* Total time badge (all tabs ran) */}
      {results.length > 1 && totalTime > 0 && (
        <p className="text-[10px] text-muted-foreground text-right">
          All {results.length} queries completed in{" "}
          <span className="font-mono text-primary">{totalTime} ms</span>
        </p>
      )}
    </div>
  );
};

export default QueryEditor;
