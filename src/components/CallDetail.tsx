import { useState, useEffect, useMemo, useRef, useCallback, Fragment } from "react";
import { motion } from "framer-motion";
import {
  ArrowLeft, Signal, Activity, Gauge, ArrowDown,
  Timer, Save, Edit2, Flag, ChevronLeft, ChevronRight, Maximize2, MapPin
} from "lucide-react";
import L from "leaflet";
import { MapContainer, TileLayer, CircleMarker, Marker, Polyline, useMap, Tooltip as LeafletTooltip } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/use-toast";
import { useLocalStorage } from "@/hooks/use-local-storage";
import type { CallRecord } from "@/lib/callData";
import { fetchLteValues, fetchLteValuesBSide, fetchGsmValues, fetchGsmValuesBSide, fetchNr5gValues, fetchMosValues, updateCallComment, fetchKpiValues, fetchCallSideComparison, fetchTracelogValues, fetchCellInfo, fetchCellInfoBSide, fetchAntennas, fetchCallContextSignal, fetchCallContextTechnology, fetchL3Messages, fetchCallDeviceInfo, fetchLteMeasurementComparison, fetchLteScannerMeasurement, fetchLteScannerRaw, fetchLteScannerBest, fetchNr5gScannerBest, fetchNr5gScannerRaw, fetchGsmScannerRaw, fetchGsmScannerBest, fetchGsmContextSignal, fetchCallContextSignalBSide, fetchGsmContextSignalBSide, fetchNr5gContextSignal, fetchNr5gContextSignalBSide, fetchCallKpiTile, fetchHandoverInfo, fetchCallSrvccDetail, fetchCallCsfbDetail, fetchTechnologyTimeline, fetchTechnologyPeriods, fetchVoiceCodec, fetchMarkers, fetchCallNeighbors, type TechnologyPeriodRow, type CallNeighbors, type CallSideComparisonRow, type TraceLogRow, type AntennaRow, type CallL3MessagesResponse, type L3MessageRow, type CallDeviceInfo, type LteMeasurementStat, type LteScannerStat, type CallKpiTile, type HandoverInfoRow, type SrvccDetailResponse, type SrvccEventRow, type CsfbDetailResponse, type TechnologyTimelineRow, type VoiceCodecRow, type MarkerRow, type Nr5gCell } from "@/lib/api";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, Legend, ReferenceLine, ReferenceArea } from "recharts";
import { technologyColor } from "@/lib/chartStyles";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { L3SignalingPanel } from "@/components/L3SignalingPanel";
import { CsfbTransitionPanel } from "@/components/CsfbTransitionPanel";
import { type OverviewLane, type OverviewSegment } from "@/components/SessionOverview";
import { CallSignalChart, type SignalEvent } from "@/components/CallSignalChart";
import { resolveCallDetailMode } from "@/lib/callDetailMode";
import { attachNearest, mergeSignalSamples, mergeTransitionSeries, nearestIndex, sampleDomain, toNumber, toTimestamp, transitionLegStats, type SignalSample } from "@/lib/signalSeries";
//ReferenceLine για γραμμες στο διαγραμμα, πχ για thresholds. 
/**
 * Interface για τα props του Component CallDetail.
 * Η TypeScript μας εγγυάται ότι όποιος καλεί αυτό το Component, 
 * είναι ΥΠΟΧΡΕΩΜΕΝΟΣ να περάσει ένα αντικείμενο `call` (τύπου `CallRecord`) 
 * και μια συνάρτηση `onBack` που δεν επιστρέφει τίποτα (`() => void`).
 */
interface CallDetailProps {
  call: CallRecord;
  database: string;
  onBack: () => void;
  /** Πλοήγηση σε άλλη κλήση (Prev/Next Call) — δίνει το SessionId της κλήσης-στόχου */
  onNavigateToCall?: (sessionId: string) => void;
}


/**
 * Παράδειγμα συνάρτησης με Types.
 * Δέχεται σαν είσοδο (iso) ένα string και εγγυάται(: string) 
 * ότι το αποτέλεσμά της θα είναι επίσης string.
 */
/**
 * Πόσο κοντά πρέπει να είναι μια γραμμή πίνακα στον κοινό cursor για να θεωρηθεί «αυτή που
 * κοιτάς». Τα measurement reports απέχουν τυπικά ~0.5s, οπότε το 1.5s καλύπτει και τους
 * αραιούς πίνακες (KPI, TraceLog) χωρίς να φωτίζει άσχετες γραμμές.
 */
const HOVER_TOLERANCE_MS = 1500;

// Το context φέρνεται ΜΙΑ φορά ανά κλήση στο μέγιστο παράθυρο· το ±Ns που βλέπει ο χρήστης
// (viewWindowSec) είναι καθαρό φίλτρο εμφάνισης πάνω σε αυτά τα δεδομένα, χωρίς refetch.
const CONTEXT_FETCH_WINDOW_SEC = 120;
const VIEW_WINDOW_OPTIONS = [10, 30, 60, 120] as const;
// ±60s για CS (GSM-only) κλήσεις, ±30s για όλες τις υπόλοιπες.
const defaultViewWindowSec = (callMode?: string | null) => (callMode === "CS" ? 60 : 30);

// Κοινό scanner (LTE/GSM/5G) μέσα στην κλήση: πάνω από τόσο μακριά στον χρόνο το scanner sample
// δεν συγκρίνεται με τη μέτρηση του κινητού. Χωρίς όριο, με το ±CONTEXT_FETCH_WINDOW_SEC padding οι
// τελευταίες γραμμές της κλήσης ταίριαζαν με scanner έως 2 λεπτά ΜΕΤΑ το τέλος της.
const SCANNER_MATCH_MAX_DT_MS = 10_000;
// Scanner στο context (πριν/μετά την κλήση): μέγιστη απόσταση scanner sample ↔ δείγμα κινητού,
// και ανοχή όταν ένα scanner sample (best) κολλάει με τη δική του ώρα στην καμπύλη.
const CONTEXT_SCANNER_MAX_DT_MS = 5_000;
const SCANNER_ATTACH_TOLERANCE_MS = 2_500;

/**
 * Τα scanner τμήματα (ανά serving cell) καλύπτουν μόνο τη διάρκεια της κλήσης· το πρώτο
 * επεκτείνεται προς τα πίσω και το τελευταίο προς τα εμπρός κατά CONTEXT_FETCH_WINDOW_SEC,
 * ώστε το scanner να υπάρχει και στο ±Ns context του διαγράμματος.
 */
const edgeSegmentPad = (index: number, count: number) => ({
  padBeforeSec: index === 0 ? CONTEXT_FETCH_WINDOW_SEC : 0,
  padAfterSec: index === count - 1 ? CONTEXT_FETCH_WINDOW_SEC : 0,
});

/** Scanner rows ταξινομημένα κατά FullDate, με τα timestamps τους για binary search. */
type TimedRows = { rows: any[]; times: number[] };
const EMPTY_TIMED: TimedRows = { rows: [], times: [] };
const toTimedRows = (raw: any[]): TimedRows => {
  const rows = raw
    .map((row) => ({ ...row, _ts: toTimestamp(row.FullDate) }))
    .filter((row) => Number.isFinite(row._ts))
    .sort((a, b) => a._ts - b._ts);
  return { rows, times: rows.map((row) => row._ts) };
};
/** Ομαδοποίηση scanner rows ανά κλειδί (CGI, EARFCN+PCI, CID…), το καθένα ταξινομημένο κατά χρόνο. */
const groupTimedRows = (raw: any[], keyOf: (row: any) => string | null): Map<string, TimedRows> => {
  const groups = new Map<string, any[]>();
  for (const row of raw) {
    const key = keyOf(row);
    if (key == null) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }
  const timed = new Map<string, TimedRows>();
  groups.forEach((rows, key) => timed.set(key, toTimedRows(rows)));
  return timed;
};
/** Το πλησιέστερο scanner row στο `ts`, μόνο αν απέχει ≤ maxMs. */
const nearestWithin = (timed: TimedRows | undefined, ts: number, maxMs: number): any | null => {
  if (!timed || timed.rows.length === 0 || !Number.isFinite(ts)) return null;
  const index = nearestIndex(timed.times, ts);
  return index >= 0 && Math.abs(timed.times[index] - ts) <= maxMs ? timed.rows[index] : null;
};
/**
 * Serving 5G κυψέλη μιας NR γραμμής του κινητού: CId / NCI (από DmnCellInformation) όταν υπάρχει,
 * αλλιώς NR-ARFCN + PCI. Στα δεδομένα το mapping είναι συχνά άδειο (CId = NULL), ενώ το NRARFCN
 * του κινητού ταιριάζει με το AbsFreqSSB του scanner. `key` ταιριάζει με το nrScannerRowKeys.
 */
const nrServingCell = (row: any): { key: string; cell: Nr5gCell } | null => {
  const cid = row.CId ?? row.NCI;
  if (cid != null) return { key: `cid:${cid}`, cell: { cid: String(cid) } };
  if (row.NRARFCN != null && row.PCI != null) {
    return { key: `arfcn:${row.NRARFCN}_${row.PCI}`, cell: { arfcn: Number(row.NRARFCN), pci: Number(row.PCI) } };
  }
  return null;
};
/** Τα κλειδιά με τα οποία μπορεί να βρεθεί ένα 5G scanner row (CID και NR-ARFCN + PCI). */
const nrScannerRowKeys = (row: any): string[] => [
  ...(row.CID != null ? [`cid:${row.CID}`] : []),
  ...(row.NRARFCN != null && row.PCI != null ? [`arfcn:${row.NRARFCN}_${row.PCI}`] : []),
];

// Χρωματισμός LTE RSRP: πράσινο καλό, πορτοκαλί οριακό, κόκκινο κακό (χρησιμοποιείται στο χάρτη)
function rsrpColor(val: number | null | undefined): string {
  if (val == null) return "#6b7280";
  if (val >= -115) return "#22c55e";
  if (val >= -120) return "#f97316";
  return "#ef4444";
}

// Ίδια λογική με rsrpColor αλλά για GSM RxLev (διαφορετικά thresholds)
function rxLevColor(val: number | null | undefined): string {
  if (val == null) return "#6b7280";
  if (val >= -88) return "#22c55e";
  if (val >= -92) return "#f97316";
  return "#ef4444";
}

const KPI_LABELS: Record<number, string> = {
  38040: "SRVCC 4G→3G",
  38050: "SRVCC 4G→2G",
};

function lteEarfcnFrequency(earfcn: number | null): number | null {
  if (earfcn == null) return null;
  if (earfcn >= 0 && earfcn <= 599) return 2100;
  if (earfcn >= 1200 && earfcn <= 1949) return 1800;
  if (earfcn >= 2750 && earfcn <= 3449) return 2600;
  if (earfcn >= 3450 && earfcn <= 3799) return 900;
  if (earfcn >= 6150 && earfcn <= 6449) return 800;
  if (earfcn >= 9210 && earfcn <= 9659) return 700;
  if (earfcn >= 37750 && earfcn <= 38249) return 2600;
  return null;
}

function rankAntennaMatches(antennas: AntennaRow[], eNBId: number | null, earfcn: number | null, pci: number | null) {
  const siteId = eNBId == null ? null : Math.abs(eNBId) % 100000;
  const frequency = lteEarfcnFrequency(earfcn);
  const score = (antenna: AntennaRow) =>
    (siteId != null && antenna.siteId === siteId ? 4 : 0)
    + (pci != null && antenna.pci === pci ? 2 : 0)
    + (frequency != null && antenna.freq === frequency ? 1 : 0);
  const candidates = antennas.filter((antenna) => antenna.pci === pci);
  const bestScore = candidates.reduce((best, antenna) => Math.max(best, score(antenna)), -1);
  return candidates.filter((antenna) => score(antenna) === bestScore);
}

/**
 * Tooltip για τα σημεία/antenna marker του χάρτη που αλλάζει αυτόματα κατεύθυνση
 * ώστε να μην "κόβεται" εκτός οθόνης όταν το σημείο βρίσκεται κοντά στην άκρη του χάρτη.
 */
function SmartTooltip({ lat, lon, children }: { lat: number; lon: number; children: React.ReactNode }) {
  const map = useMap();
  const pt = map.latLngToContainerPoint([lat, lon]);
  const sz = map.getSize();
  const xR = pt.x / sz.x;
  const yR = pt.y / sz.y;

  let direction: "top" | "bottom" | "left" | "right" = "top";
  let offset: [number, number] = [0, -24];

  if (yR < 0.35) { direction = "bottom"; offset = [0, 10]; }
  else if (yR > 0.65) { direction = "top"; offset = [0, -24]; }
  else if (xR < 0.35) { direction = "right"; offset = [10, 0]; }
  else { direction = "left"; offset = [-10, 0]; }

  return (
    <LeafletTooltip direction={direction} offset={offset} opacity={1}>
      {children}
    </LeafletTooltip>
  );
}

// Κεντράρει/κάνει zoom τον χάρτη ώστε να χωράνε όλα τα GPS σημεία της κλήσης όποτε αλλάζουν
function MapAutoFit({ points }: { points: Array<[number, number]> }) {
  const map = useMap();
  useEffect(() => {
    // Μέσα σε popup ο χάρτης στήνεται ενώ το panel ακόμη κάνει animate, οπότε το Leaflet
    // μετράει λάθος διαστάσεις και αφήνει γκρίζα κενά. Ένα invalidateSize μόλις τελειώσει
    // το animation τα διορθώνει — ανώδυνο για τον inline χάρτη.
    const settle = window.setTimeout(() => map.invalidateSize(), 260);
    if (points.length === 0) return () => window.clearTimeout(settle);
    if (points.length === 1) { map.setView(points[0], 14); return () => window.clearTimeout(settle); }
    const lats = points.map(p => p[0]);
    const lngs = points.map(p => p[1]);
    map.fitBounds(
      [[Math.min(...lats), Math.min(...lngs)], [Math.max(...lats), Math.max(...lngs)]],
      { padding: [10, 10], maxZoom: 16 }
    );
    return () => window.clearTimeout(settle);
  }, [points, map]);
  return null;
}

// Απόσταση μεταξύ δύο γεωγραφικών σημείων σε μέτρα (haversine formula)
function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Μορφοποίηση απόστασης: μέτρα κάτω από 1km, αλλιώς χιλιόμετρα με 2 δεκαδικά
function fmtDist(m: number): string {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(2)} km`;
}

// Ελληνικό format ημερομηνίας/ώρας (dd/mm/yyyy hh:mm:ss) για όλους τους πίνακες
function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("el-GR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

// Κάθε KPI γραμμή έχει StartTime/EndTime — η διαφορά τους είναι ο χρόνος που κράτησε
// η διαδικασία (setup, handover κ.λπ.), οπότε τη δείχνουμε έτοιμη αντί να την υπολογίζει ο αναλυτής.
function kpiDurationLabel(start: string | null | undefined, end: string | null | undefined): string | null {
  if (!start || !end) return null;
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(2)} s`;
}

