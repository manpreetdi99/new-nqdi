import { useState, useMemo, useEffect } from "react";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { fetchCollectionNames, fetchAllCalls } from "@/lib/api";
import type { AllCallsRow } from "@/lib/api";
import CommentAuditPanel from "./CommentAuditPanel";


export interface DemoTabProps {
  databases: string[];
}

function isDrop(status: string | null | undefined) {
  return (status || "").toLowerCase().includes("drop");
}
function isFail(status: string | null | undefined) {
  return (status || "").toLowerCase().includes("fail");
}

export default function DemoTab({ databases }: DemoTabProps) {
  const [database, setDatabase] = useState<string>("");
  const [collections, setCollections] = useState<string[]>([]);
  const [collectionNames, setCollectionNames] = useState<string[]>([]);
  const [collectionsLoading, setCollectionsLoading] = useState(false);
  const [rows, setRows] = useState<AllCallsRow[]>([]);
  const [rowsLoading, setRowsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load collections when database changes
  useEffect(() => {
    if (!database) { setCollectionNames([]); setCollections([]); return; }
    setCollectionsLoading(true);
    Promise.race([
      fetchCollectionNames(database, { timeoutMs: 20000, retries: 0 }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 20000)),
    ])
      .then((names) => setCollectionNames((names as string[] | null) || []))
      .catch(() => setCollectionNames([]))
      .finally(() => setCollectionsLoading(false));
  }, [database]);

  const collectionsForQuery = useDebouncedValue(collections, 600);
  const selectionSettling = collections !== collectionsForQuery;

  // Load rows when database/collections change (debounced)
  useEffect(() => {
    if (!database || collectionsForQuery.length === 0) { setRows([]); return; }
    setRowsLoading(true);
    setError(null);
    Promise.race([
      fetchAllCalls(database, collectionsForQuery, [], { timeoutMs: 30000, retries: 0 }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 30000)),
    ])
      .then((r) => setRows((r as AllCallsRow[] | null) || []))
      .catch((e) => { setRows([]); setError(String(e)); })
      .finally(() => setRowsLoading(false));
  }, [database, collectionsForQuery]);

  const toggleCollection = (name: string) => {
    setCollections((prev) => prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]);
  };

  const dropFailRows = useMemo(() => rows.filter((r) => isDrop(r.status) || isFail(r.status)), [rows]);

  const [unlocked, setUnlocked] = useState(() => {
    try { return sessionStorage.getItem("demo-unlocked") === "1"; } catch { return false; }
  });
  const [pwd, setPwd] = useState("");
  const [pwdError, setPwdError] = useState(false);

  if (!unlocked) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <div className="w-full max-w-sm rounded-lg border border-border bg-card p-6 space-y-4">
          <h2 className="text-lg font-bold text-center">Demo Tab — Password Required</h2>
          <p className="text-xs text-muted-foreground text-center">Enter password to access this tab.</p>
          <input
            type="password"
            value={pwd}
            onChange={(e) => { setPwd(e.target.value); setPwdError(false); }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                if (pwd === "rattan1963") { try { sessionStorage.setItem("demo-unlocked", "1"); } catch {} setUnlocked(true); }
                else setPwdError(true);
              }
            }}
            className="w-full bg-muted border border-border rounded-md px-3 py-2 text-sm"
            placeholder="Password"
            autoFocus
          />
          <button
            type="button"
            onClick={() => {
              if (pwd === "rattan1963") { try { sessionStorage.setItem("demo-unlocked", "1"); } catch {} setUnlocked(true); }
              else setPwdError(true);
            }}
            className="w-full px-3 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium"
          >
            Unlock
          </button>
          {pwdError && <p className="text-xs text-red-400 text-center">Wrong password.</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold">VoLTE Drop &amp; Fail Analysis (Demo)</h2>
        <p className="text-xs text-muted-foreground">
          {dropFailRows.length} drop &amp; fail calls in the selected collections. Analysis: user comment audit (Call Analysis.pptx rules) and the volte-drop-fail-analysis.md classifier.
        </p>
      </div>

      {/* Database & Collections selector */}
      <div className="rounded-lg border border-border bg-card p-3 space-y-3">
        <div>
          <label className="text-xs font-medium text-foreground">Database</label>
          <select
            value={database}
            onChange={(e) => { setDatabase(e.target.value); setCollections([]); setRows([]); }}
            className="mt-1 w-full bg-muted border border-border rounded-md px-3 py-2 text-sm"
          >
            <option value="">Select database</option>
            {databases.map((db) => (
              <option key={db} value={db}>{db}</option>
            ))}
          </select>
        </div>
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-medium text-foreground">Collections</label>
            <span className="text-[10px] text-muted-foreground">{collections.length} selected</span>
          </div>
          <div className="flex gap-1.5 mb-2">
            <button type="button" onClick={() => setCollections(collectionNames)} disabled={collectionNames.length === 0 || collectionsLoading} className="text-[10px] px-2 py-1 rounded border border-border bg-muted hover:bg-muted/70 disabled:opacity-50">Select all</button>
            <button type="button" onClick={() => setCollections([])} disabled={collectionNames.length === 0 || collectionsLoading} className="text-[10px] px-2 py-1 rounded border border-border bg-muted hover:bg-muted/70 disabled:opacity-50">Clear</button>
          </div>
          <div className="w-full bg-muted/30 border border-border rounded-md p-2 text-sm h-28 overflow-y-auto space-y-1">
            {!database && <p className="text-[11px] text-muted-foreground">Select database first.</p>}
            {database && collectionsLoading && <p className="text-[11px] text-muted-foreground">Loading...</p>}
            {database && !collectionsLoading && collectionNames.length === 0 && <p className="text-[11px] text-muted-foreground">No collections found.</p>}
            {database && !collectionsLoading && collectionNames.map((name) => (
              <label key={name} className="flex items-center gap-2 text-xs text-foreground cursor-pointer hover:bg-muted/50 p-1 rounded-sm">
                <input type="checkbox" checked={collections.includes(name)} onChange={() => toggleCollection(name)} className="h-3.5 w-3.5 rounded-sm border-primary text-primary focus:ring-primary" />
                <span className="truncate">{name}</span>
              </label>
            ))}
          </div>
        </div>
        {(rowsLoading || selectionSettling) && <p className="text-[11px] text-muted-foreground">Loading calls…</p>}
      </div>

      {error && <div className="text-sm text-red-400">{error}</div>}

      {database && !rowsLoading && collections.length > 0 && dropFailRows.length === 0 && (
        <div className="text-xs text-muted-foreground">No drop/fail calls in the loaded data.</div>
      )}

      {database && dropFailRows.length > 0 && <CommentAuditPanel database={database} rows={dropFailRows} allRows={rows} />}
    </div>
  );
}
