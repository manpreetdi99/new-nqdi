import { useState } from "react";
import { Wand2, Plus, Trash2, ChevronDown, ChevronUp, Check, Hash, Type, Calendar, Key } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AnimatePresence, motion } from "framer-motion";

// ─── Schema ────────────────────────────────────────────────────────────────

type ColType = "str" | "num" | "date" | "id";
interface ColDef  { name: string; type: ColType }
interface TableDef { name: string; alias: string; category: string; columns: ColDef[] }
interface JoinDef  { label: string; sql: string; alias: string; columns: ColDef[] }
interface WhereRow { id: string; alias: string; column: string; op: string; value: string; connector: "AND" | "OR" }

// ─── Table definitions ─────────────────────────────────────────────────────

const T_CALL_ANALYSIS: TableDef = {
  name: "CallAnalysis", alias: "CA", category: "Voice",
  columns: [
    { name: "SessionId", type: "id" }, { name: "FileId", type: "id" },
    { name: "callType", type: "str" }, { name: "callDir", type: "str" },
    { name: "callStatus", type: "str" }, { name: "technology", type: "str" },
    { name: "band", type: "str" }, { name: "CallMode", type: "str" },
    { name: "setupTime", type: "num" }, { name: "callDuration", type: "num" },
    { name: "callStartTimeStamp", type: "date" }, { name: "callEndTimeStamp", type: "date" },
    { name: "StartTechnology", type: "str" }, { name: "EndTechnology", type: "str" },
    { name: "CallTechnologies", type: "str" }, { name: "Side", type: "str" },
    { name: "SessionIdA", type: "id" }, { name: "disconCause", type: "str" },
    { name: "disconClass", type: "str" }, { name: "disconDirection", type: "str" },
    { name: "disconLocation", type: "str" }, { name: "code", type: "str" },
    { name: "codeDescription", type: "str" }, { name: "LastHoType", type: "str" },
    { name: "LastHoCause", type: "str" }, { name: "LastHoTimeStamp", type: "date" },
    { name: "avgRxLev", type: "num" }, { name: "avgRxQual", type: "num" },
    { name: "avgRLT", type: "num" }, { name: "avgLTERSRP", type: "num" },
    { name: "avgLTERSRQ", type: "num" }, { name: "avgLTESINR", type: "num" },
    { name: "avgNR5GRSRP", type: "num" }, { name: "avgNR5GRSRQ", type: "num" },
    { name: "avgNR5GSINR", type: "num" }, { name: "avgBLER", type: "num" },
    { name: "avgTotEcIo", type: "num" }, { name: "avgUETxPwr", type: "num" },
    { name: "avgUERxPwr", type: "num" }, { name: "NoService", type: "num" },
    { name: "Initializing", type: "num" },
  ],
};
const T_FILE_LIST: TableDef = {
  name: "FileList", alias: "FL", category: "Voice",
  columns: [
    { name: "FileId", type: "id" }, { name: "CollectionName", type: "str" },
    { name: "ASideLocation", type: "str" }, { name: "BSideLocation", type: "str" },
    { name: "ASideDevice", type: "str" }, { name: "BSideDevice", type: "str" },
    { name: "ASideNumber", type: "str" }, { name: "BSideNumber", type: "str" },
    { name: "ASideFileName", type: "str" }, { name: "BSideFileName", type: "str" },
    { name: "IMEI", type: "str" }, { name: "IMSI", type: "str" },
    { name: "FirmwareV", type: "str" }, { name: "MFVersion", type: "str" },
    { name: "SWVersion", type: "str" },
  ],
};
const T_SESSIONS: TableDef = {
  name: "Sessions", alias: "S", category: "Voice",
  columns: [
    { name: "SessionId", type: "id" }, { name: "FileId", type: "id" },
    { name: "sessionType", type: "str" }, { name: "startTime", type: "date" },
    { name: "duration", type: "num" }, { name: "valid", type: "num" },
    { name: "InvalidReason", type: "str" }, { name: "SpeedAvg", type: "num" },
    { name: "SpeedCategory", type: "num" },
  ],
};
const T_POSITION: TableDef = {
  name: "Position", alias: "POS", category: "Location",
  columns: [
    { name: "PosId", type: "id" }, { name: "SessionId", type: "id" },
    { name: "MsgTime", type: "date" }, { name: "latitude", type: "num" },
    { name: "longitude", type: "num" }, { name: "speed", type: "num" },
    { name: "altitude", type: "num" }, { name: "Direction", type: "num" },
  ],
};
const T_LTE: TableDef = {
  name: "LTEMeasurementReport", alias: "LMR", category: "Signal",
  columns: [
    { name: "MsgId", type: "id" }, { name: "SessionId", type: "id" },
    { name: "MsgTime", type: "date" }, { name: "EARFCN", type: "num" },
    { name: "PhyCellId", type: "num" }, { name: "RSRP", type: "num" },
    { name: "RSRQ", type: "num" }, { name: "RSSI", type: "num" },
    { name: "SINR0", type: "num" }, { name: "SINR1", type: "num" },
  ],
};
const T_GSM: TableDef = {
  name: "GSMMeasReport", alias: "GMR", category: "Signal",
  columns: [
    { name: "MsgId", type: "id" }, { name: "SessionId", type: "id" },
    { name: "MsgTime", type: "date" }, { name: "RxLevFull", type: "num" },
    { name: "RxLevSub", type: "num" }, { name: "RxQualFull", type: "num" },
    { name: "RxQualSub", type: "num" },
  ],
};
const T_TECHNOLOGY: TableDef = {
  name: "Technology", alias: "T", category: "Signal",
  columns: [
    { name: "SessionId", type: "id" }, { name: "FileId", type: "id" },
    { name: "MsgTime", type: "date" }, { name: "PrevTechnology", type: "str" },
    { name: "CurrTechnology", type: "str" }, { name: "Duration", type: "num" },
    { name: "Band", type: "str" }, { name: "LTEDLCarriers", type: "num" },
    { name: "LTEULCarriers", type: "num" }, { name: "NR5GDLCarriers", type: "num" },
    { name: "NR5GULCarriers", type: "num" },
  ],
};
const T_MOS: TableDef = {
  name: "ResultsLQ08Avg", alias: "LQ", category: "MOS",
  columns: [
    { name: "MsgId", type: "id" }, { name: "SessionId", type: "id" },
    { name: "OptionalWB", type: "num" }, { name: "OptionalNB", type: "num" },
    { name: "LQWB", type: "num" }, { name: "LQNB", type: "num" },
    { name: "QualityCode", type: "str" }, { name: "MissedVoice", type: "num" },
    { name: "RcvDelay", type: "num" },
  ],
};
const T_LTE_SCANNER: TableDef = {
  name: "FactLTEScanner", alias: "FLS", category: "Scanner",
  columns: [
    { name: "FactId", type: "id" }, { name: "FullDate", type: "date" },
    { name: "SessionId", type: "id" }, { name: "EARFCN", type: "num" },
    { name: "PCI", type: "num" }, { name: "RFBand", type: "num" },
    { name: "RSRP", type: "num" }, { name: "RSRQ", type: "num" },
    { name: "SINR", type: "num" }, { name: "RSSI", type: "num" },
    { name: "MCC", type: "num" }, { name: "MNC", type: "num" },
  ],
};
const T_GSM_SCANNER: TableDef = {
  name: "FactGSMScanner", alias: "FGS", category: "Scanner",
  columns: [
    { name: "FactId", type: "id" }, { name: "FullDate", type: "date" },
    { name: "SessionId", type: "id" }, { name: "BCCH", type: "num" },
    { name: "RFBand", type: "num" }, { name: "BSIC", type: "num" },
    { name: "RxLev", type: "num" }, { name: "CId", type: "num" },
    { name: "LAC", type: "num" },
  ],
};
const T_CDR: TableDef = {
  name: "CDRCombined", alias: "CC", category: "Data",
  columns: [
    { name: "TestId", type: "id" }, { name: "SessionId", type: "id" },
    { name: "FileId", type: "id" }, { name: "Technology", type: "str" },
    { name: "[Test Name]", type: "str" }, { name: "[Test Start TS]", type: "date" },
    { name: "[Transfer Status]", type: "str" }, { name: "[Scoring Status]", type: "str" },
    { name: "[Transfer Throughput (kbps)]", type: "num" }, { name: "[Transfer Duration (ms)]", type: "num" },
    { name: "TestDirection", type: "str" }, { name: "Host", type: "str" },
    { name: "[Start Technology]", type: "str" },
    { name: "[Capacity_Sustainable Throughput (kbps)]", type: "num" },
    { name: "[YouTube_Avg. Video MOS]", type: "num" },
    { name: "[Ping_RTT Avg (ms)]", type: "num" }, { name: "valid", type: "num" },
  ],
};
const T_MARKERS: TableDef = {
  name: "Markers", alias: "MK", category: "Events",
  columns: [
    { name: "markerId", type: "id" }, { name: "SessionId", type: "id" },
    { name: "MsgTime", type: "date" }, { name: "MarkerText", type: "str" },
    { name: "NetworkId", type: "id" },
  ],
};

