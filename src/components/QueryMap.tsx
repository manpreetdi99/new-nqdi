import { useState, useMemo, useEffect, useRef } from "react";
import { MapContainer, TileLayer, CircleMarker, Tooltip, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import {
  Play,
  MapPin,
  Settings2,
  ChevronDown,
  AlertCircle,
  X,
  Layers,
  ArrowRightLeft,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { runBenchmarkApi, fetchCollectionNames, fetchLocations } from "@/lib/api";
import type { CellValue } from "@/types/benchmark";

// ── Greek city coordinates (for bubble/aggregate mode) ────────────────────────
const CITY_COORDS: Record<string, [number, number]> = {
  Athens: [37.9838, 23.7275],
  Thessaloniki: [40.6401, 22.9444],
  Patras: [38.2466, 21.7346],
  Heraklion: [35.3387, 25.1442],
  Larissa: [39.639, 22.4191],
  Volos: [39.362, 22.9429],
  Ioannina: [39.6644, 20.8521],
  Kavala: [40.9396, 24.4069],
  Chania: [35.5138, 24.018],
  Rhodes: [36.4341, 28.2176],
  Alexandroupoli: [40.8459, 25.8753],
  Serres: [41.0854, 23.5479],
  Drama: [41.1502, 24.1477],
  Katerini: [40.2705, 22.5023],
  Trikala: [39.556, 21.7683],
  Lamia: [38.8986, 22.4349],
  Chalcis: [38.462, 23.595],
  Agrinio: [38.6213, 21.4077],
  Corinth: [37.9401, 22.9286],
  Tripoli: [37.5102, 22.3785],
  Sparta: [37.0736, 22.4294],
  Kalamata: [37.039, 22.1149],
  Mytilene: [39.1074, 26.5543],
  Chios: [38.3702, 26.1371],
  Samos: [37.75, 26.977],
  Kos: [36.8921, 27.2877],
  Corfu: [39.6243, 19.9217],
  Zakynthos: [37.7902, 20.8954],
};

// ── Color schemes (ported from Python panel_data.py / panel_free.py / panel_gsm.py) ─
type RangeBucket = { min: number; max: number; color: string; label: string };
type CategoryEntry = { value: string; color: string };

interface RangeScheme {
  type: "range";
  label: string;
  suggestCol: string;
  buckets: RangeBucket[];
}
interface CategoryScheme {
  type: "category";
  label: string;
  suggestCol: string;
  categories: CategoryEntry[];
  defaultColor: string;
}
type ColorScheme = RangeScheme | CategoryScheme;

const COLOR_SCHEMES: Record<string, ColorScheme> = {
  rsrp_data: {
    type: "range",
    label: "RSRP – DATA panel (dBm)",
    suggestCol: "rsrp",
    buckets: [
      { min: -50, max: -30, color: "#3E0480", label: "-50 to -30" },
      { min: -65, max: -50, color: "#7F00D3", label: "-65 to -50" },
      { min: -75, max: -65, color: "#7E3D3E", label: "-75 to -65" },
      { min: -85, max: -75, color: "#FE0707", label: "-85 to -75" },
      { min: -95, max: -85, color: "#0808FE", label: "-95 to -85" },
      { min: -105, max: -95, color: "#B1FEFC", label: "-105 to -95" },
      { min: -120, max: -105, color: "#14FE14", label: "-120 to -105" },
      { min: -160, max: -120, color: "#FEFE25", label: "-160 to -120" },
    ],
  },
  rsrp_free: {
    type: "range",
    label: "RSRP – FREE panel (dBm)",
    suggestCol: "rsrp",
    buckets: [
      { min: -50, max: -30, color: "#035E03", label: "-50 to -30" },
      { min: -65, max: -50, color: "#00ff00", label: "-65 to -50" },
      { min: -75, max: -65, color: "#99ff00", label: "-75 to -65" },
      { min: -85, max: -75, color: "#00ffff", label: "-85 to -75" },
      { min: -95, max: -85, color: "#ffff00", label: "-95 to -85" },
      { min: -105, max: -95, color: "#ff9900", label: "-105 to -95" },
      { min: -120, max: -105, color: "#ff0000", label: "-120 to -105" },
      { min: -150, max: -120, color: "#800000", label: "-150 to -120" },
    ],
  },
  dl_throughput: {
    type: "range",
    label: "DL Throughput (kbps)",
    suggestCol: "DLThrpt",
    buckets: [
      { min: 350000, max: 1000000, color: "#3F007D", label: "350.000–1.000.000" },
      { min: 100000, max: 350000,  color: "#7A0A00", label: "100.000–350.000" },
      { min: 50000,  max: 100000,  color: "#FF0000", label: "50.000–100.000" },
      { min: 20000,  max: 50000,   color: "#FF8A00", label: "20.000–50.000" },
      { min: 5000,   max: 20000,   color: "#0076FF", label: "5.000–20.000" },
      { min: 350,    max: 5000,    color: "#00EEFF", label: "350–5.000" },
      { min: 0,      max: 350,     color: "#00FF00", label: "0–350" },
    ],
  },
  ul_throughput: {
    type: "range",
    label: "UL Throughput (kbps)",
    suggestCol: "ULThrpt",
    buckets: [
      { min: 150000, max: 500000, color: "#3F007D", label: "150.000–500.000" },
      { min: 30000,  max: 150000, color: "#7A0A00", label: "30.000–150.000" },
      { min: 15000,  max: 30000,  color: "#FF0000", label: "15.000–30.000" },
      { min: 5000,   max: 15000,  color: "#FF8A00", label: "5.000–15.000" },
      { min: 350,    max: 5000,   color: "#0076FF", label: "350–5.000" },
      { min: 0,      max: 350,    color: "#00FF00", label: "0–350" },
    ],
  },
  rxlevsub_gsm: {
    type: "range",
    label: "RxLevSub – GSM (dBm)",
    suggestCol: "RxLevSub",
    buckets: [
      { min: -69,  max: 0,    color: "#5e0000", label: "-69 to 0" },
      { min: -72,  max: -69,  color: "#ff0000", label: "-72 to -69" },
      { min: -82,  max: -72,  color: "#ff8000", label: "-82 to -72" },
      { min: -90,  max: -82,  color: "#0000ff", label: "-90 to -82" },
      { min: -100, max: -90,  color: "#00ffff", label: "-100 to -90" },
      { min: -140, max: -100, color: "#00ff00", label: "-140 to -100" },
    ],
  },
  rxqualsub_gsm: {
    type: "range",
    label: "RxQualSub – GSM (0–7)",
    suggestCol: "RxQualSub",
    buckets: [
      { min: 0, max: 1, color: "#00ff00",  label: "0 (best)" },
      { min: 1, max: 2, color: "#80ff00",  label: "1" },
      { min: 2, max: 3, color: "#ffff00",  label: "2" },
      { min: 3, max: 4, color: "#ffcc00",  label: "3" },
      { min: 4, max: 5, color: "#ff8000",  label: "4" },
      { min: 5, max: 6, color: "#ff4000",  label: "5" },
      { min: 6, max: 7, color: "#ff0000",  label: "6" },
      { min: 7, max: 8, color: "#800000",  label: "7 (worst)" },
    ],
  },
  mos_lq: {
    type: "range",
    label: "MOS / LQ (1–5)",
    suggestCol: "LQ",
    buckets: [
      { min: 4.0, max: 5.1, color: "#00ff00",  label: "4.0 – 5.0 (Excellent)" },
      { min: 3.6, max: 4.0, color: "#80ff00",  label: "3.6 – 4.0 (Good)" },
      { min: 3.1, max: 3.6, color: "#ffff00",  label: "3.1 – 3.6 (Fair)" },
      { min: 2.6, max: 3.1, color: "#ff8000",  label: "2.6 – 3.1 (Poor)" },
      { min: 1.0, max: 2.6, color: "#ff0000",  label: "1.0 – 2.6 (Bad)" },
    ],
  },
  http_transfer: {
    type: "range",
    label: "HTTP Transfer / 10MB (kbps)",
    suggestCol: "throughput",
    buckets: [
      { min: 350000, max: 1000000, color: "#3F007D", label: "350.000–1.000.000" },
      { min: 100000, max: 350000,  color: "#6F0300", label: "100.000–350.000" },
      { min: 50000,  max: 100000,  color: "#FF0000", label: "50.000–100.000" },
      { min: 20000,  max: 50000,   color: "#FF7A00", label: "20.000–50.000" },
      { min: 5000,   max: 20000,   color: "#0072FF", label: "5.000–20.000" },
      { min: 350,    max: 5000,    color: "#00EDFF", label: "350–5.000" },
      { min: 0,      max: 350,     color: "#39FF00", label: "0–350" },
    ],
  },
  technology_free: {
    type: "category",
    label: "Technology – FREE / GSM",
    suggestCol: "technology",
    categories: [
      { value: "GSM 900",       color: "#00ffff" },
      { value: "GSM 1800",      color: "#0000ff" },
      { value: "LTE E-UTRA 1",  color: "#800000" },
      { value: "LTE E-UTRA 3",  color: "#008000" },
      { value: "LTE E-UTRA 20", color: "#ff9900" },
      { value: "LTE E-UTRA 28", color: "#800080" },
      { value: "LTE E-UTRA 7",  color: "#ff0000" },
      { value: "LTE E-UTRA 8",  color: "#A24FFF" },
    ],
    defaultColor: "#808080",
  },
  technology_data: {
    type: "category",
    label: "Technology – DATA (LTE/5G)",
    suggestCol: "technology_data",
    categories: [
      { value: "LTE-5G NR", color: "#800080" },
      { value: "LTE CA",    color: "#00FF00" },
      { value: "LTE",       color: "#FF0080" },
    ],
    defaultColor: "#808080",
  },
  ookla_dl: {
    type: "range",
    label: "OOKLA DL Throughput (Mbps)",
    suggestCol: "ookla_dl",
    buckets: [
      { min: 300, max: 10000, color: "#3F007D", label: "≥ 300 Mbps" },
      { min: 100, max: 300,   color: "#7A0A00", label: "100–300 Mbps" },
      { min: 50,  max: 100,   color: "#FF0000", label: "50–100 Mbps" },
      { min: 20,  max: 50,    color: "#FF8A00", label: "20–50 Mbps" },
      { min: 10,  max: 20,    color: "#0076FF", label: "10–20 Mbps" },
      { min: 1,   max: 10,    color: "#00EEFF", label: "1–10 Mbps" },
      { min: 0,   max: 1,     color: "#FEFE25", label: "0–1 Mbps" },
    ],
  },
  ookla_ul: {
    type: "range",
    label: "OOKLA UL Throughput (Mbps)",
    suggestCol: "ookla_ul",
    buckets: [
      { min: 50,  max: 10000, color: "#3F007D", label: "≥ 50 Mbps" },
      { min: 20,  max: 50,    color: "#7A0A00", label: "20–50 Mbps" },
      { min: 10,  max: 20,    color: "#FF0000", label: "10–20 Mbps" },
      { min: 5,   max: 10,    color: "#FF8A00", label: "5–10 Mbps" },
      { min: 1,   max: 5,     color: "#0076FF", label: "1–5 Mbps" },
      { min: 0,   max: 1,     color: "#00EEFF", label: "0–1 Mbps" },
    ],
  },
  ookla_latency: {
    type: "range",
    label: "OOKLA Latency (ms)",
    suggestCol: "ookla_latency",
    buckets: [
      { min: 0,   max: 20,   color: "#035E03", label: "0–20 ms (εξαιρετικό)" },
      { min: 20,  max: 50,   color: "#00FF00", label: "20–50 ms" },
      { min: 50,  max: 100,  color: "#FEFE25", label: "50–100 ms" },
      { min: 100, max: 200,  color: "#FF8A00", label: "100–200 ms" },
      { min: 200, max: 500,  color: "#FF0000", label: "200–500 ms" },
      { min: 500, max: 9999, color: "#7A0A00", label: "> 500 ms" },
    ],
  },
  nr5g_ssrsrp: {
    type: "range",
    label: "5G SS-RSRP (dBm)",
    suggestCol: "SS-RSRP",
    buckets: [
      { min: -44,  max: 0,    color: "#3E0480", label: "-44 to 0" },
      { min: -60,  max: -44,  color: "#035E03", label: "-60 to -44" },
      { min: -70,  max: -60,  color: "#00ff00", label: "-70 to -60" },
      { min: -80,  max: -70,  color: "#99ff00", label: "-80 to -70" },
      { min: -90,  max: -80,  color: "#00ffff", label: "-90 to -80" },
      { min: -100, max: -90,  color: "#ffff00", label: "-100 to -90" },
      { min: -110, max: -100, color: "#ff9900", label: "-110 to -100" },
      { min: -156, max: -110, color: "#ff0000", label: "-156 to -110" },
    ],
  },
  nr5g_sssinr: {
    type: "range",
    label: "5G SS-SINR (dB)",
    suggestCol: "SS-SINR",
    buckets: [
      { min: 20,  max: 50,  color: "#3E0480", label: "≥20 dB" },
      { min: 13,  max: 20,  color: "#035E03", label: "13–20 dB" },
      { min: 0,   max: 13,  color: "#00ff00", label: "0–13 dB" },
      { min: -3,  max: 0,   color: "#ffff00", label: "-3–0 dB" },
      { min: -10, max: -3,  color: "#ff9900", label: "-10–(-3) dB" },
      { min: -23, max: -10, color: "#ff0000", label: "-23–(-10) dB" },
    ],
  },
};

// ── Color lookup helpers ──────────────────────────────────────────────────────
function colorForValue(scheme: ColorScheme, val: CellValue): string {
  if (scheme.type === "range") {
    const n = Number(val);
    if (isNaN(n)) return "#808080";
    for (const b of scheme.buckets) {
      if (n >= b.min && n < b.max) return b.color;
    }
    return "#808080";
  }
  // category
  const str = String(val ?? "").trim();
  const entry = scheme.categories.find((c) => c.value === str);
  return entry ? entry.color : scheme.defaultColor;
}

// ── Aggregate-mode color (normalized rank 0–1) ────────────────────────────────
function bubbleColor(rank: number): { fill: string; stroke: string } {
  if (rank >= 0.8) return { fill: "#ef4444", stroke: "#dc2626" };
  if (rank >= 0.6) return { fill: "#f97316", stroke: "#ea580c" };
  if (rank >= 0.4) return { fill: "#eab308", stroke: "#ca8a04" };
  if (rank >= 0.2) return { fill: "#22c55e", stroke: "#16a34a" };
  return { fill: "#3b82f6", stroke: "#2563eb" };
}

// ── Resolve city-name → coords (used in bubble mode) ─────────────────────────
function resolveCity(name: string): { lat: number; lng: number } | null {
  if (CITY_COORDS[name]) return { lat: CITY_COORDS[name][0], lng: CITY_COORDS[name][1] };
  const matched = Object.keys(CITY_COORDS).find((c) =>
    name.toLowerCase().includes(c.toLowerCase()),
  );
  return matched ? { lat: CITY_COORDS[matched][0], lng: CITY_COORDS[matched][1] } : null;
}

// ── Auto-fit bounds ───────────────────────────────────────────────────────────
function MapBounds({ points }: { points: Array<{ lat: number; lng: number }> }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0) return;
    const lats = points.map((p) => p.lat);
    const lngs = points.map((p) => p.lng);
    const b: [[number, number], [number, number]] = [
      [Math.min(...lats), Math.min(...lngs)],
      [Math.max(...lats), Math.max(...lngs)],
    ];
    if (b[0][0] === b[1][0] && b[0][1] === b[1][1]) {
      map.setView([b[0][0], b[0][1]], 12);
    } else {
      map.fitBounds(b, { padding: [50, 50], maxZoom: 14 });
    }
  }, [points, map]);
  return null;
}