const CallDetail = ({ call, database, onBack, onNavigateToCall }: CallDetailProps) => {
  // Το callMode που οδηγεί ΟΛΕΣ τις αποφάσεις φόρτωσης. Πολλές κλήσεις έρχονται με «-» (ή κενό →
  // «N/A»): επιλύονται από το technology με τον κανόνα του A-LEVEL (βλ. resolveCallDetailMode),
  // αλλιώς μια «-» κλήση σε GSM θα φόρτωνε μόνο LTE και θα έβγαινε άδεια. Η εμφάνιση κρατάει το raw.
  const callMode = resolveCallDetailMode(call.callMode, call.technology);
  // LTE/GSM radio measurement rows (A-side and B-side, for the "Radio Measurements" table + chart)
  // For VoNR/N26-HO calls, radioValues holds LTE + NR5G rows merged chronologically (see loadRadio below).
  const [radioValues, setRadioValues] = useState<any[]>([]);
  const [gsmValues, setGsmValues] = useState<any[]>([]);
  const [bSideGsmValues, setBSideGsmValues] = useState<any[]>([]);
  const [mosValues, setMosValues] = useState<any[]>([]);
  const [kpiValues, setKpiValues] = useState<any[]>([]);
  // Ποια γραμμή του KPI πίνακα είναι ανοιχτή (κλικ) και δείχνει όλα τα πεδία του ResultsKPI
  const [expandedKpiRow, setExpandedKpiRow] = useState<string | null>(null);
  const [tracelogValues, setTracelogValues] = useState<TraceLogRow[]>([]);
  const [sideComparison, setSideComparison] = useState<CallSideComparisonRow[]>([]);
  const [bSideLteValues, setBSideLteValues] = useState<any[]>([]);
  // Which side (A/B) and which network (LTE/GSM, only relevant for SRVCC calls) the UI currently shows
  const [selectedLteSide, setSelectedLteSide] = useState<"A" | "B">("A");
  // Σε CS κλήση η φωνή ζει στο 2G, οπότε ξεκινάμε από εκεί· οπουδήποτε αλλού το LTE είναι
  // το σκέλος που κρατάει την κλήση. Και στις δύο περιπτώσεις η επιλογή υποχωρεί αν η
  // πλευρά που βλέπεις δεν έχει τέτοιες μετρήσεις (βλ. activeLeg).
  const [srvccNetwork, setSrvccNetwork] = useState<"LTE" | "GSM">(callMode === "CS" ? "GSM" : "LTE");

  // Serving cell (eNB/EARFCN/PCI) for A-side and B-side, plus the nearest physical antenna
  // matched by PCI + shortest distance to the call's average GPS position (Cosmote Free only)
  const [cellInfo, setCellInfo] = useState<{ eNBId: number | null; EARFCN: number | null; PCI: number | null } | null>(null);
  const [bSideCellInfo, setBSideCellInfo] = useState<{ eNBId: number | null; EARFCN: number | null; PCI: number | null } | null>(null);
  const [matchedAntenna, setMatchedAntenna] = useState<{ lat: number; lon: number; cellName: string | null; distanceM: number; azimuth: number | null; freq: number | null; vendor: string | null; enbName: string | null; tech: string | null; height: number | null; downtilt: number | null; siteId: number | null; cellId: number | null } | null>(null);
  const [matchedAntennaBSide, setMatchedAntennaBSide] = useState<{ lat: number; lon: number; cellName: string | null; distanceM: number; azimuth: number | null; freq: number | null; vendor: string | null; enbName: string | null; tech: string | null; height: number | null; downtilt: number | null; siteId: number | null; cellId: number | null } | null>(null);

  // Network "context" signal/technology around the call (before/during/after window), used
  // by the "Συμπεριφορά δικτύου" charts further down the page
  const [contextSignal, setContextSignal] = useState<any[]>([]);
  const [contextSignalBSide, setContextSignalBSide] = useState<any[]>([]);
  const [gsmContextSignal, setGsmContextSignal] = useState<any[]>([]);
  const [gsmContextSignalBSide, setGsmContextSignalBSide] = useState<any[]>([]);
  const [nr5gContextSignal, setNr5gContextSignal] = useState<any[]>([]);
  const [nr5gContextSignalBSide, setNr5gContextSignalBSide] = useState<any[]>([]);
  // Default παράθυρο context: οι CS κλήσεις ανοίγουν στα ±60s (το GSM σκέλος δίνει πιο αραιά
  // δείγματα, οπότε τα ±30s των packet κλήσεων αφήνουν την καμπύλη σχεδόν άδεια).
  // Φίλτρο εμφάνισης, όχι fetch parameter: αλλαγή του απλώς ξανακόβει τα ήδη φορτωμένα δεδομένα.
  const [viewWindowSec, setViewWindowSec] = useState(() => defaultViewWindowSec(callMode));
  // Το CallDetail δεν ξαναγίνεται mount όταν αλλάζει κλήση, οπότε επαναφέρουμε το default
  // κατά το render, ώστε η νέα κλήση να μην εμφανιστεί ούτε ένα frame με το παλιό παράθυρο.
  const [viewWindowCallId, setViewWindowCallId] = useState(call.callId);
  if (viewWindowCallId !== call.callId) {
    setViewWindowCallId(call.callId);
    setViewWindowSec(defaultViewWindowSec(callMode));
  }
  // Αποτυχίες του context effect — ξεχωριστά από το loadErrors του μεγάλου fetch, γιατί τα δύο
  // effects γράφουν ανεξάρτητα και δεν πρέπει το ένα να σβήνει τα λάθη του άλλου.
  const [contextLoadErrors, setContextLoadErrors] = useState<string[]>([]);
  const [contextTechnology, setContextTechnology] = useState<any[]>([]);
  // Περίοδοι τεχνολογίας (FactRadioTechnology) — η πηγή του Session Overview, ανά πλευρά
  const [techPeriods, setTechPeriods] = useState<TechnologyPeriodRow[]>([]);
  const [techPeriodsBSide, setTechPeriodsBSide] = useState<TechnologyPeriodRow[]>([]);
  // L3 signaling (RRC/NAS/SIP messages) for A-side and B-side
  const [l3Data, setL3Data] = useState<CallL3MessagesResponse | null>(null);
  const [l3DataBSide, setL3DataBSide] = useState<CallL3MessagesResponse | null>(null);
  const [deviceInfo, setDeviceInfo] = useState<CallDeviceInfo | null>(null);
  // LTE-only measurement/scanner comparison stats and raw scanner samples (used to cross-check UE vs scanner)
  const [lteMeasComp, setLteMeasComp] = useState<{ aSide: LteMeasurementStat[]; bSide: LteMeasurementStat[] } | null>(null);
  const [lteScannerComp, setLteScannerComp] = useState<{ aSide: LteScannerStat[]; bSide: LteScannerStat[] } | null>(null);
  const [scannerRawA, setScannerRawA] = useState<any[]>([]);
  const [scannerRawB, setScannerRawB] = useState<any[]>([]);
  const [gsmScannerRaw, setGsmScannerRaw] = useState<any[]>([]);
  const [gsmScannerRawB, setGsmScannerRawB] = useState<any[]>([]);
  const [gsmScannerBestRaw, setGsmScannerBestRaw] = useState<any[]>([]);
  const [lteScannerBestRaw, setLteScannerBestRaw] = useState<any[]>([]);
  const [nr5gScannerBestRaw, setNr5gScannerBestRaw] = useState<any[]>([]);
  // Κοινό 5G scanner (ίδιο serving CID με το κινητό) — μόνο A-side: NR rows υπάρχουν μόνο σε VoNR, A-side
  const [nr5gScannerRawA, setNr5gScannerRawA] = useState<any[]>([]);
  // NR γραμμές του κινητού (A-side) για ΚΑΘΕ κλήση που αγγίζει LTE/5G — όχι μόνο VoNR. Στον
  // πίνακα/καμπύλη μπαίνουν μόνο σε VoNR (radioValues)· εδώ χρειάζονται για το serving CID
  // του κοινού 5G scanner (π.χ. VoLTE με EN-DC, κλήσεις «-» σε 5G).
  const [nr5gUeRows, setNr5gUeRows] = useState<any[]>([]);
  const [callKpiTile, setCallKpiTile] = useState<CallKpiTile | null>(null);
  // SRVCC handover events (4G->3G/2G, success/fail + interruption time), technology
  // changes over the call (incl. CA carrier counts), and voice codec used per direction
  const [handoverInfo, setHandoverInfo] = useState<HandoverInfoRow[]>([]);
  const [srvccDetail, setSrvccDetail] = useState<SrvccDetailResponse | null>(null);
  const [srvccError, setSrvccError] = useState<string | null>(null);
  // CSFB: το ίδιο πράγμα για την πτώση LTE → 2G/3G. Δεν αρκεί το callMode της κλήσης για
  // να ξέρουμε αν υπάρχει — στα δεδομένα τα περισσότερα CSFB σκέλη κρέμονται από ζευγάρι
  // περασμένο VoLTE/CS/SRVCC (το ένα κινητό μιλάει VoLTE, το άλλο πέφτει σε 2G), οπότε το
  // endpoint καλείται πάντα και γυρίζει άδειο όταν δεν υπάρχει CSFB.
  const [csfbDetail, setCsfbDetail] = useState<CsfbDetailResponse | null>(null);
  const [csfbError, setCsfbError] = useState<string | null>(null);
  const [technologyTimeline, setTechnologyTimeline] = useState<TechnologyTimelineRow[]>([]);
  const [voiceCodec, setVoiceCodec] = useState<VoiceCodecRow[]>([]);
  // User-placed annotations during the session, merged into the TraceLog panel as timeline events
  const [markers, setMarkers] = useState<MarkerRow[]>([]);
  // Prev/Next call SessionIds για τα κουμπιά πλοήγησης (null → δεν υπάρχει → disabled)
  const [neighbors, setNeighbors] = useState<CallNeighbors | null>(null);
  const [loadErrors, setLoadErrors] = useState<string[]>([]);

  // Κλήσεις που ζουν σε δύο τεχνολογίες μαζί και χρειάζονται φορτωμένο το GSM σκέλος:
  // CS (μόνο GSM), SRVCC (LTE → GSM στη μέση της κλήσης) και CSFB (LTE → GSM για να
  // στηθεί η κλήση). Πριν, το CSFB δεν ήταν εδώ — η κλήση γινόταν εξ ολοκλήρου σε GSM
  // αλλά η σελίδα ζητούσε μόνο LTE, οπότε τα διαγράμματα ήταν σχεδόν άδεια.
  // Το isDualTechCall κρίνεται ΜΟΝΟ από το callMode: οδηγεί το αρχικό fetch, οπότε πρέπει
  // να είναι σταθερό. Το «βρήκαμε CSFB εκ των υστέρων» ζει χωριστά, στο showsGsmLeg.
  const isDualTechCall = callMode === "SRVCC" || callMode === "CSFB";
  // UNKNOWN: ούτε το callMode ούτε το technology λένε τι είναι — ζητάμε και τα δύο σκέλη
  const wantsGsmLeg = callMode === "CS" || isDualTechCall || callMode === "UNKNOWN";
  // Ένα CSFB σκέλος μπορεί να κρύβεται σε κλήση περασμένη VoLTE/CS (μόνο το ένα κινητό
  // έπεσε σε 2G). Μόλις το μάθουμε, το GSM σκέλος πρέπει να φαίνεται κι εκεί — αλλά χωρίς
  // να ξαναγυρίσει πίσω στο αρχικό fetch, γι' αυτό είναι ξεχωριστή μεταβλητή.
  // Μια CS κλήση ΔΕΝ σημαίνει «μόνο 2G»: σε CSFB τα κινητά κάθονται σε LTE και κατεβαίνουν
  // στο 2G μόνο για τη φωνή, οπότε το technology έρχεται "GSM/LTE" και το ένα από τα δύο
  // κινητά μπορεί να μην πάτησε ποτέ 2G. Χωρίς τα LTE δεδομένα η πλευρά εκείνη έβγαινε
  // εντελώς άδεια, ενώ η άλλη έδειχνε μόνο τα λίγα δευτερόλεπτα του GSM σκέλους.
  const csTouchesLte = callMode === "CS" && /LTE|4G|NR|5G/i.test(call.technology ?? "");
  const wantsLteLeg = callMode !== "CS" || csTouchesLte;
  const showsGsmLeg = isDualTechCall || callMode === "CS" || (csfbDetail?.events.length ?? 0) > 0
    || (callMode === "UNKNOWN" && gsmValues.length + bSideGsmValues.length > 0);
  // Ποιο σκέλος δείχνουν πίνακες/διάγραμμα. Ο χρήστης διαλέγει (srvccNetwork), αλλά η
  // επιλογή του ΔΕΝ μπορεί να σταθεί σε πλευρά που δεν έχει τέτοιες μετρήσεις: σε CSFB
  // συχνά μόνο το ένα κινητό κατεβαίνει σε 2G, οπότε εκεί πέφτουμε στο άλλο σκέλος αντί
  // να δείξουμε άδειο πίνακα. Το ίδιο το isGSMMode υπολογίζεται πιο κάτω, μόλις είναι
  // γνωστά τα δεδομένα κάθε πλευράς (βλ. sideHasGsm / sideHasLte).
  const sideHasGsm = (selectedLteSide === "B" ? bSideGsmValues : gsmValues).length > 0
    || (selectedLteSide === "B" ? gsmContextSignalBSide : gsmContextSignal).length > 0;
  const sideHasLte = (selectedLteSide === "B" ? bSideLteValues : radioValues).length > 0
    || (selectedLteSide === "B" ? contextSignalBSide : contextSignal).length > 0;
  const activeLeg: "LTE" | "GSM" = srvccNetwork === "GSM"
    ? (sideHasGsm || !sideHasLte ? "GSM" : "LTE")
    : (sideHasLte || !sideHasGsm ? "LTE" : "GSM");
  const isGSMMode = showsGsmLeg && activeLeg === "GSM";
  // Ο επιλογέας σκέλους βγαίνει μόνο όταν υπάρχουν όντως ΚΑΙ τα δύο σκέλη (σε οποιαδήποτε
  // πλευρά)· σε καθαρά 2G κλήση θα ήταν ένα κουμπί που δεν αλλάζει τίποτα.
  const canToggleLeg = showsGsmLeg
    && gsmValues.length + bSideGsmValues.length > 0
    && radioValues.length + bSideLteValues.length > 0;
  // True for calls that touch the 5G NR core (VoNR, VoNR/VoLTE, VoNR/VoLTE N26 HO): these need
  // FactNR5GRadio on top of (or instead of) the LTE anchor, since the LTE-only query can come back
  // empty/partial once the UE is camped on NR. Rows from both are merged chronologically below.
  const isVoNRMode = /VoNR/i.test(callMode ?? "");
  const [isLoadingRadio, setIsLoadingRadio] = useState(false);
  // SRVCC Transition chart: ίδια λογική σειρών/κατωφλίων με το κύριο RSRP/RxLev διάγραμμα,
  // αλλά με δικά του toggles ώστε να μη «μολύνεται» η κύρια προβολή της κλήσης.
  // "all" = ολόκληρη η κλήση (default), αλλιώς ±N δευτερόλεπτα γύρω από τα SRVCC events
  const [srvccWindowSec, setSrvccWindowSec] = useState<number | "all">("all");
  const [srvccShowStrength, setSrvccShowStrength] = useState(true);
  const [srvccShowQuality, setSrvccShowQuality] = useState(false);
  const [srvccShowSinr, setSrvccShowSinr] = useState(false);
  const [srvccShowThresholds, setSrvccShowThresholds] = useState(true);
  const [srvccShowDots, setSrvccShowDots] = useState(false);
  // Editable free-text comment attached to the call
  const [commentText, setCommentText] = useState(call.comment || "");
  const [isEditingComment, setIsEditingComment] = useState(false);
  const [isSavingComment, setIsSavingComment] = useState(false);
  const { toast } = useToast();
  // Ένας κοινός cursor για ΟΛΗ τη σελίδα: το absolute timestamp (epoch ms) κάτω από το
  // ποντίκι, από όποιον πίνακα/λωρίδα/ταμπέλα κι αν προέρχεται. Το διάγραμμα δείχνει εκεί
  // την κάθετη γραμμή και οι πίνακες φωτίζουν τη γραμμή τους — και προς τις δύο κατευθύνσεις.
  const [hoveredTime, setHoveredTimeValue] = useState<number | null>(null);
  // Από ποια πλευρά ήρθε η ώρα του cursor. null = από τα στοιχεία της πλευράς που δείχνει
  // ήδη η σελίδα (πίνακες/λωρίδες/χάρτης), οπότε το σημάδι στο διάγραμμα είναι ακριβώς η
  // ίδια μέτρηση. Στο split L3 view ο πίνακας του B-side δίνει "B" ενώ η καμπύλη μπορεί να
  // είναι A-side: εκεί η ώρα ταιριάζει, η μέτρηση όχι.
  const [hoveredSide, setHoveredSide] = useState<"A" | "B" | null>(null);
  const setHoveredTime = useCallback((time: number | null, side?: "A" | "B" | null) => {
    setHoveredTimeValue(time);
    setHoveredSide(time == null ? null : side ?? null);
  }, []);
  // Καρφιτσωμένο διάγραμμα: μένει ορατό στην κορυφή όσο κυλάς τους πίνακες από κάτω.
  const [chartPinned, setChartPinned] = useState(true);
  // Όσο είναι καρφιτσωμένο, το ύψος του δημοσιεύεται ως CSS variable (ίδιο μοτίβο με το
  // --app-header-height): οι πίνακες L3 από κάτω κόβουν το δικό τους ύψος με βάση αυτό,
  // ώστε διάγραμμα + πίνακες να χωρούν μαζί στην οθόνη χωρίς να ξεφεύγουν κάτω από το fold.
  const chartWrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = document.documentElement;
    const element = chartWrapRef.current;
    // Ξεκαρφίτσωτο = δεν κλέβει ύψος από τους πίνακες, οπότε η μεταβλητή μηδενίζεται.
    if (!element || !chartPinned) {
      root.style.setProperty("--pinned-chart-height", "0px");
      return;
    }
    const publish = () =>
      root.style.setProperty("--pinned-chart-height", `${Math.round(element.getBoundingClientRect().height)}px`);
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(element);
    return () => {
      observer.disconnect();
      root.style.setProperty("--pinned-chart-height", "0px");
    };
  }, [chartPinned]);
  // Ο χάρτης της κλήσης σε μεγάλο popup — ο μικρός της κάρτας δεν φτάνει για να διαβάσεις
  // διαδρομή και θέση κεραίας μαζί.
  const [mapDialogOpen, setMapDialogOpen] = useState(false);
  // Ο ενσωματωμένος χάρτης είναι κλειστός εξ ορισμού: τρώει 250px ύψος σε κάθε κλήση, ενώ
  // χρειάζεται μόνο περιστασιακά. Η επιλογή κρατιέται, ώστε όποιος τον θέλει ανοιχτό να
  // μην τον ξανανοίγει σε κάθε κλήση.
  const [mapOpen, setMapOpen] = useLocalStorage<boolean>("call-detail-map-open", false);
  // Το ίδιο και για το SRVCC Transition: το panel είναι ψηλό (διάγραμμα + στατιστικά +
  // source/target), ενώ τις περισσότερες φορές αρκεί η μία γραμμή με την έκβαση.
  const [srvccOpen, setSrvccOpen] = useLocalStorage<boolean>("call-detail-srvcc-open", false);
  const [csfbOpen, setCsfbOpen] = useLocalStorage<boolean>("call-detail-csfb-open", false);
  const hoverIso = (iso: string | null | undefined) => {
    const t = toTimestamp(iso);
    setHoveredTime(Number.isFinite(t) ? t : null);
  };




  // Persists the comment textarea to the backend and updates the in-memory call record so the
  // header reflects the new text immediately without a refetch.
  const handleSaveComment = async () => {
    setIsSavingComment(true);
    try {
      await updateCallComment(database, call.callId, commentText);
      call.comment = commentText; // Mutate local state inline to keep consistent
      setIsEditingComment(false);
      toast({
        title: "Επιτυχία",
        description: "Το σχόλιο αποθηκεύτηκε.",
      });
    } catch (err: any) {
      console.error(err);
      toast({
        title: "Σφάλμα",
        description: "Πρόβλημα κατά την αποθήκευση του σχολίου.",
        variant: "destructive",
      });
    } finally {
      setIsSavingComment(false);
    }
  };

  // Main data-load effect: fires whenever the selected call changes. Fetches every panel's data
  // in parallel with Promise.allSettled so that one failing endpoint doesn't block the rest of
  // the page from rendering. Several fetches are skipped (replaced with an already-resolved empty
  // value) based on callMode, since GSM-only calls have no LTE data and vice versa:
  //   - callMode === "CS"            → circuit-switched (GSM only)
  //   - callMode === "SRVCC"         → starts LTE, handed over to GSM (both fetched)
  //   - anything else                → LTE only
  useEffect(() => {
    // Γρήγορο Prev/Next: οι απαντήσεις της προηγούμενης κλήσης δεν πρέπει να γράψουν πάνω στη νέα
    let cancelled = false;
    async function loadRadio() {
      setIsLoadingRadio(true);
      try {
        const [lteRes, gsmRes, nr5gRes, mosRes, kpiRes, comparisonRes, bSideLteRes, tracelogRes, bSideGsmRes, cellInfoRes, bSideCellInfoRes, pagingRes, pagingBSideRes, deviceRes, lteMeasCompRes, lteScannerCompRes, callKpiTileRes, handoverInfoRes, technologyTimelineRes, voiceCodecRes, markersRes, srvccDetailRes, csfbDetailRes] = await Promise.allSettled([
          wantsLteLeg ? fetchLteValues(database, call.callId) : Promise.resolve({ lteValues: [] }),
          wantsGsmLeg ? fetchGsmValues(database, call.callId) : Promise.resolve({ gsmValues: [] }),
          // Κάθε κλήση που αγγίζει LTE/5G (VoNR ⇒ wantsLteLeg): οι NR γραμμές δίνουν το serving CID του 5G scanner
          wantsLteLeg ? fetchNr5gValues(database, call.callId) : Promise.resolve({ nr5gValues: [] }),
          fetchMosValues(database, call.callId),
          fetchKpiValues(database, call.callId),
          fetchCallSideComparison(database, call.callId),
          wantsLteLeg ? fetchLteValuesBSide(database, call.callId) : Promise.resolve({ lteValuesBSide: [] }),
          fetchTracelogValues(database, call.callId),
          wantsGsmLeg ? fetchGsmValuesBSide(database, call.callId) : Promise.resolve({ gsmValuesBSide: [] }),
          wantsLteLeg ? fetchCellInfo(database, call.callId) : Promise.resolve({ eNBId: null, EARFCN: null, PCI: null }),
          wantsLteLeg ? fetchCellInfoBSide(database, call.callId) : Promise.resolve({ eNBId: null, EARFCN: null, PCI: null }),
          fetchL3Messages(database, call.callId, { side: "A" }),
          fetchL3Messages(database, call.callId, { side: "B" }),
          fetchCallDeviceInfo(database, call.callId),
          wantsLteLeg ? fetchLteMeasurementComparison(database, call.callId) : Promise.resolve({ aSide: [], bSide: [] }),
          wantsLteLeg ? fetchLteScannerMeasurement(database, call.callId) : Promise.resolve({ aSide: [], bSide: [] }),
          fetchCallKpiTile(database, call.callId),
          fetchHandoverInfo(database, call.callId),
          fetchTechnologyTimeline(database, call.callId),
          fetchVoiceCodec(database, call.callId),
          fetchMarkers(database, call.callId),
          callMode === "SRVCC"
            ? fetchCallSrvccDetail(database, call.callId)
            : Promise.resolve({ events: [], technology: [] } as SrvccDetailResponse),
          // Πάντα: το callMode της κλήσης δεν προδίδει ένα CSFB σκέλος στην άλλη πλευρά.
          fetchCallCsfbDetail(database, call.callId),
        ]);
        if (cancelled) return;

        const namedResults: Array<[string, PromiseSettledResult<unknown>]> = [
          ["LTE radio", lteRes], ["GSM radio", gsmRes], ["NR5G radio", nr5gRes], ["MOS", mosRes], ["KPI", kpiRes],
          ["A/B outcome", comparisonRes], ["B-side LTE", bSideLteRes], ["TraceLog", tracelogRes],
          ["B-side GSM", bSideGsmRes],
          ["L3 A-side", pagingRes], ["L3 B-side", pagingBSideRes], ["Device", deviceRes],
          ["UE comparison", lteMeasCompRes], ["Scanner comparison", lteScannerCompRes],
          ["KPI tiles", callKpiTileRes], ["Handover", handoverInfoRes], ["Technology timeline", technologyTimelineRes],
          ["Voice codec", voiceCodecRes], ["Markers", markersRes], ["SRVCC", srvccDetailRes],
          ["CSFB", csfbDetailRes],
        ];
        setLoadErrors(namedResults.flatMap(([name, result]) => result.status === "rejected" ? [name] : []));

        setNr5gUeRows(nr5gRes.status === "fulfilled" ? ((nr5gRes.value as any).nr5gValues || []) : []);

        // UNKNOWN («-» χωρίς technology): φορτώνονται όλα, οπότε και οι NR γραμμές μπαίνουν στον
        // πίνακα/καμπύλη δίπλα στις LTE — αλλιώς ένα 5G σκέλος θα έμενε αόρατο.
        if (isVoNRMode || callMode === "UNKNOWN") {
          // VoNR / VoNR-VoLTE N26 HO: the UE hops between the LTE anchor and standalone NR
          // mid-call, so neither query alone tells the full story — merge both row sets (whichever
          // succeeded) into one chronological series (tagged by Technology) for the radio chart/table.
          const lteRows = lteRes.status === "fulfilled" ? ((lteRes.value as any).lteValues || []) : [];
          const nr5gRows = nr5gRes.status === "fulfilled" ? ((nr5gRes.value as any).nr5gValues || []) : [];
          const merged = [
            ...lteRows.map((row: any) => ({ ...row, Technology: "LTE" })),
            ...nr5gRows.map((row: any) => ({ ...row, Technology: "NR5G" })),
          ].sort((a, b) => new Date(a.MsgTime).getTime() - new Date(b.MsgTime).getTime());
          setRadioValues(merged);
        } else {
          // Σε αποτυχία άδειο (το banner loadErrors το δείχνει) — όχι τα δεδομένα της προηγούμενης κλήσης
          setRadioValues(lteRes.status === "fulfilled" ? ((lteRes.value as any).lteValues || []) : []);
        }

        setGsmValues(gsmRes.status === "fulfilled" ? ((gsmRes.value as any).gsmValues || []) : []);
        setMosValues(mosRes.status === "fulfilled" ? (mosRes.value.mosValues || []) : []);
        setKpiValues(kpiRes.status === "fulfilled" ? (kpiRes.value.kpiValues || []) : []);
        // Νέα κλήση → το ανοιχτό detail της προηγούμενης δεν αφορά αυτά τα δεδομένα
        setExpandedKpiRow(null);

        if (comparisonRes.status === "fulfilled") {
          setSideComparison(comparisonRes.value.comparison || []);
        } else {
          setSideComparison([]);
        }

        if (bSideLteRes.status === "fulfilled") {
          setBSideLteValues((bSideLteRes.value as any).lteValuesBSide || []);
        } else {
          setBSideLteValues([]);
        }

        if (bSideGsmRes.status === "fulfilled") {
          setBSideGsmValues((bSideGsmRes.value as any).gsmValuesBSide || []);
        } else {
          setBSideGsmValues([]);
        }

        if (tracelogRes.status === "fulfilled") {
          setTracelogValues(tracelogRes.value.tracelogValues || []);
        } else {
          setTracelogValues([]);
        }

        setCellInfo(cellInfoRes.status === "fulfilled" ? (cellInfoRes.value as any) : null);
        setBSideCellInfo(bSideCellInfoRes.status === "fulfilled" ? (bSideCellInfoRes.value as any) : null);

        if (pagingRes.status === "fulfilled") {
          setL3Data(pagingRes.value as CallL3MessagesResponse);
        } else {
          setL3Data(null);
        }

        if (pagingBSideRes.status === "fulfilled") {
          setL3DataBSide(pagingBSideRes.value as CallL3MessagesResponse);
        } else {
          setL3DataBSide(null);
        }

        if (deviceRes.status === "fulfilled") {
          setDeviceInfo(deviceRes.value as CallDeviceInfo);
        } else {
          setDeviceInfo(null);
        }

        if (lteMeasCompRes.status === "fulfilled") {
          setLteMeasComp(lteMeasCompRes.value as any);
        } else {
          setLteMeasComp(null);
        }

        if (lteScannerCompRes.status === "fulfilled") {
          setLteScannerComp(lteScannerCompRes.value as any);
        } else {
          setLteScannerComp(null);
        }

        if (callKpiTileRes.status === "fulfilled") {
          setCallKpiTile(callKpiTileRes.value as CallKpiTile);
        } else {
          setCallKpiTile(null);
        }

        if (handoverInfoRes.status === "fulfilled") {
          setHandoverInfo((handoverInfoRes.value as any).handoverInfo || []);
        } else {
          setHandoverInfo([]);
        }

        if (technologyTimelineRes.status === "fulfilled") {
          setTechnologyTimeline((technologyTimelineRes.value as any).technologyTimeline || []);
        } else {
          setTechnologyTimeline([]);
        }

        if (voiceCodecRes.status === "fulfilled") {
          setVoiceCodec((voiceCodecRes.value as any).voiceCodec || []);
        } else {
          setVoiceCodec([]);
        }

        if (markersRes.status === "fulfilled") {
          setMarkers((markersRes.value as any).markers || []);
        } else {
          setMarkers([]);
        }

        if (srvccDetailRes.status === "fulfilled") {
          const detail = srvccDetailRes.value as SrvccDetailResponse;
          setSrvccDetail(detail);
          if (detail.events.length > 0 && !detail.events.some((event) => (event.Side ?? "A") === "A")) {
            const firstSide = detail.events[0].Side;
            if (firstSide === "A" || firstSide === "B") setSelectedLteSide(firstSide);
          }
          setSrvccError(null);
        } else {
          setSrvccDetail(null);
          setSrvccError(callMode === "SRVCC" ? "Αποτυχία φόρτωσης των SRVCC diagnostics." : null);
        }

        if (csfbDetailRes.status === "fulfilled") {
          const detail = csfbDetailRes.value as CsfbDetailResponse;
          setCsfbDetail(detail);
          setCsfbError(null);
        } else {
          setCsfbDetail(null);
          // Μήνυμα λάθους μόνο όταν η κλήση ΕΙΝΑΙ CSFB· αλλιώς το panel απλώς δεν εμφανίζεται.
          setCsfbError(callMode === "CSFB" ? "Αποτυχία φόρτωσης των CSFB diagnostics." : null);
        }
      } catch (err) {
        console.error("Failed to load metrics", err);
      } finally {
        // Μια ακυρωμένη φόρτωση δεν σβήνει το «loading» της νέας που τρέχει ήδη
        if (!cancelled) setIsLoadingRadio(false);
      }
    }
    // Reset all UI selections and stale data back to defaults before loading the newly selected call
    if (call.callId && database) {
      setCommentText(call.comment || "");
      setIsEditingComment(false);
      setSelectedLteSide("A");
      setSrvccNetwork(callMode === "CS" ? "GSM" : "LTE");
      setLteMeasComp(null);
      setLteScannerComp(null);
      setScannerRawA([]);
      setScannerRawB([]);
      setGsmScannerRaw([]);
      setGsmScannerRawB([]);
      setGsmScannerBestRaw([]);
      setLteScannerBestRaw([]);
      setNr5gScannerBestRaw([]);
      setNr5gScannerRawA([]);
      setNr5gUeRows([]);
      setCallKpiTile(null);
      setSrvccDetail(null);
      setSrvccError(null);
      setCsfbDetail(null);
      setCsfbError(null);
      setLoadErrors([]);
      setSelectedLteSide("A");
      loadRadio();
    }
    return () => { cancelled = true; };
  }, [database, call.callId, callMode, wantsGsmLeg, wantsLteLeg]);

  // Ένα CSFB σκέλος μπορεί να κρέμεται από κλήση περασμένη VoLTE/CS: το ένα κινητό μιλάει
  // VoLTE και το άλλο πέφτει σε 2G για να απαντήσει. Σε αυτές τις κλήσεις το GSM σκέλος δεν
  // ζητήθηκε στο αρχικό φόρτωμα (το callMode δεν το πρόδιδε), οπότε το φέρνουμε συμπληρωματικά
  // μόλις το /api/call_csfb_detail πει ότι υπάρχει — αλλιώς το panel θα έδειχνε μισή καμπύλη.
  useEffect(() => {
    if (wantsGsmLeg) return;
    const sides = new Set((csfbDetail?.events ?? []).map((event) => (event.Side === "B" ? "B" : "A")));
    if (sides.size === 0 || !call.callId || !database) return;
    let cancelled = false;
    (async () => {
      const [aRes, bRes] = await Promise.allSettled([
        sides.has("A") ? fetchGsmValues(database, call.callId) : Promise.resolve({ gsmValues: [] }),
        sides.has("B") ? fetchGsmValuesBSide(database, call.callId) : Promise.resolve({ gsmValuesBSide: [] }),
      ]);
      if (cancelled) return;
      if (aRes.status === "fulfilled") setGsmValues(aRes.value.gsmValues || []);
      if (bRes.status === "fulfilled") setBSideGsmValues(bRes.value.gsmValuesBSide || []);
    })();
    return () => { cancelled = true; };
  }, [csfbDetail, wantsGsmLeg, database, call.callId]);

  // Prev/Next call: ρωτάμε το backend ποιο SessionId είναι η προηγούμενη/επόμενη κλήση
  // (στόχος ±2, σειριακός έλεγχος και του ±1) — null σημαίνει δεν υπάρχει → disabled κουμπί
  useEffect(() => {
    setNeighbors(null);
    if (!call.callId || !database) return;
    fetchCallNeighbors(database, String(call.callId))
      .then(setNeighbors)
      .catch(() => setNeighbors(null));
  }, [database, call.callId]);

  // For LTE calls (A-side), fetch LTE scanner samples per contiguous serving-CGI segment so the
  // "LTE Scanner" chart line / "RSRP Scanner" column can cross-check the UE's own measurements
  // against the scanner — same per-segment approach as the GSM fetch below.
  useEffect(() => {
    if (!wantsLteLeg || radioValues.length === 0 || !database) {
      setScannerRawA([]);
      return;
    }

    type Segment = { cgi: string; start: string; end: string };
    const segments: Segment[] = [];
    for (const v of radioValues) {
      // Σε VoNR το radioValues έχει και NR rows· αυτά πάνε στο 5G scanner παρακάτω
      if (v.Technology === "NR5G" || !v.CGI || !v.MsgTime) continue;
      const last = segments[segments.length - 1];
      if (last && last.cgi === v.CGI) {
        last.end = v.MsgTime;
      } else {
        segments.push({ cgi: v.CGI, start: v.MsgTime, end: v.MsgTime });
      }
    }
    if (segments.length === 0) { setScannerRawA([]); return; }

    let cancelled = false;
    Promise.all(
      segments.map((seg, i) => fetchLteScannerRaw(database, seg.cgi, seg.start, seg.end, edgeSegmentPad(i, segments.length)).catch(() => []))
    ).then(results => {
      if (!cancelled) setScannerRawA(results.flat());
    });
    return () => { cancelled = true; };
  }, [database, wantsLteLeg, radioValues]);

  // Same as above, but for the B-side (second leg) of the call.
  useEffect(() => {
    if (!wantsLteLeg || bSideLteValues.length === 0 || !database) {
      setScannerRawB([]);
      return;
    }

    type Segment = { cgi: string; start: string; end: string };
    const segments: Segment[] = [];
    for (const v of bSideLteValues) {
      if (!v.CGI || !v.MsgTime) continue;
      const last = segments[segments.length - 1];
      if (last && last.cgi === v.CGI) {
        last.end = v.MsgTime;
      } else {
        segments.push({ cgi: v.CGI, start: v.MsgTime, end: v.MsgTime });
      }
    }
    if (segments.length === 0) { setScannerRawB([]); return; }

    let cancelled = false;
    Promise.all(
      segments.map((seg, i) => fetchLteScannerRaw(database, seg.cgi, seg.start, seg.end, edgeSegmentPad(i, segments.length)).catch(() => []))
    ).then(results => {
      if (!cancelled) setScannerRawB(results.flat());
    });
    return () => { cancelled = true; };
  }, [database, wantsLteLeg, bSideLteValues]);

  // For GSM-capable calls, fetch A-side scanner samples per contiguous serving-cell segment so the
  // "RxLev Scanner" column can cross-check the UE's own measurements against the scanner.
  useEffect(() => {
    // Όχι wantsGsmLeg: σε CSFB που ανακαλύπτεται εκ των υστέρων (VoLTE / «-» σε LTE) τα gsmValues
    // έρχονται αργότερα χωρίς να αλλάξει το wantsGsmLeg — αρκεί να υπάρχουν GSM μετρήσεις.
    if (gsmValues.length === 0 || !database) {
      setGsmScannerRaw([]);
      return;
    }

    // gsmValues is ordered by MsgTime — split it into contiguous runs of the
    // same CGI (handover segments) and pull scanner data per segment, since
    // the serving CGI can change several times within a single call.
    type Segment = { cgi: string; start: string; end: string };
    const segments: Segment[] = [];
    for (const v of gsmValues) {
      if (!v.CGI || !v.MsgTime) continue;
      const last = segments[segments.length - 1];
      if (last && last.cgi === v.CGI) {
        last.end = v.MsgTime;
      } else {
        segments.push({ cgi: v.CGI, start: v.MsgTime, end: v.MsgTime });
      }
    }
    if (segments.length === 0) { setGsmScannerRaw([]); return; }

    let cancelled = false;
    Promise.all(
      segments.map((seg, i) => fetchGsmScannerRaw(database, seg.cgi, seg.start, seg.end, edgeSegmentPad(i, segments.length)).catch(() => []))
    ).then(results => {
      if (!cancelled) setGsmScannerRaw(results.flat());
    });
    return () => { cancelled = true; };
  }, [database, gsmValues]);

  // B-side GSM scanner data is fetched independently; it never falls back to A-side samples.
  useEffect(() => {
    if (bSideGsmValues.length === 0 || !database) {
      setGsmScannerRawB([]);
      return;
    }
    type Segment = { cgi: string; start: string; end: string };
    const segments: Segment[] = [];
    for (const value of bSideGsmValues) {
      if (!value.CGI || !value.MsgTime) continue;
      const last = segments[segments.length - 1];
      if (last && last.cgi === value.CGI) last.end = value.MsgTime;
      else segments.push({ cgi: value.CGI, start: value.MsgTime, end: value.MsgTime });
    }
    if (segments.length === 0) { setGsmScannerRawB([]); return; }
    let cancelled = false;
    Promise.all(segments.map((segment, i) => fetchGsmScannerRaw(database, segment.cgi, segment.start, segment.end, edgeSegmentPad(i, segments.length)).catch(() => [])))
      .then((results) => { if (!cancelled) setGsmScannerRawB(results.flat()); });
    return () => { cancelled = true; };
  }, [database, bSideGsmValues]);

  // "Best RxLev Scanner" — the strongest cell the scanner saw for the call's own operator at
  // each scan cycle (DmnIdTopN_RxLev_Operator = 1), independent of the UE's serving CGI. Fetched
  // once over the whole call window (resolved server-side from SessionId — call.operator is
  // hardcoded to "N/A" for real calls, and call.startTime/endTime are lossy JS Date round-trips).
  // showsGsmLeg: και όταν το GSM σκέλος εμφανίστηκε εκ των υστέρων (CSFB σε VoLTE / «-»). Ένα
  // boolean στα deps, ώστε όταν ήδη wantsGsmLeg το showsGsmLeg false→true να μην ξαναζητά.
  const wantsGsmBest = wantsGsmLeg || showsGsmLeg;
  useEffect(() => {
    if (!wantsGsmBest || !database || !call.callId) {
      setGsmScannerBestRaw([]);
      return;
    }
    let cancelled = false;
    fetchGsmScannerBest(database, call.callId, CONTEXT_FETCH_WINDOW_SEC)
      .then(rows => { if (!cancelled) setGsmScannerBestRaw(rows); })
      .catch(() => { if (!cancelled) setGsmScannerBestRaw([]); });
    return () => { cancelled = true; };
  }, [database, wantsGsmBest, call.callId]);

  // "Best LTE Scanner" — same idea as the GSM one above, but for FactLTEScanner
  // (DmnIdTopN_RSRP_Operator = 1), independent of the UE's serving EARFCN/PCI.
  useEffect(() => {
    if (!wantsLteLeg || !database || !call.callId) {
      setLteScannerBestRaw([]);
      return;
    }
    let cancelled = false;
    fetchLteScannerBest(database, call.callId, CONTEXT_FETCH_WINDOW_SEC)
      .then(rows => { if (!cancelled) setLteScannerBestRaw(rows); })
      .catch(() => { if (!cancelled) setLteScannerBestRaw([]); });
    return () => { cancelled = true; };
  }, [database, wantsLteLeg, call.callId]);

  // Κοινό 5G scanner: οι NR γραμμές του κινητού (σε κάθε κλήση με 5G, όχι μόνο VoNR) χωρίζονται
  // σε συνεχόμενα τμήματα ίδιας serving κυψέλης και ζητείται το FactNR5GScannerBeam ανά τμήμα — όπως
  // το LTE ανά CGI. Κυψέλη = CID (DmnCellInformation) ή, όταν λείπει, NR-ARFCN + PCI (nrServingCell).
  useEffect(() => {
    const nrRows = nr5gUeRows;
    if (nrRows.length === 0 || !database) {
      setNr5gScannerRawA([]);
      return;
    }
    type Segment = { key: string; cell: Nr5gCell; start: string; end: string };
    const segments: Segment[] = [];
    for (const v of nrRows) {
      const serving = nrServingCell(v);
      if (!serving || !v.MsgTime) continue;
      const last = segments[segments.length - 1];
      if (last && last.key === serving.key) last.end = v.MsgTime;
      else segments.push({ ...serving, start: v.MsgTime, end: v.MsgTime });
    }
    if (segments.length === 0) { setNr5gScannerRawA([]); return; }
    let cancelled = false;
    Promise.all(segments.map((seg, i) => fetchNr5gScannerRaw(database, seg.cell, seg.start, seg.end, edgeSegmentPad(i, segments.length)).catch(() => [])))
      .then((results) => { if (!cancelled) setNr5gScannerRawA(results.flat()); });
    return () => { cancelled = true; };
  }, [database, nr5gUeRows]);

  // "Best 5G scanner" — FactNR5GScannerBeam, Top 1 SS-RSRP του operator, όπως το LTE best.
  // Μόνο όταν η κλήση άγγιξε ΟΝΤΩΣ 5G (NR γραμμές κινητού ή NR context): αλλιώς μια καθαρή LTE
  // κλήση έδειχνε «Best 5G scanner» επειδή ο operator έχει 5G στην περιοχή. Boolean στα deps →
  // ένα fetch όταν γίνει true.
  const callTouchesNr = nr5gUeRows.length > 0 || nr5gContextSignal.length > 0 || nr5gContextSignalBSide.length > 0;
  useEffect(() => {
    if (!wantsLteLeg || !callTouchesNr || !database || !call.callId) {
      setNr5gScannerBestRaw([]);
      return;
    }
    let cancelled = false;
    fetchNr5gScannerBest(database, call.callId, CONTEXT_FETCH_WINDOW_SEC)
      .then(rows => { if (!cancelled) setNr5gScannerBestRaw(rows); })
      .catch(() => { if (!cancelled) setNr5gScannerBestRaw([]); });
    return () => { cancelled = true; };
  }, [database, wantsLteLeg, callTouchesNr, call.callId]);

  // Το context «πριν/κατά/μετά» (9 endpoints) φέρνεται ΜΙΑ φορά ανά κλήση, στο μέγιστο παράθυρο
  // CONTEXT_FETCH_WINDOW_SEC. Το ±Ns του χρήστη (viewWindowSec) ΔΕΝ είναι στα deps: κόβεται
  // client-side στο viewRange παρακάτω. Ο μόνος ιδιοκτήτης αυτού του state είναι αυτό το effect.
  useEffect(() => {
    if (!call.callId || !database) return;
    let cancelled = false;
    // Καθαρισμός πριν το fetch, ώστε να μη φαίνεται για λίγο το context της προηγούμενης κλήσης
    setContextSignal([]);
    setContextSignalBSide([]);
    setGsmContextSignal([]);
    setGsmContextSignalBSide([]);
    setNr5gContextSignal([]);
    setNr5gContextSignalBSide([]);
    setContextTechnology([]);
    setTechPeriods([]);
    setTechPeriodsBSide([]);
    setContextLoadErrors([]);
    async function loadContext() {
      const windowSec = CONTEXT_FETCH_WINDOW_SEC;
      const [ctxRes, ctxTechRes, gsmCtxRes, ctxBRes, gsmCtxBRes, nrCtxRes, nrCtxBRes, techPerRes, techPerBRes] = await Promise.allSettled([
        wantsLteLeg ? fetchCallContextSignal(database, call.callId, windowSec) : Promise.resolve({ signal: [] }),
        fetchCallContextTechnology(database, call.callId, windowSec),
        wantsGsmLeg ? fetchGsmContextSignal(database, call.callId, windowSec) : Promise.resolve({ signal: [] }),
        wantsLteLeg ? fetchCallContextSignalBSide(database, call.callId, windowSec) : Promise.resolve({ signal: [] }),
        wantsGsmLeg ? fetchGsmContextSignalBSide(database, call.callId, windowSec) : Promise.resolve({ signal: [] }),
        // Όχι μόνο σε VoNR: μια VoLTE κλήση με EN-DC (5G NSA πάνω σε LTE anchor) έχει κι αυτή
        // γραμμές στο FactNR5GRadio, και το NR σκέλος της αξίζει να φαίνεται στην καμπύλη.
        // Ίδιο κριτήριο με NR values / 5G scanner: σε CS μόνο αν η κλήση αγγίζει LTE/5G.
        wantsLteLeg ? fetchNr5gContextSignal(database, call.callId, windowSec) : Promise.resolve({ signal: [] }),
        wantsLteLeg ? fetchNr5gContextSignalBSide(database, call.callId, windowSec) : Promise.resolve({ signal: [] }),
        fetchTechnologyPeriods(database, call.callId, windowSec, "A"),
        fetchTechnologyPeriods(database, call.callId, windowSec, "B"),
      ]);
      // Άλλαξε κλήση όσο περιμέναμε — αυτές οι απαντήσεις αφορούν την προηγούμενη
      if (cancelled) return;
      const signalOf = (res: PromiseSettledResult<unknown>) =>
        res.status === "fulfilled" ? ((res.value as any).signal || []) : [];
      setContextSignal(signalOf(ctxRes));
      setContextTechnology(ctxTechRes.status === "fulfilled" ? ((ctxTechRes.value as any).technology || []) : []);
      setGsmContextSignal(signalOf(gsmCtxRes));
      setContextSignalBSide(signalOf(ctxBRes));
      setGsmContextSignalBSide(signalOf(gsmCtxBRes));
      setNr5gContextSignal(signalOf(nrCtxRes));
      setNr5gContextSignalBSide(signalOf(nrCtxBRes));
      setTechPeriods(techPerRes.status === "fulfilled" ? ((techPerRes.value as { periods?: TechnologyPeriodRow[] }).periods || []) : []);
      setTechPeriodsBSide(techPerBRes.status === "fulfilled" ? ((techPerBRes.value as { periods?: TechnologyPeriodRow[] }).periods || []) : []);
      const named: Array<[string, PromiseSettledResult<unknown>]> = [
        ["LTE context", ctxRes], ["Technology context", ctxTechRes], ["GSM context", gsmCtxRes],
        ["B-side LTE context", ctxBRes], ["B-side GSM context", gsmCtxBRes],
        ["NR context", nrCtxRes], ["B-side NR context", nrCtxBRes],
        ["Technology periods", techPerRes], ["B-side technology periods", techPerBRes],
      ];
      setContextLoadErrors(named.flatMap(([name, result]) => result.status === "rejected" ? [name] : []));
    }
    loadContext();
    return () => { cancelled = true; };
  }, [call.callId, database, callMode, wantsGsmLeg, wantsLteLeg]);

  // Cosmote Free only: match the A-side serving cell (by PCI) to the physical antenna closest
  // to the call's average GPS position, since PCI alone can be reused by several sites.
  useEffect(() => {
    const isCosmoteFree = call.region?.toLowerCase().includes("cosmote free");
    if (!isCosmoteFree || !cellInfo || cellInfo.PCI === null) {
      setMatchedAntenna(null);
      return;
    }
    const gpsPoints = radioValues
      .filter((v: any) => v.Latitude != null && v.Longitude != null)
      .map((v: any) => ({ lat: Number(v.Latitude), lon: Number(v.Longitude) }));
    if (gpsPoints.length === 0) { setMatchedAntenna(null); return; }
    const avgLat = gpsPoints.reduce((s: number, p: any) => s + p.lat, 0) / gpsPoints.length;
    const avgLon = gpsPoints.reduce((s: number, p: any) => s + p.lon, 0) / gpsPoints.length;
    fetchAntennas().then(({ antennas }) => {
      const matches = rankAntennaMatches(antennas, cellInfo.eNBId, cellInfo.EARFCN, cellInfo.PCI);
      if (matches.length === 0) { setMatchedAntenna(null); return; }
      let best = matches[0];
      let bestDist = haversineM(avgLat, avgLon, best.lat, best.lon);
      for (const ant of matches.slice(1)) {
        const d = haversineM(avgLat, avgLon, ant.lat, ant.lon);
        if (d < bestDist) { bestDist = d; best = ant; }
      }
      setMatchedAntenna({ lat: best.lat, lon: best.lon, cellName: best.cellName, distanceM: bestDist, azimuth: best.azimuth, freq: best.freq, vendor: best.vendor, enbName: best.enbName, tech: best.tech, height: best.height, downtilt: best.downtilt, siteId: best.siteId, cellId: best.cellId });
    }).catch(() => setMatchedAntenna(null));
  }, [cellInfo, radioValues, call.region]);

  // Same antenna-matching logic as above, but for the B-side (second leg) of the call
  useEffect(() => {
    const isCosmoteFree = call.region?.toLowerCase().includes("cosmote free");
    if (!isCosmoteFree || !bSideCellInfo || bSideCellInfo.PCI === null) {
      setMatchedAntennaBSide(null);
      return;
    }
    const gpsPoints = bSideLteValues
      .filter((v: any) => v.Latitude != null && v.Longitude != null)
      .map((v: any) => ({ lat: Number(v.Latitude), lon: Number(v.Longitude) }));
    if (gpsPoints.length === 0) { setMatchedAntennaBSide(null); return; }
    const avgLat = gpsPoints.reduce((s: number, p: any) => s + p.lat, 0) / gpsPoints.length;
    const avgLon = gpsPoints.reduce((s: number, p: any) => s + p.lon, 0) / gpsPoints.length;
    fetchAntennas().then(({ antennas }) => {
      const matches = rankAntennaMatches(antennas, bSideCellInfo.eNBId, bSideCellInfo.EARFCN, bSideCellInfo.PCI);
      if (matches.length === 0) { setMatchedAntennaBSide(null); return; }
      let best = matches[0];
      let bestDist = haversineM(avgLat, avgLon, best.lat, best.lon);
      for (const ant of matches.slice(1)) {
        const d = haversineM(avgLat, avgLon, ant.lat, ant.lon);
        if (d < bestDist) { bestDist = d; best = ant; }
      }
      setMatchedAntennaBSide({ lat: best.lat, lon: best.lon, cellName: best.cellName, distanceM: bestDist, azimuth: best.azimuth, freq: best.freq, vendor: best.vendor, enbName: best.enbName, tech: best.tech, height: best.height, downtilt: best.downtilt, siteId: best.siteId, cellId: best.cellId });
    }).catch(() => setMatchedAntennaBSide(null));
  }, [bSideCellInfo, bSideLteValues, call.region]);

  // Single source of truth for "which measurement rows are currently on screen", combining the
  // callMode/srvccNetwork (LTE vs GSM) and selectedLteSide (A vs B) selections into one array.
  const activeRadioValues = useMemo(() => {
    if (isGSMMode) return selectedLteSide === "B" ? bSideGsmValues : gsmValues;
    return selectedLteSide === "B" ? bSideLteValues : radioValues;
  }, [isGSMMode, selectedLteSide, radioValues, bSideLteValues, gsmValues, bSideGsmValues]);

  // Formats a numeric KPI value with fixed decimals + unit suffix, or an em-dash when missing
  const fmtMetric = (v: number | null | undefined, decimals: number, suffix: string) =>
    v != null ? `${v.toFixed(decimals)}${suffix}` : "—";

  // Τα δύο άκρα του throughput ζουν στο ίδιο tile: μια κλήση κουβαλάει ~24 kbps RTP, ένα
  // capacity test 400+ Mbps. Με σταθερό " Mbps" και ένα δεκαδικό, ό,τι είναι κάτω από
  // 50 kbps εμφανιζόταν ως "0.0 Mbps" — γι' αυτό κάτω από 1 Mbps γυρνάμε σε kbps.
  const fmtThroughput = (v: number | null | undefined) => {
    if (v == null) return "—";
    return v >= 1 ? `${v.toFixed(1)} Mbps` : `${Math.round(v * 1000)} kbps`;
  };

  // KPI tile values fall back to per-call fields when the dedicated KPI tile endpoint has no data
  const avgMos = callKpiTile?.AvgMOS ?? (call.avgMos || null);
  // Throughput: το 0 σημαίνει "καμία μέτρηση", όχι "μηδενική ταχύτητα" — το backend
  // κόβει ήδη τα idle 0-samples, οπότε ό,τι φτάνει εδώ ως 0 δεν είναι πραγματική μέτρηση.
  // Με `||` γλιστράει στο per-call field και, αν κι αυτό είναι 0, το tile δείχνει "—".
  const downloadMbps = callKpiTile?.Download_Mbps || (call.downloadSpeed || null);

  // Definitions for the inline metrics strip shown in the top controls bar
  const metrics = [
    { label: "Download", value: fmtThroughput(downloadMbps), icon: ArrowDown, color: "text-primary" },
    { label: "AVG Mos", value: fmtMetric(avgMos, 2, ""), icon: Gauge, color: "text-warning" },
    { label: "Setup Time", value: `${call.setupTime_ms} ms`, icon: Timer, color: call.setupTime_ms > 500 ? "text-warning" : "text-success" },
  ];

  // GSM scanner ανά γραμμή του κινητού: το πλησιέστερο δείγμα της ΙΔΙΑΣ serving CGI (όπως το LTE),
  // έως SCANNER_MATCH_MAX_DT_MS. Γραμμή χωρίς CGI → πλησιέστερο οποιασδήποτε CGI, ίδιο όριο.
  const gsmScannerMatched = useMemo(() => {
    if (!isGSMMode) return [] as (any | null)[];
    const raw = selectedLteSide === "B" ? gsmScannerRawB : gsmScannerRaw;
    if (raw.length === 0) return [] as (any | null)[];
    const byCgi = groupTimedRows(raw, (row) => (row.CGI ? String(row.CGI) : null));
    const all = toTimedRows(raw);
    return activeRadioValues.map((val: any) => {
      const ts = toTimestamp(val.MsgTime);
      return nearestWithin(val.CGI ? byCgi.get(String(val.CGI)) : all, ts, SCANNER_MATCH_MAX_DT_MS);
    });
  }, [gsmScannerRaw, gsmScannerRawB, selectedLteSide, activeRadioValues, isGSMMode]);

  // Pre-index scanner rows by EARFCN for fast nearest-time lookup. A and B remain
  // strictly isolated: an empty B-side must never be presented as A-side scanner data.
  const activeScannerRaw = selectedLteSide === "B"
    ? scannerRawB
    : scannerRawA;

  // Lookup maps over the scanner rows (TimedRows: sorted + timestamps for binary search): byCgi is
  // keyed on the UE's own serving CGI (globally unique — same "common CGI" cross-check GSM uses),
  // byKey falls back to EARFCN+PCI, byEarfcnOnly to EARFCN alone.
  const { scannerByKey, scannerByEarfcnOnly, scannerByCgi } = useMemo(() => ({
    scannerByKey: groupTimedRows(activeScannerRaw, (row) => `${row.EARFCN}_${row.PCI}`),
    scannerByEarfcnOnly: groupTimedRows(activeScannerRaw, (row) => (row.EARFCN != null ? String(row.EARFCN) : null)),
    scannerByCgi: groupTimedRows(activeScannerRaw, (row) => (row.CGI ? String(row.CGI) : null)),
  }), [activeScannerRaw]);

  const scannerByEarfcn = scannerByKey;

  // Nearest scanner sample for a UE measurement, within SCANNER_MATCH_MAX_DT_MS: prefer the common
  // CGI match (PCI alone can be reused by multiple physical cells, CGI can't — same idea as GSM's
  // "RxLev Scanner"), then EARFCN+PCI, then EARFCN-only if no CGI match exists.
  const findNearestScanner = (cgi: string | null, earfcn: number | null, pci: number | null, msgTime: string | null): any | null => {
    if (msgTime == null) return null;
    const ts = toTimestamp(msgTime);
    const pick = (timed: TimedRows | undefined) =>
      timed && timed.rows.length > 0 ? { hit: nearestWithin(timed, ts, SCANNER_MATCH_MAX_DT_MS) } : null;
    const byCgi = cgi ? pick(scannerByCgi.get(String(cgi))) : null;
    if (byCgi) return byCgi.hit;
    if (earfcn == null) return null;
    const byPci = pick(scannerByKey.get(`${earfcn}_${pci}`));
    if (byPci) return byPci.hit;
    return pick(scannerByEarfcnOnly.get(String(earfcn)))?.hit ?? null;
  };

  // Precompute LTE scanner match per measurement row: "LTE Scanner" is the scanner reading for
  // the UE's own serving cell — matched on common CGI first (same idea as GSM's "RxLev Scanner"),
  // falling back to EARFCN+PCI; "Best LTE Scanner" is the strongest cell the scanner saw for the
  // call's operator (DmnIdTopN_RSRP_Operator = 1).
  const lteScannerMatched = useMemo(() => {
    if (isGSMMode) return [] as (any | null)[];
    return activeRadioValues.map(val => findNearestScanner(val.CGI, val.EARFCN, val.PhyCellId, val.MsgTime));
  }, [activeRadioValues, isGSMMode, scannerByKey, scannerByEarfcnOnly, scannerByCgi]);

  // Scanner για το context πριν/μετά την κλήση, για την επιλεγμένη πλευρά:
  //  - LTE: επαληθεύεται κυψέλη — το context έχει EARFCN+PCI, οπότε ένα δείγμα παίρνει scanner
  //    μόνο από την ΙΔΙΑ κυψέλη (scannerByKey· αν το κινητό ήταν αλλού πριν την κλήση, μένει κενό).
  //  - GSM: το context ΔΕΝ έχει κυψέλη, οπότε υποθέτουμε ότι το κινητό έμενε στην πρώτη
  //    κυψέλη της κλήσης πριν από αυτή, και στην τελευταία μετά (idle camping).
  //  - 5G: δεν χρειάζεται εδώ — κολλάει με τη δική του ώρα στο unifiedSamples.
  const contextScanner = useMemo(() => {
    const gsmUe = (selectedLteSide === "B" ? bSideGsmValues : gsmValues).filter((v: any) => v.CGI);
    const gsmRaw = selectedLteSide === "B" ? gsmScannerRawB : gsmScannerRaw;
    const gsmOfCell = (cgi: string | undefined) => (cgi ? toTimedRows(gsmRaw.filter((r: any) => r.CGI === cgi)) : EMPTY_TIMED);

    return {
      gsmBefore: gsmOfCell(gsmUe[0]?.CGI),
      gsmAfter: gsmOfCell(gsmUe[gsmUe.length - 1]?.CGI),
    };
  }, [selectedLteSide, gsmValues, bSideGsmValues, gsmScannerRaw, gsmScannerRawB]);

  // Κοινό 5G scanner ανά γραμμή: για κάθε NR row, το πλησιέστερο scanner sample της ΙΔΙΑΣ κυψέλης,
  // έως SCANNER_MATCH_MAX_DT_MS μακριά (αλλιώς η σύγκριση δεν λέει τίποτα). null για LTE rows.
  const nrScannerMatched = useMemo(() => {
    if (isGSMMode || selectedLteSide === "B" || nr5gScannerRawA.length === 0) return [] as (any | null)[];
    // Κάθε scanner row μπαίνει και με τα δύο κλειδιά (CID, NR-ARFCN + PCI)· η γραμμή του κινητού
    // ψάχνει με ό,τι έχει (nrServingCell).
    const byCell = new Map<string, TimedRows>();
    for (const key of new Set(nr5gScannerRawA.flatMap(nrScannerRowKeys))) {
      byCell.set(key, toTimedRows(nr5gScannerRawA.filter((row: any) => nrScannerRowKeys(row).includes(key))));
    }
    return activeRadioValues.map((val: any) => {
      if (val.Technology !== "NR5G") return null;
      const serving = nrServingCell(val);
      return serving ? nearestWithin(byCell.get(serving.key), toTimestamp(val.MsgTime), SCANNER_MATCH_MAX_DT_MS) : null;
    });
  }, [nr5gScannerRawA, activeRadioValues, isGSMMode, selectedLteSide]);

  // Στήλες scanner στον LTE/NR πίνακα: LTE scanner, ή κοινό 5G scanner που ταίριαξε σε NR γραμμή του
  // πίνακα (όχι απλώς «ήρθε 5G scanner»: σε VoLTE με EN-DC ο πίνακας δεν έχει NR γραμμές).
  const hasTableScanner = scannerByEarfcn.size > 0 || nrScannerMatched.some(Boolean);

  // Όρια κλήσης σε epoch ms — σκιάζουν το «κατά» και χωρίζουν πριν/μετά, κοινά με το overview.
  const callBounds = useMemo(() => {
    const start = new Date(call.startTime).getTime();
    const end = new Date(call.endTime).getTime();
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) return { start, end };
    // Fallback: η φάση "during" όπως την έδωσε το backend στα context rows
    const during = [...contextSignal, ...gsmContextSignal]
      .filter((v: any) => v.phase === "during")
      .map((v: any) => toTimestamp(v.MsgTime))
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
    return during.length > 1 ? { start: during[0], end: during[during.length - 1] } : null;
  }, [call.startTime, call.endTime, contextSignal, gsmContextSignal]);

  // Το ορατό παράθυρο: [αρχή − N, τέλος + N] πάνω στα context δεδομένα των ±CONTEXT_FETCH_WINDOW_SEC.
  // Χωρίς όρια κλήσης δεν ξέρουμε πού να κόψουμε, οπότε δείχνουμε ό,τι ήρθε.
  const viewRange = useMemo(() => (
    callBounds ? { from: callBounds.start - viewWindowSec * 1000, to: callBounds.end + viewWindowSec * 1000 } : null
  ), [callBounds, viewWindowSec]);
  const inView = useCallback(
    (t: number) => !viewRange || (Number.isFinite(t) && t >= viewRange.from && t <= viewRange.to),
    [viewRange],
  );

  // ── Ενιαία σειρά σήματος ────────────────────────────────────────────────────
  // Ένα και μόνο dataset για ΟΛΟ το διάγραμμα: τα δείγματα του context (±Ns γύρω από την
  // κλήση) και τα δείγματα της ίδιας της κλήσης πέφτουν στον ίδιο πίνακα με κλειδί το
  // absolute timestamp. Έτσι το «πριν/μετά» και η ίδια η κλήση διαβάζονται σε μία καμπύλη
  // αντί για δύο ξεχωριστά διαγράμματα με διαφορετικούς άξονες.
  const unifiedSamples = useMemo<SignalSample[]>(() => {
    // Το scanner του context (βλ. contextScanner): μόνο πριν/μετά — μέσα στην κλήση το δίνουν
    // τα radio rows με ακριβέστερη αντιστοίχιση (CGI / CID).
    const outside = (v: any) => v.phase === "before" || v.phase === "after";
    const lteContext = (selectedLteSide === "B" ? contextSignalBSide : contextSignal).map((v: any) => {
      const t = toTimestamp(v.MsgTime);
      const scn = !isGSMMode && outside(v)
        ? nearestWithin(scannerByKey.get(`${v.EARFCN}_${v.PhyCellId}`), t, CONTEXT_SCANNER_MAX_DT_MS)
        : null;
      return { t, RSRP: toNumber(v.RSRP), RSRQ: toNumber(v.RSRQ), ScannerStrength: toNumber(scn?.RSRP) };
    }).filter((sample) => inView(sample.t));
    const gsmContext = (selectedLteSide === "B" ? gsmContextSignalBSide : gsmContextSignal).map((v: any) => {
      const t = toTimestamp(v.MsgTime);
      const scn = isGSMMode && outside(v)
        ? nearestWithin(v.phase === "before" ? contextScanner.gsmBefore : contextScanner.gsmAfter, t, CONTEXT_SCANNER_MAX_DT_MS)
        : null;
      return { t, RxLev: toNumber(v.RxLevSub), RxQual: toNumber(v.RxQualSub), ScannerStrength: toNumber(scn?.RxLev) };
    }).filter((sample) => inView(sample.t));
    const nrContext = (selectedLteSide === "B" ? nr5gContextSignalBSide : nr5gContextSignal).map((v: any) => ({
      t: toTimestamp(v.MsgTime), NrRSRP: toNumber(v.RSRP), NrRSRQ: toNumber(v.RSRQ),
    })).filter((sample) => inView(sample.t));

    // Τα δείγματα της κλήσης: καλύπτουν ό,τι δεν επιστρέφει το context (π.χ. CS κλήση χωρίς
    // LTE context) και είναι αυτά που κουμπώνουν με τον πίνακα Radio Measurements.
    const callRows = activeRadioValues.map((val: any) => {
      const isNr = String(val.Technology ?? "").toUpperCase().includes("NR");
      return {
        t: toTimestamp(val.MsgTime),
        RSRP: !isGSMMode && !isNr ? toNumber(val.RSRP) : undefined,
        RSRQ: !isGSMMode && !isNr ? toNumber(val.RSRQ) : undefined,
        NrRSRP: isNr ? toNumber(val.RSRP) : undefined,
        NrRSRQ: isNr ? toNumber(val.RSRQ) : undefined,
        RxLev: isGSMMode ? toNumber(val.RxLevSub) : undefined,
        RxQual: isGSMMode ? toNumber(val.RxQualSub) : undefined,
      };
    });

    // Σε SRVCC/CSFB/CS το άλλο σκέλος δεν είναι το «ενεργό» activeRadioValues, αλλά πρέπει να
    // σχεδιαστεί κι αυτό ώστε το σκαλοπάτι της μετάβασης να φαίνεται στην ίδια καμπύλη — και
    // προς τις δύο κατευθύνσεις: σε CSFB το GSM σκέλος κρατάει λίγα δευτερόλεπτα από μια κλήση
    // που το υπόλοιπο διάστημα τρέχει σε LTE, οπότε χωρίς το LTE σκέλος η καμπύλη ήταν σχεδόν άδεια.
    const gsmLeg = (showsGsmLeg && !isGSMMode
      ? (selectedLteSide === "B" ? bSideGsmValues : gsmValues)
      : []
    ).map((val: any) => ({ t: toTimestamp(val.MsgTime), RxLev: toNumber(val.RxLevSub), RxQual: toNumber(val.RxQualSub) }));
    const lteLeg = (showsGsmLeg && isGSMMode
      ? (selectedLteSide === "B" ? bSideLteValues : radioValues)
      : []
    ).map((val: any) => ({ t: toTimestamp(val.MsgTime), RSRP: toNumber(val.RSRP), RSRQ: toNumber(val.RSRQ) }));

    const merged = mergeSignalSamples([lteContext, gsmContext, nrContext, gsmLeg, lteLeg, callRows]);

    // Best scanner (LTE/GSM/5G): ανεξάρτητο από το serving cell του κινητού, οπότε κολλάει με το
    // δικό του FullDate στο πλησιέστερο δείγμα της καμπύλης — έτσι καλύπτει ΚΑΙ το context
    // πριν/μετά, κομμένο στο ορατό ±Ns. Μόνο A-side (όπως πάντα)· το 5G όχι σε GSM προβολή.
    if (selectedLteSide === "A") {
      const bestPoints = (raw: any[], key: keyof SignalSample, field: string) => raw
        .map((row: any) => ({ t: toTimestamp(row.FullDate), values: { [key]: toNumber(row[field]) } as Partial<SignalSample> }))
        .filter((point) => inView(point.t));
      attachNearest(merged, isGSMMode
        ? bestPoints(gsmScannerBestRaw, "BestScannerStrength", "RxLev")
        : bestPoints(lteScannerBestRaw, "BestScannerStrength", "RSRP"), SCANNER_ATTACH_TOLERANCE_MS);
      if (!isGSMMode) {
        attachNearest(merged, bestPoints(nr5gScannerBestRaw, "NrBestScannerStrength", "RSRP"), SCANNER_ATTACH_TOLERANCE_MS);
        // Κοινό 5G scanner: τα rows είναι ήδη μόνο της serving CID του κινητού ανά τμήμα (με
        // επέκταση στο πρώτο/τελευταίο για το context), οπότε κολλάνε κι αυτά με τη δική τους
        // ώρα — δουλεύει και σε κλήσεις χωρίς NR rows στο radioValues (VoLTE με EN-DC, «-»).
        attachNearest(merged, bestPoints(nr5gScannerRawA, "NrScannerStrength", "RSRP"), SCANNER_ATTACH_TOLERANCE_MS);
      }
    }

    // Το scanner έρχεται από άλλο query και σπάνια πέφτει στο ίδιο ακριβώς ms, οπότε
    // προσαρτάται στο πλησιέστερο δείγμα αντί για exact-match merge.
    return attachNearest(merged, activeRadioValues.map((val: any, idx: number) => ({
      t: toTimestamp(val.MsgTime),
      values: isGSMMode
        ? { ScannerStrength: toNumber(gsmScannerMatched[idx]?.RxLev) }
        : val.Technology === "NR5G"
          ? {}
          : { ScannerStrength: toNumber(lteScannerMatched[idx]?.RSRP) },
    })));
  }, [activeRadioValues, isGSMMode, showsGsmLeg, selectedLteSide, gsmValues, bSideGsmValues, radioValues, bSideLteValues,
      contextSignal, contextSignalBSide, gsmContextSignal, gsmContextSignalBSide, nr5gContextSignal, nr5gContextSignalBSide,
      gsmScannerMatched, lteScannerMatched, contextScanner, scannerByKey,
      gsmScannerBestRaw, lteScannerBestRaw, nr5gScannerBestRaw, nr5gScannerRawA, inView]);

  const unifiedDomain = useMemo(() => sampleDomain(unifiedSamples), [unifiedSamples]);

  /** Υπάρχει όντως B-side; Αλλιώς ο επιλογέας πλευράς μένει απενεργοποιημένος. */
  const hasBSideData = bSideLteValues.length > 0 || bSideGsmValues.length > 0
    || contextSignalBSide.length > 0 || gsmContextSignalBSide.length > 0 || nr5gContextSignalBSide.length > 0;
  const unifiedTimes = useMemo(() => unifiedSamples.map((sample) => sample.t), [unifiedSamples]);

  /** Ποιο δίκτυο ορίζει τον άξονα ποιότητας και τα κατώφλια του διαγράμματος. */
  const chartNetwork = isGSMMode ? "GSM" : isVoNRMode ? "NR" : "LTE";

  // Important L3/SIP/NAS events are projected onto the nearest radio sample, producing the
  // vertical event lines and stacked labels seen in drive-test tools. Repeated low-value
  /**
   * MO / MT της πλευράς που δείχνει το διάγραμμα. Η κατεύθυνση είναι ιδιότητα του
   * ΚΑΘΕ κινητού ξεχωριστά — σε mobile-to-mobile τεστ το ένα καλεί (MO) και το άλλο
   * δέχεται (MT) — οπότε ακολουθεί τον επιλογέα A/B μαζί με τις καμπύλες.
   */
  const activeCallDir = useMemo<string | null>(() => {
    const dir = (selectedLteSide === "B" ? l3DataBSide : l3Data)?.callWindow?.callDir;
    return typeof dir === "string" && dir.trim() !== "" ? dir.trim().toUpperCase() : null;
  }, [selectedLteSide, l3Data, l3DataBSide]);

  // messages (especially Paging) are rate-limited so the RSRP/RxLev trace remains readable.
  const signalEvents = useMemo<SignalEvent[]>(() => {
    if (!unifiedDomain) return [];
    const sideL3 = selectedLteSide === "B" ? l3DataBSide : l3Data;
    const firstTimestamp = unifiedDomain.start;
    const lastTimestamp = unifiedDomain.end;

    // `priority`: events που δεν επιτρέπεται να πέσουν στο αραίωμα των ταμπελών παρακάτω —
    // τα KPI-backed handovers (SRVCC / CSFB) είναι ακριβώς το σημείο που κοιτάει ο αναλυτής.
    type Candidate = SignalEvent & { dedupeKey: string; priority?: boolean };
    const candidates: Candidate[] = [];

    const eventColor = (layer: string | null, label: string) => {
      const normalizedLayer = (layer ?? "").toUpperCase();
      if (label.toLowerCase().includes("handover") || label.toLowerCase().includes("srvcc")) return "#ef4444";
      if (normalizedLayer.includes("SIP")) return "#a855f7";
      if (normalizedLayer.includes("NAS")) return "#f59e0b";
      if (normalizedLayer.includes("RRC") || normalizedLayer.includes("RR")) return "#06b6d4";
      return "#22c55e";
    };

    for (const message of sideL3?.l3Messages ?? []) {
      if (!message.MsgTime) continue;
      const timestamp = new Date(message.MsgTime).getTime();
      if (!Number.isFinite(timestamp) || timestamp < firstTimestamp || timestamp > lastTimestamp) continue;

      const rawName = message.SimpleMsgName ?? message.MsgName ?? "L3 event";
      const normalized = rawName.toLowerCase();
      const layer = message.Layer ?? null;
      const isSip = (layer ?? "").toUpperCase().includes("SIP");
      const sipMethod = rawName.replace(/^IMS SIP\s*/i, "").trim();
      let label: string | null = null;

      if (isSip && /invite|ack|bye|cancel/i.test(sipMethod)) {
        const response = message.SIPResponse && message.SIPResponse !== "Request" ? ` ${message.SIPResponse}` : "";
        label = `SIP ${sipMethod}${response}`;
      } else if (normalized === "paging" || normalized.endsWith("-paging")) {
        label = "Paging";
      } else if (normalized.includes("tracking area update")) {
        label = rawName.replace(/^EMM-/i, "");
      } else if (normalized.includes("service request")) {
        label = "Service Request";
      } else if (normalized.includes("activate dedicated eps bearer")) {
        label = normalized.includes("accept") ? "EPS bearer accept" : "EPS bearer request";
      } else if (normalized.includes("deactivate eps bearer")) {
        label = normalized.includes("accept") ? "EPS bearer release accept" : "EPS bearer release";
      } else if (normalized.includes("rrcconnectionsetup")) {
        label = normalized.includes("complete") ? "RRC Setup Complete" : "RRC Connection Setup";
      } else if (normalized.includes("rrcconnectionrelease")) {
        label = "RRC Connection Release";
      } else if (normalized.includes("securitymode") || normalized.includes("security mode")) {
        label = rawName.replace(/^.*?-/, "");
      } else if (normalized.includes("authentication")) {
        label = rawName.replace(/^.*?-/, "");
      } else if (normalized.includes("handover")) {
        label = rawName;
      } else if (normalized.includes("routing area update") || normalized.includes("location updating") || normalized.includes("cm service")) {
        label = rawName;
      }

      if (!label) continue;
      const compactLabel = label.length > 34 ? `${label.slice(0, 32)}…` : label;
      candidates.push({
        timestamp,
        label: compactLabel,
        dedupeKey: compactLabel.toLowerCase(),
        detail: [message.MsgName ?? rawName, message.SIPResponse].filter(Boolean).join(" · "),
        technology: message.Technology ?? null,
        layer,
        direction: message.Direction ?? null,
        color: eventColor(layer, compactLabel),
      });
    }

    for (const handover of callMode === "SRVCC" ? [] : handoverInfo) {
      if (!handover.MsgTime) continue;
      const timestamp = new Date(handover.MsgTime).getTime();
      if (timestamp < firstTimestamp || timestamp > lastTimestamp) continue;
      const label = `Handover ${handover.HoStatus ?? "event"}`;
      candidates.push({
        timestamp,
        label,
        dedupeKey: label.toLowerCase(),
        detail: handover.hoDuration != null ? `${label} · ${handover.hoDuration} ms` : label,
        technology: "LTE",
        layer: "Handover",
        direction: null,
        color: eventColor("Handover", label),
      });
    }

    for (const event of (srvccDetail?.events ?? []).filter((item) => (item.Side ?? "A") === selectedLteSide)) {
      if (!event.EventTime) continue;
      const timestamp = new Date(event.EventTime).getTime();
      if (timestamp < firstTimestamp || timestamp > lastTimestamp) continue;
      const label = `${event.HandoverType} ${event.Status}`;
      candidates.push({
        timestamp,
        label,
        dedupeKey: label.toLowerCase(),
        detail: `${label}${event.InterruptionMs != null ? ` · ${event.InterruptionMs} ms` : ""}`,
        technology: "SRVCC",
        layer: "Handover",
        direction: null,
        color: eventColor("Handover", label),
        priority: true,
      });
    }

    // CSFB: τα τρία σημεία που ορίζουν τη διαδρομή — πότε ξεκίνησε το fallback, πότε
    // κούμπωσε στο 2G/3G και πότε γύρισε σε LTE — πάνω στον ίδιο άξονα με τα L3.
    for (const event of (csfbDetail?.events ?? []).filter((item) => (item.Side ?? "A") === selectedLteSide)) {
      const target = event.TargetTechnology ?? "2G/3G";
      const points: Array<[string | null, string, string]> = [
        [event.FallbackStart, `CSFB start → ${target}`, `Έναρξη CS fallback · ${event.Status}`],
        [event.TargetTime, `CSFB camp ${target}`, `Πρώτη ${target} κυψέλη${event.TargetCGI ? ` · ${event.TargetCGI}` : ""}`],
        [event.ReturnTime, "CSFB return LTE", `Επιστροφή σε LTE${event.ReturnDelayMs != null ? ` · ${event.ReturnDelayMs} ms` : ""}`],
      ];
      for (const [iso, label, detail] of points) {
        if (!iso) continue;
        const timestamp = new Date(iso).getTime();
        if (!Number.isFinite(timestamp) || timestamp < firstTimestamp || timestamp > lastTimestamp) continue;
        candidates.push({
          timestamp,
          label,
          dedupeKey: label.toLowerCase(),
          detail,
          technology: "CSFB",
          layer: "Handover",
          direction: null,
          color: event.Status === "Fail" ? "#ef4444" : "#f97316",
          priority: true,
        });
      }
    }

    const accepted: Candidate[] = [];
    const lastByLabel = new Map<string, number>();
    for (const candidate of candidates.sort((left, right) => left.timestamp - right.timestamp)) {
      const previous = lastByLabel.get(candidate.dedupeKey);
      const minimumGap = candidate.dedupeKey === "paging" ? 30_000 : candidate.dedupeKey.startsWith("sip ") ? 1_000 : 3_000;
      if (previous != null && candidate.timestamp - previous < minimumGap) continue;
      accepted.push(candidate);
      lastByLabel.set(candidate.dedupeKey, candidate.timestamp);
    }

    // Η κατανομή σε λωρίδες γίνεται πλέον στο ίδιο το διάγραμμα, πάνω στον χρονικό άξονα
    // (layoutEventLanes) — εδώ μένει μόνο το «ποια events αξίζουν ταμπέλα».
    //
    // Τα priority events (SRVCC/CSFB handovers) κρατιούνται ΠΑΝΤΑ και τα υπόλοιπα
    // αραιώνονται γύρω τους: με σκέτο δειγματοληπτικό φιλτράρισμα ανά index, η ταμπέλα
    // της μετάβασης χανόταν ανάμεσα σε δεκάδες Paging/Handover Complete.
    const limited = accepted.length <= 16 ? accepted : (() => {
      const mustKeep = accepted.filter((candidate) => candidate.priority);
      const rest = accepted.filter((candidate) => !candidate.priority);
      const slots = Math.max(0, 16 - mustKeep.length);
      if (slots === 0) return mustKeep.slice(0, 16);
      const step = Math.max(1, Math.ceil(rest.length / slots));
      const sampled = rest
        .filter((_, index) => index === 0 || index === rest.length - 1 || index % step === 0)
        .slice(0, slots);
      return [...mustKeep, ...sampled].sort((left, right) => left.timestamp - right.timestamp);
    })();

    return limited.map(({ dedupeKey, priority, ...event }) => event);
  }, [callMode, unifiedDomain, handoverInfo, isGSMMode, l3Data, l3DataBSide, selectedLteSide, srvccDetail, csfbDetail]);

  const srvccEvents = useMemo(() => srvccDetail?.events ?? [], [srvccDetail]);
  const activeSrvccEvents = useMemo(
    () => srvccEvents.filter((event) => (event.Side ?? "A") === selectedLteSide),
    [srvccEvents, selectedLteSide],
  );
  const primarySrvccEvent: SrvccEventRow | null = activeSrvccEvents[0] ?? srvccEvents[0] ?? null;

  // Χρονικό παράθυρο γύρω από τα SRVCC events του επιλεγμένου side — κοινό για το διάγραμμα
  // και τα στατιστικά των δύο σκελών, ώστε ό,τι βλέπει ο χρήστης να είναι ό,τι μετριέται.
  const srvccWindow = useMemo(() => {
    const eventTimes = activeSrvccEvents
      .map((event) => event.EventTime ? new Date(event.EventTime).getTime() : NaN)
      .filter(Number.isFinite);
    if (eventTimes.length === 0) return null;
    const first = Math.min(...eventTimes);
    const last = Math.max(...eventTimes);
    // Στο "all" κρατάμε τα event times (τα χρειάζονται οι ζώνες/στατιστικά) αλλά ανοίγουμε
    // τα όρια, ώστε να μη φιλτράρεται κανένα sample της κλήσης.
    return srvccWindowSec === "all"
      ? { first, last, start: -Infinity, end: Infinity }
      : { first, last, start: first - srvccWindowSec * 1000, end: last + srvccWindowSec * 1000 };
  }, [activeSrvccEvents, srvccWindowSec]);

  // One continuous SRVCC timeline. LTE and GSM keep their own series but share one absolute time
  // axis and one row per timestamp, so a single tooltip can show στοιχεία και των δύο τεχνολογιών
  // (ισχύς, ποιότητα, SINR, cell identity) γύρω από το handover.
  const srvccTransitionData = useMemo(() => {
    if (callMode !== "SRVCC") return [];
    return mergeTransitionSeries(
      selectedLteSide === "B" ? bSideLteValues : radioValues,
      selectedLteSide === "B" ? bSideGsmValues : gsmValues,
      srvccWindow,
    );
  }, [callMode, selectedLteSide, radioValues, bSideLteValues, gsmValues, bSideGsmValues, srvccWindow]);

  // Στατιστικά ανά σκέλος + το πραγματικό ραδιο-κενό: τελευταίο LTE sample πριν το event και
  // πρώτο GSM sample μετά. Το κενό αυτό είναι το μετρήσιμο αντίστοιχο του KPI interruption time.
  const srvccLegStats = useMemo(
    () => transitionLegStats(srvccTransitionData, srvccWindow?.first ?? null),
    [srvccTransitionData, srvccWindow],
  );

  // Generic handovers remain useful for non-SRVCC calls. For SRVCC, only the KPI-backed events
  // are shown, avoiding the previous implication that every HandoverInfo row was an SRVCC event.
  const headerHandoverInfo = callMode === "SRVCC" ? [] : handoverInfo;
  const activeCellInfo = selectedLteSide === "B" ? bSideCellInfo : cellInfo;

  // Ποιά γραμμή του πίνακα Radio Measurements αντιστοιχεί στον κοινό cursor: η πλησιέστερη
  // χρονικά, αλλά μόνο αν είναι όντως κοντά — αλλιώς ένα event εκτός παραθύρου θα «φώτιζε»
  // αυθαίρετα την πρώτη ή την τελευταία γραμμή.
  const activeRadioTimes = useMemo(
    () => activeRadioValues.map((val: any) => toTimestamp(val.MsgTime)),
    [activeRadioValues],
  );
  const activeRadioIndex = useMemo(() => {
    if (hoveredTime == null) return -1;
    const index = nearestIndex(activeRadioTimes, hoveredTime);
    return index >= 0 && Math.abs(activeRadioTimes[index] - hoveredTime) <= HOVER_TOLERANCE_MS ? index : -1;
  }, [hoveredTime, activeRadioTimes]);

  /** Είναι αυτή η γραμμή (με το δικό της timestamp) κάτω από τον κοινό cursor; */
  const isHoveredIso = (iso: string | null | undefined) => {
    if (hoveredTime == null) return false;
    const t = toTimestamp(iso);
    return Number.isFinite(t) && Math.abs(t - hoveredTime) <= HOVER_TOLERANCE_MS;
  };

  // TraceLog rows + user-placed Markers merged into one time-sorted timeline, so annotations
  // the user dropped during the session show up alongside the engine's own trace events.
  type TimelineEntry = { kind: "trace" | "marker"; time: string | null; side: string | null; sessionId: string | null; info: string | null };
  const combinedTraceLog = useMemo<TimelineEntry[]>(() => {
    const traceEntries: TimelineEntry[] = tracelogValues.map(v => ({
      kind: "trace", time: v.FullDate, side: v.Side, sessionId: v.SessionId, info: v.Info,
    }));
    const markerEntries: TimelineEntry[] = markers.map(m => ({
      kind: "marker", time: m.MsgTime, side: null, sessionId: m.SessionId, info: m.MarkerText,
    }));
    return [...traceEntries, ...markerEntries].sort((a, b) => {
      const ta = a.time ? new Date(a.time).getTime() : 0;
      const tb = b.time ? new Date(b.time).getTime() : 0;
      return ta - tb;
    });
  }, [tracelogValues, markers]);

  // Aggregate min/max/avg RSRP & RSRQ for the B-side LTE leg (samples, avg, min, max)
  const bSideLteSummary = useMemo(() => {
    if (!bSideLteValues || bSideLteValues.length === 0) {
      return null;
    }

    const rsrpVals = bSideLteValues
      .map((v) => Number(v.RSRP))
      .filter((v) => Number.isFinite(v));
    const rsrqVals = bSideLteValues
      .map((v) => Number(v.RSRQ))
      .filter((v) => Number.isFinite(v));

    const avg = (arr: number[]) => arr.reduce((acc, n) => acc + n, 0) / arr.length;

    return {
      samples: bSideLteValues.length,
      avgRsrp: rsrpVals.length ? avg(rsrpVals) : null,
      avgRsrq: rsrqVals.length ? avg(rsrqVals) : null,
      minRsrp: rsrpVals.length ? Math.min(...rsrpVals) : null,
      maxRsrp: rsrpVals.length ? Math.max(...rsrpVals) : null,
      minRsrq: rsrqVals.length ? Math.min(...rsrqVals) : null,
      maxRsrq: rsrqVals.length ? Math.max(...rsrqVals) : null,
    };
  }, [bSideLteValues]);

  // The GPS map is only shown for the "Cosmote Free" region, since that's the only dataset
  // that reliably carries per-sample Latitude/Longitude values.
  const isCosmoteFree = call.region?.toLowerCase().includes("cosmote free");

  // GPS points for the currently selected side/network, colored by signal strength
  const mapActivePts = useMemo(() => {
    if (!isCosmoteFree) return [];
    const source = selectedLteSide === "B"
      ? (isGSMMode ? bSideGsmValues : bSideLteValues)
      : (isGSMMode ? gsmValues : radioValues);
    return source
      .filter((v: any) => v.Latitude != null && v.Longitude != null)
      .map((v: any) => ({
        pos: [Number(v.Latitude), Number(v.Longitude)] as [number, number],
        color: isGSMMode ? rxLevColor(v.RxLevSub) : rsrpColor(v.RSRP),
      }));
  }, [isCosmoteFree, selectedLteSide, isGSMMode, bSideGsmValues, bSideLteValues, gsmValues, radioValues]);

  // A matched LTE antenna must not be presented as the serving antenna while the GSM leg is active.
  const mapActiveAntenna = isGSMMode
    ? null
    : selectedLteSide === "B" ? matchedAntennaBSide : matchedAntenna;

  // Bounds used by MapAutoFit — includes the matched antenna position so the map frames both
  // the UE's GPS trail and the serving antenna it's connected to.
  const mapFitPts = useMemo((): [number, number][] => {
    const pts: [number, number][] = mapActivePts.map(p => p.pos);
    if (mapActiveAntenna) pts.push([mapActiveAntenna.lat, mapActiveAntenna.lon]);
    return pts;
  }, [mapActivePts, mapActiveAntenna]);

  /**
   * Ο χάρτης της κλήσης (διαδρομή GPS + η κεραία που την εξυπηρετούσε). Ορίζεται ΜΙΑ φορά
   * και σχεδιάζεται σε δύο μεγέθη: μικρός μέσα στην κάρτα και μεγάλος στο popup, ώστε οι
   * δύο προβολές να μη μπορούν να αποκλίνουν.
   */
  const renderCallMap = (height: string, withZoomControl = false) => {
    const antennaColor = selectedLteSide === "B" ? "#c48105" : "#b200f8";
    // Custom SVG antenna icon (signal-wave glyph) drawn in the side's accent color, only
    // rendered when a matched antenna position exists
    const antennaIcon = mapActiveAntenna ? L.divIcon({
      className: "",
      html: `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="${antennaColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M4.9 16.1C1 12.2 1 5.8 4.9 1.9"/>
        <path d="M7.8 13.2c-2.3-2.3-2.3-6.1 0-8.5"/>
        <path d="M19.1 1.9c3.9 3.9 3.9 10.2 0 14.1"/>
        <path d="M16.2 4.8c2.3 2.3 2.3 6.1 0 8.5"/>
        <line x1="12" x2="12" y1="12" y2="22"/>
        <line x1="8" x2="16" y1="22" y2="22"/>
      </svg>`,
      iconSize: [22, 22],
      iconAnchor: [11, 22],
    }) : null;

    return (
      <MapContainer
        center={mapFitPts[0]}
        zoom={13}
        style={{ height, width: "100%" }}
        zoomControl={withZoomControl}
        attributionControl={false}
      >
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        <MapAutoFit points={mapFitPts} />
        {mapActivePts.map((pt, i) => (
          <CircleMarker
            key={i}
            center={pt.pos}
            radius={3}
            fillColor={pt.color}
            color={pt.color}
            fillOpacity={0.85}
            weight={0}
          />
        ))}
        {/* Dashed line from the UE's last known GPS fix to its matched serving antenna */}
        {mapActiveAntenna && antennaIcon && (
          <>
            <Polyline
              positions={[
                mapActivePts.length > 0 ? mapActivePts[mapActivePts.length - 1].pos : mapFitPts[0],
                [mapActiveAntenna.lat, mapActiveAntenna.lon],
              ]}
              color="#000000"
              weight={1.5}
              dashArray="6 5"
              opacity={0.8}
            />
            <Marker
              position={[mapActiveAntenna.lat, mapActiveAntenna.lon]}
              icon={antennaIcon}
            >
              <SmartTooltip lat={mapActiveAntenna.lat} lon={mapActiveAntenna.lon}>
                <div className="text-[8px] font-mono leading-relaxed">
                  {mapActiveAntenna.enbName && <div><span className="text-gray-500">eNB </span>{mapActiveAntenna.enbName}</div>}
                  {mapActiveAntenna.azimuth != null && <div><span className="text-gray-500">Azimuth </span><b>{mapActiveAntenna.azimuth}°</b></div>}
                  {mapActiveAntenna.downtilt != null && <div><span className="text-gray-500">Tilt </span>{mapActiveAntenna.downtilt}°</div>}
                  {mapActiveAntenna.height != null && <div><span className="text-gray-500">Height </span>{mapActiveAntenna.height} m</div>}
                  {mapActiveAntenna.freq != null && <div><span className="text-gray-500">Freq </span>{mapActiveAntenna.freq} MHz</div>}
                  {mapActiveAntenna.tech && <div><span className="text-gray-500">Tech </span>{mapActiveAntenna.tech}</div>}
                  <div><span className="text-gray-500">Dist </span><b>{fmtDist(mapActiveAntenna.distanceM)}</b></div>
                </div>
              </SmartTooltip>
            </Marker>
          </>
        )}
      </MapContainer>
    );
  };


  // Keep sides isolated. Empty B-side data is rendered as a clear no-data state instead of
  // silently showing A-side measurements under a B-side label.
  const activeContextSignal = selectedLteSide === "B" ? contextSignalBSide : contextSignal;
  const activeGsmContextSignal = selectedLteSide === "B" ? gsmContextSignalBSide : gsmContextSignal;

  // Το GSM σκέλος δεν αφορά μόνο τις CS κλήσεις: σε SRVCC το δεύτερο σκέλος είναι GSM και
  // σε CSFB ολόκληρη η κλήση. Το CSFB μπορεί να κρύβεται και σε κλήση περασμένη VoLTE
  // (η μία πλευρά μόνο), γι' αυτό μετράει και το τι βρήκε το /api/call_csfb_detail.
  const showGsmContext = isGSMMode || showsGsmLeg;

  // ── Session Overview ──────────────────────────────────────────────────────
  // Χρονική επισκόπηση (τύπου Gantt) που μπαίνει ακριβώς πάνω από το διάγραμμα
  // RSRP/RxLev: λωρίδα κατάστασης (IDLE → CALL → IDLE) και λωρίδα τεχνολογίας.
  // Δένεται στα ΙΔΙΑ δείγματα με το chart από κάτω (index domain), ώστε κάθε
  // μπάρα να πέφτει πάνω από το αντίστοιχο σημείο της καμπύλης.
  const sessionOverview = useMemo(() => {
    if (!unifiedDomain) return null;

    // Τα charts από κάτω έχουν πλέον γραμμικό άξονα χρόνου, οπότε το overview δένεται σε
    // ισαπέχοντα δείγματα του ίδιου domain (γραμμική αντιστοίχιση χρόνου → θέσης).
    const STEPS = 120;
    const times = Array.from({ length: STEPS + 1 }, (_, i) => unifiedDomain.start + ((unifiedDomain.end - unifiedDomain.start) * i) / STEPS);

    const winStart = unifiedDomain.start;
    const winEnd = unifiedDomain.end;
    const callStart = callBounds?.start ?? null;
    const callEnd = callBounds?.end ?? null;

    // Λωρίδα κατάστασης — τα όρια είναι ακριβώς αυτά του shaded "κατά την κλήση"
    // area του chart, οπότε οι δύο απεικονίσεις δείχνουν πάντα το ίδιο διάστημα.
    const stateSegments: OverviewSegment[] = [];
    const callLabel = `CALL${call.callType ? ` · ${call.callType}` : ""}`;
    const callDetail = [
      // Εμφάνιση: το raw mode της βάσης, με το resolved όταν διαφέρει (π.χ. «-» → CS από technology)
      call.callMode
        ? `Mode: ${call.callMode}${
            callMode === "UNKNOWN" ? " (άγνωστο — φορτώθηκαν όλα τα σκέλη)"
            : callMode !== call.callMode ? ` (→ ${callMode} από technology)` : ""}`
        : null,
      call.status ? `Status: ${call.status}` : null,
    ].filter(Boolean).join(" · ") || undefined;

    if (callStart != null && callEnd != null && callEnd > callStart) {
      if (callStart > winStart) stateSegments.push({ from: winStart, to: callStart, label: "IDLE", color: "#4b5563", detail: "Πριν την κλήση" });
      stateSegments.push({ from: callStart, to: callEnd, label: callLabel, color: "#dc2626", detail: callDetail });
      if (winEnd > callEnd) stateSegments.push({ from: callEnd, to: winEnd, label: "IDLE", color: "#4b5563", detail: "Μετά την κλήση" });
    } else {
      stateSegments.push({ from: winStart, to: winEnd, label: callLabel, color: "#dc2626", detail: callDetail });
    }

    // Ψαλίδισμα στο παράθυρο των δειγμάτων (οι πηγές τεχνολογίας μπορεί να
    // επιστρέψουν ελαφρώς φαρδύτερο παράθυρο από τα δείγματα του chart)
    const clip = (seg: OverviewSegment): OverviewSegment | null => {
      const from = Math.max(seg.from, winStart);
      const to = Math.min(seg.to, winEnd);
      return to > from ? { ...seg, from, to } : null;
    };

    // ── Λωρίδα τεχνολογίας ──
    // Κύρια πηγή: FactRadioTechnology (/api/technology_periods) — έτοιμες περίοδοι με
    // StartTime/EndTime και το band που σέρβιρε πραγματικά το δίκτυο ("LTE E-UTRA 20",
    // "GSM 900"). Είναι η ίδια πηγή που διαβάζει και το SmartAnalytics Scene, οπότε
    // περιέχει το GSM σκέλος ενός SRVCC, ολόκληρη μια CS κλήση και τα κενά "No service".
    const periods = selectedLteSide === "B" ? techPeriodsBSide : techPeriods;
    const periodSegments: OverviewSegment[] = [];
    for (const period of periods) {
      const from = new Date(period.StartTime).getTime();
      const to = period.EndTime ? new Date(period.EndTime).getTime() : from + (period.Duration ?? 0);
      if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) continue;
      const outOfService = period.NetworkStatus != null && /no service|out of service/i.test(period.NetworkStatus);
      // Το RANConfiguration ξεχωρίζει π.χ. 5G EN-DC πάνω σε LTE anchor
      const ranSuffix = period.RANConfiguration && period.RANConfiguration !== period.RadioTechnology
        ? ` · ${period.RANConfiguration}` : "";
      const clipped = clip({
        from,
        to,
        label: outOfService ? "NO SERVICE" : `${period.Band ?? period.RadioTechnology ?? "—"}${ranSuffix}`,
        color: outOfService ? "#7f1d1d" : technologyColor(period.RANConfiguration ?? period.Band ?? period.RadioTechnology),
        detail: [
          period.NetworkStatus,
          period.CGI ? `CGI ${period.CGI}` : null,
          period.RFBand != null ? `RF band ${period.RFBand}` : null,
        ].filter(Boolean).join(" · ") || undefined,
        // Το CGI κρατά χωριστά τα μπλοκ διαφορετικών κυψελών κατά τη συγχώνευση
        key: period.CGI ?? "",
      });
      if (clipped) periodSegments.push(clipped);
    }

    // Fallback όταν η βάση δεν έχει FactRadioTechnology: παλιά λογική πάνω στον πίνακα
    // Technology, όπου κάθε αλλαγή ανοίγει ένα μπλοκ που κλείνει
    // στην επόμενη αλλαγή (ή στο τέλος του παραθύρου). Οι εγγραφές με
    // CurrTechnology = NULL είναι δείκτες "τέλος/μεταβατικό" και ΔΕΝ ανοίγουν νέα
    // τεχνολογία — αν τις κρατούσαμε θα έσβηναν τη λωρίδα για όλη τη διάρκειά τους.
    // Το context φέρνει και τις δύο πλευρές· η λωρίδα δείχνει μόνο αυτή που βλέπει η σελίδα
    // (IsCallSide 1 = «A-side» της σελίδας, 0 = το ζευγάρι της).
    const wantCallSide = selectedLteSide === "A" ? 1 : 0;
    const techRows = (contextTechnology as TechnologyTimelineRow[])
      .filter((row) => (row.IsCallSide ?? 1) === wantCallSide)
      .filter((row) => row?.MsgTime && row.CurrTechnology != null)
      .map((row) => ({ ...row, t: new Date(row.MsgTime as string).getTime() }))
      .filter((row) => Number.isFinite(row.t))
      .sort((a, b) => a.t - b.t);

    // Το Band περιέχει συνήθως ήδη το RAT ("LTE E-UTRA 20"), οπότε αποφεύγουμε
    // διπλές ταμπέλες τύπου "LTE LTE E-UTRA 20". Band "unknown" αγνοείται.
    const techLabel = (tech: string | null | undefined, band: string | null | undefined) => {
      const t = (tech ?? "").trim();
      const b = (band ?? "").trim();
      if (!b || b.toLowerCase() === "unknown") return t || "—";
      if (!t) return b;
      return b.toUpperCase().includes(t.toUpperCase()) ? b : `${t} ${b}`;
    };

    const rawTech: OverviewSegment[] = [];
    if (techRows.length > 0) {
      const firstPrev = techRows[0].PrevTechnology;
      if (firstPrev && techRows[0].t > winStart) {
        rawTech.push({ from: winStart, to: techRows[0].t, label: firstPrev, color: technologyColor(firstPrev) });
      }
      techRows.forEach((row, i) => {
        const to = i + 1 < techRows.length ? techRows[i + 1].t : winEnd;
        const carriers = row.LTEDLCarriers != null || row.NR5GDLCarriers != null
          ? `CA ${row.LTEDLCarriers ?? 0}DL/${row.LTEULCarriers ?? 0}UL LTE · ${row.NR5GDLCarriers ?? 0}DL/${row.NR5GULCarriers ?? 0}UL NR`
          : undefined;
        rawTech.push({
          from: row.t,
          to,
          label: techLabel(row.CurrTechnology, row.Band),
          color: technologyColor(row.CurrTechnology),
          detail: carriers,
        });
      });
    }

    let segments = rawTech.map(clip).filter((seg): seg is OverviewSegment => seg != null);

    // Ο πίνακας Technology καταγράφει μόνο LTE/NR περιόδους — το σκέλος GSM μιας
    // SRVCC κλήσης δεν υπάρχει καθόλου εκεί. Το συνθέτουμε από το KPI event του
    // SRVCC (ώρα + target technology) και το "καρφώνουμε" πάνω από τα LTE μπλοκ.
    const srvccOverlays = (srvccDetail?.events ?? [])
      .filter((ev) => (ev.Side ?? "A") === "A" && ev.Status === "Success")
      .map((ev): OverviewSegment | null => {
        const startIso = ev.TargetNetworkTime ?? ev.TargetRadioTime ?? ev.EventTime;
        const start = startIso ? new Date(startIso).getTime() : NaN;
        if (!Number.isFinite(start)) return null;
        const target = String(ev.TargetTechnology ?? ev.TargetRadioBand ?? ev.HandoverType?.split("->")[1] ?? "GSM");
        // Κλείνει όταν ο πίνακας Technology ξαναγράψει τεχνολογία (επιστροφή σε LTE),
        // αλλιώς στο τέλος της κλήσης / του παραθύρου.
        const backOnLte = techRows.find((row) => row.t > start + 500);
        const end = backOnLte?.t ?? (callEnd != null && callEnd > start ? callEnd : winEnd);
        if (end <= start) return null;
        return clip({
          from: start,
          to: end,
          label: target,
          color: technologyColor(target),
          detail: [
            `SRVCC ${ev.HandoverType ?? ""} · ${ev.Status}`,
            ev.InterruptionMs != null ? `διακοπή ${ev.InterruptionMs} ms` : null,
            ev.TargetCGI ? `CGI ${ev.TargetCGI}` : null,
          ].filter(Boolean).join(" · "),
        });
      })
      .filter((seg): seg is OverviewSegment => seg != null);

    // Το ίδιο κενό υπάρχει και στο CSFB — και εκεί ολόκληρη η κλήση γίνεται σε 2G/3G
    // χωρίς να το γράφει ο πίνακας Technology. Εδώ όμως ξέρουμε και πότε τελειώνει:
    // το KPI επιστροφής (30180) δίνει τη στιγμή που το UE ξαναπιάνει LTE.
    const csfbOverlays = (csfbDetail?.events ?? [])
      .filter((ev) => (ev.Side ?? "A") === selectedLteSide)
      .map((ev): OverviewSegment | null => {
        const startIso = ev.TargetTime ?? ev.TargetRadioTime ?? ev.FallbackStart;
        const start = startIso ? new Date(startIso).getTime() : NaN;
        if (!Number.isFinite(start)) return null;
        const target = String(ev.TargetTechnology ?? ev.TargetRadioBand ?? "GSM");
        const returnIso = ev.ReturnTime ?? ev.ReturnEnd;
        const backOnLte = returnIso ? new Date(returnIso).getTime() : NaN;
        const end = Number.isFinite(backOnLte) && backOnLte > start
          ? backOnLte
          : (callEnd != null && callEnd > start ? callEnd : winEnd);
        if (end <= start) return null;
        return clip({
          from: start,
          to: end,
          label: target,
          color: technologyColor(target),
          detail: [
            `CSFB LTE→${target} · ${ev.Status}`,
            ev.TelephonyServiceMs != null ? `service ${ev.TelephonyServiceMs} ms` : null,
            ev.TargetCGI ? `CGI ${ev.TargetCGI}` : null,
          ].filter(Boolean).join(" · "),
        });
      })
      .filter((seg): seg is OverviewSegment => seg != null);

    // Το overlay κόβει ό,τι υπάρχει από κάτω του (π.χ. το LTE μπλοκ που "τρέχει"
    // όταν γίνεται το handover) και μπαίνει στη θέση του.
    for (const overlay of [...srvccOverlays, ...csfbOverlays]) {
      const kept: OverviewSegment[] = [];
      for (const seg of segments) {
        if (seg.to <= overlay.from || seg.from >= overlay.to) { kept.push(seg); continue; }
        if (seg.from < overlay.from) kept.push({ ...seg, to: overlay.from });
        if (seg.to > overlay.to) kept.push({ ...seg, from: overlay.to });
      }
      kept.push(overlay);
      segments = kept;
    }

    // CS κλήση: το GSM σκέλος δεν καταγράφεται ούτε εδώ, οπότε αν τίποτα δεν
    // καλύπτει τη διάρκεια της κλήσης τη συμπληρώνουμε ρητά ως GSM.
    if (callMode === "CS" && callStart != null && callEnd != null && callEnd > callStart
        && !segments.some((seg) => seg.from < callEnd && seg.to > callStart)) {
      const csSeg = clip({ from: callStart, to: callEnd, label: "GSM", color: technologyColor("GSM"), detail: "CS κλήση — δεν υπάρχει εγγραφή στον πίνακα Technology" });
      if (csSeg) segments.push(csSeg);
    }

    // Οι περίοδοι του FactRadioTechnology είναι η αξιόπιστη πηγή· το fallback
    // χρησιμοποιείται μόνο αν αυτές λείπουν εντελώς.
    const chosen = periodSegments.length > 0 ? periodSegments : segments;

    // Ταξινόμηση και συγχώνευση διαδοχικών μπλοκ με ίδια ταμπέλα ΚΑΙ ίδια κυψέλη
    chosen.sort((a, b) => a.from - b.from);
    const techSegments: OverviewSegment[] = [];
    for (const seg of chosen) {
      const prev = techSegments[techSegments.length - 1];
      if (prev && prev.label === seg.label && prev.key === seg.key && seg.from - prev.to <= 1) {
        prev.to = Math.max(prev.to, seg.to);
      } else {
        techSegments.push({ ...seg });
      }
    }

    const lanes: OverviewLane[] = [{ name: "Κατάσταση", segments: stateSegments }];
    if (techSegments.length > 0) lanes.push({ name: "Τεχνολογία", segments: techSegments });

    return { times, lanes, callStart, callEnd };
  }, [unifiedDomain, callBounds, contextTechnology, techPeriods, techPeriodsBSide, selectedLteSide, srvccDetail, csfbDetail, call.callType, call.callMode, callMode, call.status]);

  /**
   * Ο πίνακας "Technology Timeline" και ο πίνακας "Αλλαγές τεχνολογίας" έδειχναν τα ίδια
   * events από δύο διαφορετικά endpoints: το πρώτο μόνο μέσα στην κλήση, το δεύτερο σε
   * παράθυρο ±viewWindowSec γύρω της (με phase). Τα ενώνουμε σε έναν πίνακα: βάση είναι
   * τα context rows (έχουν phase), και όποιο timeline row δεν καλύπτεται από αυτά μπαίνει ως
   * "during" — κάθε event εμφανίζεται μία φορά, σε κοινό άξονα χρόνου.
   */
  const mergedTechnology = useMemo(() => {
    type MergedTechRow = TechnologyTimelineRow & { phase: string };
    // Η πλευρά μπαίνει στο κλειδί: A και B είναι διαφορετικές συσκευές, ακόμα κι αν αλλάξουν ταυτόχρονα
    const keyOf = (r: TechnologyTimelineRow) =>
      `${r.Side ?? ""}|${r.MsgTime ?? ""}|${r.PrevTechnology ?? ""}|${r.CurrTechnology ?? ""}`;

    const rows = new Map<string, MergedTechRow>();
    for (const row of contextTechnology as MergedTechRow[]) {
      // Το context ήρθε για ±CONTEXT_FETCH_WINDOW_SEC — κρατάμε μόνο όσα πέφτουν στο ορατό ±Ns
      if (!inView(new Date(row.MsgTime ?? NaN).getTime())) continue;
      rows.set(keyOf(row), { ...row, phase: row.phase ?? "during" });
    }
    // SRVCC κλήσεις καλύπτονται από το KPI-backed panel παραπάνω — εκεί το timeline δεν προστίθεται
    if (callMode !== "SRVCC") {
      for (const row of technologyTimeline) {
        const key = keyOf(row);
        const existing = rows.get(key);
        if (existing) {
          // Το context row υπερισχύει, αλλά κρατάμε ό,τι λείπει από αυτό (π.χ. Duration)
          rows.set(key, { ...row, ...existing, Duration: existing.Duration ?? row.Duration });
        } else {
          rows.set(key, { ...row, phase: "during" });
        }
      }
    }

    return [...rows.values()].sort(
      (a, b) => new Date(a.MsgTime ?? 0).getTime() - new Date(b.MsgTime ?? 0).getTime()
    );
  }, [contextTechnology, technologyTimeline, callMode, inView]);

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      className="space-y-2"
    >

      {/* Top Controls (Back button, Metrics inline & Status) */}
      <div className="flex flex-wrap md:flex-nowrap items-center justify-between gap-2 bg-card border border-border rounded-lg px-2 py-1">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center shrink-0 gap-1 h-6 px-2 text-xs font-medium rounded border border-border bg-muted/50 hover:bg-muted transition-colors"
        >
          <ArrowLeft className="h-3 w-3" /> Πίσω
        </button>

        {/* Inline Metrics Grid */}
        <div className="flex items-center gap-3 md:gap-4 overflow-x-auto px-1 flex-1 justify-center scrollbar-hide">
          <TooltipProvider>
            {metrics.map((m) => {
              const isMos = m.label === "AVG Mos";
              const content = (
                <div key={m.label} className={`flex items-center gap-1 shrink-0 ${isMos ? "cursor-help" : ""}`}>
                  <m.icon className={`h-3 w-3 ${m.color}`} />
                  <span className="text-[10px] uppercase font-medium text-muted-foreground">{m.label}:</span>
                  <span className="text-xs font-bold font-mono text-foreground">{m.value}</span>
                </div>
              );

              if (isMos) {
                // AVG Mos gets a hoverable tooltip listing the individual MOS samples it was averaged from
                return (
                  <Tooltip key={m.label} delayDuration={150}>
                    <TooltipTrigger asChild>
                      {content}
                    </TooltipTrigger>
                    <TooltipContent side="bottom" align="center" className="max-w-[200px] p-0 overflow-hidden border-border bg-card">
                      <div className="bg-muted px-3 py-2 border-b border-border">
                        <p className="text-xs font-semibold text-foreground">Individual MOS Values</p>
                      </div>
                      <div className="max-h-[160px] overflow-y-auto px-1 py-1">
                        {!mosValues || mosValues.length === 0 ? (
                          <p className="text-xs text-muted-foreground p-2 text-center">No additional values</p>
                        ) : (
                          <div className="grid grid-cols-2 gap-1 p-1">
                            {mosValues.map((v, i) => (
                              <div key={i} className="text-[11px] font-mono bg-muted/40 rounded px-2 py-1 text-center text-foreground">
                                {v.MOS != null ? Number(v.MOS).toFixed(2) : "-"}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </TooltipContent>
                  </Tooltip>
                );
              }
              return content;
            })}
          </TooltipProvider>
        </div>

        {/* Overall call status badge: green completed, orange dropped, red anything else */}
        <span className={`shrink-0 text-xs px-2 py-0.5 rounded font-medium ${call.status === "completed" ? "bg-success/10 text-success" :
          call.status === "dropped" ? "bg-warning/10 text-warning" :
            "bg-destructive/10 text-destructive"
          }`}>
          {call.status.toUpperCase()}
        </span>
      </div>

      {(loadErrors.length > 0 || contextLoadErrors.length > 0) && (
        <div className="rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
          Μερικά API panels απέτυχαν: {[...loadErrors, ...contextLoadErrors].join(", ")}. Τα κενά τους δεν θεωρούνται «χωρίς δεδομένα».
        </div>
      )}

      {callMode === "SRVCC" && (
        <div className="bg-card border border-border rounded-lg p-3 space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            {/* Κλειστό εξ ορισμού — η γραμμή από μόνη της λέει την έκβαση του handover,
                που είναι και το μόνο που χρειάζεται συνήθως. */}
            <button
              type="button"
              onClick={() => setSrvccOpen(!srvccOpen)}
              aria-expanded={srvccOpen}
              className="min-w-0 text-left"
            >
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <ChevronRight className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${srvccOpen ? "rotate-90" : ""}`} />
                <Signal className="h-4 w-4 text-primary" />
                SRVCC Transition
                {primarySrvccEvent && (
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                    primarySrvccEvent.Status === "Success"
                      ? "bg-success/10 text-success"
                      : "bg-destructive/10 text-destructive"
                  }`}>
                    {primarySrvccEvent.HandoverType} {primarySrvccEvent.Status}
                    {primarySrvccEvent.InterruptionMs != null ? ` · ${primarySrvccEvent.InterruptionMs} ms` : ""}
                  </span>
                )}
              </h3>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                KPI 38040/38050 · κοινός χρόνος LTE → 3G/2G · {srvccWindowSec === "all" ? "όλη η κλήση" : `παράθυρο ±${srvccWindowSec}s`} · {srvccTransitionData.length} δείγματα
              </p>
            </button>
            {new Set(srvccEvents.map((event) => event.Side).filter(Boolean)).size > 1 && (
              <div className="inline-flex rounded-md border border-border overflow-hidden">
                {(["A", "B"] as const).map((side) => (
                  <button
                    key={side}
                    type="button"
                    onClick={() => setSelectedLteSide(side)}
                    className={`px-2 py-1 text-xs ${side === "B" ? "border-l border-border" : ""} ${selectedLteSide === side ? "bg-primary text-primary-foreground" : "bg-muted text-foreground hover:bg-muted/80"}`}
                  >
                    {side}-side
                  </button>
                ))}
              </div>
            )}
          </div>

          {srvccOpen && (isLoadingRadio ? (
            <p className="text-xs text-muted-foreground">Φόρτωση SRVCC diagnostics...</p>
          ) : srvccError ? (
            <div className="rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {srvccError}
            </div>
          ) : srvccEvents.length === 0 ? (
            <div className="rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-400">
              Η κλήση χαρακτηρίζεται SRVCC, αλλά δεν βρέθηκε KPI 38040 ή 38050 για το A/B pair.
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-2">
                {srvccEvents.map((event, idx) => {
                  const isSuccess = event.Status === "Success";
                  const isSelected = (event.Side ?? "A") === selectedLteSide;
                  return (
                    <button
                      key={`${event.SessionId ?? "srvcc"}-${event.MsgId ?? idx}`}
                      type="button"
                      onClick={() => event.Side === "A" || event.Side === "B" ? setSelectedLteSide(event.Side) : undefined}
                      className={`text-left rounded border p-2 transition-colors ${isSelected ? "border-primary/70 bg-primary/5" : "border-border bg-muted/20 hover:bg-muted/40"}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-bold font-mono">{event.Side ?? "A"}-side · {event.HandoverType}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${isSuccess ? "bg-success/10 text-success" : event.Status === "Fail" ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground"}`}>
                          {event.Status}
                        </span>
                      </div>
                      <div className="mt-1 flex items-center gap-3 text-[10px] text-muted-foreground">
                        <span>{event.EventTime ? formatDateTime(event.EventTime) : "Χωρίς χρόνο"}</span>
                        <span className="font-mono text-foreground">{event.InterruptionMs != null ? `${Number(event.InterruptionMs).toFixed(0)} ms` : "—"}</span>
                      </div>
                    </button>
                  );
                })}
              </div>

              {srvccTransitionData.length > 0 && (
                <div className="rounded border border-border/60 bg-muted/10 p-2">
                  {/* Controls: σειρές (ισχύς/ποιότητα/SINR), κατώφλια, δείγματα και εύρος παραθύρου —
                      ίδια φιλοσοφία με τα checkboxes του κύριου RSRP/RxLev διαγράμματος. */}
                  <div className="mb-1.5 flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-3 flex-wrap bg-muted/40 px-2 py-0.5 rounded border border-border/50">
                      {([
                        ["Ισχύς (RSRP/RxLev)", srvccShowStrength, setSrvccShowStrength],
                        ["Ποιότητα (RSRQ/RxQual)", srvccShowQuality, setSrvccShowQuality],
                        ["SINR", srvccShowSinr, setSrvccShowSinr],
                        ["Κατώφλια", srvccShowThresholds, setSrvccShowThresholds],
                        ["Δείγματα", srvccShowDots, setSrvccShowDots],
                      ] as const).map(([label, checked, setChecked]) => (
                        <label key={label} className="flex items-center gap-1.5 text-[10px] font-medium text-foreground cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => setChecked(e.target.checked)}
                            className="h-3 w-3 rounded-sm border-primary text-primary focus:ring-primary"
                          />
                          {label}
                        </label>
                      ))}
                    </div>
                    <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                      <span>Παράθυρο</span>
                      <div className="inline-flex rounded border border-border overflow-hidden">
                        {([["all", "Όλη η κλήση"], [5, "±5s"], [15, "±15s"], [30, "±30s"], [60, "±60s"]] as const).map(([value, label], idx) => (
                          <button
                            key={value}
                            type="button"
                            onClick={() => setSrvccWindowSec(value)}
                            className={`px-1.5 py-0.5 font-mono ${idx > 0 ? "border-l border-border" : ""} ${srvccWindowSec === value ? "bg-primary text-primary-foreground" : "bg-muted text-foreground hover:bg-muted/80"}`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Legend — μόνο οι σειρές που είναι όντως ενεργές */}
                  <div className="flex items-center gap-3 mb-1 text-[10px] text-muted-foreground flex-wrap">
                    {srvccShowStrength && <span className="flex items-center gap-1"><span className="inline-block w-3 h-0.5 bg-green-500" />LTE RSRP (dBm)</span>}
                    {srvccShowStrength && <span className="flex items-center gap-1"><span className="inline-block w-3 h-0.5 bg-amber-400" />GSM RxLev (dBm)</span>}
                    {srvccShowQuality && <span className="flex items-center gap-1"><span className="inline-block w-3 h-0.5 bg-sky-400" />LTE RSRQ (dB)</span>}
                    {srvccShowQuality && <span className="flex items-center gap-1"><span className="inline-block w-3 h-0.5 bg-slate-200" />GSM RxQual (0-7)</span>}
                    {srvccShowSinr && <span className="flex items-center gap-1"><span className="inline-block w-3 h-0.5 bg-purple-400" />LTE SINR (dB)</span>}
                    <span className="flex items-center gap-1"><span className="inline-block w-3 h-1.5 bg-red-500/30 border border-red-500/60" />Interruption</span>
                  </div>

                  <ResponsiveContainer width="100%" height={260}>
                    <LineChart data={srvccTransitionData} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#ffffff18" />
                      <XAxis
                        dataKey="timestamp"
                        type="number"
                        scale="time"
                        domain={["dataMin", "dataMax"]}
                        tickFormatter={(value: number) => new Date(value).toLocaleTimeString("el-GR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                        tick={{ fontSize: 9, fill: "#94a3b8" }}
                      />
                      <YAxis yAxisId="strength" domain={[-140, -40]} tick={{ fontSize: 9, fill: "#94a3b8" }} width={34} unit=" dBm" />
                      {(srvccShowQuality || srvccShowSinr) && (
                        <YAxis
                          yAxisId="db"
                          orientation="right"
                          domain={srvccShowSinr ? [-25, 30] : [-25, 0]}
                          tick={{ fontSize: 9, fill: "#94a3b8" }}
                          width={30}
                          unit=" dB"
                        />
                      )}
                      {srvccShowQuality && (
                        <YAxis yAxisId="rxqual" orientation="right" domain={[0, 7]} reversed tick={{ fontSize: 9, fill: "#94a3b8" }} width={20} />
                      )}

                      {/* Φάσεις: LTE μέχρι το handover, το interruption παράθυρο του KPI, GSM μετά */}
                      {srvccWindow && (
                        <>
                          <ReferenceArea
                            yAxisId="strength"
                            x1={Number.isFinite(srvccWindow.start) ? srvccWindow.start : srvccTransitionData[0].timestamp}
                            x2={srvccWindow.first}
                            fill="#22c55e"
                            fillOpacity={0.06}
                          />
                          <ReferenceArea
                            yAxisId="strength"
                            x1={srvccWindow.last}
                            x2={Number.isFinite(srvccWindow.end) ? srvccWindow.end : srvccTransitionData[srvccTransitionData.length - 1].timestamp}
                            fill="#fbbf24"
                            fillOpacity={0.06}
                          />
                        </>
                      )}
                      {activeSrvccEvents.map((event, idx) => {
                        if (!event.EventTime || event.InterruptionMs == null) return null;
                        const eventTs = new Date(event.EventTime).getTime();
                        return (
                          <ReferenceArea
                            key={`${event.MsgId ?? idx}-gap`}
                            yAxisId="strength"
                            x1={eventTs}
                            x2={eventTs + Number(event.InterruptionMs)}
                            fill="#ef4444"
                            fillOpacity={0.28}
                            stroke="#ef4444"
                            strokeOpacity={0.5}
                          />
                        );
                      })}

                      {/* Κατώφλια ανά τεχνολογία — ίδιες τιμές με το κύριο διάγραμμα
                          (LTE RSRP -115/-120 dBm, GSM RxLev -88/-92 dBm) */}
                      {srvccShowThresholds && srvccShowStrength && (
                        <>
                          <ReferenceLine yAxisId="strength" y={-115} stroke="#22c55e" strokeOpacity={0.5} strokeDasharray="2 4" label={{ value: "LTE -115", position: "insideLeft", fill: "#22c55e", fontSize: 8 }} />
                          <ReferenceLine yAxisId="strength" y={-120} stroke="#22c55e" strokeOpacity={0.35} strokeDasharray="2 4" />
                          <ReferenceLine yAxisId="strength" y={-88} stroke="#fbbf24" strokeOpacity={0.5} strokeDasharray="2 4" label={{ value: "GSM -88", position: "insideRight", fill: "#fbbf24", fontSize: 8 }} />
                          <ReferenceLine yAxisId="strength" y={-92} stroke="#fbbf24" strokeOpacity={0.35} strokeDasharray="2 4" />
                        </>
                      )}

                      <RechartsTooltip
                        cursor={{ stroke: "#64748b", strokeDasharray: "3 3" }}
                        content={({ active, payload }: any) => {
                          if (!active || !payload?.length) return null;
                          const point = payload[0].payload as typeof srvccTransitionData[number];
                          const deltaMs = srvccWindow ? point.timestamp - srvccWindow.first : null;
                          const rows: Array<[string, string]> = [];
                          if (point.LTE_RSRP != null) rows.push(["LTE RSRP", `${point.LTE_RSRP.toFixed(1)} dBm`]);
                          if (point.LTE_RSRQ != null) rows.push(["LTE RSRQ", `${point.LTE_RSRQ.toFixed(1)} dB`]);
                          if (point.LTE_SINR != null) rows.push(["LTE SINR", `${point.LTE_SINR.toFixed(1)} dB`]);
                          if (point.LTE_EARFCN != null || point.LTE_PCI != null) rows.push(["EARFCN / PCI", `${point.LTE_EARFCN ?? "—"} / ${point.LTE_PCI ?? "—"}`]);
                          if (point.LTE_CGI) rows.push(["LTE CGI", String(point.LTE_CGI)]);
                          if (point.GSM_RxLev != null) rows.push(["GSM RxLev", `${point.GSM_RxLev.toFixed(1)} dBm`]);
                          if (point.GSM_RxQual != null) rows.push(["GSM RxQual", point.GSM_RxQual.toFixed(0)]);
                          if (point.GSM_BAND) rows.push(["GSM band", String(point.GSM_BAND)]);
                          if (point.GSM_CGI) rows.push(["GSM CGI", String(point.GSM_CGI)]);
                          return (
                            <div className="rounded border border-border bg-card/95 px-2 py-1.5 text-[10px] shadow-lg">
                              <div className="font-mono text-foreground">
                                {new Date(point.timestamp).toLocaleTimeString("el-GR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                              </div>
                              {deltaMs != null && (
                                <div className="text-muted-foreground mb-1">
                                  {deltaMs >= 0 ? "+" : ""}{(deltaMs / 1000).toFixed(1)}s ως προς το handover
                                </div>
                              )}
                              <div className="grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5">
                                {rows.map(([label, value]) => (
                                  <div key={label} className="contents">
                                    <span className="text-muted-foreground">{label}</span>
                                    <span className="font-mono text-foreground text-right break-all">{value}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          );
                        }}
                      />

                      {activeSrvccEvents.map((event, idx) => event.EventTime && (
                        <ReferenceLine
                          key={`${event.MsgId ?? idx}-line`}
                          yAxisId="strength"
                          x={new Date(event.EventTime).getTime()}
                          stroke={event.Status === "Success" ? "#22c55e" : "#ef4444"}
                          strokeWidth={2}
                          strokeDasharray="4 3"
                          label={{ value: `${event.HandoverType} ${event.InterruptionMs ?? "—"}ms`, position: "insideTopRight", fill: "#cbd5e1", fontSize: 10 }}
                        />
                      ))}

                      {srvccShowStrength && <Line yAxisId="strength" type="monotone" dataKey="LTE_RSRP" stroke="#22c55e" dot={srvccShowDots ? { r: 1.5, fill: "#22c55e" } : false} strokeWidth={2} name="LTE RSRP" />}
                      {srvccShowStrength && <Line yAxisId="strength" type="monotone" dataKey="GSM_RxLev" stroke="#fbbf24" dot={srvccShowDots ? { r: 1.5, fill: "#fbbf24" } : false} strokeWidth={2} name="GSM RxLev" />}
                      {srvccShowQuality && <Line yAxisId="db" type="monotone" dataKey="LTE_RSRQ" stroke="#38bdf8" dot={false} strokeWidth={1.5} strokeDasharray="4 2" name="LTE RSRQ" />}
                      {srvccShowQuality && <Line yAxisId="rxqual" type="monotone" dataKey="GSM_RxQual" stroke="#e2e8f0" dot={false} strokeWidth={1.5} strokeDasharray="4 2" name="GSM RxQual" />}
                      {srvccShowSinr && <Line yAxisId="db" type="monotone" dataKey="LTE_SINR" stroke="#a855f7" dot={false} strokeWidth={1.5} strokeDasharray="2 2" name="LTE SINR" />}
                    </LineChart>
                  </ResponsiveContainer>

                  {/* Μετρημένα στοιχεία των δύο σκελών + το πραγματικό ραδιο-κενό μεταξύ τους */}
                  {srvccLegStats && (
                    <div className="mt-1.5 grid grid-cols-1 md:grid-cols-3 gap-1.5 text-[10px]">
                      <div className="rounded border border-green-500/25 bg-green-500/5 px-2 py-1">
                        <div className="text-green-400 font-semibold uppercase tracking-wider">LTE leg (RSRP)</div>
                        {srvccLegStats.lte ? (
                          <div className="mt-0.5 flex flex-wrap gap-x-3 text-muted-foreground">
                            <span>n <b className="text-foreground font-mono">{srvccLegStats.lte.samples}</b></span>
                            <span>avg <b className="text-foreground font-mono">{srvccLegStats.lte.avg.toFixed(1)}</b></span>
                            <span>min <b className="text-foreground font-mono">{srvccLegStats.lte.min.toFixed(1)}</b></span>
                            <span>max <b className="text-foreground font-mono">{srvccLegStats.lte.max.toFixed(1)}</b></span>
                            {srvccLegStats.lteRsrq && <span>RSRQ avg <b className="text-foreground font-mono">{srvccLegStats.lteRsrq.avg.toFixed(1)}</b></span>}
                          </div>
                        ) : <div className="mt-0.5 text-muted-foreground">Χωρίς LTE δείγματα στο παράθυρο.</div>}
                      </div>
                      <div className="rounded border border-red-500/25 bg-red-500/5 px-2 py-1">
                        <div className="text-red-400 font-semibold uppercase tracking-wider">Μετάβαση</div>
                        <div className="mt-0.5 flex flex-wrap gap-x-3 text-muted-foreground">
                          <span>KPI <b className="text-foreground font-mono">{primarySrvccEvent?.InterruptionMs != null ? `${Number(primarySrvccEvent.InterruptionMs).toFixed(0)} ms` : "—"}</b></span>
                          <span>ραδιο-κενό <b className="text-foreground font-mono">{srvccLegStats.radioGapMs != null ? `${srvccLegStats.radioGapMs} ms` : "—"}</b></span>
                          <span>Δ ισχύος <b className="text-foreground font-mono">{srvccLegStats.deltaDb != null ? `${srvccLegStats.deltaDb > 0 ? "+" : ""}${srvccLegStats.deltaDb.toFixed(1)} dB` : "—"}</b></span>
                        </div>
                        <div className="mt-0.5 text-muted-foreground">
                          τελευταίο RSRP <b className="text-foreground font-mono">{srvccLegStats.lastLte?.LTE_RSRP != null ? `${srvccLegStats.lastLte.LTE_RSRP.toFixed(1)} dBm` : "—"}</b>
                          {" → "}
                          πρώτο RxLev <b className="text-foreground font-mono">{srvccLegStats.firstGsm?.GSM_RxLev != null ? `${srvccLegStats.firstGsm.GSM_RxLev.toFixed(1)} dBm` : "—"}</b>
                        </div>
                      </div>
                      <div className="rounded border border-amber-500/25 bg-amber-500/5 px-2 py-1">
                        <div className="text-amber-400 font-semibold uppercase tracking-wider">GSM leg (RxLev)</div>
                        {srvccLegStats.gsm ? (
                          <div className="mt-0.5 flex flex-wrap gap-x-3 text-muted-foreground">
                            <span>n <b className="text-foreground font-mono">{srvccLegStats.gsm.samples}</b></span>
                            <span>avg <b className="text-foreground font-mono">{srvccLegStats.gsm.avg.toFixed(1)}</b></span>
                            <span>min <b className="text-foreground font-mono">{srvccLegStats.gsm.min.toFixed(1)}</b></span>
                            <span>max <b className="text-foreground font-mono">{srvccLegStats.gsm.max.toFixed(1)}</b></span>
                            {srvccLegStats.gsmRxQual && <span>RxQual avg <b className="text-foreground font-mono">{srvccLegStats.gsmRxQual.avg.toFixed(1)}</b></span>}
                          </div>
                        ) : <div className="mt-0.5 text-muted-foreground">Χωρίς GSM δείγματα στο παράθυρο.</div>}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {primarySrvccEvent && (
                <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto_1fr] gap-2 items-stretch">
                  <div className="rounded border border-green-500/30 bg-green-500/5 p-2">
                    <div className="text-[10px] uppercase tracking-wider text-green-400 font-semibold mb-1">Source LTE</div>
                    <div className="text-xs font-bold">{primarySrvccEvent.SourceTechnology ?? "LTE"} · Band {primarySrvccEvent.SourceBand ?? "—"}</div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-x-3 gap-y-1 mt-2 text-[10px]">
                      <span>EARFCN <b className="text-foreground">{primarySrvccEvent.SourceEARFCN ?? "—"}</b></span>
                      <span>PCI <b className="text-foreground">{primarySrvccEvent.SourcePCI ?? "—"}</b></span>
                      <span>RSRP <b className="text-foreground">{primarySrvccEvent.SourceRSRP != null ? `${primarySrvccEvent.SourceRSRP} dBm` : "—"}</b></span>
                      <span>RSRQ <b className="text-foreground">{primarySrvccEvent.SourceRSRQ != null ? `${primarySrvccEvent.SourceRSRQ} dB` : "—"}</b></span>
                      <span>SINR <b className="text-foreground">{primarySrvccEvent.SourceSINR != null ? `${primarySrvccEvent.SourceSINR} dB` : "—"}</b></span>
                      <span>CGI <b className="text-foreground break-all">{primarySrvccEvent.SourceRadioCGI ?? primarySrvccEvent.SourceCGI ?? "—"}</b></span>
                      <span>DL BW <b className="text-foreground">{primarySrvccEvent.SourceDLBandwidth ?? "—"}</b></span>
                      <span>UL BW <b className="text-foreground">{primarySrvccEvent.SourceULBandwidth ?? "—"}</b></span>
                    </div>
                  </div>
                  <div className="flex items-center justify-center px-2 text-primary font-bold text-lg">→</div>
                  <div className="rounded border border-amber-500/30 bg-amber-500/5 p-2">
                    <div className="text-[10px] uppercase tracking-wider text-amber-400 font-semibold mb-1">Target {primarySrvccEvent.HandoverType.endsWith("2G") ? "GSM" : "3G"}</div>
                    <div className="text-xs font-bold">{primarySrvccEvent.TargetTechnology ?? primarySrvccEvent.HandoverType.split("->")[1]} · Band {primarySrvccEvent.TargetBand ?? primarySrvccEvent.TargetRadioBand ?? "—"}</div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-x-3 gap-y-1 mt-2 text-[10px]">
                      <span>CGI <b className="text-foreground break-all">{primarySrvccEvent.TargetRadioCGI ?? primarySrvccEvent.TargetCGI ?? "—"}</b></span>
                      <span>Cell ID <b className="text-foreground">{primarySrvccEvent.TargetCellId ?? "—"}</b></span>
                      <span>LAC <b className="text-foreground">{primarySrvccEvent.TargetLAC ?? "—"}</b></span>
                      <span>BCCH <b className="text-foreground">{primarySrvccEvent.TargetBCCH ?? "—"}</b></span>
                      <span>BSIC <b className="text-foreground">{primarySrvccEvent.TargetBSIC ?? "—"}</b></span>
                      <span>RxLev <b className="text-foreground">{primarySrvccEvent.TargetRxLev != null ? `${primarySrvccEvent.TargetRxLev} dBm` : "—"}</b></span>
                      <span>RxQual <b className="text-foreground">{primarySrvccEvent.TargetRxQual ?? "—"}</b></span>
                      <span>Operator <b className="text-foreground">{primarySrvccEvent.TargetOperator ?? primarySrvccEvent.SourceOperator ?? "—"}</b></span>
                    </div>
                  </div>
                </div>
              )}
            </>
          ))}
        </div>
      )}

      {/* ── CSFB Transition ──
          Ίδια δουλειά με το SRVCC panel από πάνω, για την πτώση LTE → 2G/3G που στήνει
          την κλήση. Εμφανίζεται όταν το /api/call_csfb_detail βρει CSFB KPIs — και σε
          κλήσεις που δεν είναι περασμένες CSFB, όταν η μία πλευρά έπεσε σε 2G. */}
      <CsfbTransitionPanel
        events={csfbDetail?.events ?? []}
        steps={csfbDetail?.steps ?? []}
        lteRows={radioValues}
        gsmRows={gsmValues}
        lteRowsBSide={bSideLteValues}
        gsmRowsBSide={bSideGsmValues}
        selectedSide={selectedLteSide}
        onSelectSide={setSelectedLteSide}
        open={csfbOpen}
        onOpenChange={setCsfbOpen}
        loading={isLoadingRadio}
        error={csfbError}
        hoveredTime={hoveredTime}
        onHoverTime={setHoveredTime}
      />

      {/* Call Info Header & Chart */}
      <div className="bg-card border border-border rounded-lg p-2">
        <div className="flex items-start gap-3 mb-1">
          {/* Left: call info */}
          <div className="flex-1 min-w-0">

            {/* <div className="bg-card border border-border rounded-lg p-5">
            <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
              <Activity className="h-4 w-4 text-primary" />
              TraceLog
            </h3>

            {isLoadingRadio ? (
              <p className="text-xs text-muted-foreground">Φόρτωση δεδομένων...</p>
            ) : tracelogValues && tracelogValues.length > 0 ? (
              <div className="overflow-x-auto max-h-[300px] overflow-y-auto flex">
                <table className="w-full text-xs text-left">
                  <thead className="sticky top-0 bg-muted border-b border-border z-10">
                    <tr>
                      <th className="px-2 py-1 font-semibold">FactId</th>
                      <th className="px-2 py-1 font-semibold">FullDate</th>
                      <th className="px-2 py-1 font-semibold">Info</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {tracelogValues.map((val, idx) => (
                      <tr key={`${val.FactId ?? idx}-${idx}`} className="hover:bg-muted/30">
                        <td className="px-2 py-1 font-mono">{val.FactId ?? "N/A"}</td>
                        <td className="px-2 py-1">{val.FullDate ? formatDateTime(val.FullDate) : "N/A"}</td>
                        <td className="px-2 py-1 font-mono whitespace-pre-wrap break-words max-w-[520px]">{val.Info ?? "N/A"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Δεν υπάρχουν TraceLog δεδομένα.</p>
            )}
          </div> */}

            <div className="flex items-center gap-3 flex-wrap">
              <h2 className="text-sm font-bold font-mono text-foreground">{call.region} · {call.callId}</h2>
            </div>
            {/* Call meta + timing on one line */}
            <div className="text-[10px] text-muted-foreground flex flex-wrap items-center gap-x-3 mt-0.5">
              <span className="text-xs">{call.callType} · {call.technology} · {call.operator}</span>
              <span>Έναρξη: {formatDateTime(call.startTime)}</span>
              <span>Λήξη: {formatDateTime(call.endTime)}</span>
              <span className="font-mono text-foreground">{Math.floor(call.duration_s / 60)}m {call.duration_s % 60}s</span>
            </div>
            {/* Single signalling strip: SRVCC handovers │ voice codec │ serving cell + A/B side status */}
            {(headerHandoverInfo.length > 0 || voiceCodec.length > 0 || (!isGSMMode && activeCellInfo && activeCellInfo.eNBId !== null)) && (
              <div className="flex items-center gap-x-2 gap-y-0.5 flex-wrap mt-0.5 text-[10px] font-mono">
                {headerHandoverInfo.length > 0 && (
                  <>
                    <span className="text-muted-foreground uppercase tracking-wider">HO</span>
                    {headerHandoverInfo.map((ho, idx) => {
                      const isSuccess = ho.HoStatus?.toLowerCase().includes("success");
                      return (
                        <span
                          key={idx}
                          className={`px-1.5 py-0.5 rounded font-semibold ${isSuccess ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"}`}
                          title={ho.MsgTime ? formatDateTime(ho.MsgTime) : undefined}
                        >
                          {ho.HoStatus ?? "N/A"}{ho.hoDuration != null ? ` (${ho.hoDuration} ms)` : ""}
                        </span>
                      );
                    })}
                  </>
                )}
                {voiceCodec.length > 0 && (
                  <>
                    {headerHandoverInfo.length > 0 && <span className="text-border">│</span>}
                    <span className="text-muted-foreground uppercase tracking-wider">Codec</span>
                    {(["U", "D"] as const).map((dir) => {
                      const last = [...voiceCodec].reverse().find((c) => c.Direction === dir);
                      if (!last) return null;
                      return (
                        <span key={dir} className="text-muted-foreground">
                          {dir === "U" ? "UL" : "DL"}{" "}
                          <span className="text-foreground font-bold">{last.CodecName ?? `#${last.Codec}`}</span>
                          {last.CodecRate != null ? ` (${last.CodecRate} kbps)` : ""}
                        </span>
                      );
                    })}
                  </>
                )}
                {!isGSMMode && activeCellInfo && activeCellInfo.eNBId !== null && (
                  <>
                    {(headerHandoverInfo.length > 0 || voiceCodec.length > 0) && <span className="text-border">│</span>}
                    <span className="text-muted-foreground">eNB <span className="text-foreground font-bold">{activeCellInfo.eNBId}</span></span>
                    <span className="text-muted-foreground">EARFCN <span className="text-primary font-bold">{activeCellInfo.EARFCN}</span></span>
                    <span className="text-muted-foreground">PCI <span className="text-accent font-bold">{activeCellInfo.PCI}</span></span>
                    {mapActiveAntenna && (
                      <>
                        <span className="text-muted-foreground">Dist <span className="text-yellow-400 font-bold">{fmtDist(mapActiveAntenna.distanceM)}</span></span>
                        {mapActiveAntenna.cellName && (
                          <span className="text-muted-foreground truncate max-w-[160px]">{mapActiveAntenna.cellName}</span>
                        )}
                      </>
                    )}
                    {/* Per-side call outcome (e.g. status/reason code) when both A and B side data is available */}
                    {sideComparison.length > 0 && (
                      <>
                        <span className="text-border">│</span>
                        {sideComparison.map((row, idx) => (
                          <span key={idx} className="text-muted-foreground whitespace-nowrap">
                            <span className="text-foreground font-bold">{row.Side}</span>
                            {" "}{row.callStatus}{" "}
                            <span className="text-foreground">{row.code}</span>
                            {row.codeDescription ? ` ${row.codeDescription}` : ""}
                            {idx < sideComparison.length - 1 && <span className="text-border mx-1">·</span>}
                          </span>
                        ))}
                      </>
                    )}
                  </>
                )}
              </div>
            )}
          </div>

          {/* Middle: Prev/Next call navigation — στο κενό ανάμεσα στο call info και το σχόλιο.
              Disabled όταν το backend επιστρέψει null (δεν υπάρχει γειτονική κλήση). */}
          <div className="flex items-center gap-1.5 flex-shrink-0 self-center">
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs px-2"
              disabled={!onNavigateToCall || !neighbors?.prevSessionId}
              onClick={() => {
                if (neighbors?.prevSessionId && onNavigateToCall) onNavigateToCall(String(neighbors.prevSessionId));
              }}
              title={neighbors?.prevSessionId ? `Session ${neighbors.prevSessionId}` : "Δεν υπάρχει προηγούμενη κλήση"}
            >
              <ChevronLeft className="h-3.5 w-3.5 mr-1" />
              Prev Call
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs px-2"
              disabled={!onNavigateToCall || !neighbors?.nextSessionId}
              onClick={() => {
                if (neighbors?.nextSessionId && onNavigateToCall) onNavigateToCall(String(neighbors.nextSessionId));
              }}
              title={neighbors?.nextSessionId ? `Session ${neighbors.nextSessionId}` : "Δεν υπάρχει επόμενη κλήση"}
            >
              Next Call
              <ChevronRight className="h-3.5 w-3.5 ml-1" />
            </Button>
          </div>

          {/* Right: Comment */}
          <div className="w-80 flex-shrink-0 bg-muted/40 px-2 py-1 rounded border border-border">
            <div className="flex items-center justify-between mb-0.5">
              <span className="text-[10px] font-semibold text-foreground uppercase tracking-wider">Σχόλιο</span>
              {!isEditingComment && (
                <Button size="sm" variant="ghost" className="h-5 text-[10px] px-1.5" onClick={() => setIsEditingComment(true)}>
                  <Edit2 className="w-2.5 h-2.5 mr-1" /> Επεξ.
                </Button>
              )}
            </div>
            {/* Editable comment box: quick-select dropdown of common tags plus a free-text textarea */}
            {isEditingComment ? (
              <div className="space-y-1">
                {/* Dropdown quick-select — picking an option overwrites commentText, it does not append */}
                <select
                  className="w-full text-xs rounded border border-border bg-muted/60 px-2 py-1 text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  value=""
                  onChange={(e) => {
                    if (e.target.value) setCommentText(e.target.value);
                  }}
                >
                  <option value="" disabled>⚡ Γρήγορη επιλογή...</option>
                  <option value="LC GSM">LC GSM</option>
                  <option value="LQ GSM">LQ GSM</option>
                  <option value="LC LTE">LC LTE</option>
                  <option value="LQ LTE">LQ LTE</option>
                  <option value="CORE NETWORK (DEACTIVATE BEARER)">CORE NETWORK (DEACTIVATE BEARER)</option>
                  <option value="FAKE UE STUCK">FAKE UE STUCK</option>
                  <option value="FAKE NO SYNC">FAKE NO SYNC</option>
                  <option value="FAKE EOF">FAKE EOF</option>
                  <option value="">— Εκκαθάριση σχολίου</option>
                </select>
                <Textarea
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  placeholder="Ή γράψε ελεύθερο σχόλιο..."
                  className="text-xs min-h-[48px] resize-y"
                />
                <div className="flex justify-end gap-1">
                  <Button size="sm" variant="outline" className="h-6 text-xs px-2" onClick={() => { setIsEditingComment(false); setCommentText(call.comment || ""); }} disabled={isSavingComment}>Ακύρωση</Button>
                  <Button size="sm" className="h-6 text-xs px-2" onClick={handleSaveComment} disabled={isSavingComment}>
                    {isSavingComment ? "..." : <><Save className="w-2.5 h-2.5 mr-1" />Αποθήκευση</>}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="text-xs text-muted-foreground whitespace-pre-wrap">{call.comment || "—"}</div>
            )}
          </div>
        </div>

        {/* Χάρτης της κλήσης — το διάγραμμα σήματος έφυγε από εδώ και μπήκε σε δικό του,
            καρφιτσώσιμο block ακριβώς από κάτω (CallSignalChart), ώστε να μένει ορατό
            όσο κυλάς τους πίνακες. */}
        {activeRadioValues && activeRadioValues.length > 0 && (
          <div className="mt-1 pt-1 border-t border-border">
            {/* Χάρτης — μόνο σε Cosmote Free, κλειστός εξ ορισμού. Η γραμμή από πάνω λέει τι
                κρύβει (σημεία GPS, απόσταση κεραίας) ώστε να ξέρεις αν αξίζει να τον ανοίξεις. */}
            {isCosmoteFree && (
              <div className="rounded border border-border/50">
                <div className="flex items-center justify-between gap-2 px-2 py-1">
                  <button
                    type="button"
                    onClick={() => setMapOpen(!mapOpen)}
                    aria-expanded={mapOpen}
                    className="inline-flex min-w-0 items-center gap-1 text-[10px] font-medium text-foreground hover:text-primary"
                  >
                    <ChevronRight className={`h-3 w-3 shrink-0 text-muted-foreground transition-transform ${mapOpen ? "rotate-90" : ""}`} />
                    <MapPin className="h-3 w-3 shrink-0 text-primary" />
                    Χάρτης κλήσης
                    <span className="truncate font-normal text-muted-foreground">
                      {mapFitPts.length === 0
                        ? "· χωρίς GPS"
                        : `· ${mapActivePts.length} σημεία GPS${mapActiveAntenna ? ` · κεραία σε ${fmtDist(mapActiveAntenna.distanceM)}` : " · χωρίς κεραία για το PCI"}`}
                    </span>
                  </button>
                  {/* Διαθέσιμο και με τον χάρτη κλειστό — συνήθως αυτό θέλεις τελικά */}
                  {mapFitPts.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setMapDialogOpen(true)}
                      title="Άνοιγμα του χάρτη σε μεγάλο παράθυρο"
                      className="inline-flex shrink-0 items-center gap-1 rounded border border-border bg-muted px-2 py-0.5 text-[10px] font-medium text-foreground hover:bg-muted/80"
                    >
                      <Maximize2 className="h-3 w-3" /> Μεγέθυνση
                    </button>
                  )}
                </div>
                {mapOpen && (mapFitPts.length === 0 ? (
                  <div className="flex items-center justify-center border-t border-border/50 bg-muted/30" style={{ height: "250px" }}>
                    <span className="text-[10px] text-muted-foreground">Χωρίς GPS</span>
                  </div>
                ) : (
                  // `relative z-0`: τα panes του Leaflet φτάνουν σε z-index 700 και, χωρίς δικό
                  // του stacking context, ο χάρτης ζωγραφιζόταν ΠΑΝΩ από το popup (z-50).
                  <div className="relative z-0 overflow-hidden border-t border-border/50" style={{ height: "250px" }}>
                    {renderCallMap("250px")}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Χάρτης κλήσης σε popup ── */}
      <Dialog open={mapDialogOpen} onOpenChange={setMapDialogOpen}>
        <DialogContent className="w-[1200px] max-w-[95vw] gap-2 p-3">
          <DialogHeader>
            <DialogTitle className="text-sm">
              Χάρτης κλήσης · {call.callId} · {selectedLteSide}-side
            </DialogTitle>
            <DialogDescription className="text-xs">
              {mapActivePts.length} σημεία GPS
              {mapActiveAntenna
                ? ` · κεραία ${mapActiveAntenna.cellName ?? mapActiveAntenna.enbName ?? "—"} σε ${fmtDist(mapActiveAntenna.distanceM)}`
                : " · δεν βρέθηκε κεραία για το PCI"}
            </DialogDescription>
          </DialogHeader>
          {/* Ο χάρτης στήνεται μόνο όσο το popup είναι ανοιχτό: το Leaflet χρειάζεται
              container με πραγματικές διαστάσεις για να μετρήσει σωστά. */}
          <div className="overflow-hidden rounded border border-border/50" style={{ height: "72vh" }}>
            {mapDialogOpen && mapFitPts.length > 0 && renderCallMap("100%", true)}
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Ενιαίο διάγραμμα σήματος ──
          Ένα διάγραμμα για όλη την κλήση: Session Overview + καμπύλη σήματος + ζώνες
          πριν/κατά/μετά + ταμπέλες L3, σε κοινό άξονα απόλυτου χρόνου. Όταν είναι
          καρφιτσωμένο μένει στην κορυφή όσο κυλάς τους πίνακες από κάτω, ώστε ο κοινός
          cursor να δείχνει πάντα πού πέφτει η γραμμή που κοιτάς. */}
      <div
        ref={chartWrapRef}
        className={chartPinned ? "sticky z-30 bg-background/95 backdrop-blur-sm rounded-lg" : ""}
        style={chartPinned ? { top: "var(--app-header-height, 57px)" } : undefined}
      >
        <CallSignalChart
          network={chartNetwork}
          technology={call.technology}
          samples={unifiedSamples}
          domain={unifiedDomain}
          callBounds={callBounds}
          overviewTimes={sessionOverview?.times ?? []}
          overviewLanes={sessionOverview?.lanes ?? []}
          events={signalEvents}
          hoveredTime={hoveredTime}
          onHoverTime={setHoveredTime}
          hoverFromOtherSide={hoveredSide != null && hoveredSide !== selectedLteSide}
          pinned={chartPinned}
          onPinnedChange={setChartPinned}
          subtitle={
            <>
              ±{viewWindowSec}s γύρω από την κλήση · {unifiedSamples.length} δείγματα · {selectedLteSide}-side
              {activeCallDir && (
                <span
                  className={`ml-1.5 px-1.5 py-0.5 rounded text-[12px] font-bold tracking-wide ${
                    activeCallDir === "MO" ? "bg-primary/15 text-primary" : "bg-accent/15 text-accent"
                  }`}
                  title={activeCallDir === "MO"
                    ? "Mobile Originated · από αυτό το κινητό ξεκίνησε η κλήση"
                    : "Mobile Terminated · αυτό το κινητό δέχθηκε την κλήση"}
                >
                  {activeCallDir}
                </span>
              )}
            </>
          }
          controls={
            <>
              {/* Ορατό παράθυρο — καθαρό φίλτρο εμφάνισης, δεν ξαναρωτάει τη βάση */}
              <div className="inline-flex rounded-md border border-border overflow-hidden">
                {VIEW_WINDOW_OPTIONS.map((seconds) => (
                  <button
                    key={seconds}
                    type="button"
                    onClick={() => setViewWindowSec(seconds)}
                    className={`px-2 py-1 text-[10px] border-r last:border-r-0 border-border ${viewWindowSec === seconds ? "bg-primary text-primary-foreground" : "bg-muted text-foreground hover:bg-muted/80"}`}
                  >
                    ±{seconds}s
                  </button>
                ))}
              </div>
              {/* Μία επιλογή πλευράς για όλη τη σελίδα — διάγραμμα, πίνακες και χάρτης μαζί */}
              <div className="inline-flex rounded-md border border-border overflow-hidden">
                {(["A", "B"] as const).map((side) => {
                  const enabled = side === "A" || hasBSideData;
                  return (
                    <button
                      key={side}
                      type="button"
                      disabled={!enabled}
                      onClick={() => enabled && setSelectedLteSide(side)}
                      title={enabled ? undefined : "Δεν υπάρχουν δεδομένα B-side"}
                      className={`px-2 py-1 text-[10px] ${side === "B" ? "border-l border-border" : ""} ${
                        selectedLteSide === side
                          ? "bg-primary text-primary-foreground"
                          : enabled
                            ? "bg-muted text-foreground hover:bg-muted/80"
                            : "bg-muted text-muted-foreground/40 cursor-not-allowed"
                      }`}
                    >
                      {side}-side
                    </button>
                  );
                })}
              </div>
            </>
          }
        />
      </div>

      {/* Panels Side by Side */}
      <div className="grid grid-cols-1 xl:grid-cols-3 lg:grid-cols-2 gap-2">
        {/* TraceLog panel (Αριστερά) */}
        <div className="bg-card border border-border rounded-lg p-2">
          <h3 className="text-xs font-semibold text-foreground mb-1 flex items-center gap-1.5">
            <Activity className="h-3 w-3 text-primary" />
            TraceLog
          </h3>

          {isLoadingRadio ? (
            <p className="text-xs text-muted-foreground">Φόρτωση δεδομένων...</p>
          ) : combinedTraceLog.length > 0 ? (
            <div className="overflow-x-auto max-h-[260px] overflow-y-auto">
              <table className="w-full text-xs text-left">
                <thead className="sticky top-0 bg-muted border-b border-border z-10">
                  <tr>
                    <th className="px-2 py-1 font-semibold">FullDate</th>
                    <th className="px-2 py-1 font-semibold">Side</th>
                    <th className="px-2 py-1 font-semibold">SessionId</th>
                    <th className="px-2 py-1 font-semibold">Info</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {combinedTraceLog.map((entry, idx) => {
                    const isActive = isHoveredIso(entry.time);
                    const isMarker = entry.kind === "marker";
                    // Flag TraceLog rows containing known failure/teardown keywords so they stand out in red
                    const isCritical = !isMarker && entry.info != null && [
                      "No sync signal found",
                      "Task stopped",
                      "Close Engine",
                      "System Release",
                    ].some(kw => entry.info!.includes(kw));
                    return (
                      <tr
                        key={`${entry.kind}-${entry.time ?? idx}-${idx}`}
                        style={isMarker
                          ? { boxShadow: "inset 3px 0 0 hsl(38, 92%, 50%)" }
                          : isCritical
                            ? { boxShadow: "inset 3px 0 0 hsl(0, 72%, 51%)" }
                            : isActive
                              ? { boxShadow: "inset 3px 0 0 hsl(180, 90%, 55%)" }
                              : undefined}
                        className={`transition-all duration-100 cursor-pointer ${isMarker
                          ? "bg-amber-500/10 text-amber-400"
                          : isCritical
                            ? "bg-red-500/15 text-red-400"
                            : isActive
                              ? "bg-cyan-500/10"
                              : "hover:bg-muted/40"
                          }`}
                        onMouseEnter={() => hoverIso(entry.time)}
                        onMouseLeave={() => setHoveredTime(null)}
                      >
                        <td className="px-1 py-0.5">{entry.time ? formatDateTime(entry.time) : "N/A"}</td>
                        <td className="px-1 py-0.5 font-mono">
                          {isMarker ? <Flag className="h-3 w-3 inline" /> : entry.side ?? "N/A"}
                        </td>
                        <td className="px-1 py-0.5 font-mono">{entry.sessionId ?? "N/A"}</td>
                        <td className="px-1 py-0.5 font-mono whitespace-pre-wrap break-words max-w-[400px]">{entry.info ?? "N/A"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Δεν υπάρχουν TraceLog δεδομένα.</p>
          )}
        </div>

        {/* KPI panel (Μέση) */}
        <div className="bg-card border border-border rounded-lg p-2">
          <h3 className="text-xs font-semibold text-foreground mb-1 flex items-center gap-1.5">
            <Activity className="h-3 w-3 text-primary" />
            KPI Results
          </h3>

          {isLoadingRadio ? (
            <p className="text-xs text-muted-foreground">Φόρτωση δεδομένων...</p>
          ) : kpiValues && kpiValues.length > 0 ? (
            <>
              <div className="overflow-x-auto max-h-[260px] overflow-y-auto">
                <table className="w-full text-xs text-center">
                  <thead className="sticky top-0 bg-muted border-b border-border z-10">
                    <tr>
                      <th className="px-2 py-1 font-semibold">MsgTime</th>
                      <th className="px-2 py-1 font-semibold text-[10px]">KPI</th>
                      <th className="px-2 py-1 font-semibold text-[10px]">Status / Code</th>
                      <th className="px-2 py-1 font-semibold text-[10px]">Value3</th>
                      <th className="px-2 py-1 font-semibold text-[10px]">Value4</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {/* Copy the array before sorting — kpiValues itself must stay in API order */}
                    {[...kpiValues]
                      .sort((a, b) => new Date(a.StartTime).getTime() - new Date(b.StartTime).getTime())
                      .map((val, idx) => {
                        const isActive = isHoveredIso(val.StartTime);
                        const rowKey = `${val.MsgId ?? "row"}-${idx}`;
                        const isOpen = expandedKpiRow === rowKey;
                        const failed = Number(val.ErrorCode) !== 0;
                        const duration = kpiDurationLabel(val.StartTime, val.EndTime);
                        // Τα πεδία που δεν χωράνε στις 6 στήλες — φαίνονται στο detail της γραμμής
                        const extras: [string, React.ReactNode][] = [
                          ["KPI Name", val.KPIName ?? KPI_LABELS[Number(val.KPIId)] ?? "—"],
                          ["KPI Id", val.KPIId ?? "—"],
                          ["Status", val.KPIStatus ?? (failed ? "Failed" : "Successful")],
                          ["ErrorCode", val.ErrorCode ?? "—"],
                          ["StartTime", val.StartTime ? formatDateTime(val.StartTime) : "—"],
                          ["EndTime", val.EndTime ? formatDateTime(val.EndTime) : "—"],
                          ["Duration", duration ?? "—"],
                          ["Counter", val.Counter ?? "—"],
                          ["Value1", val.Value1 ?? "—"],
                          ["Value2", val.Value2 ?? "—"],
                          ["Value3", val.Value3 ?? "—"],
                          ["Value4", val.Value4 ?? "—"],
                          ["Value5", val.Value5 ?? "—"],
                          ["MsgId", val.MsgId ?? "—"],
                          ["TestId", val.TestId ?? "—"],
                          ["SessionId", val.SessionId ?? "—"],
                        ];
                        return (
                          <Fragment key={rowKey}>
                            <tr
                              style={isActive ? { boxShadow: "inset 3px 0 0 hsl(180, 90%, 55%)" } : undefined}
                              className={`transition-all duration-100 cursor-pointer ${isActive
                                ? "bg-cyan-500/10"
                                : isOpen
                                  ? "bg-muted/60"
                                  : "hover:bg-muted/40"
                                }`}
                              onMouseEnter={() => hoverIso(val.StartTime)}
                              onMouseLeave={() => setHoveredTime(null)}
                              onClick={() => setExpandedKpiRow(isOpen ? null : rowKey)}
                              title="Κλικ για όλα τα πεδία του KPI"
                            >
                              <td className="px-1 py-0.5 whitespace-nowrap w-px">
                                <div className="flex items-center gap-1">
                                  <ChevronRight className={`h-2.5 w-2.5 shrink-0 text-muted-foreground transition-transform ${isOpen ? "rotate-90" : ""}`} />
                                  <span className="text-[10px]">{formatDateTime(val.StartTime)}</span>
                                </div>
                                {/* Η διάρκεια είναι το πιο χρήσιμο νούμερο ενός KPI (setup/handover time) */}
                                {duration && <div className="text-[9px] text-muted-foreground font-mono pl-3.5">{duration}</div>}
                              </td>
                              <td className="px-1 py-0.5 font-mono text-[10px]">
                                <div title={val.KPIName ?? undefined}>{val.KPIShortName ?? KPI_LABELS[Number(val.KPIId)] ?? `KPI ${val.KPIId}`}</div>
                                <div className="text-[8px] text-muted-foreground">ID {val.KPIId}</div>
                              </td>
                              <td className="px-1 py-0.5 font-mono text-[10px]">
                                <div className={failed ? "text-red-500" : "text-emerald-500"}>
                                  {val.KPIStatus ?? (failed ? "Failed" : "Successful")}
                                </div>
                                <div className="text-[8px] text-muted-foreground">{val.ErrorCode}</div>
                              </td>
                              <td className="px-1 py-0.5 font-mono text-[10px] max-w-[80px] break-all whitespace-normal overflow-hidden">{val.Value3}</td>
                              {/* Το Value4 κρατάει τη μεγαλύτερη συμβολοσειρά (π.χ. cause/description),
                                  οπότε παίρνει τον χώρο που ελευθέρωσε η στήλη Value5 */}
                              <td className="px-1 py-0.5 font-mono text-[10px] min-w-[160px] break-all whitespace-normal">{val.Value4}</td>
                            </tr>

                            {isOpen && (
                              <tr className="bg-muted/30">
                                <td colSpan={5} className="px-2 py-1.5 text-left">
                                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-3 gap-y-1">
                                    {extras.map(([label, value]) => (
                                      <div key={label} className="min-w-0">
                                        <div className="text-[9px] uppercase tracking-wide text-muted-foreground">{label}</div>
                                        <div className="text-[11px] font-mono text-foreground break-all">{value}</div>
                                      </div>
                                    ))}
                                  </div>
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                  </tbody>
                </table>
              </div>
              <p className="text-[9px] text-muted-foreground mt-1">Κλικ σε γραμμή για όλα τα πεδία (Value1/2/5, Counter, EndTime, IDs).</p>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">Δεν υπάρχουν KPI δεδομένα.</p>
          )}
        </div>

        {/* Radio Measurements Panel (Δεξιά) */}
        <div className="bg-card border border-border rounded-lg p-2">
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-xs font-semibold text-foreground flex items-center gap-1.5">
              <Signal className="h-3 w-3 text-primary" />
              {isGSMMode ? "GSM Measurements" : "LTE Measurements"}
            </h3>

            <div className="flex items-center gap-2">
              {/* SRVCC calls start on LTE and hand over to GSM mid-call, CSFB calls drop to GSM to
                  set the call up — this toggle lets the user inspect either leg's measurements,
                  and resets side back to "A" on switch */}
              {canToggleLeg && (
                <div className="inline-flex rounded-md border border-border overflow-hidden mr-2">
                  <button
                    type="button"
                    onClick={() => { setSrvccNetwork("LTE"); setSelectedLteSide("A"); }}
                    className={`px-2 py-1 text-xs ${activeLeg === "LTE" ? "bg-primary text-primary-foreground" : "bg-muted text-foreground hover:bg-muted/80"}`}
                  >
                    LTE
                  </button>
                  <button
                    type="button"
                    onClick={() => { setSrvccNetwork("GSM"); setSelectedLteSide("A"); }}
                    className={`px-2 py-1 text-xs border-l border-border ${activeLeg === "GSM" ? "bg-primary text-primary-foreground" : "bg-muted text-foreground hover:bg-muted/80"}`}
                  >
                    GSM
                  </button>
                </div>
              )}

              {/* Show A/B toggle only when B-side data exists for the current mode */}
              {(() => {
                const hasBSide = isGSMMode
                  ? bSideGsmValues.length > 0
                  : bSideLteValues.length > 0;
                if (!hasBSide && isLoadingRadio) {
                  // While loading, show the toggle (placeholder) so layout doesn't jump
                  return (
                    <div className="inline-flex rounded-md border border-border overflow-hidden opacity-40 pointer-events-none">
                      <button type="button" className="px-2 py-1 text-xs bg-primary text-primary-foreground">A-side</button>
                      <button type="button" className="px-2 py-1 text-xs border-l border-border bg-muted text-foreground">B-side</button>
                    </div>
                  );
                }
                if (!hasBSide) return null; // No B-side data — hide toggle entirely
                return (
                  <div className="inline-flex rounded-md border border-border overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setSelectedLteSide("A")}
                      className={`px-2 py-1 text-xs ${selectedLteSide === "A" ? "bg-primary text-primary-foreground" : "bg-muted text-foreground hover:bg-muted/80"}`}
                    >
                      A-side
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedLteSide("B")}
                      className={`px-2 py-1 text-xs border-l border-border ${selectedLteSide === "B" ? "bg-primary text-primary-foreground" : "bg-muted text-foreground hover:bg-muted/80"}`}
                    >
                      B-side
                    </button>
                  </div>
                );
              })()}
            </div>

          </div>



          {isLoadingRadio ? (
            <p className="text-xs text-muted-foreground">Φόρτωση δεδομένων...</p>
          ) : activeRadioValues && activeRadioValues.length > 0 ? (
            <div className="overflow-x-auto max-h-[260px] overflow-y-auto">
              {/* GSM table: BCCH/RxLev/RxQual/BSIC, with an optional scanner comparison column
                  (only shown once gsmScannerMatched has data) */}
              {isGSMMode ? (
                <table className="w-full text-xs text-center">
                  <thead className="sticky top-0 bg-muted border-b border-border z-10">
                    <tr>
                      <th className="px-1 py-1 font-semibold text-left">BCCH</th>
                      <th className="px-1 py-1 font-semibold text-left">Band</th>
                      <th className="px-1 py-1 font-semibold text-primary">RxLevSub</th>
                      {gsmScannerMatched.length > 0 && (
                        <th className="px-1 py-1 font-semibold text-cyan-400/80">RxLev Scanner</th>
                      )}
                      <th className="px-1 py-1 font-semibold">RxQualSub</th>
                      {gsmScannerMatched.length > 0 && (
                        <th className="px-1 py-1 font-semibold text-cyan-400/80">BSIC</th>
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {activeRadioValues.map((val, idx) => {
                      // Severity coloring uses |value| since RxLev/RxQual are stored as negative/positive
                      // magnitudes depending on source — thresholds tuned per column
                      const rxAbs = Math.abs(Number(val.RxLevSub));
                      const rxColor = rxAbs >= 95 ? "text-destructive" : rxAbs >= 90 ? "text-warning" : "text-primary";
                      const rxqAbs = Math.abs(Number(val.RxQualSub));
                      const rxqColor = rxqAbs >= 6 ? "text-destructive" : rxqAbs >= 5 ? "text-warning" : "text-primary";
                      const isActive = activeRadioIndex === idx;

                      // Pre-matched scanner sample for this row (see gsmScannerMatched memo above)
                      const scn = gsmScannerMatched[idx] ?? null;
                      const scnRxAbs = scn ? Math.abs(Number(scn.RxLev)) : null;
                      const scnRxColor = scnRxAbs == null ? "" : scnRxAbs >= 80 ? "text-destructive" : scnRxAbs >= 77 ? "text-warning" : "text-cyan-400";

                      return (
                        <tr
                          key={idx}
                          style={isActive ? { boxShadow: "inset 3px 0 0 hsl(180, 90%, 55%)" } : undefined}
                          className={`transition-all duration-100 cursor-pointer ${isActive ? "bg-cyan-500/10" : "hover:bg-muted/40"}`}
                          onMouseEnter={() => hoverIso(val.MsgTime)}
                          onMouseLeave={() => setHoveredTime(null)}
                        >
                          <td className="px-1 py-0.5 font-mono text-left font-bold">{scn?.BCCH ?? "—"}</td>
                          <td className="px-1 py-0.5 font-mono text-left">{val.band ?? "—"}</td>
                          <td className={`px-1 py-0.5 font-mono font-bold ${val.RxLevSub != null ? rxColor : "text-muted-foreground/40"}`}>
                            {val.RxLevSub != null ? val.RxLevSub : "—"}
                          </td>
                          {gsmScannerMatched.length > 0 && (
                            <td className={`px-1 py-0.5 font-mono font-bold ${scn?.RxLev != null ? scnRxColor : "text-muted-foreground/40"}`}>
                              {scn?.RxLev != null ? scn.RxLev : "—"}
                            </td>
                          )}
                          <td className={`px-1 py-0.5 font-mono font-bold ${rxqColor}`}>{val.RxQualSub}</td>
                          {gsmScannerMatched.length > 0 && (
                            <td className="px-1 py-0.5 font-mono text-cyan-400/80">{scn?.BSIC ?? "—"}</td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : (
                // LTE table: EARFCN/RSRP/RSRQ, plus a scanner comparison + Δt(s) column when
                // scanner data is available for the active EARFCN
                <table className="w-full text-xs text-center">
                  <thead className="sticky top-0 bg-muted border-b border-border z-10">
                    <tr>
                      <th className="px-1 py-1 font-semibold text-left">EARFCN</th>
                      <th className="px-1 py-1 font-semibold text-primary">RSRP</th>
                      {hasTableScanner && (
                        <th className="px-1 py-1 font-semibold text-cyan-400/80">RSRP Scanner</th>
                      )}
                      <th className="px-1 py-1 font-semibold text-primary">RSRQ</th>
                      {hasTableScanner && (
                        <th className="px-1 py-1 font-semibold text-cyan-400/80">RSRQ Scanner</th>
                      )}
                      {hasTableScanner && <>
                        <th className="px-1 py-1 font-semibold text-muted-foreground/60" title="Χρονική απόσταση UE → scanner sample">Δt(s)</th>
                      </>}
                      <th className="px-1 py-1 font-semibold">MsgTime</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {activeRadioValues.map((val, idx) => {
                      const rsrpAbs = Math.abs(Number(val.RSRP));
                      const rsrpColor = rsrpAbs >= 120 ? "text-destructive" : rsrpAbs >= 115 ? "text-warning" : "text-primary";
                      const rsrqAbs = Math.abs(Number(val.RSRQ));
                      const rsrqColor = rsrqAbs >= 18 ? "text-destructive" : rsrqAbs >= 16 ? "text-warning" : "text-primary";
                      const isActive = activeRadioIndex === idx;

                      // NR rows (VoNR): κοινό 5G scanner ανά CID· LTE rows: CGI → EARFCN+PCI → EARFCN
                      const scn = val.Technology === "NR5G"
                        ? (nrScannerMatched[idx] ?? null)
                        : scannerByEarfcn.size > 0
                          ? findNearestScanner(val.CGI, val.EARFCN, val.PhyCellId, val.MsgTime)
                          : null;
                      // Δt(s): how far the matched scanner sample is from this UE measurement in time —
                      // green/yellow/red so the reader can judge how trustworthy the comparison is
                      const dtSec = scn && val.MsgTime ? Math.abs(scn._ts - new Date(val.MsgTime).getTime()) / 1000 : null;
                      const dtColor = dtSec == null ? "" : dtSec <= 2 ? "text-green-400" : dtSec <= 10 ? "text-yellow-400" : "text-red-400";
                      const scnRsrpAbs = scn ? Math.abs(Number(scn.RSRP)) : null;
                      const scnRsrpColor = scnRsrpAbs == null ? "" : scnRsrpAbs >= 120 ? "text-destructive" : scnRsrpAbs >= 115 ? "text-warning" : "text-cyan-400";
                      return (
                        <tr
                          key={idx}
                          style={isActive ? { boxShadow: "inset 3px 0 0 hsl(180, 90%, 55%)" } : undefined}
                          className={`transition-all duration-100 cursor-pointer ${isActive ? "bg-cyan-500/10" : "hover:bg-muted/40"}`}
                          onMouseEnter={() => hoverIso(val.MsgTime)}
                          onMouseLeave={() => setHoveredTime(null)}
                        >
                          <td className="px-1 py-0.5 font-mono text-left" title={val.Technology === "NR5G" ? "NR-ARFCN (5G)" : undefined}>{val.EARFCN ?? val.NRARFCN}</td>
                          <td className={`px-1 py-0.5 font-mono font-bold ${val.RSRP != null ? rsrpColor : "text-muted-foreground/40"}`}>
                            {val.RSRP != null ? val.RSRP : "—"}
                          </td>
                          {hasTableScanner && (
                            <td className={`px-1 py-0.5 font-mono font-bold ${scn?.RSRP != null ? scnRsrpColor : "text-muted-foreground/40"}`}>
                              {scn?.RSRP != null ? Number(scn.RSRP).toFixed(1) : "—"}
                            </td>
                          )}
                          <td className={`px-1 py-0.5 font-mono font-bold ${val.RSRQ != null ? rsrqColor : "text-muted-foreground/40"}`}>
                            {val.RSRQ != null ? val.RSRQ : "—"}
                          </td>
                          {hasTableScanner && (
                            <td className="px-1 py-0.5 font-mono font-bold text-cyan-400/80">
                              {scn?.RSRQ != null ? Number(scn.RSRQ).toFixed(1) : "—"}
                            </td>
                          )}
                          {hasTableScanner && <>
                            <td className={`px-1 py-0.5 font-mono ${dtColor}`} title={scn ? `Scanner: ${scn.FullDate}` : ""}>
                              {dtSec != null ? dtSec.toFixed(1) : "—"}
                            </td>
                          </>}
                          <td className="px-1 py-0.5">{formatDateTime(val.MsgTime)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Δεν βρέθηκαν δεδομένα για αυτήν την κλήση.</p>
          )}
        </div>

      </div>

      {/* ── Αλλαγές τεχνολογίας ──
          Το διάγραμμα σήματος και το Session Overview που βρίσκονταν εδώ έχουν ενωθεί με το
          κύριο διάγραμμα της κάρτας (CallSignalChart) πάνω σε έναν κοινό άξονα χρόνου· εδώ
          μένει ο πίνακας των αλλαγών, που δεν έχει νόημα ως καμπύλη. */}
      {mergedTechnology.length > 0 && (
        <div className="bg-card border border-border rounded-lg p-3 space-y-3">
          <h3 className="text-sm font-semibold text-foreground">
            Συμπεριφορά δικτύου ±{viewWindowSec}δευτ. πριν / μετά κλήση
          </h3>

          {selectedLteSide === "B" && activeContextSignal.length === 0 && (!showGsmContext || activeGsmContextSignal.length === 0) && (
            <div className="rounded border border-border/60 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
              Δεν υπάρχουν context measurements για B-side. Δεν χρησιμοποιούνται δεδομένα A-side ως fallback.
            </div>
          )}


          {/* Technology changes table — ενιαίος πίνακας: events της κλήσης (πρώην
              "Technology Timeline") μαζί με όσα συμβαίνουν πριν/μετά μέσα στο παράθυρο */}
          <div>
              <p className="text-xs text-muted-foreground mb-1">
                Αλλαγές τεχνολογίας <span className="text-[10px]">({mergedTechnology.length} events — κλήση + παράθυρο ±{viewWindowSec}δευτ.)</span>
              </p>
              <div className="overflow-x-auto max-h-[240px] overflow-y-auto rounded border border-border/50">
                <table className="w-full text-xs text-center">
                  <thead className="sticky top-0 bg-muted border-b border-border z-10">
                    <tr>
                      <th className="px-2 py-1 font-semibold">Ώρα</th>
                      <th className="px-2 py-1 font-semibold" title="Πλευρά συσκευής (CallAnalysis.Side)">Πλευρά</th>
                      <th className="px-2 py-1 font-semibold">Από</th>
                      <th className="px-2 py-1 font-semibold">→ Σε</th>
                      <th className="px-2 py-1 font-semibold">Band</th>
                      <th className="px-2 py-1 font-semibold">LTE CA</th>
                      <th className="px-2 py-1 font-semibold">5G CA</th>
                      <th className="px-2 py-1 font-semibold">Duration</th>
                      <th className="px-2 py-1 font-semibold">Φάση</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {mergedTechnology.map((row, i) => {
                      // Same before/during/after color convention as the charts above (amber/primary/orange)
                      const phaseColor =
                        row.phase === "before" ? "bg-amber-500/10 text-amber-400" :
                        row.phase === "after"  ? "bg-orange-500/10 text-orange-400" :
                        "bg-primary/10 text-primary";
                      const isActive = isHoveredIso(row.MsgTime);
                      return (
                        <tr
                          key={i}
                          onMouseEnter={() => hoverIso(row.MsgTime)}
                          onMouseLeave={() => setHoveredTime(null)}
                          style={isActive ? { boxShadow: "inset 3px 0 0 hsl(180, 90%, 55%)" } : undefined}
                          className={`transition-colors cursor-pointer ${isActive ? "bg-cyan-500/10" : "hover:bg-muted/40"}`}
                        >
                          <td className="px-2 py-0.5 font-mono">{row.MsgTime ? new Date(row.MsgTime).toLocaleTimeString("el-GR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—"}</td>
                          <td
                            className="px-2 py-0.5"
                            title={row.IsCallSide === 0 ? "Η απέναντι πλευρά της κλήσης" : "Η πλευρά της κλήσης που άνοιξες"}
                          >
                            {row.Side ? (
                              <span className={`inline-block min-w-[1.5rem] rounded px-1 font-semibold ${row.Side === "B" ? "bg-violet-500/15 text-violet-400" : "bg-sky-500/15 text-sky-400"} ${row.IsCallSide === 0 ? "opacity-70" : ""}`}>
                                {row.Side}
                              </span>
                            ) : "—"}
                          </td>
                          <td className="px-2 py-0.5 text-muted-foreground">{row.PrevTechnology ?? "—"}</td>
                          <td className="px-2 py-0.5 font-semibold">{row.CurrTechnology ?? "—"}</td>
                          <td className="px-2 py-0.5">{row.Band ?? "—"}</td>
                          <td className="px-2 py-0.5">{row.LTEDLCarriers != null ? `${row.LTEDLCarriers}DL/${row.LTEULCarriers}UL` : "—"}</td>
                          <td className="px-2 py-0.5">{row.NR5GDLCarriers != null ? `${row.NR5GDLCarriers}DL/${row.NR5GULCarriers}UL` : "—"}</td>
                          <td className="px-2 py-0.5 font-mono">{row.Duration != null ? `${row.Duration} ms` : "—"}</td>
                          <td className={`px-2 py-0.5 font-semibold rounded ${phaseColor}`}>{row.phase}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
          </div>
        </div>
      )}

      {/* ── L3 Signaling (RRC / NAS / SIP) ── */}
      <L3SignalingPanel
        key={`${database}:${call.callId}`}
        l3Data={l3Data}
        l3DataBSide={l3DataBSide}
        asideLocation={deviceInfo?.fileInfo.ASideLocation}
        onHoverTime={setHoveredTime}
      />

      {/* ── Scanner / Device Info ── */}
      {deviceInfo && (
        <div className="bg-card border border-border rounded-lg p-3 space-y-3">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Signal className="h-4 w-4 text-primary" />
            Scanner &amp; Κινητό
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {/* A-side — each row prefers the dedicated device-info field (d.*) and falls back to
                whatever was parsed from the trace file name/header (f.*) when the former is missing */}
            <div className="rounded border border-border/60 bg-muted/20 p-2 space-y-1">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-primary mb-1.5">A-Side</p>
              {(() => {
                const d = deviceInfo.aSideDevice;
                const f = deviceInfo.fileInfo;
                const rows: [string, string | null | undefined][] = [
                  ["Device", d?.Model ?? f.ASideDevice],
                  ["IMEI", d?.IMEI ?? f.IMEI],
                  ["IMSI", d?.IMSI ?? f.IMSI],
                  ["Number", d?.Number ?? f.ASideNumber],
                  ["OS", d?.OS ?? null],
                  ["Firmware", d?.Firmware ?? f.FirmwareV],
                  ["BaseBand", d?.BaseBand ?? null],
                  ["DeviceType", d?.DeviceType ?? null],
                  ["RF Manufacturer", d?.RFManufacturer ?? null],
                  ["RF Model", d?.RFModel ?? null],
                  ["Serial", d?.SerialNumber ?? null],
                  ["SW Version", f.SWVersion],
                  ["MF Version", f.MFVersion],
                  ["Product Ver.", f.ProductVersion],
                  ["File", f.ASideFileName],
                  ["Location", f.ASideLocation],
                ];
                // Hide any row whose value is missing/empty rather than showing a blank field
                return rows
                  .filter(([, v]) => v != null && v !== "")
                  .map(([label, value]) => (
                    <div key={label} className="flex items-start gap-2 text-xs">
                      <span className="text-muted-foreground w-28 shrink-0">{label}</span>
                      <span className="font-mono text-foreground break-all">{value}</span>
                    </div>
                  ));
              })()}
            </div>

            {/* B-side — same fallback pattern as A-side above, but with an explicit empty-state message
                since the B-side leg often has no device info at all */}
            <div className="rounded border border-border/60 bg-muted/20 p-2 space-y-1">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-accent mb-1.5">B-Side</p>
              {(() => {
                const d = deviceInfo.bSideDevice;
                const f = deviceInfo.fileInfo;
                const rows: [string, string | null | undefined][] = [
                  ["Device", d?.Model ?? f.BSideDevice],
                  ["IMEI", d?.IMEI ?? null],
                  ["IMSI", d?.IMSI ?? null],
                  ["Number", d?.Number ?? f.BSideNumber],
                  ["OS", d?.OS ?? null],
                  ["Firmware", d?.Firmware ?? null],
                  ["BaseBand", d?.BaseBand ?? null],
                  ["DeviceType", d?.DeviceType ?? null],
                  ["RF Manufacturer", d?.RFManufacturer ?? null],
                  ["RF Model", d?.RFModel ?? null],
                  ["Serial", d?.SerialNumber ?? null],
                  ["File", f.BSideFileName],
                  ["Location", f.BSideLocation],
                ];
                const visible = rows.filter(([, v]) => v != null && v !== "");
                if (visible.length === 0) {
                  return <p className="text-xs text-muted-foreground">Δεν υπάρχουν δεδομένα B-side.</p>;
                }
                return visible.map(([label, value]) => (
                  <div key={label} className="flex items-start gap-2 text-xs">
                    <span className="text-muted-foreground w-28 shrink-0">{label}</span>
                    <span className="font-mono text-foreground break-all">{value}</span>
                  </div>
                ));
              })()}
            </div>
          </div>
        </div>
      )}
    </motion.div>
  );
};

export default CallDetail;