const ALL_TABLES: TableDef[] = [
  T_CALL_ANALYSIS, T_FILE_LIST, T_SESSIONS,
  T_LTE, T_GSM, T_TECHNOLOGY, T_MOS,
  T_LTE_SCANNER, T_GSM_SCANNER, T_CDR, T_MARKERS, T_POSITION,
];

const AC_COLS: ColDef[] = [{ name: "Comment", type: "str" }];

const JOINS_FOR: Record<string, JoinDef[]> = {
  CallAnalysis: [
    { label: "FileList",          sql: "LEFT JOIN FileList FL ON FL.FileId = CA.FileId",                                                                                               alias: "FL",  columns: T_FILE_LIST.columns },
    { label: "Sessions",          sql: "LEFT JOIN Sessions S ON S.SessionId = CA.SessionId",                                                                                           alias: "S",   columns: T_SESSIONS.columns },
    { label: "Position",          sql: "LEFT JOIN Position POS ON POS.PosId = CA.PosId",                                                                                              alias: "POS", columns: T_POSITION.columns },
    { label: "ResultsLQ08Avg",    sql: "LEFT JOIN ResultsLQ08Avg LQ ON LQ.SessionId = CA.SessionId",                                                                                  alias: "LQ",  columns: T_MOS.columns },
    { label: "AnalysisComment",   sql: "LEFT JOIN AnalysisCommentSessionsBridge ACSB ON ACSB.sessionID = CA.SessionId\nLEFT JOIN AnalysisComment AC ON ACSB.commentId = AC.commentID", alias: "AC",  columns: AC_COLS },
  ],
  LTEMeasurementReport: [
    { label: "Position", sql: "LEFT JOIN Position P ON P.PosId = LMR.PosId",           alias: "P", columns: T_POSITION.columns },
    { label: "Sessions", sql: "LEFT JOIN Sessions S ON S.SessionId = LMR.SessionId",   alias: "S", columns: T_SESSIONS.columns },
  ],
  GSMMeasReport: [
    { label: "Position", sql: "LEFT JOIN Position P ON P.PosId = GMR.PosId",           alias: "P", columns: T_POSITION.columns },
    { label: "Sessions", sql: "LEFT JOIN Sessions S ON S.SessionId = GMR.SessionId",   alias: "S", columns: T_SESSIONS.columns },
  ],
  Technology: [
    { label: "Position", sql: "LEFT JOIN Position P ON P.PosId = T.PosId",             alias: "P",  columns: T_POSITION.columns },
    { label: "FileList", sql: "LEFT JOIN FileList FL ON FL.FileId = T.FileId",         alias: "FL", columns: T_FILE_LIST.columns },
  ],
  CDRCombined: [
    { label: "FileList",        sql: "JOIN FileList FL ON FL.FileId = CC.FileId",                                                                                                      alias: "FL", columns: T_FILE_LIST.columns },
    { label: "Sessions",        sql: "LEFT JOIN Sessions S ON S.SessionId = CC.SessionId",                                                                                             alias: "S",  columns: T_SESSIONS.columns },
    { label: "AnalysisComment", sql: "LEFT JOIN AnalysisCommentSessionsBridge ACSB ON ACSB.sessionID = CC.SessionId\nLEFT JOIN AnalysisComment AC ON ACSB.commentId = AC.commentID",  alias: "AC", columns: AC_COLS },
  ],
  FactLTEScanner: [{ label: "Position", sql: "LEFT JOIN Position P ON P.PosId = FLS.PosId", alias: "P", columns: T_POSITION.columns }],
  FactGSMScanner: [{ label: "Position", sql: "LEFT JOIN Position P ON P.PosId = FGS.PosId", alias: "P", columns: T_POSITION.columns }],
  Markers: [
    { label: "Position", sql: "LEFT JOIN Position P ON P.PosId = MK.PosId",           alias: "P", columns: T_POSITION.columns },
    { label: "Sessions", sql: "LEFT JOIN Sessions S ON S.SessionId = MK.SessionId",   alias: "S", columns: T_SESSIONS.columns },
  ],
};