// ── 3-Operator Sync ───────────────────────────────────────────────────────────
// Token-based: split on _/-./ then match known abbreviations
const OPERATOR_GROUPS: Array<{ name: string; tokens: string[] }> = [
  { name: "Cosmote", tokens: ["cosmote", "cosm", "cos"] },
  { name: "Vodafone", tokens: ["vodafone", "voda", "vod"] },
  { name: "Nova",     tokens: ["nova", "wind", "nov"] },
];

function tokenize(s: string): string[] {
  return s.toLowerCase().replace(/[_\-\.\s]+/g, " ").split(" ").filter(Boolean);
}

function detectOperator(collection: string): string | null {
  const toks = tokenize(collection);
  for (const g of OPERATOR_GROUPS) {
    if (toks.some(t => g.tokens.includes(t))) return g.name;
  }
  return null;
}

function bestCollectionForOperator(
  ref: string,
  refOp: string,
  targetOp: string,
  candidates: string[],
): string | null {
  if (!candidates.length) return null;
  const refGroup   = OPERATOR_GROUPS.find(g => g.name === refOp);
  const targetGroup = OPERATOR_GROUPS.find(g => g.name === targetOp);
  const strip = (toks: string[], grp: typeof OPERATOR_GROUPS[0] | undefined) =>
    toks.filter(t => !grp?.tokens.includes(t));
  const refSet = new Set(strip(tokenize(ref), refGroup));
  let best = candidates[0], bestScore = -1;
  for (const c of candidates) {
    const score = strip(tokenize(c), targetGroup).filter(t => refSet.has(t)).length;
    if (score > bestScore) { bestScore = score; best = c; }
  }
  return best;
}

// ── Template definitions ──────────────────────────────────────────────────────
type MapMode = "bubble" | "points";

interface SyncPayload {
  db: string;
  tmplIdx: number;
  sql: string;
  mode: MapMode;
  valueCol: string;
  colorSchemeKey: string;
  labelCol: string;
  quantityCol: string;
  location: string;
  collection: string;
}

interface QueryTemplate {
  label: string;
  category: string;
  mode: MapMode;
  quantityCol?: string;
  valueCol?: string;
  colorScheme?: string;
  labelCol: string;
  sql: string;
  requiresFilters?: boolean;
  nrarfcnCol?: string;
}

