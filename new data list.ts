import { useMemo, useState } from "react";
import {
  Wifi,
  WifiOff,
  AlertTriangle,
  ChevronRight,
  ChevronDown,
  Search,
  ArrowUpRight,
  ArrowLeftRight,
  Filter,
  MapPin,
  RefreshCw,
} from "lucide-react";
import type { DataCallRow } from "@/lib/api";
import { classifyDataTest } from "@/lib/attachmentC";

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

type SortKey = "natural" | "newest" | "fails" | "dl" | "rtt" | "session";

/* ── helpers ───────────────────────────────────────────────────────────── */

const pad = (n: number) => String(n).padStart(2, "0");

function parseTs(ts: string | null | undefined): Date | null {
  if (!ts) return null;
  const d = new Date(ts);
  return isNaN(d.getTime()) ? null : d;
}

function formatClock(ts: string | null | undefined): string {
  const d = parseTs(ts);
  if (!d) return ts ?? "N/A";
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function formatDay(ts: string | null | undefined): string {
  const d = parseTs(ts);
  if (!d) return "";
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
}

/** 95 → "95s", 512 → "8m 32s", 4210 → "1h 10m" */
function formatDuration(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return "—";
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${pad(s % 60)}s`;
  return `${Math.floor(m / 60)}h ${pad(m % 60)}m`;
}

const num = (v: number | null | undefined): number | null =>
  v == null || Number.isNaN(Number(v)) ? null : Number(v);

const avg = (values: number[]): number | null =>
  values.length === 0 ? null : values.reduce((s, v) => s + v, 0) / values.length;

/** Κρατάει μόνο τις μετρήσεις που πραγματικά έγιναν (null / 0 = δεν μετρήθηκε). */
const positives = (values: (number | null)[]): number[] =>
  values.filter((v): v is number => v != null && v > 0);

const isDl = (dir: string | null | undefined) => /^(dl|down)/i.test((dir ?? "").trim());
const isUl = (dir: string | null | undefined) => /^(ul|up)/i.test((dir ?? "").trim());

const techOf = (r: DataCallRow) => (r.technology ?? r.startTechnology ?? "").trim();

/** Τα capacity tests γράφουν σε δικό τους πεδίο. */
const throughputOf = (r: DataCallRow) => num(r.throughputKbps) ?? num(r.capacityThroughputKbps);

/** "HTTPBrowser" + "DL" → "HTTPBrowser DL" */
function testLabel(row: DataCallRow): string {
  const test = (row.testType ?? "Unknown").trim();
  const dir = (row.direction ?? "").trim();
  if (!dir) return test;
  if (isDl(dir)) return `${test} DL`;
  if (isUl(dir)) return `${test} UL`;
  return `${test} ${dir.toUpperCase()}`;
}

/**
 * Ποια στήλη είναι "η" μετρική για κάθε τύπο test και πώς γράφεται. Ένα σημείο
 * αλήθειας, ώστε γραμμή / breakdown / cycle να δείχνουν πάντα το ίδιο νούμερο.
 */
interface MetricSpec {
  pick: (r: DataCallRow) => number | null;
  fmt: (v: number) => string;
  /** true = μικρότερο είναι καλύτερο (RTT) */
  lowerIsBetter: boolean;
}

function metricSpec(testType: string | null | undefined): MetricSpec {
  const type = (testType ?? "").toLowerCase();
  if (type.includes("ping")) {
    return { pick: (r) => num(r.pingRttAvg), fmt: (v) => `${v.toFixed(1)} ms`, lowerIsBetter: true };
  }
  if (type.includes("youtube")) {
    return { pick: (r) => num(r.youtubeMos), fmt: (v) => `MOS ${v.toFixed(2)}`, lowerIsBetter: false };
  }
  return { pick: throughputOf, fmt: (v) => `${(v / 1000).toFixed(2)} Mbps`, lowerIsBetter: false };
}

/** Η βασική μετρική κάθε test, όπως τη διαβάζει ο μηχανικός στο πεδίο. */
function testMetric(row: DataCallRow): string {
  const type = (row.testType ?? "").toLowerCase();
  const spec = metricSpec(type);
  const v = spec.pick(row);

  if (type.includes("youtube")) {
    const inter = num(row.youtubeInterruptions);
    const parts = [v == null ? null : spec.fmt(v), inter == null ? null : `${inter} int.`];
    return parts.filter(Boolean).join(" · ") || "—";
  }
  if (type.includes("ping")) return v == null ? "—" : `RTT ${spec.fmt(v)}`;
  return v == null ? "—" : spec.fmt(v);
}

/** Δεύτερη γραμμή στα detail tables: πού χτύπησε και με τι τεχνολογία. */
function testContext(row: DataCallRow): string {
  return [row.host ?? "", techOf(row)].filter(Boolean).join(" · ");
}

/* ── KPI thresholds (άλλαξέ τα εδώ αν αλλάξουν τα targets) ─────────────── */

const kpiClass = {
  dl: (v: number) => (v >= 20 ? "text-green-400" : v >= 5 ? "text-yellow-400" : "text-red-400"),
  ul: (v: number) => (v >= 10 ? "text-green-400" : v >= 2 ? "text-yellow-400" : "text-red-400"),
  rtt: (v: number) => (v <= 50 ? "text-green-400" : v <= 150 ? "text-yellow-400" : "text-red-400"),
  mos: (v: number) => (v >= 4 ? "text-green-400" : v >= 3 ? "text-yellow-400" : "text-red-400"),
  /** Success rate % πάνω στα scored tests */
  rate: (v: number) => (v >= 98 ? "text-green-400" : v >= 90 ? "text-yellow-400" : "text-red-400"),
};

const TECH_COLORS: Record<string, string> = {
  "5G": "bg-purple-500/20 text-purple-300 border-purple-500/40",
  NR: "bg-purple-500/20 text-purple-300 border-purple-500/40",
  LTE: "bg-blue-500/20 text-blue-300 border-blue-500/40",
  "4G": "bg-blue-500/20 text-blue-300 border-blue-500/40",
  UMTS: "bg-yellow-500/20 text-yellow-300 border-yellow-500/40",
  "3G": "bg-yellow-500/20 text-yellow-300 border-yellow-500/40",
  GSM: "bg-green-500/20 text-green-300 border-green-500/40",
  "2G": "bg-green-500/20 text-green-300 border-green-500/40",
};

function techColor(tech: string): string {
  const key = Object.keys(TECH_COLORS).find((k) => tech.toUpperCase().includes(k));
  return key ? TECH_COLORS[key] : "bg-muted text-muted-foreground border-border";
}

const statusConfig = {
  invalid: { icon: WifiOff, color: "text-red-400", bg: "bg-red-500/15", label: "Invalid session" },
  fail: { icon: AlertTriangle, color: "text-orange-400", bg: "bg-orange-500/15", label: "Έχει αποτυχίες" },
  ok: { icon: Wifi, color: "text-green-400", bg: "bg-green-500/15", label: "OK" },
};

/* ── per-session aggregation ───────────────────────────────────────────── */

interface TypeBreakdown {
  label: string;
  total: number;
  ok: number;
  fail: number;
  /** Tests χωρίς scoring — δεν μετράνε ούτε ως pass ούτε ως fail. */
  other: number;
  metric: string;
  /** "min … max" όταν υπάρχουν ≥2 μετρήσεις — δείχνει τη διασπορά. */
  range: string | null;
  hosts: string[];
}

interface SessionView {
  item: DataSessionItem;
  location: string;
  status: keyof typeof statusConfig;
  startedAt: number;
  endedAt: number;
  /** Από το πρώτο ως το τελευταίο test του session. */
  durationSec: number | null;
  dl: number | null;
  ul: number | null;
  rtt: number | null;
  mos: number | null;
  /** Χειρότερη τιμή του session — εκεί κρύβεται συνήθως το πρόβλημα. */
  worstDl: number | null;
  worstRtt: number | null;
  /** Σύνολο YouTube interruptions σε όλο το session. */
  interruptions: number | null;
  techMix: { tech: string; count: number }[];
  /** Η αλληλουχία των τεχνολογιών με τη σειρά που εμφανίστηκαν (π.χ. NR → LTE). */
  techPath: string[];
  hosts: string[];
  coords: { lat: number; lon: number } | null;
  fileName: string | null;
  /** Tests χωρίς scoring status. */
  otherCount: number;
  breakdown: TypeBreakdown[];
  failedTests: DataCallRow[];
  orderedTests: DataCallRow[];
  searchBlob: string;
  /** Θέση του session μέσα στο location, με τη σειρά που το επιστρέφει το SQL. */
  order: number;
  /** 6 συνεχόμενα sessions ενός location = 1 cycle. */
  cycle: number;
  /** 1..cycleSize — η θέση του session μέσα στο cycle. */
  posInCycle: number;
}

function buildView(item: DataSessionItem): SessionView {
  const tests = item.tests;

  /** Χρονολογική σειρά — τα rows μπορεί να έρθουν ομαδοποιημένα ανά τύπο. */
  const orderedTests = [...tests].sort(
    (a, b) =>
      (parseTs(a.callStartTimeStamp)?.getTime() ?? 0) - (parseTs(b.callStartTimeStamp)?.getTime() ?? 0),
  );

  const dlValues = positives(tests.filter((r) => isDl(r.direction)).map(throughputOf));
  const ulValues = positives(tests.filter((r) => isUl(r.direction)).map(throughputOf));
  const rttValues = positives(tests.map((r) => num(r.pingRttAvg)));
  const mosValues = positives(tests.map((r) => num(r.youtubeMos)));
  const interValues = tests
    .map((r) => num(r.youtubeInterruptions))
    .filter((v): v is number => v != null);

  const dl = avg(dlValues);
  const ul = avg(ulValues);
  const rtt = avg(rttValues);
  const mos = avg(mosValues);

  const techCounts = new Map<string, number>();
  const techPath: string[] = [];
  for (const r of orderedTests) {
    const t = techOf(r);
    if (!t) continue;
    techCounts.set(t, (techCounts.get(t) ?? 0) + 1);
    if (techPath[techPath.length - 1] !== t) techPath.push(t);
  }

  const hosts = Array.from(new Set(tests.map((r) => (r.host ?? "").trim()).filter(Boolean)));

  const groups = new Map<string, DataCallRow[]>();
  for (const r of orderedTests) {
    const key = testLabel(r);
    const bucket = groups.get(key);
    if (bucket) bucket.push(r);
    else groups.set(key, [r]);
  }

  const breakdown: TypeBreakdown[] = Array.from(groups.entries()).map(([label, rows]) => {
    let ok = 0;
    let fail = 0;
    for (const r of rows) {
      const outcome = classifyDataTest(r);
      if (outcome === "success") ok++;
      else if (outcome === "failed") fail++;
    }
    const spec = metricSpec(rows[0]?.testType);
    const values = positives(rows.map(spec.pick));
    const mean = avg(values);
    return {
      label,
      total: rows.length,
      ok,
      fail,
      other: rows.length - ok - fail,
      metric: mean == null ? "—" : spec.fmt(mean),
      range:
        values.length < 2
          ? null
          : `${spec.fmt(Math.min(...values))} … ${spec.fmt(Math.max(...values))}`,
      hosts: Array.from(new Set(rows.map((r) => (r.host ?? "").trim()).filter(Boolean))),
    };
  });
  breakdown.sort((a, b) => b.fail - a.fail || a.label.localeCompare(b.label));

  const status: keyof typeof statusConfig =
    item.first?.isValid === 0 ? "invalid" : item.failCount > 0 ? "fail" : "ok";

  const startedAt = parseTs(item.first?.callStartTimeStamp)?.getTime() ?? 0;
  const endedAt =
    parseTs(orderedTests[orderedTests.length - 1]?.callStartTimeStamp)?.getTime() ?? startedAt;

  const withCoords = tests.find((r) => num(r.latitude) != null && num(r.longitude) != null);

  return {
    item,
    location: item.first?.Location ?? "Unknown",
    status,
    startedAt,
    endedAt,
    durationSec: startedAt > 0 && endedAt > startedAt ? (endedAt - startedAt) / 1000 : null,
    dl: dl == null ? null : dl / 1000,
    ul: ul == null ? null : ul / 1000,
    rtt,
    mos,
    worstDl: dlValues.length === 0 ? null : Math.min(...dlValues) / 1000,
    worstRtt: rttValues.length === 0 ? null : Math.max(...rttValues),
    interruptions: interValues.length === 0 ? null : interValues.reduce((s, v) => s + v, 0),
    techMix: Array.from(techCounts.entries())
      .map(([tech, count]) => ({ tech, count }))
      .sort((a, b) => b.count - a.count),
    techPath,
    hosts,
    coords:
      withCoords == null
        ? null
        : { lat: num(withCoords.latitude)!, lon: num(withCoords.longitude)! },
    fileName: item.first?.ASideFileName ?? null,
    otherCount: Math.max(tests.length - item.passCount - item.failCount, 0),
    breakdown,
    failedTests: orderedTests.filter((r) => classifyDataTest(r) === "failed"),
    orderedTests,
    searchBlob: [
      item.sessionId,
      item.first?.Location ?? "",
      item.first?.CollectionName ?? "",
      item.first?.ASideFileName ?? "",
      item.first?.comment ?? "",
      ...tests.map((r) => `${r.testType ?? ""} ${r.host ?? ""} ${techOf(r)}`),
    ]
      .join(" ")
      .toLowerCase(),
    // Συμπληρώνονται αφού μαζευτούν όλα τα sessions ενός location (βλ. useMemo).
    order: 0,
    cycle: 1,
    posInCycle: 1,
  };
}

/* ── cycle aggregation ─────────────────────────────────────────────────── */

interface CycleGroup {
  cycle: number;
  views: SessionView[];
  /** Πλήρες = έχει όλα τα sessions του cycle (π.χ. 6/6). */
  complete: boolean;
  from: string | null;
  to: string | null;
  tests: number;
  pass: number;
  fail: number;
  /** Πόσα sessions του cycle έχουν έστω μία αποτυχία ή είναι invalid. */
  badSessions: number;
  dl: number | null;
  ul: number | null;
  rtt: number | null;
  mos: number | null;
  /** Διάρκεια από την αρχή του πρώτου ως την αρχή του τελευταίου test. */
  spanSec: number | null;
}

function summarizeCycle(cycle: number, views: SessionView[], cycleSize: number): CycleGroup {
  const stamps = views
    .map((v) => v.item.first?.callStartTimeStamp)
    .filter((s): s is string => !!parseTs(s))
    .sort((a, b) => (parseTs(a)!.getTime() - parseTs(b)!.getTime()));

  const from = stamps[0] ?? null;
  const to = stamps[stamps.length - 1] ?? null;
  const spanMs =
    from && to ? parseTs(to)!.getTime() - parseTs(from)!.getTime() : null;

  return {
    cycle,
    views,
    complete: views.length >= cycleSize,
    from,
    to,
    tests: views.reduce((s, v) => s + v.item.tests.length, 0),
    pass: views.reduce((s, v) => s + v.item.passCount, 0),
    fail: views.reduce((s, v) => s + v.item.failCount, 0),
    badSessions: views.filter((v) => v.status !== "ok").length,
    dl: avg(views.map((v) => v.dl).filter((v): v is number => v != null)),
    ul: avg(views.map((v) => v.ul).filter((v): v is number => v != null)),
    rtt: avg(views.map((v) => v.rtt).filter((v): v is number => v != null)),
    mos: avg(views.map((v) => v.mos).filter((v): v is number => v != null)),
    spanSec: spanMs == null || spanMs <= 0 ? null : spanMs / 1000,
  };
}

interface LocationGroup {
  location: string;
  views: SessionView[];
  cycles: CycleGroup[];
  tests: number;
  pass: number;
  fail: number;
  badSessions: number;
  dl: number | null;
  ul: number | null;
  rtt: number | null;
  /** Ενωμένο tech mix όλου του location. */
  techMix: { tech: string; count: number }[];
}

/* ── small presentational bits ─────────────────────────────────────────── */

const Kpi = ({
  value,
  format,
  tone,
}: {
  value: number | null;
  format: (v: number) => string;
  tone: (v: number) => string;
}) =>
  value == null ? (
    <span className="text-xs font-mono text-muted-foreground/50">—</span>
  ) : (
    <span className={`text-xs font-mono ${tone(value)}`}>{format(value)}</span>
  );

/** Γραμμή "ετικέτα → τιμή" στο panel στοιχείων· κρύβεται όταν δεν υπάρχει τιμή. */
const Fact = ({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string | null | undefined;
  mono?: boolean;
}) =>
  !value ? null : (
    <div className="flex gap-2">
      <dt className="text-muted-foreground w-[5.5rem] shrink-0">{label}</dt>
      <dd className={`text-foreground break-words min-w-0 ${mono ? "font-mono" : ""}`} title={value}>
        {value}
      </dd>
    </div>
  );

const PassFailBar = ({ pass, fail, total }: { pass: number; fail: number; total: number }) => {
  const other = Math.max(total - pass - fail, 0);
  const pct = (n: number) => (total > 0 ? (n / total) * 100 : 0);
  return (
    <div className="flex items-center gap-2">
      <div className="flex h-1.5 w-16 overflow-hidden rounded-full bg-muted/40 shrink-0">
        <div className="bg-green-500/80" style={{ width: `${pct(pass)}%` }} />
        <div className="bg-red-500/80" style={{ width: `${pct(fail)}%` }} />
        <div className="bg-muted-foreground/30" style={{ width: `${pct(other)}%` }} />
      </div>
      <span className="text-[11px] font-mono whitespace-nowrap">
        <span className="text-green-400">{pass}</span>
        <span className="text-muted-foreground">/</span>
        <span className={fail > 0 ? "text-red-400" : "text-muted-foreground"}>{fail}</span>
        <span className="text-muted-foreground/60"> ({total})</span>
      </span>
    </div>
  );
};

/* ── component ─────────────────────────────────────────────────────────── */

const GRID =
  "grid grid-cols-[1.75rem_1.75rem_minmax(9rem,1.3fr)_5rem_4rem_4.5rem_minmax(6rem,0.8fr)_4.5rem_4.5rem_4.5rem_4rem_9rem_1.75rem] gap-2 items-center";

/** Πόσα συνεχόμενα sessions ενός location κάνουν ένα cycle. */
const DEFAULT_CYCLE_SIZE = 6;
const CYCLE_SIZE_OPTIONS = [4, 6, 8, 12];

const DataSessionsList = ({ sessions, selectedSessionId, onSelectSession }: DataSessionsListProps) => {
  const [search, setSearch] = useState("");
  const [onlyProblems, setOnlyProblems] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("natural");
  const [cycleSize, setCycleSize] = useState(DEFAULT_CYCLE_SIZE);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [collapsedLocations, setCollapsedLocations] = useState<Set<string>>(new Set());

  /**
   * Τα sessions έρχονται με τη σειρά του SQL (ORDER BY SessionId, Test Start TS),
   * δηλαδή από το παλαιότερο προς το νεότερο. Πάνω σε αυτή τη σειρά χτίζονται τα
   * cycles: κάθε {cycleSize} συνεχόμενα sessions του ίδιου ASideLocation = 1 cycle.
   */
  const views = useMemo(() => {
    const built = sessions.map(buildView);
    const perLocation = new Map<string, number>();
    for (const v of built) {
      const idx = perLocation.get(v.location) ?? 0;
      perLocation.set(v.location, idx + 1);
      v.order = idx;
      v.cycle = Math.floor(idx / cycleSize) + 1;
      v.posInCycle = (idx % cycleSize) + 1;
    }
    return built;
  }, [sessions, cycleSize]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = views.filter((v) => {
      if (onlyProblems && v.status === "ok") return false;
      if (q && !v.searchBlob.includes(q)) return false;
      return true;
    });

    const sorted = [...filtered];
    sorted.sort((a, b) => {
      switch (sortKey) {
        case "newest":
          return b.startedAt - a.startedAt;
        case "fails":
          return b.item.failCount - a.item.failCount || a.order - b.order;
        case "dl":
          return (a.dl ?? Number.POSITIVE_INFINITY) - (b.dl ?? Number.POSITIVE_INFINITY);
        case "rtt":
          return (b.rtt ?? -1) - (a.rtt ?? -1);
        case "session":
          return a.item.sessionId.localeCompare(b.item.sessionId, undefined, { numeric: true });
        default:
          // Φυσική σειρά συλλογής: παλαιότερο πρώτα, όπως το SQL.
          return a.order - b.order;
      }
    });
    return sorted;
  }, [views, search, onlyProblems, sortKey]);

  /** Ομαδοποίηση ανά ASideLocation· τα locations με τη σειρά που εμφανίζονται στο SQL. */
  const locationGroups = useMemo<LocationGroup[]>(() => {
    const map = new Map<string, SessionView[]>();
    for (const v of visible) {
      const bucket = map.get(v.location);
      if (bucket) bucket.push(v);
      else map.set(v.location, [v]);
    }

    return Array.from(map.entries()).map(([location, groupViews]) => {
      const cycles = new Map<number, SessionView[]>();
      for (const v of groupViews) {
        const bucket = cycles.get(v.cycle);
        if (bucket) bucket.push(v);
        else cycles.set(v.cycle, [v]);
      }

      const techCounts = new Map<string, number>();
      for (const v of groupViews) {
        for (const { tech, count } of v.techMix) {
          techCounts.set(tech, (techCounts.get(tech) ?? 0) + count);
        }
      }

      return {
        location,
        views: groupViews,
        cycles: Array.from(cycles.entries())
          .sort((a, b) => a[0] - b[0])
          .map(([cycle, cycleViews]) => summarizeCycle(cycle, cycleViews, cycleSize)),
        tests: groupViews.reduce((s, v) => s + v.item.tests.length, 0),
        pass: groupViews.reduce((s, v) => s + v.item.passCount, 0),
        fail: groupViews.reduce((s, v) => s + v.item.failCount, 0),
        badSessions: groupViews.filter((v) => v.status !== "ok").length,
        dl: avg(groupViews.map((v) => v.dl).filter((v): v is number => v != null)),
        ul: avg(groupViews.map((v) => v.ul).filter((v): v is number => v != null)),
        rtt: avg(groupViews.map((v) => v.rtt).filter((v): v is number => v != null)),
        techMix: Array.from(techCounts.entries())
          .map(([tech, count]) => ({ tech, count }))
          .sort((a, b) => b.count - a.count),
      };
    });
  }, [visible, cycleSize]);

  const totals = useMemo(() => {
    let pass = 0;
    let fail = 0;
    let tests = 0;
    let other = 0;
    let bad = 0;
    for (const v of visible) {
      pass += v.item.passCount;
      fail += v.item.failCount;
      tests += v.item.tests.length;
      other += v.otherCount;
      if (v.status !== "ok") bad++;
    }
    return {
      pass,
      fail,
      tests,
      other,
      bad,
      // Success rate μόνο πάνω στα scored tests — τα "other" δεν κρίθηκαν.
      successRate: pass + fail > 0 ? (pass / (pass + fail)) * 100 : null,
      dl: avg(visible.map((v) => v.dl).filter((v): v is number => v != null)),
      rtt: avg(visible.map((v) => v.rtt).filter((v): v is number => v != null)),
    };
  }, [visible]);

  const toggleExpand = (sessionId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(sessionId)) next.delete(sessionId);
      else next.add(sessionId);
      return next;
    });
  };

  /** Τα cycle blocks βγάζουν νόημα μόνο στη φυσική σειρά συλλογής. */
  const groupByCycle = sortKey === "natural";

  const toggleLocation = (location: string) => {
    setCollapsedLocations((prev) => {
      const next = new Set(prev);
      if (next.has(location)) next.delete(location);
      else next.add(location);
      return next;
    });
  };

  return (
    <div>
      {/* ── Toolbar ── */}
      <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-border bg-muted/20">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Session / Location / Collection / Host"
            className="h-7 w-64 rounded-md border border-border bg-background pl-7 pr-2 text-xs text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        <button
          type="button"
          onClick={() => setOnlyProblems((v) => !v)}
          className={`flex items-center gap-1 h-7 px-2 rounded-md border text-[11px] transition-colors ${
            onlyProblems
              ? "border-orange-500/50 bg-orange-500/15 text-orange-300"
              : "border-border text-muted-foreground hover:bg-muted/40"
          }`}
          title="Μόνο sessions με αποτυχίες ή invalid"
        >
          <Filter className="h-3 w-3" />
          Μόνο προβλήματα
        </button>

        <div className="flex items-center gap-1">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Sort</span>
          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
            className="h-7 rounded-md border border-border bg-background px-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="natural">Σειρά συλλογής (παλαιότερο πρώτα)</option>
            <option value="newest">Πιο πρόσφατα πρώτα</option>
            <option value="fails">Περισσότερες αποτυχίες</option>
            <option value="dl">Χαμηλότερο DL πρώτα</option>
            <option value="rtt">Χειρότερο RTT πρώτα</option>
            <option value="session">Session ID</option>
          </select>
        </div>

        <div className="flex items-center gap-1">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Cycle</span>
          <select
            value={cycleSize}
            onChange={(e) => setCycleSize(Number(e.target.value))}
            title="Πόσα συνεχόμενα sessions ανά location κάνουν ένα cycle"
            className="h-7 rounded-md border border-border bg-background px-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          >
            {CYCLE_SIZE_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n} sessions
              </option>
            ))}
          </select>
        </div>

        <div className="ml-auto flex items-center gap-3 text-[11px] font-mono">
          <span className="text-muted-foreground">
            {visible.length}/{views.length} sessions
            {totals.bad > 0 && <span className="text-orange-400"> ({totals.bad} με πρόβλημα)</span>}
          </span>
          <span className="text-muted-foreground">{locationGroups.length} locations</span>
          <span className="text-muted-foreground">{totals.tests} tests</span>
          <span className="text-green-400">{totals.pass} pass</span>
          <span className={totals.fail > 0 ? "text-red-400" : "text-muted-foreground"}>{totals.fail} fail</span>
          {totals.other > 0 && (
            <span className="text-muted-foreground/70" title="Tests χωρίς scoring status">
              {totals.other} n/s
            </span>
          )}
          {totals.successRate != null && (
            <span
              className={kpiClass.rate(totals.successRate)}
              title="Success rate πάνω στα scored tests"
            >
              {totals.successRate.toFixed(1)}%
            </span>
          )}
          {totals.dl != null && (
            <span className="text-muted-foreground" title="Μέσο DL όλων των ορατών sessions">
              DL {totals.dl.toFixed(1)}
            </span>
          )}
          {totals.rtt != null && (
            <span className="text-muted-foreground" title="Μέσο RTT όλων των ορατών sessions">
              RTT {totals.rtt.toFixed(0)}
            </span>
          )}
        </div>
      </div>

      {/* ── Header ── */}
      <div
        className={`${GRID} px-4 py-2 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold border-b border-border`}
      >
        <span />
        <span />
        <span>Session</span>
        <span>Start</span>
        <span title="Διάρκεια session / πλήθος tests">Διάρκεια</span>
        <span>Cycle</span>
        <span>Technology</span>
        <span className="text-right">DL Mbps</span>
        <span className="text-right">UL Mbps</span>
        <span className="text-right">RTT ms</span>
        <span className="text-right">YT MOS</span>
        <span>Pass / Fail</span>
        <span />
      </div>

      {/* ── Rows: ανά ASideLocation → ανά cycle ── */}
      <div className="max-h-[620px] overflow-y-auto">
        {visible.length === 0 ? (
          <p className="px-4 py-6 text-center text-xs text-muted-foreground">
            Κανένα session δεν ταιριάζει με την αναζήτηση / το φίλτρο.
          </p>
        ) : (
          locationGroups.map((group) => {
            const isCollapsed = collapsedLocations.has(group.location);

            return (
              <div key={group.location}>
                {/* Location header */}
                <div
                  onClick={() => toggleLocation(group.location)}
                  className="sticky top-0 z-10 flex items-center gap-2 px-4 py-1.5 bg-secondary/80 backdrop-blur border-y border-border cursor-pointer hover:bg-secondary"
                >
                  {isCollapsed ? (
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                  ) : (
                    <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                  )}
                  <MapPin className="h-3.5 w-3.5 text-primary" />
                  <span className="text-xs font-semibold text-foreground">{group.location}</span>
                  <span className="text-[11px] font-mono text-muted-foreground">
                    {group.views.length} sessions · {group.cycles.length} cycles · {group.tests} tests
                    {group.badSessions > 0 && (
                      <span className="text-orange-400"> · {group.badSessions} με πρόβλημα</span>
                    )}
                  </span>

                  {/* Tech mix όλου του location */}
                  <span className="flex items-center gap-1">
                    {group.techMix.slice(0, 3).map(({ tech, count }) => (
                      <span
                        key={tech}
                        className={`text-[10px] px-1 rounded border whitespace-nowrap ${techColor(tech)}`}
                        title={`${tech}: ${count} tests στο ${group.location}`}
                      >
                        {tech} {Math.round((count / Math.max(group.tests, 1)) * 100)}%
                      </span>
                    ))}
                  </span>

                  <span className="ml-auto flex items-center gap-3 text-[11px] font-mono">
                    {group.dl != null && (
                      <span className="text-muted-foreground">
                        DL <span className={kpiClass.dl(group.dl)}>{group.dl.toFixed(1)}</span>
                      </span>
                    )}
                    {group.ul != null && (
                      <span className="text-muted-foreground">
                        UL <span className={kpiClass.ul(group.ul)}>{group.ul.toFixed(1)}</span>
                      </span>
                    )}
                    {group.rtt != null && (
                      <span className="text-muted-foreground">
                        RTT <span className={kpiClass.rtt(group.rtt)}>{group.rtt.toFixed(0)}</span>
                      </span>
                    )}
                    <span>
                      <span className="text-green-400">{group.pass}</span>
                      <span className="text-muted-foreground">/</span>
                      <span className={group.fail > 0 ? "text-red-400" : "text-muted-foreground"}>{group.fail}</span>
                    </span>
                  </span>
                </div>

                {/* Με custom ταξινόμηση τα cycles χάνουν νόημα ως blocks: επίπεδη λίστα, με το cycle badge στη γραμμή. */}
                {!isCollapsed && !groupByCycle &&
                  group.views.map((v) => (
                    <SessionRow
                      key={v.item.sessionId}
                      view={v}
                      cycleSize={cycleSize}
                      isSelected={selectedSessionId === v.item.sessionId}
                      isOpen={expanded.has(v.item.sessionId)}
                      onToggle={() => toggleExpand(v.item.sessionId)}
                      onOpenDetail={() => onSelectSession(v.item.sessionId)}
                    />
                  ))}

                {!isCollapsed && groupByCycle &&
                  group.cycles.map((cycleGroup) => (
                    <div key={cycleGroup.cycle}>
                      {/* Cycle header */}
                      <div className="flex items-center gap-2 px-4 py-1 bg-muted/30 border-b border-border/40">
                        <RefreshCw className="h-3 w-3 text-muted-foreground ml-5" />
                        <span className="text-[11px] font-semibold text-foreground">Cycle {cycleGroup.cycle}</span>
                        <span className="text-[10px] font-mono text-muted-foreground">
                          {cycleGroup.views.length}/{cycleSize}
                          {!cycleGroup.complete && <span className="text-yellow-400"> μερικός</span>}
                        </span>
                        {cycleGroup.badSessions > 0 && (
                          <span
                            className="text-[10px] font-mono text-orange-400"
                            title="Sessions του cycle με αποτυχίες ή invalid"
                          >
                            {cycleGroup.badSessions} με πρόβλημα
                          </span>
                        )}
                        {cycleGroup.from && (
                          <span className="text-[10px] font-mono text-muted-foreground">
                            {formatClock(cycleGroup.from)} → {formatClock(cycleGroup.to)} · {formatDay(cycleGroup.from)}
                            {cycleGroup.spanSec != null && (
                              <span className="text-muted-foreground/60">
                                {" "}
                                ({formatDuration(cycleGroup.spanSec)})
                              </span>
                            )}
                          </span>
                        )}
                        <span className="ml-auto flex items-center gap-3 text-[10px] font-mono text-muted-foreground">
                          <span>{cycleGroup.tests} tests</span>
                          {cycleGroup.dl != null && (
                            <span>
                              DL <span className={kpiClass.dl(cycleGroup.dl)}>{cycleGroup.dl.toFixed(1)}</span> Mbps
                            </span>
                          )}
                          {cycleGroup.ul != null && (
                            <span>
                              UL <span className={kpiClass.ul(cycleGroup.ul)}>{cycleGroup.ul.toFixed(1)}</span> Mbps
                            </span>
                          )}
                          {cycleGroup.rtt != null && (
                            <span>
                              RTT <span className={kpiClass.rtt(cycleGroup.rtt)}>{cycleGroup.rtt.toFixed(0)}</span> ms
                            </span>
                          )}
                          {cycleGroup.mos != null && (
                            <span>
                              MOS <span className={kpiClass.mos(cycleGroup.mos)}>{cycleGroup.mos.toFixed(2)}</span>
                            </span>
                          )}
                          <span>
                            <span className="text-green-400">{cycleGroup.pass}</span>
                            <span>/</span>
                            <span className={cycleGroup.fail > 0 ? "text-red-400" : ""}>{cycleGroup.fail}</span>
                          </span>
                        </span>
                      </div>

                      {cycleGroup.views.map((v) => (
                        <SessionRow
                          key={v.item.sessionId}
                          view={v}
                          cycleSize={cycleSize}
                          isSelected={selectedSessionId === v.item.sessionId}
                          isOpen={expanded.has(v.item.sessionId)}
                          onToggle={() => toggleExpand(v.item.sessionId)}
                          onOpenDetail={() => onSelectSession(v.item.sessionId)}
                        />
                      ))}
                    </div>
                  ))}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

/* ── row ───────────────────────────────────────────────────────────────── */

interface SessionRowProps {
  view: SessionView;
  cycleSize: number;
  isSelected: boolean;
  isOpen: boolean;
  onToggle: () => void;
  onOpenDetail: () => void;
}

const SessionRow = ({ view: v, cycleSize, isSelected, isOpen, onToggle, onOpenDetail }: SessionRowProps) => {
  const { item } = v;
  const cfg = statusConfig[v.status];
  const StatusIcon = cfg.icon;
  const [showAllTests, setShowAllTests] = useState(false);

  const listedTests = showAllTests ? v.orderedTests : v.failedTests;

  return (
  <div className="border-b border-border/40 last:border-b-0">
    <div
      onClick={onToggle}
      className={`${GRID} px-4 py-2 cursor-pointer transition-colors group ${
        isSelected ? "bg-primary/10" : isOpen ? "bg-muted/30" : "hover:bg-muted/40"
      }`}
    >
      {/* Expand caret */}
      {isOpen ? (
        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
      ) : (
        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/60" />
      )}

      {/* Status */}
      <div className={`${cfg.bg} rounded-md p-1 flex items-center justify-center`} title={cfg.label}>
        <StatusIcon className={`h-3.5 w-3.5 ${cfg.color}`} />
      </div>

      {/* Session ID + collection */}
      <div className="min-w-0">
        <span className="block text-xs font-mono text-foreground truncate">{item.sessionId}</span>
        <span
          className="block text-[10px] text-muted-foreground truncate"
          title={[item.first?.CollectionName ?? "", v.fileName ?? ""].filter(Boolean).join(" · ")}
        >
          {item.first?.CollectionName ?? ""}
        </span>
      </div>

      {/* Start */}
      <div className="leading-tight">
        <span
          className="block text-xs font-mono text-foreground"
          title={`${formatClock(item.first?.callStartTimeStamp)} → ${formatClock(
            v.orderedTests[v.orderedTests.length - 1]?.callStartTimeStamp,
          )}`}
        >
          {formatClock(item.first?.callStartTimeStamp)}
        </span>
        <span className="block text-[10px] text-muted-foreground font-mono">
          {formatDay(item.first?.callStartTimeStamp)}
        </span>
      </div>

      {/* Διάρκεια + πλήθος tests */}
      <div className="leading-tight">
        <span className="block text-xs font-mono text-muted-foreground">
          {formatDuration(v.durationSec)}
        </span>
        <span className="block text-[10px] text-muted-foreground/70 font-mono">
          {item.tests.length} tests
          {v.otherCount > 0 && (
            <span className="text-muted-foreground/50" title="Tests χωρίς scoring status">
              {" "}
              ·{v.otherCount} n/s
            </span>
          )}
        </span>
      </div>

      {/* Cycle / θέση μέσα στο cycle */}
      <span
        className="text-[11px] font-mono text-muted-foreground whitespace-nowrap"
        title={`Cycle ${v.cycle}, session ${v.posInCycle} από ${cycleSize}`}
      >
        C{v.cycle}
        <span className="text-muted-foreground/60">
          ·{v.posInCycle}/{cycleSize}
        </span>
      </span>

      {/* Technology mix */}
      <div className="flex items-center gap-1 min-w-0">
        {v.techMix.length === 0 ? (
          <span className="text-[10px] text-muted-foreground">N/A</span>
        ) : (
          v.techMix.slice(0, 2).map(({ tech, count }) => (
            <span
              key={tech}
              className={`text-[10px] px-1 py-0.5 rounded border whitespace-nowrap ${techColor(tech)}`}
              title={`${tech}: ${count} tests`}
            >
              {tech}
              {v.techMix.length > 1 && (
                <span className="opacity-70"> {Math.round((count / item.tests.length) * 100)}%</span>
              )}
            </span>
          ))
        )}
        {v.techMix.length > 2 && (
          <span
            className="text-[10px] text-muted-foreground"
            title={v.techMix.map(({ tech, count }) => `${tech}: ${count}`).join("\n")}
          >
            +{v.techMix.length - 2}
          </span>
        )}
        {v.techPath.length > 1 && (
          <span
            className="shrink-0"
            title={`Αλλαγές τεχνολογίας: ${v.techPath.join(" → ")}`}
            aria-label="Αλλαγή τεχνολογίας"
          >
            <ArrowLeftRight className="h-3 w-3 text-yellow-400" />
          </span>
        )}
      </div>

      {/* KPIs — το title δείχνει και τη χειρότερη τιμή του session */}
      <span className="text-right" title={v.worstDl == null ? undefined : `Χειρότερο DL: ${v.worstDl.toFixed(2)} Mbps`}>
        <Kpi value={v.dl} format={(n) => n.toFixed(1)} tone={kpiClass.dl} />
      </span>
      <span className="text-right">
        <Kpi value={v.ul} format={(n) => n.toFixed(1)} tone={kpiClass.ul} />
      </span>
      <span className="text-right" title={v.worstRtt == null ? undefined : `Χειρότερο RTT: ${v.worstRtt.toFixed(1)} ms`}>
        <Kpi value={v.rtt} format={(n) => n.toFixed(0)} tone={kpiClass.rtt} />
      </span>
      <span
        className="text-right"
        title={v.interruptions == null ? undefined : `YouTube interruptions: ${v.interruptions}`}
      >
        <Kpi value={v.mos} format={(n) => n.toFixed(2)} tone={kpiClass.mos} />
        {v.interruptions != null && v.interruptions > 0 && (
          <span className="block text-[9px] font-mono text-yellow-400/80">{v.interruptions} int.</span>
        )}
      </span>

      {/* Pass / Fail */}
      <PassFailBar pass={item.passCount} fail={item.failCount} total={item.tests.length} />

      {/* Open detail */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onOpenDetail();
        }}
        title="Άνοιγμα λεπτομερειών session"
        className="flex items-center justify-center h-6 w-6 rounded-md text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-primary/15 hover:text-primary transition-all"
      >
        <ArrowUpRight className="h-3.5 w-3.5" />
      </button>
    </div>

    {/* ── Expanded: ανάλυση ανά τύπο test + αποτυχίες ── */}
    {isOpen && (
      <div className="bg-muted/20 border-t border-border/40 px-4 py-3 grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* ── 1. Ανά τύπο test ── */}
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">
            Ανά τύπο test
          </p>
          <table className="w-full text-xs">
            <tbody className="divide-y divide-border/40">
              {v.breakdown.map((b) => (
                <tr key={b.label}>
                  <td className="py-1 pr-2 align-top">
                    <span className="block text-foreground">{b.label}</span>
                    {b.hosts.length > 0 && (
                      <span
                        className="block text-[10px] font-mono text-muted-foreground/70 truncate max-w-[140px]"
                        title={b.hosts.join("\n")}
                      >
                        {b.hosts[0]}
                        {b.hosts.length > 1 && ` +${b.hosts.length - 1}`}
                      </span>
                    )}
                  </td>
                  <td className="py-1 pr-2 font-mono text-muted-foreground whitespace-nowrap align-top">
                    {b.total}×
                  </td>
                  <td className="py-1 pr-2 font-mono whitespace-nowrap align-top">
                    <span className="text-green-400">{b.ok}</span>
                    <span className="text-muted-foreground">/</span>
                    <span className={b.fail > 0 ? "text-red-400" : "text-muted-foreground"}>{b.fail}</span>
                    {b.other > 0 && (
                      <span className="text-muted-foreground/50" title="Χωρίς scoring status">
                        {" "}
                        +{b.other}
                      </span>
                    )}
                  </td>
                  <td className="py-1 font-mono text-right whitespace-nowrap align-top">
                    <span className="block text-foreground">{b.metric}</span>
                    {b.range && (
                      <span className="block text-[10px] text-muted-foreground/70" title="min … max">
                        {b.range}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* ── 2. Λίστα tests (αποτυχίες ή όλα) ── */}
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
              {showAllTests ? `Όλα τα tests (${v.orderedTests.length})` : `Αποτυχημένα tests (${v.failedTests.length})`}
            </p>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setShowAllTests((s) => !s);
              }}
              className="text-[10px] text-primary hover:underline"
            >
              {showAllTests ? "μόνο αποτυχίες" : "δείξε όλα"}
            </button>
          </div>

          {listedTests.length === 0 ? (
            <p className="text-xs text-green-400">Καμία αποτυχία σε αυτό το session.</p>
          ) : (
            <div className="max-h-48 overflow-y-auto">
              <table className="w-full text-xs">
                <tbody className="divide-y divide-border/40">
                  {listedTests.map((r, idx) => {
                    const outcome = classifyDataTest(r);
                    return (
                      <tr key={`${r.TestId ?? idx}-${idx}`}>
                        <td className="py-1 pr-2 font-mono text-muted-foreground whitespace-nowrap align-top">
                          {formatClock(r.callStartTimeStamp)}
                        </td>
                        <td className="py-1 pr-2 align-top">
                          <span className="block text-foreground whitespace-nowrap">{testLabel(r)}</span>
                          {testContext(r) && (
                            <span className="block text-[10px] font-mono text-muted-foreground/70 truncate max-w-[150px]">
                              {testContext(r)}
                            </span>
                          )}
                        </td>
                        <td
                          className={`py-1 pr-2 truncate max-w-[110px] align-top ${
                            outcome === "failed"
                              ? "text-red-400"
                              : outcome === "success"
                                ? "text-green-400"
                                : "text-muted-foreground"
                          }`}
                          title={[r.status, r.scoringStatus].filter(Boolean).join(" · ")}
                        >
                          {r.status ?? r.scoringStatus ?? "—"}
                        </td>
                        <td className="py-1 font-mono text-right text-muted-foreground whitespace-nowrap align-top">
                          {testMetric(r)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ── 3. Στοιχεία session ── */}
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">
            Στοιχεία session
          </p>
          <dl className="text-xs space-y-1">
            <Fact label="Location" value={v.location} />
            <Fact label="Collection" value={item.first?.CollectionName} />
            <Fact label="Αρχείο" value={v.fileName} mono />
            <Fact
              label="Χρόνος"
              value={`${formatClock(item.first?.callStartTimeStamp)} → ${formatClock(
                v.orderedTests[v.orderedTests.length - 1]?.callStartTimeStamp,
              )} (${formatDuration(v.durationSec)})`}
              mono
            />
            <Fact label="Cycle" value={`${v.cycle} · session ${v.posInCycle}/${cycleSize}`} mono />
            <Fact
              label="Tests"
              value={`${item.tests.length} — ${item.passCount} pass / ${item.failCount} fail${
                v.otherCount > 0 ? ` / ${v.otherCount} χωρίς scoring` : ""
              }`}
              mono
            />
            <Fact label="Technology" value={v.techPath.join(" → ") || null} />
            <Fact
              label="Hosts"
              value={v.hosts.length === 0 ? null : v.hosts.join(", ")}
              mono
            />
            {v.interruptions != null && (
              <Fact label="YT interruptions" value={String(v.interruptions)} mono />
            )}
            {v.coords && (
              <div className="flex gap-2">
                <dt className="text-muted-foreground w-[5.5rem] shrink-0">Θέση</dt>
                <dd className="font-mono text-foreground">
                  <a
                    href={`https://www.google.com/maps?q=${v.coords.lat},${v.coords.lon}`}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="text-primary hover:underline"
                  >
                    {v.coords.lat.toFixed(5)}, {v.coords.lon.toFixed(5)}
                  </a>
                </dd>
              </div>
            )}
            {item.first?.isValid === 0 && (
              <Fact label="Validity" value="Invalid session" />
            )}
            <Fact label="Comment" value={item.first?.comment} />
          </dl>

          <button
            type="button"
            onClick={onOpenDetail}
            className="mt-2 flex items-center gap-1 text-[11px] text-primary hover:underline"
          >
            Πλήρες detail session <ArrowUpRight className="h-3 w-3" />
          </button>
        </div>
      </div>
    )}
  </div>
  );
};

export default DataSessionsList;