const OPERATORS = ["=", "!=", ">", "<", ">=", "<=", "LIKE", "IN", "IS NULL", "IS NOT NULL"];
const CATEGORIES = ["Voice", "Signal", "Data", "MOS", "Scanner", "Events", "Location"];
const uid = () => Math.random().toString(36).slice(2, 8);
const colKey = (alias: string, col: string) => `${alias}.${col}`;

// ─── Type badge ────────────────────────────────────────────────────────────

const TYPE_META: Record<ColType, { icon: React.ReactNode; cls: string }> = {
  id:   { icon: <Key      className="h-2.5 w-2.5" />, cls: "text-muted-foreground/60" },
  num:  { icon: <Hash     className="h-2.5 w-2.5" />, cls: "text-sky-400/80"          },
  str:  { icon: <Type     className="h-2.5 w-2.5" />, cls: "text-emerald-400/80"      },
  date: { icon: <Calendar className="h-2.5 w-2.5" />, cls: "text-amber-400/80"        },
};

// ─── Step label ────────────────────────────────────────────────────────────

function StepLabel({ n, label }: { n: number; label: string }) {
  return (
    <div className="flex items-center gap-2 mb-2">
      <span className="flex h-4.5 w-4.5 items-center justify-center rounded-full bg-primary/20 text-primary text-[9px] font-bold leading-none ring-1 ring-primary/40 px-1.5 py-0.5">
        {n}
      </span>
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
    </div>
  );
}