const TEMPLATES: QueryTemplate[] = [
  // ── Individual GPS Points ───────────────────────────────────────────────
  {
    label: "RSRP σημεία μέτρησης (DATA panel)",
    category: "RSRP",
    mode: "points",
    valueCol: "rsrp",
    colorScheme: "rsrp_data",
    labelCol: "Location",
    sql: `SELECT
  CAST(DP.Latitude  AS FLOAT) AS latitude,
  CAST(DP.Longitude AS FLOAT) AS longitude,
  flr.rsrp,
  DF.ASideLocation AS Location,
  DF.CollectionName
FROM LTEMeasurementReport AS flr
LEFT JOIN Sessions  AS fs ON flr.SessionId = fs.SessionId
LEFT JOIN FileList  AS DF ON fs.FileId     = DF.FileId
LEFT JOIN Position  AS DP ON flr.PosId     = DP.PosId
WHERE DP.Latitude  IS NOT NULL
  AND DP.Longitude IS NOT NULL
  AND flr.rsrp     IS NOT NULL
  AND DF.CollectionName = '{collection}'
  AND DF.ASideLocation  = '{location}'
ORDER BY flr.MsgTime`,
  },
  {
    label: "RSRP σημεία μέτρησης (FREE panel)",
    category: "RSRP",
    mode: "points",
    valueCol: "rsrp",
    colorScheme: "rsrp_free",
    labelCol: "Location",
    sql: `SELECT
  CAST(DP.Latitude  AS FLOAT) AS latitude,
  CAST(DP.Longitude AS FLOAT) AS longitude,
  flr.rsrp,
  DF.ASideLocation AS Location,
  DF.CollectionName
FROM LTEMeasurementReport AS flr
LEFT JOIN Sessions  AS fs ON flr.SessionId = fs.SessionId
LEFT JOIN FileList  AS DF ON fs.FileId     = DF.FileId
LEFT JOIN Position  AS DP ON flr.PosId     = DP.PosId
WHERE DP.Latitude  IS NOT NULL
  AND DP.Longitude IS NOT NULL
  AND flr.rsrp     IS NOT NULL
  AND DF.CollectionName = '{collection}'
  AND DF.ASideLocation  = '{location}'
ORDER BY flr.MsgTime`,
  },
  {
    label: "DL Throughput σημεία (kbps)",
    category: "Throughput",
    mode: "points",
    valueCol: "DLThrpt",
    colorScheme: "dl_throughput",
    labelCol: "Location",
    sql: `SELECT
  Position.latitude  AS latitude,
  Position.longitude AS longitude,
  ROUND(CONVERT(float, ResultsCapacityTest.ThroughputGet) * 0.008, 1) AS DLThrpt,
  FileList.ASideLocation AS Location,
  FileList.CollectionName
FROM Sessions
JOIN FileList ON Sessions.FileId = FileList.FileId
JOIN ResultsCapacityTest ON Sessions.sessionId = ResultsCapacityTest.sessionId
JOIN Position ON ResultsCapacityTest.PosId = Position.PosId
JOIN ResultsCapacityTestParameters ON ResultsCapacityTest.TestId = ResultsCapacityTestParameters.TestId
WHERE Sessions.Valid = 1
  AND ResultsCapacityTest.lastBlock = 1
  AND ResultsCapacityTestParameters.Direction LIKE 'get%'
  AND FileList.CollectionName = '{collection}'
  AND FileList.ASideLocation  = '{location}'
ORDER BY ResultsCapacityTest.MsgTime`,
  },
  {
    label: "UL Throughput σημεία (kbps)",
    category: "Throughput",
    mode: "points",
    valueCol: "ULThrpt",
    colorScheme: "ul_throughput",
    labelCol: "Location",
    sql: `SELECT
  Position.latitude  AS latitude,
  Position.longitude AS longitude,
  ROUND(CONVERT(float, ResultsCapacityTest.ThroughputPut) * 0.008, 1) AS ULThrpt,
  FileList.ASideLocation AS Location,
  FileList.CollectionName
FROM Sessions
JOIN FileList ON Sessions.FileId = FileList.FileId
JOIN ResultsCapacityTest ON Sessions.sessionId = ResultsCapacityTest.sessionId
JOIN Position ON ResultsCapacityTest.PosId = Position.PosId
JOIN ResultsCapacityTestParameters ON ResultsCapacityTest.TestId = ResultsCapacityTestParameters.TestId
WHERE Sessions.Valid = 1
  AND ResultsCapacityTest.lastBlock = 1
  AND ResultsCapacityTestParameters.Direction LIKE 'put%'
  AND FileList.CollectionName = '{collection}'
  AND FileList.ASideLocation  = '{location}'
ORDER BY ResultsCapacityTest.MsgTime`,
  },
  {
    label: "HTTP Transfer 10MB σημεία (kbps)",
    category: "Throughput",
    mode: "points",
    valueCol: "throughput",
    colorScheme: "http_transfer",
    labelCol: "Location",
    sql: `SELECT
  Position.latitude  AS latitude,
  Position.longitude AS longitude,
  CONVERT(float, ResultsHttpTransfertest.throughput) * 0.008 AS throughput,
  FileList.ASideLocation AS Location
FROM Sessions
JOIN ResultsHttpTransfertest ON Sessions.sessionId = ResultsHttpTransfertest.sessionId
JOIN ResultsHTTPTransferParameters ON ResultsHttpTransfertest.TestId = ResultsHTTPTransferParameters.TestId
JOIN Position ON ResultsHttpTransfertest.PosId = Position.PosId
JOIN FileList ON Sessions.FileId = FileList.FileId
WHERE Sessions.Valid = 1
  AND ResultsHttpTransfertest.throughput > 0
  AND ResultsHTTPTransferParameters.RemoteFilename = '10M'
  AND FileList.CollectionName = '{collection}'
  AND FileList.ASideLocation  = '{location}'`,
  },
  {
    label: "RxLevSub σημεία (GSM)",
    category: "GSM",
    mode: "points",
    valueCol: "RxLevSub",
    colorScheme: "rxlevsub_gsm",
    labelCol: "Location",
    sql: `SELECT
  COALESCE(l1.RxLevSub, -200) AS RxLevSub,
  p.Latitude  AS latitude,
  p.Longitude AS longitude,
  f.ASideLocation AS Location
FROM msgGSMLayer1 AS l1
JOIN Sessions  AS s ON s.SessionId = l1.SessionId AND s.Valid = 1
JOIN FileList  AS f ON f.FileId    = s.FileId
JOIN Position  AS p ON p.PosId     = l1.PosId
WHERE l1.formatid <> 'IDLE'
  AND f.CollectionName = '{collection}'
  AND f.ASideLocation  = '{location}'
ORDER BY l1.msgTime`,
  },
  {
    label: "RxQualSub σημεία (GSM)",
    category: "GSM",
    mode: "points",
    valueCol: "RxQualSub",
    colorScheme: "rxqualsub_gsm",
    labelCol: "Location",
    requiresFilters: true,
    sql: `SELECT
  COALESCE(l1.RxQualSub, -1) AS RxQualSub,
  p.Latitude  AS latitude,
  p.Longitude AS longitude,
  f.ASideLocation AS Location
FROM msgGSMLayer1 AS l1
JOIN Sessions  AS s ON s.SessionId = l1.SessionId AND s.Valid = 1
JOIN FileList  AS f ON f.FileId    = s.FileId
JOIN Position  AS p ON p.PosId     = l1.PosId
WHERE l1.formatid <> 'IDLE'
  AND l1.RxQualSub IS NOT NULL
  AND f.CollectionName = '{collection}'
  AND f.ASideLocation  = '{location}'
ORDER BY l1.msgTime`,
  },
  {
    label: "MOS FREE/GSM",
    category: "MOS",
    mode: "points",
    valueCol: "LQ",
    colorScheme: "mos_lq",
    labelCol: "Location",
    requiresFilters: true,
    sql: `SELECT
  fs.LQ                          AS LQ,
  fl.ASideLocation               AS Location,
  fl.CollectionName,
  CAST(dp.Latitude  AS FLOAT)    AS latitude,
  CAST(dp.Longitude AS FLOAT)    AS longitude,
  fs.TestId,
  fs.SessionId
FROM dbo.FactSpeech fs
LEFT JOIN FileList fl ON fl.FileId  = fs.FileId
LEFT JOIN TestInfo TI ON TI.TestId  = fs.TestId
LEFT JOIN Position dp ON dp.PosId   = TI.PosId
WHERE fl.CollectionName  = '{collection}'
  AND fl.ASideLocation   = '{location}'
  AND fs.LQ IS NOT NULL
  AND dp.Latitude  IS NOT NULL
  AND dp.Longitude IS NOT NULL
ORDER BY fs.TestId`,
  },
  {
    label: "Technology σημεία (FREE/GSM)",
    category: "Technology",
    mode: "points",
    valueCol: "technology",
    colorScheme: "technology_free",
    labelCol: "Location",
    sql: `SELECT
  p.Latitude  AS latitude,
  p.Longitude AS longitude,
  ni.technology,
  f.ASideLocation AS Location,
  f.CollectionName
FROM Sessions AS s
JOIN Position  AS p  ON s.SessionId = p.SessionId
OUTER APPLY (
  SELECT TOP (1) n.*
  FROM NetworkInfo AS n
  WHERE n.FileId = p.FileId
    AND n.MsgTime < p.msgTime
  ORDER BY n.MsgTime DESC
) AS ni
LEFT JOIN dbo.Filelist AS f ON s.FileId = f.FileId
WHERE s.Valid = 1
  AND ni.technology IS NOT NULL
  AND ni.technology <> 'Unknown'
  AND f.CollectionName = '{collection}'
  AND f.ASideLocation  = '{location}'
ORDER BY ni.MsgTime`,
  },
  {
    label: "Technology σημεία (DATA/LTE/5G)",
    category: "Technology",
    mode: "points",
    valueCol: "technology_data",
    colorScheme: "technology_data",
    labelCol: "Location",
    sql: `SELECT
  P.latitude  AS latitude,
  P.longitude AS longitude,
  t.CurrTechnology AS technology_data,
  fl.ASideLocation AS Location
FROM Sessions AS s
JOIN FileList AS fl ON fl.FileId = s.FileId
JOIN TestInfo AS ti ON ti.SessionId = s.SessionId
JOIN Position AS p  ON p.TestId = ti.TestId
JOIN Technology AS t ON t.TestId = p.TestId
  AND t.MsgTime = (
    SELECT MAX(t2.MsgTime)
    FROM Technology AS t2
    WHERE t2.TestId = p.TestId
      AND t2.MsgTime < p.MsgTime
      AND t2.CurrTechnology IS NOT NULL
  )
WHERE s.Valid = 1 AND ti.Valid = 1
  AND fl.CollectionName = '{collection}'
  AND fl.ASideLocation  = '{location}'
ORDER BY p.MsgTime`,
  },
  {
    label: "RSRP σημεία – FREE LTE",
    category: "RSRP",
    mode: "points",
    valueCol: "rsrp",
    colorScheme: "rsrp_data",
    labelCol: "ASideLocation",
    requiresFilters: true,
    sql: `SELECT
    DF.CollectionName,
    DF.ASideLocation,
    CAST(DP.Latitude  AS FLOAT) AS latitude,
    CAST(DP.Longitude AS FLOAT) AS longitude,
    flr.MsgTime,
    flr.rsrp
FROM LTEMeasurementReport AS flr
LEFT JOIN Sessions  AS fs ON flr.SessionId = fs.SessionId
LEFT JOIN FileList  AS DF ON fs.FileId     = DF.FileId
LEFT JOIN Position  AS DP ON flr.PosId     = DP.PosId
WHERE DF.CollectionName = '{collection}'
  AND DF.ASideLocation  = '{location}'
  AND DP.Latitude  IS NOT NULL
  AND DP.Longitude IS NOT NULL
  AND flr.rsrp     IS NOT NULL
ORDER BY flr.MsgTime`,
  },
  {
    label: "OOKLA DL Throughput (Mbps)",
    category: "OOKLA",
    mode: "points",
    valueCol: "ookla_dl",
    colorScheme: "ookla_dl",
    labelCol: "Location",
    sql: `WITH SessionsCTE AS (
  SELECT SessionId, FileId, info FROM Sessions WHERE valid = 1
  GROUP BY SessionId, FileId, info
)
SELECT
  CAST(pos.Latitude  AS FLOAT) AS latitude,
  CAST(pos.Longitude AS FLOAT) AS longitude,
  CASE aaf.thp WHEN 0 THEN NULL ELSE aaf.thp END AS ookla_dl,
  fl.ASideLocation                                AS Location,
  fl.CollectionName,
  ni.Technology,
  t.PrevTechnology                                AS Data_Technology,
  atp.ServiceProvider                             AS App,
  aaf.Latency                                     AS Latency_ms,
  aaf.PacketLossPercent                           AS PacketLoss_pct,
  CASE COALESCE(aa.ErrorCode, aaf.ErrorCode)
    WHEN 0 THEN 'Success' ELSE 'Failed'
  END                                             AS ActionStatus
FROM SessionsCTE s
INNER JOIN FileList                 fl  ON fl.FileId   = s.FileId
INNER JOIN TestInfo                 ti  ON s.SessionId = ti.SessionId AND ti.Valid = 1
INNER JOIN ResultsAppTestParameters atp ON ti.TestId   = atp.TestId
LEFT  JOIN ResultsAppAction         aa  ON ti.TestId   = aa.TestId   AND aa.LastBlock = 1
LEFT  JOIN (
    SELECT raap.TestId, raap.ActionId, raap.MsgTime, raap.ErrorCode, raap.NetworkId,
           CAST(raap.DLThroughput AS FLOAT) * 8.0 / 1000000.0               AS thp,
           ISNULL(raap.Ping, raap.Latency)                                   AS Latency,
           raap.PacketLossPercent
    FROM ResultsAppActionPerformance raap
) aaf ON ti.TestId = aaf.TestId
INNER JOIN NetworkInfo ni ON ni.NetworkId = ISNULL(ISNULL(aa.NetworkId, aaf.NetworkId), ti.NetworkId)
LEFT  JOIN Technology  t  ON t.PrevTechnology IS NOT NULL AND (
    (t.TestId = aaf.TestId AND aaf.MsgTime BETWEEN DATEADD(ms,-1*t.Duration,t.MsgTime) AND t.MsgTime) OR
    (t.TestId = aa.TestId  AND aa.MsgTime  BETWEEN DATEADD(ms,-1*t.Duration,t.MsgTime) AND t.MsgTime))
OUTER APPLY (
    SELECT TOP (1) p.Latitude, p.Longitude
    FROM Position p
    WHERE p.TestId  = ti.TestId
      AND p.MsgTime <= COALESCE(aa.MsgTime, aaf.MsgTime)
    ORDER BY p.MsgTime DESC
) pos
WHERE pos.Latitude    IS NOT NULL
  AND pos.Longitude   IS NOT NULL
  AND s.SessionId     IS NOT NULL
  AND aaf.thp         IS NOT NULL
  AND fl.CollectionName = '{collection}'
  AND fl.ASideLocation  = '{location}'
ORDER BY ti.TestId, aaf.ActionId`,
  },
  {
    label: "OOKLA UL Throughput (Mbps)",
    category: "OOKLA",
    mode: "points",
    valueCol: "ookla_ul",
    colorScheme: "ookla_ul",
    labelCol: "Location",
    sql: `WITH SessionsCTE AS (
  SELECT SessionId, FileId, info FROM Sessions WHERE valid = 1
  GROUP BY SessionId, FileId, info
)
SELECT
  CAST(pos.Latitude  AS FLOAT) AS latitude,
  CAST(pos.Longitude AS FLOAT) AS longitude,
  CASE aaf.thp WHEN 0 THEN NULL ELSE aaf.thp END AS ookla_ul,
  fl.ASideLocation                                AS Location,
  fl.CollectionName,
  ni.Technology,
  t.PrevTechnology                                AS Data_Technology,
  atp.ServiceProvider                             AS App,
  aaf.Latency                                     AS Latency_ms,
  aaf.PacketLossPercent                           AS PacketLoss_pct,
  CASE COALESCE(aa.ErrorCode, aaf.ErrorCode)
    WHEN 0 THEN 'Success' ELSE 'Failed'
  END                                             AS ActionStatus
FROM SessionsCTE s
INNER JOIN FileList                 fl  ON fl.FileId   = s.FileId
INNER JOIN TestInfo                 ti  ON s.SessionId = ti.SessionId AND ti.Valid = 1
INNER JOIN ResultsAppTestParameters atp ON ti.TestId   = atp.TestId
LEFT  JOIN ResultsAppAction         aa  ON ti.TestId   = aa.TestId   AND aa.LastBlock = 1
LEFT  JOIN (
    SELECT raap.TestId, raap.ActionId, raap.MsgTime, raap.ErrorCode, raap.NetworkId,
           CAST(raap.ULThroughput AS FLOAT) * 8.0 / 1000000.0               AS thp,
           ISNULL(raap.Ping, raap.Latency)                                   AS Latency,
           raap.PacketLossPercent
    FROM ResultsAppActionPerformance raap
) aaf ON ti.TestId = aaf.TestId
INNER JOIN NetworkInfo ni ON ni.NetworkId = ISNULL(ISNULL(aa.NetworkId, aaf.NetworkId), ti.NetworkId)
LEFT  JOIN Technology  t  ON t.PrevTechnology IS NOT NULL AND (
    (t.TestId = aaf.TestId AND aaf.MsgTime BETWEEN DATEADD(ms,-1*t.Duration,t.MsgTime) AND t.MsgTime) OR
    (t.TestId = aa.TestId  AND aa.MsgTime  BETWEEN DATEADD(ms,-1*t.Duration,t.MsgTime) AND t.MsgTime))
OUTER APPLY (
    SELECT TOP (1) p.Latitude, p.Longitude
    FROM Position p
    WHERE p.TestId  = ti.TestId
      AND p.MsgTime <= COALESCE(aa.MsgTime, aaf.MsgTime)
    ORDER BY p.MsgTime DESC
) pos
WHERE pos.Latitude    IS NOT NULL
  AND pos.Longitude   IS NOT NULL
  AND s.SessionId     IS NOT NULL
  AND aaf.thp         IS NOT NULL
  AND fl.CollectionName = '{collection}'
  AND fl.ASideLocation  = '{location}'
ORDER BY ti.TestId, aaf.ActionId`,
  },
  {
    label: "OOKLA Latency (ms)",
    category: "OOKLA",
    mode: "points",
    valueCol: "ookla_latency",
    colorScheme: "ookla_latency",
    labelCol: "Location",
    sql: `WITH SessionsCTE AS (
  SELECT SessionId, FileId, info FROM Sessions WHERE valid = 1
  GROUP BY SessionId, FileId, info
)
SELECT
  CAST(pos.Latitude  AS FLOAT) AS latitude,
  CAST(pos.Longitude AS FLOAT) AS longitude,
  ISNULL(raap.Ping, raap.Latency)                AS ookla_latency,
  fl.ASideLocation                               AS Location,
  fl.CollectionName,
  ni.Technology,
  t.PrevTechnology                               AS Data_Technology,
  atp.ServiceProvider                            AS App,
  raap.PacketLossPercent                         AS PacketLoss_pct
FROM SessionsCTE s
INNER JOIN FileList                 fl  ON fl.FileId   = s.FileId
INNER JOIN TestInfo                 ti  ON s.SessionId = ti.SessionId AND ti.Valid = 1
INNER JOIN ResultsAppTestParameters atp ON ti.TestId   = atp.TestId
INNER JOIN ResultsAppActionPerformance raap ON ti.TestId = raap.TestId
INNER JOIN NetworkInfo ni ON ni.NetworkId = raap.NetworkId
LEFT  JOIN Technology  t  ON t.PrevTechnology IS NOT NULL AND
    t.TestId = raap.TestId AND
    raap.MsgTime BETWEEN DATEADD(ms,-1*t.Duration,t.MsgTime) AND t.MsgTime
OUTER APPLY (
    SELECT TOP (1) p.Latitude, p.Longitude
    FROM Position p
    WHERE p.TestId  = ti.TestId
      AND p.MsgTime <= raap.MsgTime
    ORDER BY p.MsgTime DESC
) pos
WHERE pos.Latitude  IS NOT NULL
  AND pos.Longitude IS NOT NULL
  AND ISNULL(raap.Ping, raap.Latency) IS NOT NULL
  AND fl.CollectionName = '{collection}'
  AND fl.ASideLocation  = '{location}'
ORDER BY ti.TestId, raap.ActionId`,
  },
  {
    label: "5G Phone – SS-RSRP",
    category: "5G",
    mode: "points",
    valueCol: "SS-RSRP",
    colorScheme: "nr5g_ssrsrp",
    labelCol: "Location",
    requiresFilters: true,
    nrarfcnCol: "NRARFCN",
    sql: `SELECT
  nr.PosId,
  nr.NRARFCN,
  AVG(nr.RSRP)  AS [SS-RSRP],
  AVG(nr.RSRQ)  AS [SS-RSRQ],
  AVG(nr.SINR)  AS [SS-SINR],
  CAST(pos.latitude  AS FLOAT) AS latitude,
  CAST(pos.longitude AS FLOAT) AS longitude,
  fl.CollectionName,
  fl.ASideLocation              AS Location,
  NRcarrier.CarrierIndexName
FROM [dbo].[FactNR5GRadio] nr
LEFT JOIN Position           pos       ON pos.PosId   = nr.PosId
LEFT JOIN FileList           fl        ON fl.FileId   = nr.FileId
LEFT JOIN DmnNR5GCarrierInfo NRcarrier ON NRcarrier.DmnId = nr.DmnIdNR5GCarrierInfo
WHERE fl.Valid = 1
  AND fl.CollectionName = '{collection}'
  AND fl.ASideLocation  = '{location}'
GROUP BY nr.SessionId, nr.PosId, nr.NRARFCN,
         pos.latitude, pos.longitude,
         fl.CollectionName, fl.ASideLocation, NRcarrier.CarrierIndexName
ORDER BY nr.PosId`,
  },
  {
    label: "5G Phone – SS-SINR",
    category: "5G",
    mode: "points",
    valueCol: "SS-SINR",
    colorScheme: "nr5g_sssinr",
    labelCol: "Location",
    requiresFilters: true,
    nrarfcnCol: "NRARFCN",
    sql: `SELECT
  nr.PosId,
  nr.NRARFCN,
  AVG(nr.RSRP)  AS [SS-RSRP],
  AVG(nr.RSRQ)  AS [SS-RSRQ],
  AVG(nr.SINR)  AS [SS-SINR],
  CAST(pos.latitude  AS FLOAT) AS latitude,
  CAST(pos.longitude AS FLOAT) AS longitude,
  fl.CollectionName,
  fl.ASideLocation              AS Location,
  NRcarrier.CarrierIndexName
FROM [dbo].[FactNR5GRadio] nr
LEFT JOIN Position           pos       ON pos.PosId   = nr.PosId
LEFT JOIN FileList           fl        ON fl.FileId   = nr.FileId
LEFT JOIN DmnNR5GCarrierInfo NRcarrier ON NRcarrier.DmnId = nr.DmnIdNR5GCarrierInfo
WHERE fl.Valid = 1
  AND fl.CollectionName = '{collection}'
  AND fl.ASideLocation  = '{location}'
GROUP BY nr.SessionId, nr.PosId, nr.NRARFCN,
         pos.latitude, pos.longitude,
         fl.CollectionName, fl.ASideLocation, NRcarrier.CarrierIndexName
ORDER BY nr.PosId`,
  },
  {
    label: "5G Scanner – SS-RSRP",
    category: "5G",
    mode: "points",
    valueCol: "SS-RSRP",
    colorScheme: "nr5g_ssrsrp",
    labelCol: "Location",
    requiresFilters: true,
    nrarfcnCol: "NRARFCN",
    sql: `SELECT
  nr.PCI,
  nr.AbsFreqSSB       AS NRARFCN,
  nr.SS_RSRP          AS [SS-RSRP],
  nr.SS_SINR          AS [SS-SINR],
  fl.CollectionName,
  fl.ASideLocation    AS Location,
  CAST(pos.Latitude  AS FLOAT) AS latitude,
  CAST(pos.Longitude AS FLOAT) AS longitude
FROM [dbo].[FactNR5GScannerBeam] nr
LEFT JOIN [dbo].[FileList] fl  ON fl.[FileId]  = nr.[FileId]
LEFT JOIN [dbo].[Position] pos ON pos.[PosId]  = nr.[PosId]
WHERE nr.[DmnIdTopN_SS_RSRP] = 1
  AND fl.CollectionName = '{collection}'
  AND fl.ASideLocation  = '{location}'
ORDER BY latitude, longitude`,
  },
  {
    label: "5G Scanner – SS-SINR",
    category: "5G",
    mode: "points",
    valueCol: "SS-SINR",
    colorScheme: "nr5g_sssinr",
    labelCol: "Location",
    requiresFilters: true,
    nrarfcnCol: "NRARFCN",
    sql: `SELECT
  nr.PCI,
  nr.AbsFreqSSB       AS NRARFCN,
  nr.SS_RSRP          AS [SS-RSRP],
  nr.SS_SINR          AS [SS-SINR],
  fl.CollectionName,
  fl.ASideLocation    AS Location,
  CAST(pos.Latitude  AS FLOAT) AS latitude,
  CAST(pos.Longitude AS FLOAT) AS longitude
FROM [dbo].[FactNR5GScannerBeam] nr
LEFT JOIN [dbo].[FileList] fl  ON fl.[FileId]  = nr.[FileId]
LEFT JOIN [dbo].[Position] pos ON pos.[PosId]  = nr.[PosId]
WHERE nr.[DmnIdTopN_SS_RSRP] = 1
  AND fl.CollectionName = '{collection}'
  AND fl.ASideLocation  = '{location}'
ORDER BY latitude, longitude`,
  },
  {
    label: "— Custom SQL —",
    category: "Custom",
    mode: "points",
    valueCol: "",
    colorScheme: "rsrp_data",
    labelCol: "Location",
    sql: `-- Custom query για σημεία GPS.
-- Χρειάζονται στήλες: latitude, longitude, και η τιμή σας.
-- Παράδειγμα:
SELECT TOP 2000
  CAST(DP.Latitude  AS FLOAT) AS latitude,
  CAST(DP.Longitude AS FLOAT) AS longitude,
  flr.rsrp,
  DF.ASideLocation AS Location
FROM LTEMeasurementReport AS flr
LEFT JOIN Sessions AS fs ON flr.SessionId = fs.SessionId
LEFT JOIN FileList AS DF ON fs.FileId     = DF.FileId
LEFT JOIN Position AS DP ON flr.PosId     = DP.PosId
WHERE DP.Latitude IS NOT NULL AND flr.rsrp IS NOT NULL
ORDER BY flr.MsgTime`,
  },
];

// ── Compute bucket counters for legend ───────────────────────────────────────
function computeBucketCounters(
  rows: Record<string, CellValue>[],
  valueCol: string,
  scheme: ColorScheme,
): Map<string, number> {
  const counters = new Map<string, number>();
  if (scheme.type === "range") {
    for (const b of scheme.buckets) counters.set(b.label, 0);
    for (const row of rows) {
      const n = Number(row[valueCol]);
      if (isNaN(n)) continue;
      const bucket = scheme.buckets.find((b) => n >= b.min && n < b.max);
      if (bucket) counters.set(bucket.label, (counters.get(bucket.label) ?? 0) + 1);
    }
  } else {
    for (const c of scheme.categories) counters.set(c.value, 0);
    for (const row of rows) {
      const str = String(row[valueCol] ?? "").trim();
      counters.set(str, (counters.get(str) ?? 0) + 1);
    }
  }
  return counters;
}

// ── Spatial decimation: keep at most maxPoints, one per adaptive grid cell ────
const MAX_RENDER_POINTS = 4000;

function decimatePoints<T extends { lat: number; lng: number }>(pts: T[], max = MAX_RENDER_POINTS): T[] {
  if (pts.length <= max) return pts;
  const lats = pts.map((p) => p.lat);
  const lngs = pts.map((p) => p.lng);
  const latRange = Math.max(...lats) - Math.min(...lats) || 0.1;
  const lngRange = Math.max(...lngs) - Math.min(...lngs) || 0.1;
  const cellSize = Math.sqrt((latRange * lngRange) / max);
  const seen = new Set<string>();
  return pts.filter((p) => {
    const key = `${Math.floor(p.lat / cellSize)},${Math.floor(p.lng / cellSize)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const lc = (s: string) => s.toLowerCase();

// ── Single self-contained map panel ──────────────────────────────────────────
interface SingleMapPanelProps {
  databases: string[];
  defaultDatabase?: string;
  panelIndex?: number;
  syncTarget?: SyncPayload | null;
  onSyncRequest?: (payload: SyncPayload, collections: string[], locations: string[]) => void;
  runTrigger?: number;
}

const SingleMapPanel = ({ databases, defaultDatabase = "", panelIndex = 0, syncTarget, onSyncRequest, runTrigger }: SingleMapPanelProps) => {
  // ── Local database + collections ──────────────────────────────────────────
  const [localDb, setLocalDb]               = useState(defaultDatabase);
  const [localCollections, setLocalCollections] = useState<string[]>([]);
  const [collectionsLoading, setCollectionsLoading] = useState(false);
  const [localLocations, setLocalLocations] = useState<string[]>([]);

  useEffect(() => {
    if (!localDb) { setLocalCollections([]); setLocalLocations([]); return; }
    setCollectionsLoading(true);
    fetchCollectionNames(localDb)
      .then(setLocalCollections)
      .catch(() => setLocalCollections([]))
      .finally(() => setCollectionsLoading(false));
  }, [localDb]);

  const [tmplIdx, setTmplIdx]           = useState(0);
  const [sql, setSql]                   = useState(TEMPLATES[0].sql);
  const [mode, setMode]                 = useState<MapMode>(TEMPLATES[0].mode);
  const [quantityCol, setQuantityCol]   = useState(TEMPLATES[0].quantityCol ?? "");
  const [labelCol, setLabelCol]         = useState(TEMPLATES[0].labelCol);
  const [latCol, setLatCol]             = useState("");
  const [lngCol, setLngCol]             = useState("");
  const [valueCol, setValueCol]         = useState(TEMPLATES[0].valueCol ?? "");
  const [colorSchemeKey, setColorSchemeKey] = useState(TEMPLATES[0].colorScheme ?? "rsrp_data");
  const [isRunning, setIsRunning]       = useState(false);
  const [error, setError]               = useState<string | null>(null);
  const [columns, setColumns]           = useState<string[]>([]);
  const [rows, setRows]                 = useState<Record<string, CellValue>[]>([]);
  const [executionTime, setExecutionTime] = useState<number | null>(null);
  const [showExpanded, setShowExpanded] = useState(false);
  const [filterCollection, setFilterCollection] = useState("");
  const [filterLocation, setFilterLocation]     = useState("");
  const [filterNRARFCN, setFilterNRARFCN]       = useState("");
  const [mapLoading, setMapLoading]             = useState(false);
  const latestRunQuery = useRef<() => void>(() => {});

  useEffect(() => {
    if (!localDb) { setLocalLocations([]); return; }
    const collections = filterCollection ? [filterCollection] : [];
    fetchLocations(localDb, collections)
      .then(setLocalLocations)
      .catch(() => setLocalLocations([]));
  }, [localDb, filterCollection]);

  // Apply sync from panel 1 (operator sync)
  useEffect(() => {
    if (!syncTarget) return;
    if (syncTarget.db) setLocalDb(syncTarget.db);
    setTmplIdx(syncTarget.tmplIdx);
    setSql(syncTarget.sql);
    setMode(syncTarget.mode);
    setValueCol(syncTarget.valueCol);
    setColorSchemeKey(syncTarget.colorSchemeKey);
    setLabelCol(syncTarget.labelCol);
    setQuantityCol(syncTarget.quantityCol);
    setLatCol(""); setLngCol("");
    setFilterLocation(syncTarget.location);
    setFilterCollection(syncTarget.collection);
    setRows([]); setColumns([]); setError(null); setExecutionTime(null);
    setFilterNRARFCN("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncTarget]);

  const currentScheme = COLOR_SCHEMES[colorSchemeKey];

  const effLatCol   = latCol      || columns.find((c) => ["lat","latitude"].includes(lc(c)))                                          || "";
  const effLngCol   = lngCol      || columns.find((c) => ["lng","lon","longitude"].includes(lc(c)))                                   || "";
  const effQtyCol   = quantityCol || columns.find((c) => ["total_calls","count","total","calls","sessions","avg","value"].some(k => lc(c).includes(k))) || columns[1] || "";
  const effValCol   = valueCol    || columns.find((c) => lc(c) === lc(currentScheme.suggestCol))                                      || columns[2]  || "";
  const effLabelCol = labelCol    || columns.find((c) => ["location","asidelocation","name","label"].includes(lc(c)))                 || columns[0]  || "";

  const collectionColName = columns.find((c) => ["collectionname","collection"].includes(lc(c))) ?? "";

  const uniqueCollections = useMemo(() => {
    if (!collectionColName) return [];
    return [...new Set(rows.map((r) => String(r[collectionColName] ?? "")).filter(Boolean))].sort();
  }, [rows, collectionColName]);

  const filteredRows = useMemo(() => {
    const nrCol = TEMPLATES[tmplIdx]?.nrarfcnCol;
    if (!nrCol || !filterNRARFCN) return rows;
    return rows.filter((r) => String(r[nrCol] ?? "") === filterNRARFCN);
  }, [rows, tmplIdx, filterNRARFCN]);

  const availableNRARFCNs = useMemo(() => {
    const nrCol = TEMPLATES[tmplIdx]?.nrarfcnCol;
    if (!nrCol || rows.length === 0) return [];
    return [...new Set(rows.map((r) => String(r[nrCol] ?? "")).filter(Boolean))].sort(
      (a, b) => Number(a) - Number(b),
    );
  }, [rows, tmplIdx]);

  const handleTemplateChange = (idx: number) => {
    const t = TEMPLATES[idx];
    setTmplIdx(idx); setSql(t.sql); setMode(t.mode);
    setQuantityCol(t.quantityCol ?? ""); setValueCol(t.valueCol ?? "");
    setLabelCol(t.labelCol); setLatCol(""); setLngCol("");
    if (t.colorScheme) setColorSchemeKey(t.colorScheme);
    setRows([]); setColumns([]); setError(null); setExecutionTime(null);
    setFilterNRARFCN("");
  };

  const currentTemplate = TEMPLATES[tmplIdx];
  const needsFilters = currentTemplate?.requiresFilters ?? false;
  const filtersReady = !needsFilters || (filterCollection !== "" && filterLocation !== "");

  const runQuery = async () => {
    if (!localDb) { setError("Επιλέξτε database πρώτα."); return; }
    if (!filtersReady) { setError("Επιλέξτε Collection και ASideLocation πριν εκτελέσετε το query."); return; }
    setIsRunning(true); setError(null); setMapLoading(true);
    const esc = (s: string) => s.replace(/'/g, "''");
    let effectiveSql = sql;
    if (filterCollection) {
      effectiveSql = effectiveSql.replace(/\{collection\}/g, esc(filterCollection));
    } else {
      effectiveSql = effectiveSql.split('\n').filter((line) => !line.includes('{collection}')).join('\n');
    }
    if (filterLocation) {
      effectiveSql = effectiveSql.replace(/\{location\}/g, esc(filterLocation));
    } else {
      effectiveSql = effectiveSql.split('\n').filter((line) => !line.includes('{location}')).join('\n');
    }
    try {
      const result = await runBenchmarkApi(localDb, [effectiveSql]);
      if (result.results.length > 0) {
        const r = result.results[0];
        setColumns(r.columns); setRows(r.data); setExecutionTime(r.executionTime);
        if (!currentTemplate?.colorScheme) {
          const colsLower = r.columns.map((c) => c.toLowerCase());
          const match = Object.entries(COLOR_SCHEMES).find(([, s]) => colsLower.includes(s.suggestCol.toLowerCase()));
          if (match) setColorSchemeKey(match[0]);
        }
        setTimeout(() => setMapLoading(false), 600);
      } else {
        setMapLoading(false);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Σφάλμα εκτέλεσης query");
      setMapLoading(false);
    } finally { setIsRunning(false); }
  };

  // Keep ref pointing to latest runQuery so external trigger avoids stale closure
  latestRunQuery.current = runQuery;
  useEffect(() => {
    if (!runTrigger) return;
    latestRunQuery.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runTrigger]);

  const bubblePoints = useMemo(() => {
    if (mode !== "bubble" || !effQtyCol || filteredRows.length === 0) return [];
    const vals = filteredRows.map((r) => Number(r[effQtyCol])).filter((v) => !isNaN(v));
    if (!vals.length) return [];
    const minV = Math.min(...vals), maxV = Math.max(...vals), range = maxV - minV || 1;
    return filteredRows.flatMap((row) => {
      const qty = Number(row[effQtyCol]);
      if (isNaN(qty)) return [];
      let lat: number | null = null, lng: number | null = null;
      if (effLatCol && effLngCol) {
        const a = Number(row[effLatCol]), b = Number(row[effLngCol]);
        if (!isNaN(a) && !isNaN(b) && !(a === 0 && b === 0)) { lat = a; lng = b; }
      }
      if (lat === null && effLabelCol && row[effLabelCol] != null) {
        const c = resolveCity(String(row[effLabelCol]));
        if (c) { lat = c.lat; lng = c.lng; }
      }
      if (lat === null || lng === null) return [];
      const normalized = (qty - minV) / range;
      return [{ lat, lng, qty, normalized, radius: 8 + normalized * 36, row }];
    });
  }, [mode, filteredRows, effQtyCol, effLatCol, effLngCol, effLabelCol]);

  const pointMarkers = useMemo(() => {
    if (mode !== "points" || !effValCol || !effLatCol || !effLngCol || filteredRows.length === 0) return [];
    const raw = filteredRows.flatMap((row) => {
      const lat = Number(row[effLatCol]), lng = Number(row[effLngCol]);
      if (isNaN(lat) || isNaN(lng) || (lat === 0 && lng === 0)) return [];
      const val = row[effValCol];
      if (val == null) return [];
      return [{ lat, lng, val, color: colorForValue(currentScheme, val), label: effLabelCol ? String(row[effLabelCol] ?? "") : "", row }];
    });
    return decimatePoints(raw);
  }, [mode, filteredRows, effValCol, effLatCol, effLngCol, effLabelCol, currentScheme]);

  const allMapPoints = mode === "bubble"
    ? bubblePoints.map((p) => ({ lat: p.lat, lng: p.lng }))
    : pointMarkers.map((p) => ({ lat: p.lat, lng: p.lng }));

  const bucketCounters = useMemo(() => {
    if (mode !== "points" || !effValCol || filteredRows.length === 0) return new Map<string, number>();
    return computeBucketCounters(filteredRows, effValCol, currentScheme);
  }, [mode, filteredRows, effValCol, currentScheme]);

  const pointsTotal = [...bucketCounters.values()].reduce((a, b) => a + b, 0);

  return (
    <div className="rounded-lg border border-border bg-card flex flex-col overflow-hidden">

      {/* ── Controls ── */}
      <div className="p-2.5 space-y-2 border-b border-border bg-muted/20">

        {/* Row 0: Database selector */}
        <select
          value={localDb}
          onChange={(e) => { setLocalDb(e.target.value); setRows([]); setColumns([]); }}
          className="w-full bg-background border border-border rounded px-2 py-1 text-xs"
        >
          <option value="">— Επιλέξτε Database —</option>
          {databases.map((db) => <option key={db} value={db}>{db}</option>)}
        </select>
        {collectionsLoading && (
          <p className="text-[10px] text-muted-foreground">Φόρτωση collections…</p>
        )}

        {/* Row 1: Template + mode + run */}
        <div className="flex items-center gap-1.5">
          <select
            value={tmplIdx}
            onChange={(e) => handleTemplateChange(Number(e.target.value))}
            className="flex-1 min-w-0 bg-background border border-border rounded px-2 py-1 text-xs truncate"
          >
            {TEMPLATES.map((t, i) => (
              <option key={i} value={i}>[{t.category}] {t.label}</option>
            ))}
          </select>

          {/* mode pills */}
          <button type="button" onClick={() => setMode("bubble")}
            title="Bubble mode"
            className={`p-1.5 rounded border text-xs transition-all ${mode === "bubble" ? "bg-background border-border text-foreground shadow-sm" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
            <Layers className="h-3.5 w-3.5" />
          </button>
          <button type="button" onClick={() => setMode("points")}
            title="GPS Points mode"
            className={`p-1.5 rounded border text-xs transition-all ${mode === "points" ? "bg-background border-border text-foreground shadow-sm" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
            <MapPin className="h-3.5 w-3.5" />
          </button>

          <Button onClick={runQuery} disabled={isRunning || !localDb} size="sm" className="h-7 px-2.5 gap-1 shrink-0">
            {isRunning
              ? <div className="h-3 w-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
              : <Play className="h-3 w-3" />}
          </Button>

          {panelIndex === 0 && onSyncRequest && (filterLocation || filterCollection) && (
            <button
              type="button"
              title={`Sync template & operator → Panels 2 & 3\n${filterLocation ? `Location: ${filterLocation}` : `Collection: ${filterCollection}`}`}
              onClick={() => onSyncRequest(
                { db: localDb, tmplIdx, sql, mode, valueCol, colorSchemeKey, labelCol, quantityCol, location: filterLocation, collection: filterCollection },
                localCollections,
                localLocations,
              )}
              className="p-1.5 rounded border border-border text-muted-foreground hover:text-primary hover:border-primary text-xs transition-all shrink-0"
            >
              <ArrowRightLeft className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Row 2: Filters */}
        <div className="grid grid-cols-2 gap-1.5">
          <div>
            <label className="text-[10px] text-muted-foreground block mb-0.5">Collection</label>
            <select
              value={filterCollection}
              onChange={(e) => setFilterCollection(e.target.value)}
              className="w-full bg-background border border-border rounded px-2 py-1 text-xs"
            >
              <option value="">— Όλα —</option>
              {(() => {
                const base = localCollections.length > 0 ? localCollections : uniqueCollections;
                const extra = filterCollection && !base.includes(filterCollection) ? [filterCollection] : [];
                return [...extra, ...base].map((v) => <option key={v} value={v}>{v}</option>);
              })()}
            </select>
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground block mb-0.5">ASideLocation</label>
            <select
              value={filterLocation}
              onChange={(e) => setFilterLocation(e.target.value)}
              className="w-full bg-background border border-border rounded px-2 py-1 text-xs"
            >
              <option value="">— Όλες —</option>
              {localLocations.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
        </div>

        {/* Row 2b: NRARFCN filter — εμφανίζεται μόνο για 5G templates */}
        {currentTemplate?.nrarfcnCol && (
          <div>
            <label className="text-[10px] text-muted-foreground block mb-0.5">
              NRARFCN
              {availableNRARFCNs.length > 0 && (
                <span className="ml-1 text-primary/70">({availableNRARFCNs.length} διαθέσιμα)</span>
              )}
            </label>
            <select
              value={filterNRARFCN}
              onChange={(e) => setFilterNRARFCN(e.target.value)}
              className="w-full bg-background border border-border rounded px-2 py-1 text-xs"
            >
              <option value="">— Όλα τα NRARFCN —</option>
              {availableNRARFCNs.map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
          </div>
        )}

        {/* Row 3: Expand toggle */}
        <button
          type="button"
          onClick={() => setShowExpanded((v) => !v)}
          className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
        >
          <Settings2 className="h-3 w-3" />
          SQL / Ρυθμίσεις
          <ChevronDown className={`h-3 w-3 ml-0.5 transition-transform ${showExpanded ? "rotate-180" : ""}`} />
        </button>

        {showExpanded && (
          <div className="space-y-2 pt-2 border-t border-border">
            <div>
              <label className="text-[10px] text-muted-foreground block mb-0.5">SQL Query</label>
              <textarea
                value={sql}
                onChange={(e) => { setSql(e.target.value); setTmplIdx(TEMPLATES.length - 1); }}
                className="w-full h-32 font-mono text-[11px] bg-background border border-border rounded px-2 py-1.5 resize-y focus:outline-none focus:ring-1 focus:ring-primary"
                spellCheck={false}
              />
            </div>
          </div>
        )}

        {/* Status row */}
        {rows.length > 0 && !isRunning && (
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground font-mono flex-wrap">
            <span className={allMapPoints.length === 0 ? "text-destructive" : "text-primary"}>
              {allMapPoints.length} pts
            </span>
            <span>/ {filteredRows.length !== rows.length ? `${filteredRows.length} filtered /` : ""} {rows.length} rows</span>
            {executionTime != null && <span className="ml-auto">{executionTime.toFixed(0)} ms</span>}
            {(filterCollection || filterLocation) && (
              <button type="button" onClick={() => { setFilterCollection(""); setFilterLocation(""); setFilterNRARFCN(""); }}
                className="ml-1 text-primary/70 hover:text-primary flex items-center gap-0.5">
                <X className="h-2.5 w-2.5" /> reset
              </button>
            )}
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="flex items-start gap-1.5 p-2 rounded bg-destructive/10 border border-destructive/30 text-[11px] text-destructive">
            <AlertCircle className="h-3 w-3 shrink-0 mt-0.5" />
            <span className="break-all">{error}</span>
          </div>
        )}
      </div>

      {/* ── Map ── */}
      <div className="relative" style={{ height: 520 }}>
        {mapLoading && (
          <div className="absolute inset-0 z-[1001] flex items-center justify-center bg-background/60 backdrop-blur-sm">
            <div className="h-9 w-9 border-4 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        )}
        <MapContainer
          center={[39.07, 23.73]}
          zoom={6}
          scrollWheelZoom
          style={{ height: "100%", width: "100%" }}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <MapBounds points={allMapPoints} />

          {mode === "bubble" && bubblePoints.map((pt, i) => {
            const { fill, stroke } = bubbleColor(pt.normalized);
            const label = effLabelCol ? String(pt.row[effLabelCol] ?? `#${i}`) : `#${i}`;
            const extra = Object.entries(pt.row).filter(([k]) => k !== effLabelCol && k !== effLatCol && k !== effLngCol && k !== effQtyCol);
            return (
              <CircleMarker key={i} center={[pt.lat, pt.lng]} radius={pt.radius}
                pathOptions={{ fillColor: fill, fillOpacity: 0.78, color: stroke, weight: 2 }}>
                <Tooltip direction="top" offset={[0, -pt.radius]} opacity={0.97}>
                  <div className="font-sans text-center space-y-0.5 min-w-[120px]">
                    <div className="font-bold text-xs border-b border-gray-200 pb-1 mb-1">{label}</div>
                    <div className="text-xs">
                      <span className="text-gray-500">{effQtyCol}:</span>{" "}
                      <span className="font-mono font-bold" style={{ color: stroke }}>
                        {pt.qty % 1 === 0 ? pt.qty.toLocaleString() : pt.qty.toFixed(2)}
                      </span>
                    </div>
                    {extra.map(([k, v]) => (
                      <div key={k} className="text-[10px] text-gray-500">
                        {k}: <span className="text-gray-700 font-mono">{v != null ? String(v) : "—"}</span>
                      </div>
                    ))}
                  </div>
                </Tooltip>
              </CircleMarker>
            );
          })}

          {mode === "points" && pointMarkers.map((pt, i) => {
            const displayVal = typeof pt.val === "number"
              ? (pt.val % 1 === 0 ? pt.val.toLocaleString() : pt.val.toFixed(2))
              : String(pt.val);
            return (
              <CircleMarker key={i} center={[pt.lat, pt.lng]} radius={4}
                pathOptions={{ fillColor: pt.color, fillOpacity: 0.85, color: pt.color, weight: 1 }}>
                <Tooltip direction="top" offset={[0, -6]} opacity={0.95}>
                  <div className="font-sans text-center space-y-0.5">
                    {pt.label && <div className="font-bold text-xs border-b border-gray-200 pb-0.5 mb-0.5">{pt.label}</div>}
                    <div className="text-xs">
                      <span className="text-gray-500">{effValCol}:</span>{" "}
                      <span className="font-mono font-bold" style={{ color: pt.color }}>{displayVal}</span>
                    </div>
                  </div>
                </Tooltip>
              </CircleMarker>
            );
          })}
        </MapContainer>

        {/* Legend overlay */}
        {allMapPoints.length > 0 && (
          <div className="absolute bottom-2 right-2 bg-card/95 backdrop-blur-sm border border-border/60 rounded-md p-1.5 space-y-0.5 z-[1000] shadow-md max-h-[220px] overflow-y-auto min-w-[140px]">
            {mode === "bubble" ? (
              <>
                <p className="text-[8px] font-bold uppercase tracking-widest text-muted-foreground mb-0.5">Κλίμακα</p>
                {[
                  { label: "Πολύ Υψηλό",  fill: "#ef4444" },
                  { label: "Υψηλό",       fill: "#f97316" },
                  { label: "Μέτριο",      fill: "#eab308" },
                  { label: "Χαμηλό",      fill: "#22c55e" },
                  { label: "Πολύ Χαμηλό", fill: "#3b82f6" },
                ].map(({ label, fill }) => (
                  <div key={label} className="flex items-center gap-1">
                    <div className="rounded-full shrink-0" style={{ width: 7, height: 7, backgroundColor: fill }} />
                    <span className="text-[9px] text-muted-foreground">{label}</span>
                  </div>
                ))}
                <p className="text-[8px] text-muted-foreground border-t border-border/50 pt-0.5 mt-0.5">∝ {effQtyCol || "qty"}</p>
              </>
            ) : (
              <>
                <p className="text-[8px] font-bold uppercase tracking-widest text-muted-foreground mb-0.5 truncate">{currentScheme.label}</p>
                {currentScheme.type === "range"
                  ? currentScheme.buckets.map((b) => {
                      const cnt = bucketCounters.get(b.label) ?? 0;
                      return (
                        <div key={b.label} className={`flex items-center gap-1 ${cnt === 0 ? "opacity-25" : ""}`}>
                          <div className="rounded-full shrink-0" style={{ width: 7, height: 7, backgroundColor: b.color }} />
                          <span className="text-[9px] text-muted-foreground flex-1 leading-none">{b.label}</span>
                          {cnt > 0 && (
                            <span className="text-[8px] font-mono text-muted-foreground/60 whitespace-nowrap">
                              {cnt.toLocaleString()} <span className="text-primary/70">{(cnt / pointsTotal * 100).toFixed(1)}%</span>
                            </span>
                          )}
                        </div>
                      );
                    })
                  : currentScheme.categories.map((c) => {
                      const cnt = bucketCounters.get(c.value) ?? 0;
                      return (
                        <div key={c.value} className={`flex items-center gap-1 ${cnt === 0 ? "opacity-25" : ""}`}>
                          <div className="rounded-full shrink-0" style={{ width: 7, height: 7, backgroundColor: c.color }} />
                          <span className="text-[9px] text-muted-foreground flex-1 leading-none">{c.value}</span>
                          {cnt > 0 && (
                            <span className="text-[8px] font-mono text-muted-foreground/60 whitespace-nowrap">
                              {cnt.toLocaleString()} <span className="text-primary/70">{(cnt / pointsTotal * 100).toFixed(1)}%</span>
                            </span>
                          )}
                        </div>
                      );
                    })}
                <p className="text-[8px] text-muted-foreground/60 border-t border-border/50 pt-0.5 mt-0.5 font-mono truncate">
                  {effValCol || "—"} · {pointsTotal.toLocaleString()} pts
                </p>
              </>
            )}
          </div>
        )}

        {/* Empty state */}
        {allMapPoints.length === 0 && !isRunning && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="text-center space-y-2">
              <MapPin className="h-10 w-10 text-muted-foreground/20 mx-auto" />
              <p className="text-xs text-muted-foreground/60">
                {rows.length > 0 ? "Δεν βρέθηκαν συντεταγμένες" : "Εκτελέστε query"}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// ── Props ─────────────────────────────────────────────────────────────────────
interface QueryMapProps {
  databases: string[];
  defaultDatabase?: string;
}

// ── Main component — three-panel grid ────────────────────────────────────────
const QueryMap = ({ databases, defaultDatabase = "" }: QueryMapProps) => {
  const [syncTargets, setSyncTargets] = useState<[SyncPayload | null, SyncPayload | null]>([null, null]);
  const [runAllTrigger, setRunAllTrigger] = useState(0);

  const handleSyncRequest = (payload: SyncPayload, collections: string[], locations: string[]) => {
    // Detect operator from location first (e.g. "Cosmote Free A"), fall back to collection
    const refOp = detectOperator(payload.location) || detectOperator(payload.collection);
    const others = OPERATOR_GROUPS.filter(g => g.name !== refOp);
    const targets: [SyncPayload | null, SyncPayload | null] = [null, null];
    for (let i = 0; i < 2; i++) {
      const targetOp = others[i];
      // Swap location to the matching operator location (e.g. "Vodafone Free A")
      const locCandidates = locations.filter(l => detectOperator(l) === targetOp?.name);
      const bestLoc = targetOp
        ? bestCollectionForOperator(payload.location, refOp ?? "", targetOp.name, locCandidates) ?? ""
        : "";
      // Swap collection only if it also contains an operator name; otherwise keep same
      const collRefOp = detectOperator(payload.collection);
      const collCandidates = collRefOp && targetOp
        ? collections.filter(c => detectOperator(c) === targetOp.name)
        : [];
      const bestColl = collRefOp && targetOp && collCandidates.length > 0
        ? bestCollectionForOperator(payload.collection, collRefOp, targetOp.name, collCandidates) ?? payload.collection
        : payload.collection;
      targets[i] = { ...payload, collection: bestColl, location: bestLoc };
    }
    setSyncTargets(targets);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <MapPin className="h-4 w-4 text-primary shrink-0" />
        <h2 className="text-sm font-semibold">Query Map — Τριπλός Χάρτης</h2>
        <span className="text-[11px] text-muted-foreground">
          Κάθε χάρτης έχει ανεξάρτητο query, φίλτρα και χρωματική κλίμακα
        </span>
        <Button
          size="sm"
          className="ml-auto h-7 px-3 gap-1.5"
          onClick={() => setRunAllTrigger(v => v + 1)}
        >
          <Play className="h-3 w-3" />
          Run All
        </Button>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <SingleMapPanel
          databases={databases} defaultDatabase={defaultDatabase}
          panelIndex={0} onSyncRequest={handleSyncRequest}
          runTrigger={runAllTrigger}
        />
        <SingleMapPanel
          databases={databases} defaultDatabase={defaultDatabase}
          panelIndex={1} syncTarget={syncTargets[0]}
          runTrigger={runAllTrigger}
        />
        <SingleMapPanel
          databases={databases} defaultDatabase={defaultDatabase}
          panelIndex={2} syncTarget={syncTargets[1]}
          runTrigger={runAllTrigger}
        />
      </div>
    </div>
  );
};

export default QueryMap;