// ─── Column group ──────────────────────────────────────────────────────────

function ColGroup({
  alias, cols, label, selCols,
  onToggle, onAll, onNone,
}: {
  alias: string; cols: ColDef[]; label: string; selCols: Set<string>;
  onToggle: (alias: string, col: string) => void;
  onAll: (alias: string, cols: ColDef[]) => void;
  onNone: (alias: string, cols: ColDef[]) => void;
}) {
  const selected = cols.filter((c) => selCols.has(colKey(alias, c.name))).length;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-[10px] font-semibold text-primary">
          <span className="rounded px-1 py-0.5 bg-primary/10 font-mono text-[9px]">{alias}</span>
          {label}
        </span>
        <div className="flex items-center gap-1.5">
          <span className="text-[9px] text-muted-foreground">{selected}/{cols.length}</span>
          <button onClick={() => onAll(alias, cols)}  className="text-[9px] px-1.5 py-0.5 rounded border border-border bg-muted/60 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">All</button>
          <button onClick={() => onNone(alias, cols)} className="text-[9px] px-1.5 py-0.5 rounded border border-border bg-muted/60 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">None</button>
        </div>
      </div>

      <div className="flex flex-wrap gap-1">
        {cols.map((c) => {
          const k = colKey(alias, c.name);
          const on = selCols.has(k);
          const tm = TYPE_META[c.type];
          return (
            <button
              key={k}
              onClick={() => onToggle(alias, c.name)}
              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono border transition-all ${
                on
                  ? "bg-primary/15 border-primary/40 text-primary shadow-sm shadow-primary/10"
                  : "bg-muted/30 border-border/60 text-muted-foreground hover:border-border hover:text-foreground"
              }`}
            >
              <span className={on ? "text-primary/70" : tm.cls}>{tm.icon}</span>
              {c.name}
              {on && <Check className="h-2 w-2 text-primary/60 ml-0.5" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Component ─────────────────────────────────────────────────────────────

export default function QueryBuilder({ onApply }: { onApply: (sql: string) => void }) {
  const [open, setOpen]               = useState(false);
  const [primaryName, setPrimaryName] = useState("CallAnalysis");
  const [activeJoins, setActiveJoins] = useState<string[]>([]);
  const [selCols, setSelCols]         = useState<Set<string>>(
    new Set(["CA.SessionId", "CA.callStatus", "CA.technology", "CA.callDir", "CA.setupTime", "CA.callDuration"]),
  );
  const [wheres, setWheres]           = useState<WhereRow[]>([]);
  const [topN, setTopN]               = useState("500");
  const [orderCol, setOrderCol]       = useState("");
  const [orderDir, setOrderDir]       = useState<"ASC" | "DESC">("DESC");

  const primaryTable   = ALL_TABLES.find((t) => t.name === primaryName) ?? T_CALL_ANALYSIS;
  const availableJoins = JOINS_FOR[primaryName] ?? [];
  const joinDefs       = availableJoins.filter((j) => activeJoins.includes(j.label));

  const allAliasCols = [
    ...primaryTable.columns.map((c) => ({ alias: primaryTable.alias, col: c })),
    ...joinDefs.flatMap((j) => j.columns.map((c) => ({ alias: j.alias, col: c }))),
  ];

  const totalSelected = selCols.size;

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleTableChange = (name: string) => {
    const tbl = ALL_TABLES.find((t) => t.name === name) ?? T_CALL_ANALYSIS;
    setPrimaryName(name);
    setActiveJoins([]);
    setSelCols(new Set(
      [`${tbl.alias}.SessionId`, `${tbl.alias}.MsgTime`]
        .filter((k) => tbl.columns.some((c) => colKey(tbl.alias, c.name) === k)),
    ));
    setWheres([]);
    setOrderCol("");
  };

  const toggleJoin   = (label: string) => setActiveJoins((prev) => prev.includes(label) ? prev.filter((l) => l !== label) : [...prev, label]);
  const toggleCol    = (alias: string, col: string) => setSelCols((prev) => { const n = new Set(prev); n.has(colKey(alias, col)) ? n.delete(colKey(alias, col)) : n.add(colKey(alias, col)); return n; });
  const selectAll    = (alias: string, cols: ColDef[]) => setSelCols((prev) => { const n = new Set(prev); cols.forEach((c) => n.add(colKey(alias, c.name))); return n; });
  const clearAll     = (alias: string, cols: ColDef[]) => setSelCols((prev) => { const n = new Set(prev); cols.forEach((c) => n.delete(colKey(alias, c.name))); return n; });
  const removeWhere  = (id: string) => setWheres((prev) => prev.filter((w) => w.id !== id));
  const updateWhere  = (id: string, patch: Partial<WhereRow>) => setWheres((prev) => prev.map((w) => w.id === id ? { ...w, ...patch } : w));
  const addWhere     = () => setWheres((prev) => [...prev, { id: uid(), alias: primaryTable.alias, column: primaryTable.columns[0]?.name ?? "", op: "=", value: "", connector: "AND" }]);

  // ── SQL builder ────────────────────────────────────────────────────────────

  const buildSQL = () => {
    const alias = primaryTable.alias;
    const colLines: string[] = [];
    primaryTable.columns.forEach((c) => { if (selCols.has(colKey(alias, c.name))) colLines.push(`  ${alias}.${c.name}`); });
    joinDefs.forEach((j) => j.columns.forEach((c) => { if (selCols.has(colKey(j.alias, c.name))) colLines.push(`  ${j.alias}.${c.name}`); }));

    const lines: string[] = [
      `SELECT ${topN ? `TOP ${topN} ` : ""}`,
      colLines.length > 0 ? colLines.join(",\n") : `  ${alias}.*`,
      `FROM ${primaryTable.name} ${alias}`,
      ...joinDefs.flatMap((j) => j.sql.split("\n")),
    ];

    wheres.forEach((w, i) => {
      const prefix = i === 0 ? "WHERE " : `  ${w.connector} `;
      const col = `${w.alias}.${w.column}`;
      if (w.op === "IS NULL" || w.op === "IS NOT NULL") lines.push(`${prefix}${col} ${w.op}`);
      else if (w.op === "LIKE") lines.push(`${prefix}${col} LIKE '%${w.value}%'`);
      else if (w.op === "IN")   lines.push(`${prefix}${col} IN (${w.value.split(",").map((v) => `'${v.trim()}'`).join(", ")})`);
      else { const v = w.value !== "" && !isNaN(Number(w.value)) ? w.value : `'${w.value}'`; lines.push(`${prefix}${col} ${w.op} ${v}`); }
    });

    if (orderCol) lines.push(`ORDER BY ${orderCol} ${orderDir}`);
    return lines.join("\n");
  };

  const handleApply = () => { onApply(buildSQL()); setOpen(false); };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">

      {/* Header toggle */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-2.5 hover:bg-muted/20 transition-colors group"
      >
        <span className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/10 group-hover:bg-primary/20 transition-colors">
            <Wand2 className="h-3.5 w-3.5 text-primary" />
          </span>
          <span className="text-xs font-semibold tracking-wide text-foreground">Query Builder</span>
          {open && totalSelected > 0 && (
            <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[9px] font-semibold text-primary">
              {totalSelected} cols
            </span>
          )}
        </span>
        <span className="flex items-center gap-2">
          {!open && (
            <span className="text-[10px] text-muted-foreground hidden sm:block">
              {primaryTable.name} · {totalSelected} cols
            </span>
          )}
          {open
            ? <ChevronUp   className="h-3.5 w-3.5 text-muted-foreground" />
            : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
        </span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <div className="border-t border-border divide-y divide-border/50">

              {/* ── 1. Table ── */}
              <div className="px-4 py-3">
                <StepLabel n={1} label="Primary Table" />
                <select
                  value={primaryName}
                  onChange={(e) => handleTableChange(e.target.value)}
                  className="w-full bg-muted/40 border border-border rounded-md px-3 py-2 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-primary/40 transition-shadow"
                >
                  {CATEGORIES.map((cat) => {
                    const inCat = ALL_TABLES.filter((t) => t.category === cat);
                    if (!inCat.length) return null;
                    return (
                      <optgroup key={cat} label={`── ${cat} ──`}>
                        {inCat.map((t) => (
                          <option key={t.name} value={t.name}>{t.name} ({t.alias})</option>
                        ))}
                      </optgroup>
                    );
                  })}
                </select>
              </div>

              {/* ── 2. JOINs ── */}
              {availableJoins.length > 0 && (
                <div className="px-4 py-3">
                  <StepLabel n={2} label="JOINs" />
                  <div className="flex flex-wrap gap-1.5">
                    {availableJoins.map((j) => {
                      const on = activeJoins.includes(j.label);
                      return (
                        <button
                          key={j.label}
                          onClick={() => toggleJoin(j.label)}
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-[10px] font-medium transition-all ${
                            on
                              ? "bg-primary/15 border-primary/40 text-primary shadow-sm"
                              : "bg-muted/30 border-border/60 text-muted-foreground hover:text-foreground hover:border-border"
                          }`}
                        >
                          {on && <Check className="h-2.5 w-2.5" />}
                          {j.label}
                          <span className="rounded px-1 bg-muted/60 font-mono text-[9px] text-muted-foreground">
                            {j.alias}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* ── 3. Columns ── */}
              <div className="px-4 py-3">
                <StepLabel n={3} label="Columns" />
                <div className="space-y-3 rounded-md border border-border/60 bg-muted/10 p-3">
                  <ColGroup
                    alias={primaryTable.alias}
                    cols={primaryTable.columns}
                    label={primaryTable.name}
                    selCols={selCols}
                    onToggle={toggleCol}
                    onAll={selectAll}
                    onNone={clearAll}
                  />
                  {joinDefs.map((j) => (
                    <div key={j.alias} className="pt-2 border-t border-border/40">
                      <ColGroup
                        alias={j.alias}
                        cols={j.columns}
                        label={j.label}
                        selCols={selCols}
                        onToggle={toggleCol}
                        onAll={selectAll}
                        onNone={clearAll}
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* ── 4. WHERE ── */}
              <div className="px-4 py-3">
                <div className="flex items-center justify-between mb-2">
                  <StepLabel n={4} label="WHERE Conditions" />
                  <button
                    onClick={addWhere}
                    className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-md border border-border bg-muted/40 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <Plus className="h-3 w-3" /> Add
                  </button>
                </div>

                {wheres.length === 0
                  ? <p className="text-[10px] text-muted-foreground/60 italic py-1">Χωρίς φίλτρα — επιστρέφει όλες τις γραμμές.</p>
                  : (
                    <div className="space-y-1.5">
                      {wheres.map((w, i) => (
                        <div key={w.id} className="flex items-center gap-1.5 rounded-md bg-muted/20 border border-border/40 px-2 py-1.5 flex-wrap">
                          {i > 0 && (
                            <select
                              value={w.connector}
                              onChange={(e) => updateWhere(w.id, { connector: e.target.value as "AND" | "OR" })}
                              className="bg-muted border border-border rounded px-1 py-0.5 text-[10px] font-semibold w-12 focus:outline-none text-primary"
                            >
                              <option>AND</option><option>OR</option>
                            </select>
                          )}

                          <select
                            value={`${w.alias}.${w.column}`}
                            onChange={(e) => { const [a, ...rest] = e.target.value.split("."); updateWhere(w.id, { alias: a, column: rest.join(".") }); }}
                            className="bg-muted border border-border rounded px-1 py-0.5 text-[10px] font-mono flex-1 min-w-[130px] focus:outline-none"
                          >
                            {allAliasCols.map(({ alias, col }) => (
                              <option key={colKey(alias, col.name)} value={colKey(alias, col.name)}>
                                {alias}.{col.name}
                              </option>
                            ))}
                          </select>

                          <select
                            value={w.op}
                            onChange={(e) => updateWhere(w.id, { op: e.target.value })}
                            className="bg-muted border border-border rounded px-1 py-0.5 text-[10px] w-[90px] focus:outline-none"
                          >
                            {OPERATORS.map((op) => <option key={op}>{op}</option>)}
                          </select>

                          {w.op !== "IS NULL" && w.op !== "IS NOT NULL" && (
                            <input
                              value={w.value}
                              onChange={(e) => updateWhere(w.id, { value: e.target.value })}
                              placeholder={w.op === "IN" ? "a, b, c" : "value"}
                              className="bg-muted border border-border rounded px-1.5 py-0.5 text-[10px] font-mono flex-1 min-w-[80px] focus:outline-none focus:ring-1 focus:ring-primary/40"
                            />
                          )}

                          <button onClick={() => removeWhere(w.id)} className="text-muted-foreground/50 hover:text-destructive transition-colors ml-auto">
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
              </div>

              {/* ── 5. TOP / ORDER ── */}
              <div className="px-4 py-3">
                <StepLabel n={5} label="TOP / ORDER BY" />
                <div className="flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-2 text-[10px] text-muted-foreground">
                    TOP
                    <input
                      type="number" value={topN} onChange={(e) => setTopN(e.target.value)}
                      min={0} max={100000}
                      className="w-20 bg-muted border border-border rounded px-2 py-1 text-[10px] font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
                    />
                    <span>rows</span>
                  </label>

                  <label className="flex items-center gap-2 text-[10px] text-muted-foreground">
                    ORDER BY
                    <select
                      value={orderCol}
                      onChange={(e) => setOrderCol(e.target.value)}
                      className="bg-muted border border-border rounded px-1.5 py-1 text-[10px] font-mono min-w-[150px] focus:outline-none"
                    >
                      <option value="">(none)</option>
                      {allAliasCols.map(({ alias, col }) => (
                        <option key={colKey(alias, col.name)} value={`${alias}.${col.name}`}>
                          {alias}.{col.name}
                        </option>
                      ))}
                    </select>
                    <div className="flex rounded-md border border-border overflow-hidden">
                      {(["ASC", "DESC"] as const).map((d) => (
                        <button
                          key={d}
                          onClick={() => setOrderDir(d)}
                          className={`px-2 py-0.5 text-[10px] font-medium transition-colors ${
                            orderDir === d
                              ? "bg-primary/20 text-primary"
                              : "bg-muted/40 text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          {d}
                        </button>
                      ))}
                    </div>
                  </label>
                </div>
              </div>

              {/* ── Apply ── */}
              <div className="px-4 py-3 bg-muted/10 flex items-center justify-between">
                <p className="text-[10px] text-muted-foreground">
                  {totalSelected} columns · {wheres.length} conditions
                </p>
                <Button size="sm" onClick={handleApply} className="gap-1.5 text-xs font-semibold">
                  <Wand2 className="h-3.5 w-3.5" />
                  Build &amp; Apply SQL
                </Button>
              </div>

            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
