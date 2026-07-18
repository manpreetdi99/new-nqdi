import { useState, useEffect, useMemo } from "react";
import { motion } from "framer-motion";
import {
  ArrowLeft, Signal, Activity, Gauge, ArrowDown, ArrowUp,
  Wifi, Timer, Save, Edit2, Flag, ChevronLeft, ChevronRight
} from "lucide-react";
import L from "leaflet";
import { MapContainer, TileLayer, CircleMarker, Marker, Polyline, useMap, Tooltip as LeafletTooltip } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";
import type { CallRecord } from "@/lib/callData";
import { fetchLteValues, fetchLteValuesBSide, fetchGsmValues, fetchGsmValuesBSide, fetchMosValues, updateCallComment, fetchKpiValues, fetchCallSideComparison, fetchTracelogValues, fetchCellInfo, fetchCellInfoBSide, fetchAntennas, fetchCallContextSignal, fetchCallContextTechnology, fetchL3Messages, fetchCallDeviceInfo, fetchLteMeasurementComparison, fetchLteScannerMeasurement, fetchLteScannerRaw, fetchLteScannerBest, fetchGsmScannerRaw, fetchGsmScannerBest, fetchGsmContextSignal, fetchCallContextSignalBSide, fetchGsmContextSignalBSide, fetchCallKpiTile, fetchHandoverInfo, fetchTechnologyTimeline, fetchVoiceCodec, fetchMarkers, fetchCallNeighbors, type CallNeighbors, type CallSideComparisonRow, type TraceLogRow, type AntennaRow, type CallL3MessagesResponse, type L3MessageRow, type CallDeviceInfo, type LteMeasurementStat, type LteScannerStat, type CallKpiTile, type HandoverInfoRow, type TechnologyTimelineRow, type VoiceCodecRow, type MarkerRow } from "@/lib/api";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, Legend, ReferenceLine, ReferenceArea } from "recharts";
import { CHART_PALETTE, AXIS_STYLE, GRID_STYLE } from "@/lib/chartStyles";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useSignallingHighlights, SEV_ROW_CLASS, SEV_BADGE_CLASS, SEV_LABEL } from "@/lib/signallingHighlights";
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
    if (points.length === 0) return;
    if (points.length === 1) { map.setView(points[0], 14); return; }
    const lats = points.map(p => p[0]);
    const lngs = points.map(p => p[1]);
    map.fitBounds(
      [[Math.min(...lats), Math.min(...lngs)], [Math.max(...lats), Math.max(...lngs)]],
      { padding: [10, 10], maxZoom: 16 }
    );
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

const CallDetail = ({ call, database, onBack, onNavigateToCall }: CallDetailProps) => {
  // LTE/GSM radio measurement rows (A-side and B-side, for the "Radio Measurements" table + chart)
  const [radioValues, setRadioValues] = useState<any[]>([]);
  const [gsmValues, setGsmValues] = useState<any[]>([]);
  const [bSideGsmValues, setBSideGsmValues] = useState<any[]>([]);
  const [mosValues, setMosValues] = useState<any[]>([]);
  const [kpiValues, setKpiValues] = useState<any[]>([]);
  const [tracelogValues, setTracelogValues] = useState<TraceLogRow[]>([]);
  const [sideComparison, setSideComparison] = useState<CallSideComparisonRow[]>([]);
  const [bSideLteValues, setBSideLteValues] = useState<any[]>([]);
  // Which side (A/B) and which network (LTE/GSM, only relevant for SRVCC calls) the UI currently shows
  const [selectedLteSide, setSelectedLteSide] = useState<"A" | "B">("A");
  const [srvccNetwork, setSrvccNetwork] = useState<"LTE" | "GSM">("LTE");

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
  const [selectedContextSide, setSelectedContextSide] = useState<"A" | "B">("A");
  const [contextWindowSec, setContextWindowSec] = useState(30);
  const [contextTechnology, setContextTechnology] = useState<any[]>([]);
  // L3 signaling (RRC/NAS/SIP messages) for A-side and B-side
  const [l3Data, setL3Data] = useState<CallL3MessagesResponse | null>(null);
  const [l3DataBSide, setL3DataBSide] = useState<CallL3MessagesResponse | null>(null);
  const [selectedL3Side, setSelectedL3Side] = useState<"A" | "B">("A");
  const [deviceInfo, setDeviceInfo] = useState<CallDeviceInfo | null>(null);
  // LTE-only measurement/scanner comparison stats and raw scanner samples (used to cross-check UE vs scanner)
  const [lteMeasComp, setLteMeasComp] = useState<{ aSide: LteMeasurementStat[]; bSide: LteMeasurementStat[] } | null>(null);
  const [lteScannerComp, setLteScannerComp] = useState<{ aSide: LteScannerStat[]; bSide: LteScannerStat[] } | null>(null);
  const [scannerRawA, setScannerRawA] = useState<any[]>([]);
  const [scannerRawB, setScannerRawB] = useState<any[]>([]);
  const [gsmScannerRaw, setGsmScannerRaw] = useState<any[]>([]);
  const [gsmScannerBestRaw, setGsmScannerBestRaw] = useState<any[]>([]);
  const [lteScannerBestRaw, setLteScannerBestRaw] = useState<any[]>([]);
  const [callKpiTile, setCallKpiTile] = useState<CallKpiTile | null>(null);
  // SRVCC handover events (4G->3G/2G, success/fail + interruption time), technology
  // changes over the call (incl. CA carrier counts), and voice codec used per direction
  const [handoverInfo, setHandoverInfo] = useState<HandoverInfoRow[]>([]);
  const [technologyTimeline, setTechnologyTimeline] = useState<TechnologyTimelineRow[]>([]);
  const [voiceCodec, setVoiceCodec] = useState<VoiceCodecRow[]>([]);
  // User-placed annotations during the session, merged into the TraceLog panel as timeline events
  const [markers, setMarkers] = useState<MarkerRow[]>([]);
  // Prev/Next call SessionIds για τα κουμπιά πλοήγησης (null → δεν υπάρχει → disabled)
  const [neighbors, setNeighbors] = useState<CallNeighbors | null>(null);

  // True when the active table/chart should show GSM columns instead of LTE:
  // CS calls are always GSM; SRVCC calls let the user toggle between LTE and GSM.
  const isGSMMode = call.callMode === "CS" || (call.callMode === "SRVCC" && srvccNetwork === "GSM");
  const [isLoadingRadio, setIsLoadingRadio] = useState(false);
  // Chart series visibility toggles (strength/quality/scanner overlay)
  const [showStrength, setShowStrength] = useState(true);
  const [showQuality, setShowQuality] = useState(true);
  const [showScanner, setShowScanner] = useState(false);
  const [showBScanner, setShowBScanner] = useState(false);
  // Editable free-text comment attached to the call
  const [commentText, setCommentText] = useState(call.comment || "");
  const [isEditingComment, setIsEditingComment] = useState(false);
  const [isSavingComment, setIsSavingComment] = useState(false);
  const { toast } = useToast();
  // Index του hovered row στο activeRadioValues (για ακριβή αντιστοίχιση με chartData)
  const [hoveredRadioIndex, setHoveredRadioIndex] = useState<number | null>(null);
  // Για TraceLog & KPI: αποθηκεύουμε το time string ώστε να βρούμε το κοντινότερο σημείο στο chart
  const [hoveredTimeStr, setHoveredTimeStr] = useState<string | null>(null);

  const toChartTime = (isoOrDate: string | null) => {
    if (!isoOrDate) return null;
    return new Date(isoOrDate).toLocaleTimeString("el-GR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
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
  // value) based on call.callMode, since GSM-only calls have no LTE data and vice versa:
  //   - callMode === "CS"            → circuit-switched (GSM only)
  //   - callMode === "SRVCC"         → starts LTE, handed over to GSM (both fetched)
  //   - anything else                → LTE only
  useEffect(() => {
    async function loadRadio() {
      setIsLoadingRadio(true);
      try {
        const [lteRes, gsmRes, mosRes, kpiRes, comparisonRes, bSideLteRes, tracelogRes, bSideGsmRes, cellInfoRes, bSideCellInfoRes, ctxSignalRes, ctxTechRes, pagingRes, pagingBSideRes, deviceRes, lteMeasCompRes, lteScannerCompRes, gsmCtxSignalRes, ctxSignalBSideRes, gsmCtxSignalBSideRes, callKpiTileRes, handoverInfoRes, technologyTimelineRes, voiceCodecRes, markersRes] = await Promise.allSettled([
          call.callMode !== "CS" ? fetchLteValues(database, call.callId) : Promise.resolve({ lteValues: [] }),
          call.callMode === "CS" || call.callMode === "SRVCC" ? fetchGsmValues(database, call.callId) : Promise.resolve({ gsmValues: [] }),
          fetchMosValues(database, call.callId),
          fetchKpiValues(database, call.callId),
          fetchCallSideComparison(database, call.callId),
          call.callMode === "CS" ? Promise.resolve({ lteValuesBSide: [] }) : fetchLteValuesBSide(database, call.callId),
          fetchTracelogValues(database, call.callId),
          call.callMode === "CS" || call.callMode === "SRVCC" ? fetchGsmValuesBSide(database, call.callId) : Promise.resolve({ gsmValuesBSide: [] }),
          call.callMode !== "CS" ? fetchCellInfo(database, call.callId) : Promise.resolve({ eNBId: null, EARFCN: null, PCI: null }),
          call.callMode !== "CS" ? fetchCellInfoBSide(database, call.callId) : Promise.resolve({ eNBId: null, EARFCN: null, PCI: null }),
          fetchCallContextSignal(database, call.callId, contextWindowSec),
          fetchCallContextTechnology(database, call.callId, contextWindowSec),
          fetchL3Messages(database, call.callId, { side: "A" }),
          fetchL3Messages(database, call.callId, { side: "B" }),
          fetchCallDeviceInfo(database, call.callId),
          call.callMode !== "CS" ? fetchLteMeasurementComparison(database, call.callId) : Promise.resolve({ aSide: [], bSide: [] }),
          call.callMode !== "CS" ? fetchLteScannerMeasurement(database, call.callId) : Promise.resolve({ aSide: [], bSide: [] }),
          call.callMode === "CS" || call.callMode === "SRVCC" ? fetchGsmContextSignal(database, call.callId, contextWindowSec) : Promise.resolve({ signal: [] }),
          call.callMode !== "CS" ? fetchCallContextSignalBSide(database, call.callId, contextWindowSec) : Promise.resolve({ signal: [] }),
          call.callMode === "CS" || call.callMode === "SRVCC" ? fetchGsmContextSignalBSide(database, call.callId, contextWindowSec) : Promise.resolve({ signal: [] }),
          fetchCallKpiTile(database, call.callId),
          fetchHandoverInfo(database, call.callId),
          fetchTechnologyTimeline(database, call.callId),
          fetchVoiceCodec(database, call.callId),
          fetchMarkers(database, call.callId),
        ]);

        if (lteRes.status === "fulfilled") {
          setRadioValues((lteRes.value as any).lteValues || []);
        }

        if (gsmRes.status === "fulfilled") {
          setGsmValues((gsmRes.value as any).gsmValues || []);
        }

        if (mosRes.status === "fulfilled") {
          setMosValues(mosRes.value.mosValues || []);
        }

        if (kpiRes.status === "fulfilled") {
          setKpiValues(kpiRes.value.kpiValues || []);
        }

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

        if (cellInfoRes.status === "fulfilled") {
          setCellInfo(cellInfoRes.value as any);
        }

        if (bSideCellInfoRes.status === "fulfilled") {
          setBSideCellInfo(bSideCellInfoRes.value as any);
        }

        if (ctxSignalRes.status === "fulfilled") {
          setContextSignal((ctxSignalRes.value as any).signal || []);
        } else {
          setContextSignal([]);
        }

        if (ctxTechRes.status === "fulfilled") {
          setContextTechnology((ctxTechRes.value as any).technology || []);
        } else {
          setContextTechnology([]);
        }

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

        if (gsmCtxSignalRes.status === "fulfilled") {
          setGsmContextSignal((gsmCtxSignalRes.value as any).signal || []);
        } else {
          setGsmContextSignal([]);
        }

        if (ctxSignalBSideRes.status === "fulfilled") {
          setContextSignalBSide((ctxSignalBSideRes.value as any).signal || []);
        } else {
          setContextSignalBSide([]);
        }

        if (gsmCtxSignalBSideRes.status === "fulfilled") {
          setGsmContextSignalBSide((gsmCtxSignalBSideRes.value as any).signal || []);
        } else {
          setGsmContextSignalBSide([]);
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
      } catch (err) {
        console.error("Failed to load metrics", err);
      } finally {
        setIsLoadingRadio(false);
      }
    }
    // Reset all UI selections and stale data back to defaults before loading the newly selected call
    if (call.callId && database) {
      setCommentText(call.comment || "");
      setIsEditingComment(false);
      setSelectedLteSide("A");
      setSrvccNetwork("LTE");
      setLteMeasComp(null);
      setLteScannerComp(null);
      setScannerRawA([]);
      setScannerRawB([]);
      setGsmScannerRaw([]);
      setGsmScannerBestRaw([]);
      setLteScannerBestRaw([]);
      setGsmContextSignal([]);
      setContextSignalBSide([]);
      setGsmContextSignalBSide([]);
      setCallKpiTile(null);
      setSelectedContextSide("A");
      loadRadio();
    }
  }, [database, call.callId, call.callMode]);

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
    if (call.callMode === "CS" || radioValues.length === 0 || !database) {
      setScannerRawA([]);
      return;
    }

    type Segment = { cgi: string; start: string; end: string };
    const segments: Segment[] = [];
    for (const v of radioValues) {
      if (!v.CGI || !v.MsgTime) continue;
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
      segments.map(seg => fetchLteScannerRaw(database, seg.cgi, seg.start, seg.end).catch(() => []))
    ).then(results => {
      if (!cancelled) setScannerRawA(results.flat());
    });
    return () => { cancelled = true; };
  }, [database, call.callMode, radioValues]);

  // Same as above, but for the B-side (second leg) of the call.
  useEffect(() => {
    if (call.callMode === "CS" || bSideLteValues.length === 0 || !database) {
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
      segments.map(seg => fetchLteScannerRaw(database, seg.cgi, seg.start, seg.end).catch(() => []))
    ).then(results => {
      if (!cancelled) setScannerRawB(results.flat());
    });
    return () => { cancelled = true; };
  }, [database, call.callMode, bSideLteValues]);

  // For CS (GSM) calls, fetch GSM scanner samples per contiguous serving-cell segment so the
  // "RxLev Scanner" column can cross-check the UE's own measurements against the scanner.
  useEffect(() => {
    if (call.callMode !== "CS" || gsmValues.length === 0 || !database) {
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
      segments.map(seg => fetchGsmScannerRaw(database, seg.cgi, seg.start, seg.end).catch(() => []))
    ).then(results => {
      if (!cancelled) setGsmScannerRaw(results.flat());
    });
    return () => { cancelled = true; };
  }, [database, call.callMode, gsmValues]);

  // "Best RxLev Scanner" — the strongest cell the scanner saw for the call's own operator at
  // each scan cycle (DmnIdTopN_RxLev_Operator = 1), independent of the UE's serving CGI. Fetched
  // once over the whole call window (resolved server-side from SessionId — call.operator is
  // hardcoded to "N/A" for real calls, and call.startTime/endTime are lossy JS Date round-trips).
  useEffect(() => {
    const canBeGSM = call.callMode === "CS" || call.callMode === "SRVCC";
    if (!canBeGSM || !database || !call.callId) {
      setGsmScannerBestRaw([]);
      return;
    }
    let cancelled = false;
    fetchGsmScannerBest(database, call.callId)
      .then(rows => { if (!cancelled) setGsmScannerBestRaw(rows); })
      .catch(() => { if (!cancelled) setGsmScannerBestRaw([]); });
    return () => { cancelled = true; };
  }, [database, call.callMode, call.callId]);

  // "Best LTE Scanner" — same idea as the GSM one above, but for FactLTEScanner
  // (DmnIdTopN_RSRP_Operator = 1), independent of the UE's serving EARFCN/PCI.
  useEffect(() => {
    if (call.callMode === "CS" || !database || !call.callId) {
      setLteScannerBestRaw([]);
      return;
    }
    let cancelled = false;
    fetchLteScannerBest(database, call.callId)
      .then(rows => { if (!cancelled) setLteScannerBestRaw(rows); })
      .catch(() => { if (!cancelled) setLteScannerBestRaw([]); });
    return () => { cancelled = true; };
  }, [database, call.callMode, call.callId]);

  // Re-fetches only the "before/during/after" context-signal data when the user changes the
  // time window (10/30/60/120s) — cheaper than re-running the full loadRadio() load above.
  useEffect(() => {
    if (!call.callId || !database) return;
    async function reloadContext() {
      const [ctxRes, ctxTechRes, gsmCtxRes, ctxBRes, gsmCtxBRes] = await Promise.allSettled([
        call.callMode !== "CS" ? fetchCallContextSignal(database, call.callId, contextWindowSec) : Promise.resolve({ signal: [] }),
        fetchCallContextTechnology(database, call.callId, contextWindowSec),
        call.callMode === "CS" || call.callMode === "SRVCC" ? fetchGsmContextSignal(database, call.callId, contextWindowSec) : Promise.resolve({ signal: [] }),
        call.callMode !== "CS" ? fetchCallContextSignalBSide(database, call.callId, contextWindowSec) : Promise.resolve({ signal: [] }),
        call.callMode === "CS" || call.callMode === "SRVCC" ? fetchGsmContextSignalBSide(database, call.callId, contextWindowSec) : Promise.resolve({ signal: [] }),
      ]);
      if (ctxRes.status === "fulfilled") setContextSignal((ctxRes.value as any).signal || []);
      if (ctxTechRes.status === "fulfilled") setContextTechnology((ctxTechRes.value as any).technology || []);
      if (gsmCtxRes.status === "fulfilled") setGsmContextSignal((gsmCtxRes.value as any).signal || []);
      if (ctxBRes.status === "fulfilled") setContextSignalBSide((ctxBRes.value as any).signal || []);
      if (gsmCtxBRes.status === "fulfilled") setGsmContextSignalBSide((gsmCtxBRes.value as any).signal || []);
    }
    reloadContext();
  }, [contextWindowSec, call.callId, database, call.callMode]);

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
      const matches = antennas.filter((a: AntennaRow) => a.pci === cellInfo.PCI);
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
      const matches = antennas.filter((a: AntennaRow) => a.pci === bSideCellInfo.PCI);
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
    if (call.callMode === "CS") return selectedLteSide === "B" ? bSideGsmValues : gsmValues;
    if (call.callMode === "SRVCC" && srvccNetwork === "GSM") return selectedLteSide === "B" ? bSideGsmValues : gsmValues;
    return selectedLteSide === "B" ? bSideLteValues : radioValues;
  }, [call.callMode, selectedLteSide, radioValues, bSideLteValues, gsmValues, bSideGsmValues, srvccNetwork]);

  // Formats a numeric KPI value with fixed decimals + unit suffix, or an em-dash when missing
  const fmtMetric = (v: number | null | undefined, decimals: number, suffix: string) =>
    v != null ? `${v.toFixed(decimals)}${suffix}` : "—";

  // KPI tile values fall back to per-call fields when the dedicated KPI tile endpoint has no data
  const avgMos = callKpiTile?.AvgMOS ?? (call.avgMos || null);
  const downloadMbps = callKpiTile?.Download_Mbps ?? null;
  const uploadMbps = callKpiTile?.Upload_Mbps ?? null;
  const latencyMs = callKpiTile?.Latency_ms ?? null;
  const jitterMs = callKpiTile?.Jitter_ms ?? null;
  const packetLossPct = callKpiTile?.PacketLoss_pct ?? null;

  // Definitions for the inline metrics strip shown in the top controls bar
  const metrics = [
    { label: "Download", value: fmtMetric(downloadMbps, 1, " Mbps"), icon: ArrowDown, color: "text-primary" },
    { label: "Upload", value: fmtMetric(uploadMbps, 1, " Mbps"), icon: ArrowUp, color: "text-accent" },
    { label: "Latency", value: fmtMetric(latencyMs, 0, " ms"), icon: Gauge, color: "text-warning" },
    { label: "AVG Mos", value: fmtMetric(avgMos, 2, ""), icon: Gauge, color: "text-warning" },
    { label: "Jitter", value: fmtMetric(jitterMs, 1, " ms"), icon: Activity, color: "text-chart-4" },
    { label: "Packet Loss", value: fmtMetric(packetLossPct, 2, "%"), icon: Wifi, color: packetLossPct != null && packetLossPct > 2 ? "text-destructive" : "text-success" },
    { label: "Setup Time", value: `${call.setupTime_ms} ms`, icon: Timer, color: call.setupTime_ms > 500 ? "text-warning" : "text-success" },
  ];

  // Matches each measurement row (by MsgTime) to the nearest sample in a time-sorted scanner
  // array — O(n log m) once, O(1) per row in render. Shared by the raw and "best" GSM scanner series.
  const matchNearestByTime = (raw: any[], byMsgTime: any[]): (any | null)[] => {
    if (raw.length === 0) return [];
    const sorted = raw
      .map(r => ({ ...r, _ts: new Date(r.FullDate).getTime() }))
      .sort((a, b) => a._ts - b._ts);
    return byMsgTime.map(val => {
      if (!val.MsgTime) return null;
      const ts = new Date(val.MsgTime).getTime();
      let lo = 0, hi = sorted.length - 1, best = 0;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (sorted[mid]._ts <= ts) { best = mid; lo = mid + 1; }
        else hi = mid - 1;
      }
      const a = sorted[best];
      const b = sorted[best + 1];
      return b && Math.abs(b._ts - ts) < Math.abs(a._ts - ts) ? b : a;
    });
  };

  // Precompute GSM scanner match per measurement row (serving-CGI scanner + best-per-operator scanner)
  const gsmScannerMatched = useMemo(() => {
    if (!isGSMMode) return [] as (any | null)[];
    return matchNearestByTime(gsmScannerRaw, activeRadioValues);
  }, [gsmScannerRaw, activeRadioValues, isGSMMode]);

  const gsmScannerBestMatched = useMemo(() => {
    if (!isGSMMode) return [] as (any | null)[];
    return matchNearestByTime(gsmScannerBestRaw, activeRadioValues);
  }, [gsmScannerBestRaw, activeRadioValues, isGSMMode]);

  // Pre-index scanner rows by EARFCN for fast nearest-time lookup.
  // B-side falls back to the A-side scanner data when no B-side scanner rows exist.
  const activeScannerRaw = selectedLteSide === "B"
    ? (scannerRawB.length > 0 ? scannerRawB : scannerRawA)
    : scannerRawA;

  // Build lookup maps over the scanner rows, sorted by timestamp so nearest-time lookups can use
  // binary search: byCgi is keyed on the UE's own serving CGI (globally unique — same "common CGI"
  // cross-check GSM uses), byKey falls back to EARFCN+PCI, byEarfcn falls back to EARFCN alone.
  const { scannerByKey, scannerByEarfcnOnly, scannerByCgi } = useMemo(() => {
    const byKey = new Map<string, any[]>();
    const byEarfcn = new Map<number, any[]>();
    const byCgi = new Map<string, any[]>();
    for (const row of activeScannerRaw) {
      const entry = { ...row, _ts: new Date(row.FullDate).getTime() };
      const key = `${row.EARFCN}_${row.PCI}`;
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key)!.push(entry);
      const e = row.EARFCN as number;
      if (!byEarfcn.has(e)) byEarfcn.set(e, []);
      byEarfcn.get(e)!.push(entry);
      if (row.CGI) {
        if (!byCgi.has(row.CGI)) byCgi.set(row.CGI, []);
        byCgi.get(row.CGI)!.push(entry);
      }
    }
    byKey.forEach(rows => rows.sort((a, b) => a._ts - b._ts));
    byEarfcn.forEach(rows => rows.sort((a, b) => a._ts - b._ts));
    byCgi.forEach(rows => rows.sort((a, b) => a._ts - b._ts));
    return { scannerByKey: byKey, scannerByEarfcnOnly: byEarfcn, scannerByCgi: byCgi };
  }, [activeScannerRaw]);

  const scannerByEarfcn = scannerByKey;

  // Binary search for the first row at/after `ts` in a list already sorted ascending by _ts —
  // used to find the closest scanner sample taken on/after a given UE measurement's MsgTime.
  const findNextInList = (rows: any[], ts: number): any | null => {
    let lo = 0, hi = rows.length - 1, result = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (rows[mid]._ts >= ts) { result = mid; hi = mid - 1; }
      else lo = mid + 1;
    }
    return result >= 0 ? rows[result] : null;
  };

  // Looks up the nearest scanner sample for a given UE measurement: prefer the common CGI match
  // (PCI alone can be reused by multiple physical cells, CGI can't — same idea as GSM's "RxLev
  // Scanner"), then fall back to EARFCN+PCI, then EARFCN-only if no CGI match exists.
  const findNearestScanner = (cgi: string | null, earfcn: number | null, pci: number | null, msgTime: string | null): any | null => {
    if (msgTime == null) return null;
    const ts = new Date(msgTime).getTime();
    if (cgi) {
      const byCgiRows = scannerByCgi.get(cgi);
      if (byCgiRows && byCgiRows.length > 0) return findNextInList(byCgiRows, ts);
    }
    if (earfcn == null) return null;
    const byPci = scannerByKey.get(`${earfcn}_${pci}`);
    if (byPci && byPci.length > 0) return findNextInList(byPci, ts);
    const byEarfcn = scannerByEarfcnOnly.get(earfcn);
    if (byEarfcn && byEarfcn.length > 0) return findNextInList(byEarfcn, ts);
    return null;
  };

  // Precompute LTE scanner match per measurement row: "LTE Scanner" is the scanner reading for
  // the UE's own serving cell — matched on common CGI first (same idea as GSM's "RxLev Scanner"),
  // falling back to EARFCN+PCI; "Best LTE Scanner" is the strongest cell the scanner saw for the
  // call's operator (DmnIdTopN_RSRP_Operator = 1).
  const lteScannerMatched = useMemo(() => {
    if (isGSMMode) return [] as (any | null)[];
    return activeRadioValues.map(val => findNearestScanner(val.CGI, val.EARFCN, val.PhyCellId, val.MsgTime));
  }, [activeRadioValues, isGSMMode, scannerByKey, scannerByEarfcnOnly, scannerByCgi]);

  const lteScannerBestMatched = useMemo(() => {
    if (isGSMMode) return [] as (any | null)[];
    return matchNearestByTime(lteScannerBestRaw, activeRadioValues);
  }, [lteScannerBestRaw, activeRadioValues, isGSMMode]);

  const chartData = useMemo(() => {
    return activeRadioValues.map((val, idx) => {
      const isGSM = isGSMMode;

      // Βοηθητική συνάρτηση για να μην μετατρέπεται το null/κενό σε 0 από την Number()
      const parseValue = (v: any) => (v == null || v === "") ? undefined : Number(v);

      return {
        time: new Date(val.MsgTime).toLocaleTimeString("el-GR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
        RxLevSub: isGSM ? parseValue(val.RxLevSub) : undefined,
        RxQualSub: isGSM ? parseValue(val.RxQualSub) : undefined,
        RSRP: !isGSM ? parseValue(val.RSRP) : undefined,
        RSRQ: !isGSM ? parseValue(val.RSRQ) : undefined,
        ScannerRxLev: isGSM ? parseValue(gsmScannerMatched[idx]?.RxLev) : undefined,
        BestScannerRxLev: isGSM ? parseValue(gsmScannerBestMatched[idx]?.RxLev) : undefined,
        ScannerRSRP: !isGSM ? parseValue(lteScannerMatched[idx]?.RSRP) : undefined,
        BestScannerRSRP: !isGSM ? parseValue(lteScannerBestMatched[idx]?.RSRP) : undefined,
      };
    });
  }, [activeRadioValues, isGSMMode, gsmScannerMatched, gsmScannerBestMatched, lteScannerMatched, lteScannerBestMatched]);

  // Ποιό x-value (time string) να δείξει στο ReferenceLine — ορίζεται ΜΕΤΑ το chartData
  const chartHighlightTime = hoveredRadioIndex !== null
    ? chartData[hoveredRadioIndex]?.time ?? null
    : hoveredTimeStr !== null
      ? (chartData.find(d => d.time === hoveredTimeStr)?.time ?? null)
      : null;

  const chartHighlightIndex = useMemo(() => {
    if (hoveredRadioIndex !== null) return hoveredRadioIndex;
    if (hoveredTimeStr !== null) return chartData.findIndex(d => d.time === hoveredTimeStr);
    return -1;
  }, [hoveredRadioIndex, hoveredTimeStr, chartData]);

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

  // Τα threshold ReferenceLines εμφανίζονται μόνο όταν είναι επιλεγμένο ακριβώς ΕΝΑ checkbox
  // σειράς — με 2+ σειρές ταυτόχρονα απενεργοποιούνται για να μένει καθαρό το διάγραμμα.
  const selectedSeriesCount = [showStrength, showQuality, showScanner, showBScanner].filter(Boolean).length;
  const showStrengthThresholds = selectedSeriesCount === 1 && !showQuality;
  const showQualityThresholds = selectedSeriesCount === 1 && showQuality;
  // Ο αριστερός άξονας (ισχύς) χρειάζεται και από τις scanner σειρές (yAxisId="left"), αλλιώς
  // η σύγκριση scanner με μόνο RxQual/RSRQ ενεργό δεν σχεδιάζεται (λείπει ο άξονάς τους).
  const showLeftAxis = showStrength || showScanner || showBScanner;

  // Currently displayed L3 signalling side (A/B) + per-row anomaly classification for it
  const activeL3Data = useMemo(
    () => (selectedL3Side === "B" ? l3DataBSide : l3Data),
    [selectedL3Side, l3Data, l3DataBSide]
  );
  const l3Highlights = useSignallingHighlights(activeL3Data?.l3Messages ?? []);

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

  const mapActiveAntenna = selectedLteSide === "B" ? matchedAntennaBSide : matchedAntenna;

  // Bounds used by MapAutoFit — includes the matched antenna position so the map frames both
  // the UE's GPS trail and the serving antenna it's connected to.
  const mapFitPts = useMemo((): [number, number][] => {
    const pts: [number, number][] = mapActivePts.map(p => p.pos);
    if (mapActiveAntenna) pts.push([mapActiveAntenna.lat, mapActiveAntenna.lon]);
    return pts;
  }, [mapActivePts, mapActiveAntenna]);

  // B-side context signal is only used when it actually has data, otherwise silently fall back
  // to A-side so the chart doesn't render empty just because the toggle is on "B".
  const activeContextSignal = selectedContextSide === "B" && contextSignalBSide.length > 0
    ? contextSignalBSide
    : contextSignal;

  const activeGsmContextSignal = selectedContextSide === "B" && gsmContextSignalBSide.length > 0
    ? gsmContextSignalBSide
    : gsmContextSignal;

  // LTE RSRP/RSRQ series for the "network behavior around the call" chart, tagged with
  // before/during/after phase so the chart can shade each period differently
  const contextChartData = useMemo(() =>
    activeContextSignal.map((v, idx) => ({
      idx,
      time: new Date(v.MsgTime).toLocaleTimeString("el-GR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
      RSRP: v.RSRP != null ? Number(v.RSRP) : undefined,
      RSRQ: v.RSRQ != null ? Number(v.RSRQ) : undefined,
      phase: v.phase as "before" | "during" | "after",
    }))
  , [activeContextSignal]);

  // Finds the [first, last] index range where phase === "during", used to draw the shaded
  // "during the call" ReferenceArea band on the LTE context chart (before/after are the rest)
  const duringZone = useMemo(() => {
    const firstIdx = contextChartData.findIndex(d => d.phase === "during");
    const lastIdx  = [...contextChartData].reverse().findIndex(d => d.phase === "during");
    const last = lastIdx === -1 ? -1 : contextChartData.length - 1 - lastIdx;
    return {
      first: firstIdx >= 0 ? firstIdx : null,
      last:  last     >= 0 ? last     : null,
    };
  }, [contextChartData]);

  const gsmChartData = useMemo(() => {
    if (!isGSMMode) return [];
    // Use the active context signal (A or B side, has real before/during/after) when available
    if (activeGsmContextSignal.length > 0) {
      return activeGsmContextSignal.map((v: any, idx: number) => ({
        idx,
        time: new Date(v.MsgTime).toLocaleTimeString("el-GR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
        RxLevSub: v.RxLevSub != null ? Number(v.RxLevSub) : undefined,
        RxQualSub: v.RxQualSub != null ? Number(v.RxQualSub) : undefined,
        phase: v.phase as "before" | "during" | "after",
      }));
    }
    // Fallback: use the current call's measurements (all "during") so the chart always renders
    return activeRadioValues.map((val: any, idx: number) => ({
      idx,
      time: new Date(val.MsgTime).toLocaleTimeString("el-GR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
      RxLevSub: val.RxLevSub != null ? Number(val.RxLevSub) : undefined,
      RxQualSub: val.RxQualSub != null ? Number(val.RxQualSub) : undefined,
      phase: "during" as const,
    }));
  }, [isGSMMode, activeGsmContextSignal, activeRadioValues]);

  // Same before/during/after range-finding as duringZone, but for the GSM RxLev/RxQual chart
  const gsmDuringZone = useMemo(() => {
    const firstIdx = gsmChartData.findIndex(d => d.phase === "during");
    const lastIdx  = [...gsmChartData].reverse().findIndex(d => d.phase === "during");
    const last = lastIdx === -1 ? -1 : gsmChartData.length - 1 - lastIdx;
    return {
      first: firstIdx >= 0 ? firstIdx : null,
      last:  last     >= 0 ? last     : null,
    };
  }, [gsmChartData]);

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
                                {v.OptionalWB !== null ? Number(v.OptionalWB).toFixed(2) : "-"}
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
              {/* Checkboxes to toggle each line series on the chart below (labels swap for GSM vs LTE) */}
              {activeRadioValues && activeRadioValues.length > 0 && (
                <div className="flex items-center gap-3 bg-muted/50 px-2 py-0.5 rounded border border-border/50">
                  <label className="flex items-center gap-1.5 text-xs font-medium text-foreground cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={showStrength}
                      onChange={(e) => setShowStrength(e.target.checked)}
                      className="h-3.5 w-3.5 rounded-sm border-primary text-primary focus:ring-primary"
                    />
                    {isGSMMode ? "RxLev" : "RSRP"}
                  </label>
                  <label className="flex items-center gap-1.5 text-xs font-medium text-foreground cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={showQuality}
                      onChange={(e) => setShowQuality(e.target.checked)}
                      className="h-3.5 w-3.5 rounded-sm border-primary text-primary focus:ring-primary"
                    />
                    {isGSMMode ? "RxQual" : "RSRQ"}
                  </label>
                  <Tooltip delayDuration={150}>
                    <TooltipTrigger asChild>
                      <label className="flex items-center gap-1.5 text-xs font-medium text-foreground cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={showScanner}
                          onChange={(e) => setShowScanner(e.target.checked)}
                          className="h-3.5 w-3.5 rounded-sm border-primary text-primary focus:ring-primary"
                        />
                        {isGSMMode ? "RxLev Scanner" : "LTE Scanner"}
                      </label>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" align="center" className="max-w-[220px]">
                      <p className="text-xs">
                        {isGSMMode
                          ? "Ο scanner στο ίδιο CGI με το κινητό — σύγκριση RxLev κινητού vs scanner στο κοινό serving CGI."
                          : "Ο scanner στο ίδιο EARFCN/PCI με το κινητό — σύγκριση RSRP κινητού vs scanner στο κοινό serving cell."}
                      </p>
                    </TooltipContent>
                  </Tooltip>
                  <Tooltip delayDuration={150}>
                    <TooltipTrigger asChild>
                      <label className="flex items-center gap-1.5 text-xs font-medium text-foreground cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={showBScanner}
                          onChange={(e) => setShowBScanner(e.target.checked)}
                          className="h-3.5 w-3.5 rounded-sm border-primary text-primary focus:ring-primary"
                        />
                        {isGSMMode ? "best RxLev Scanner" : "Best LTE Scanner"}
                      </label>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" align="center" className="max-w-[220px]">
                      <p className="text-xs">
                        {isGSMMode
                          ? "Top 1 RxLev του scanner για τον operator της κλήσης."
                          : "Top 1 RSRP του scanner για τον operator της κλήσης, ανεξαρτήτως EARFCN/PCI του κινητού."}
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </div>
              )}
            </div>
            {/* Call meta + timing on one line */}
            <div className="text-[10px] text-muted-foreground flex flex-wrap items-center gap-x-3 mt-0.5">
              <span className="text-xs">{call.callType} · {call.technology} · {call.operator}</span>
              <span>Έναρξη: {formatDateTime(call.startTime)}</span>
              <span>Λήξη: {formatDateTime(call.endTime)}</span>
              <span className="font-mono text-foreground">{Math.floor(call.duration_s / 60)}m {call.duration_s % 60}s</span>
            </div>
            {/* Single signalling strip: SRVCC handovers │ voice codec │ serving cell + A/B side status */}
            {(handoverInfo.length > 0 || voiceCodec.length > 0 || (cellInfo && cellInfo.eNBId !== null)) && (
              <div className="flex items-center gap-x-2 gap-y-0.5 flex-wrap mt-0.5 text-[10px] font-mono">
                {handoverInfo.length > 0 && (
                  <>
                    <span className="text-muted-foreground uppercase tracking-wider">HO</span>
                    {handoverInfo.map((ho, idx) => {
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
                    {handoverInfo.length > 0 && <span className="text-border">│</span>}
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
                {cellInfo && cellInfo.eNBId !== null && (
                  <>
                    {(handoverInfo.length > 0 || voiceCodec.length > 0) && <span className="text-border">│</span>}
                    <span className="text-muted-foreground">eNB <span className="text-foreground font-bold">{cellInfo.eNBId}</span></span>
                    <span className="text-muted-foreground">EARFCN <span className="text-primary font-bold">{cellInfo.EARFCN}</span></span>
                    <span className="text-muted-foreground">PCI <span className="text-accent font-bold">{cellInfo.PCI}</span></span>
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

        {/* Chart inside the top card */}
        {activeRadioValues && activeRadioValues.length > 0 && (
          <div className="mt-1 pt-1 border-t border-border">
            <h3 className="text-[10px] font-semibold text-foreground mb-1 flex items-center gap-1">
              <Activity className="h-3 w-3 text-primary" />
              {isGSMMode ? "GSM (RxLev / RxQual)" : "LTE (RSRP / RSRQ)"}
            </h3>
            <div className="flex gap-2 items-end">
            {/* Chart — flex 3 */}
            <div style={{ flex: 3, height: 240 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 5, right: 0, left: 0, bottom: 5 }}>
                  <CartesianGrid {...GRID_STYLE} vertical={false} />
                  <XAxis dataKey="time" {...AXIS_STYLE} axisLine={false} tickLine={false} />

                  {/* Axis domains, threshold reference lines and dashed thresholds differ per network:
                      GSM uses RxLev/RxQual scales (RxQual axis reversed, 0=best..7=worst),
                      LTE uses RSRP/RSRQ scales (both axes standard, more negative=worse). */}
                  {isGSMMode ? (
                    <>
                      {showLeftAxis && <YAxis yAxisId="left" domain={[-105, dataMax => Math.max(dataMax, -60)]} {...AXIS_STYLE} axisLine={false} tickLine={false} />}
                      {showQuality && <YAxis yAxisId="right" orientation="right" reversed={true} domain={[0, 7]} {...AXIS_STYLE} axisLine={false} tickLine={false} />}
                      {showStrengthThresholds && <ReferenceLine y={-88} yAxisId="left" stroke="hsl(var(--warning, 45 93% 58%))" strokeDasharray="3 3" />}
                      {showStrengthThresholds && <ReferenceLine y={-92} yAxisId="left" stroke="hsl(var(--destructive, 0 72% 51%))" strokeDasharray="3 3" />}
                      {showQualityThresholds && <ReferenceLine y={5} yAxisId="right" stroke="hsl(var(--warning, 45 93% 58%))" strokeDasharray="3 3" />}
                      {showQualityThresholds && <ReferenceLine y={6} yAxisId="right" stroke="hsl(var(--destructive, 0 72% 51%))" strokeDasharray="3 3" />}
                      <RechartsTooltip contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', borderRadius: '8px', fontSize: '12px' }} itemStyle={{ color: 'hsl(var(--foreground))' }} />
                      <Legend wrapperStyle={{ fontSize: '12px' }} />
                      {/* Custom dot renderer: only draws a visible circle at chartHighlightIndex (the
                          row currently hovered in the table below), keeping every other point invisible */}
                      {showStrength && <Line yAxisId="left" type="monotone" dataKey="RxLevSub" stroke={CHART_PALETTE[1]} dot={(p: any) => p.index === chartHighlightIndex && p.cx != null && p.cy != null ? <circle key={p.index} cx={p.cx} cy={p.cy} r={5} fill={CHART_PALETTE[1]} stroke="white" strokeWidth={1.5} /> : <g key={p.index} />} activeDot={false} strokeWidth={2} name="RxLevSub" />}
                      {showScanner && <Line yAxisId="left" type="monotone" dataKey="ScannerRxLev" stroke={CHART_PALETTE[2]} strokeDasharray="4 3" dot={false} activeDot={false} strokeWidth={2} connectNulls name="RxLev Scanner" />}
                      {showBScanner && <Line yAxisId="left" type="monotone" dataKey="BestScannerRxLev" stroke={CHART_PALETTE[3]} strokeDasharray="2 2" dot={false} activeDot={false} strokeWidth={2} connectNulls name="Best RxLev Scanner" />}
                      {showQuality && <Line yAxisId="right" type="monotone" dataKey="RxQualSub" stroke={CHART_PALETTE[4]} dot={(p: any) => p.index === chartHighlightIndex && p.cx != null && p.cy != null ? <circle key={p.index} cx={p.cx} cy={p.cy} r={5} fill={CHART_PALETTE[4]} stroke="white" strokeWidth={1.5} /> : <g key={p.index} />} activeDot={false} strokeWidth={2} name="RxQualSub" />}
                      {chartHighlightTime && (showLeftAxis || showQuality) && (
                        <ReferenceLine
                          x={chartHighlightTime}
                          yAxisId={showLeftAxis ? "left" : "right"}
                          stroke="hsl(180, 90%, 55%)"
                          strokeWidth={3}
                          label={{ value: "│", position: "insideTopLeft", fill: "hsl(180, 90%, 65%)", fontSize: 18, fontWeight: 800 }}
                        />
                      )}
                    </>
                  ) : (
                    <>
                      {showLeftAxis && <YAxis yAxisId="left" domain={[-140, dataMax => Math.max(dataMax, -100)]} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} axisLine={false} tickLine={false} />}
                      {showQuality && <YAxis yAxisId="right" orientation="right" domain={[-25, -12]} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} axisLine={false} tickLine={false} />}
                      {showStrengthThresholds && <ReferenceLine y={-115} yAxisId="left" stroke="hsl(var(--warning, 45 93% 58%))" strokeDasharray="3 3" />}
                      {showStrengthThresholds && <ReferenceLine y={-120} yAxisId="left" stroke="hsl(var(--destructive, 0 72% 51%))" strokeDasharray="3 3" />}
                      {showQualityThresholds && <ReferenceLine y={-16} yAxisId="right" stroke="hsl(var(--warning, 45 93% 58%))" strokeDasharray="3 3" />}
                      {showQualityThresholds && <ReferenceLine y={-18} yAxisId="right" stroke="hsl(var(--destructive, 0 72% 51%))" strokeDasharray="3 3" />}
                      <RechartsTooltip contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', borderRadius: '8px', fontSize: '12px' }} itemStyle={{ color: 'hsl(var(--foreground))' }} />
                      <Legend wrapperStyle={{ fontSize: '12px' }} />
                      {showStrength && <Line yAxisId="left" type="monotone" dataKey="RSRP" stroke="hsl(200, 80%, 55%)" dot={(p: any) => p.index === chartHighlightIndex && p.cx != null && p.cy != null ? <circle key={p.index} cx={p.cx} cy={p.cy} r={5} fill="hsl(200, 80%, 55%)" stroke="white" strokeWidth={1.5} /> : <g key={p.index} />} activeDot={false} strokeWidth={2} name="RSRP" />}
                      {showScanner && <Line yAxisId="left" type="monotone" dataKey="ScannerRSRP" stroke={CHART_PALETTE[2]} strokeDasharray="4 3" dot={false} activeDot={false} strokeWidth={2} connectNulls name="LTE Scanner" />}
                      {showBScanner && <Line yAxisId="left" type="monotone" dataKey="BestScannerRSRP" stroke={CHART_PALETTE[3]} strokeDasharray="2 2" dot={false} activeDot={false} strokeWidth={2} connectNulls name="Best LTE Scanner" />}
                      {showQuality && <Line yAxisId="right" type="monotone" dataKey="RSRQ" stroke="hsl(45, 93%, 58%)" dot={(p: any) => p.index === chartHighlightIndex && p.cx != null && p.cy != null ? <circle key={p.index} cx={p.cx} cy={p.cy} r={5} fill="hsl(45, 93%, 58%)" stroke="white" strokeWidth={1.5} /> : <g key={p.index} />} activeDot={false} strokeWidth={2} name="RSRQ" />}
                      {chartHighlightTime && (showLeftAxis || showQuality) && (
                        <ReferenceLine
                          x={chartHighlightTime}
                          yAxisId={showLeftAxis ? "left" : "right"}
                          stroke="hsl(180, 90%, 55%)"
                          strokeWidth={3}
                          label={{ value: "│", position: "insideTopLeft", fill: "hsl(180, 90%, 65%)", fontSize: 18, fontWeight: 800 }}
                        />
                      )}
                    </>
                  )}
                </LineChart>
              </ResponsiveContainer>
            </div>
            {/* Map — 1/4 */}
            {/*Εμφανίζεται μόνο αν είναι Cosmote Free και υπάρχουν GPS σημεία */}
            {isCosmoteFree && (() => {
              const antennaColor = selectedLteSide === "B" ? "#c48105" : "#b200f8";

              if (mapFitPts.length === 0) return (
                <div className="rounded border border-border/50 bg-muted/30 flex items-center justify-center" style={{ flex: 1, height: "250px" }}>
                  <span className="text-[10px] text-muted-foreground">Χωρίς GPS</span>
                </div>
              );

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
                <div className="rounded overflow-hidden border border-border/50 relative" style={{ flex: 1, height: "250px" }}>
                  <MapContainer
                    center={mapFitPts[0]}
                    zoom={13}
                    style={{ height: "250px", width: "100%" }}
                    zoomControl={false}
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
                </div>
              );
            })()}
          </div>
          </div>
        )}
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
                    const tStr = toChartTime(entry.time ?? null);
                    const isActive = tStr !== null && tStr === hoveredTimeStr;
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
                        onMouseEnter={() => { setHoveredRadioIndex(null); setHoveredTimeStr(tStr); }}
                        onMouseLeave={() => setHoveredTimeStr(null)}
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
            <div className="overflow-x-auto max-h-[260px] overflow-y-auto">
              <table className="w-full text-xs text-center">
                <thead className="sticky top-0 bg-muted border-b border-border z-10">
                  <tr>
                    <th className="px-2 py-1 font-semibold">MsgTime</th>
                    <th className="px-2 py-1 font-semibold">KPIId</th>
                    <th className="px-2 py-1 font-semibold">ErrorCode</th>
                    <th className="px-2 py-1 font-semibold">Value3</th>
                    <th className="px-2 py-1 font-semibold">Value4</th>
                    <th className="px-2 py-1 font-semibold">Value5</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {/* Copy the array before sorting — kpiValues itself must stay in API order */}
                  {[...kpiValues]
                    .sort((a, b) => new Date(a.StartTime).getTime() - new Date(b.StartTime).getTime())
                    .map((val, idx) => {
                      const tStr = toChartTime(val.StartTime ?? null);
                      const isActive = tStr !== null && tStr === hoveredTimeStr;
                      return (
                        <tr
                          key={idx}
                          style={isActive ? { boxShadow: "inset 3px 0 0 hsl(180, 90%, 55%)" } : undefined}
                          className={`transition-all duration-100 cursor-pointer ${isActive
                            ? "bg-cyan-500/10"
                            : "hover:bg-muted/40"
                            }`}
                          onMouseEnter={() => { setHoveredRadioIndex(null); setHoveredTimeStr(tStr); }}
                          onMouseLeave={() => setHoveredTimeStr(null)}
                        >
                          <td className="px-1 py-0.5 whitespace-nowrap">{formatDateTime(val.StartTime)}</td>
                          <td className="px-1 py-0.5 font-mono">{val.KPIId}</td>
                          <td className="px-1 py-0.5 font-mono">{val.ErrorCode}</td>
                          <td className="px-1 py-0.5 font-mono max-w-[80px] break-all whitespace-normal overflow-hidden">{val.Value3}</td>
                          <td className="px-1 py-0.5 font-mono max-w-[80px] break-all whitespace-normal overflow-hidden">{val.Value4}</td>
                          <td className="px-1 py-0.5 font-mono max-w-[80px] break-all whitespace-normal overflow-hidden">{val.Value5}</td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
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
              {/* SRVCC calls start on LTE and hand over to GSM mid-call — this toggle lets the
                  user inspect either leg's measurements, and resets side back to "A" on switch */}
              {call.callMode === "SRVCC" && (
                <div className="inline-flex rounded-md border border-border overflow-hidden mr-2">
                  <button
                    type="button"
                    onClick={() => { setSrvccNetwork("LTE"); setSelectedLteSide("A"); }}
                    className={`px-2 py-1 text-xs ${srvccNetwork === "LTE" ? "bg-primary text-primary-foreground" : "bg-muted text-foreground hover:bg-muted/80"}`}
                  >
                    LTE
                  </button>
                  <button
                    type="button"
                    onClick={() => { setSrvccNetwork("GSM"); setSelectedLteSide("A"); }}
                    className={`px-2 py-1 text-xs border-l border-border ${srvccNetwork === "GSM" ? "bg-primary text-primary-foreground" : "bg-muted text-foreground hover:bg-muted/80"}`}
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
                      <th className="px-1 py-1 font-semibold text-primary">RxLev</th>
                      {gsmScannerMatched.length > 0 && (
                        <th className="px-1 py-1 font-semibold text-cyan-400/80">RxLev Scanner</th>
                      )}
                      <th className="px-1 py-1 font-semibold">RxQual</th>
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
                      const isActive = hoveredRadioIndex === idx;

                      // Pre-matched scanner sample for this row (see gsmScannerMatched memo above)
                      const scn = gsmScannerMatched[idx] ?? null;
                      const scnRxAbs = scn ? Math.abs(Number(scn.RxLev)) : null;
                      const scnRxColor = scnRxAbs == null ? "" : scnRxAbs >= 80 ? "text-destructive" : scnRxAbs >= 77 ? "text-warning" : "text-cyan-400";

                      return (
                        <tr
                          key={idx}
                          style={isActive ? { boxShadow: "inset 3px 0 0 hsl(180, 90%, 55%)" } : undefined}
                          className={`transition-all duration-100 cursor-pointer ${isActive ? "bg-cyan-500/10" : "hover:bg-muted/40"}`}
                          onMouseEnter={() => { setHoveredTimeStr(null); setHoveredRadioIndex(idx); }}
                          onMouseLeave={() => setHoveredRadioIndex(null)}
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
                      {scannerByEarfcn.size > 0 && (
                        <th className="px-1 py-1 font-semibold text-cyan-400/80">RSRP Scanner</th>
                      )}
                      <th className="px-1 py-1 font-semibold text-primary">RSRQ</th>
                      {scannerByEarfcn.size > 0 && (
                        <th className="px-1 py-1 font-semibold text-cyan-400/80">RSRQ Scanner</th>
                      )}
                      {scannerByEarfcn.size > 0 && <>
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
                      const isActive = hoveredRadioIndex === idx;

                      const scn = scannerByEarfcn.size > 0
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
                          onMouseEnter={() => { setHoveredTimeStr(null); setHoveredRadioIndex(idx); }}
                          onMouseLeave={() => setHoveredRadioIndex(null)}
                        >
                          <td className="px-1 py-0.5 font-mono text-left">{val.EARFCN}</td>
                          <td className={`px-1 py-0.5 font-mono font-bold ${val.RSRP != null ? rsrpColor : "text-muted-foreground/40"}`}>
                            {val.RSRP != null ? val.RSRP : "—"}
                          </td>
                          {scannerByEarfcn.size > 0 && (
                            <td className={`px-1 py-0.5 font-mono font-bold ${scn?.RSRP != null ? scnRsrpColor : "text-muted-foreground/40"}`}>
                              {scn?.RSRP != null ? Number(scn.RSRP).toFixed(1) : "—"}
                            </td>
                          )}
                          <td className={`px-1 py-0.5 font-mono font-bold ${val.RSRQ != null ? rsrqColor : "text-muted-foreground/40"}`}>
                            {val.RSRQ != null ? val.RSRQ : "—"}
                          </td>
                          {scannerByEarfcn.size > 0 && (
                            <td className="px-1 py-0.5 font-mono font-bold text-cyan-400/80">
                              {scn?.RSRQ != null ? Number(scn.RSRQ).toFixed(1) : "—"}
                            </td>
                          )}
                          {scannerByEarfcn.size > 0 && <>
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

        {/* Technology Timeline panel: PrevTechnology -> CurrTechnology transitions during the call,
            incl. CA carrier counts (LTE/NR5G) and band, so handovers/reselections between 2G/3G/4G/5G
            (e.g. the SRVCC leg) are visible with exact timing instead of being inferred from RSRP gaps. */}
        <div className="bg-card border border-border rounded-lg p-2">
          <h3 className="text-xs font-semibold text-foreground mb-1 flex items-center gap-1.5">
            <Signal className="h-3 w-3 text-primary" />
            Technology Timeline
          </h3>

          {isLoadingRadio ? (
            <p className="text-xs text-muted-foreground">Φόρτωση δεδομένων...</p>
          ) : technologyTimeline.length > 0 ? (
            <div className="overflow-x-auto max-h-[260px] overflow-y-auto">
              <table className="w-full text-xs text-left">
                <thead className="sticky top-0 bg-muted border-b border-border z-10">
                  <tr>
                    <th className="px-2 py-1 font-semibold">MsgTime</th>
                    <th className="px-2 py-1 font-semibold">Prev → Curr</th>
                    <th className="px-2 py-1 font-semibold">Band</th>
                    <th className="px-2 py-1 font-semibold">CA (LTE/NR)</th>
                    <th className="px-2 py-1 font-semibold">Duration</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {technologyTimeline.map((t, idx) => (
                    <tr key={idx} className="hover:bg-muted/40">
                      <td className="px-1 py-0.5 whitespace-nowrap">{t.MsgTime ? formatDateTime(t.MsgTime) : "N/A"}</td>
                      <td className="px-1 py-0.5 font-mono">
                        <span className="text-muted-foreground">{t.PrevTechnology ?? "—"}</span>
                        {" → "}
                        <span className="text-foreground font-bold">{t.CurrTechnology ?? "—"}</span>
                      </td>
                      <td className="px-1 py-0.5 font-mono">{t.Band ?? "—"}</td>
                      <td className="px-1 py-0.5 font-mono">
                        {t.LTEDLCarriers != null || t.NR5GDLCarriers != null
                          ? `${t.LTEDLCarriers ?? 0}/${t.NR5GDLCarriers ?? 0}`
                          : "—"}
                      </td>
                      <td className="px-1 py-0.5 font-mono">{t.Duration != null ? `${t.Duration} ms` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Δεν υπάρχουν δεδομένα τεχνολογίας.</p>
          )}
        </div>

      </div>

      {/* ── Συμπεριφορά δικτύου πριν / κατά / μετά κλήση ── */}
      {(contextChartData.length > 0 || contextTechnology.length > 0 || (isGSMMode && gsmChartData.length > 0)) && (
        <div className="bg-card border border-border rounded-lg p-3 space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h3 className="text-sm font-semibold text-foreground">
              Συμπεριφορά δικτύου ±{contextWindowSec}δευτ. πριν / μετά κλήση
            </h3>
            <div className="flex items-center gap-2">
              {/* Window-size selector — changing this re-fetches context data via the reloadContext effect */}
              <div className="inline-flex rounded-md border border-border overflow-hidden">
                {[10, 30, 60, 120].map(s => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setContextWindowSec(s)}
                    className={`px-2 py-1 text-xs border-r last:border-r-0 border-border ${contextWindowSec === s ? "bg-primary text-primary-foreground" : "bg-muted text-foreground hover:bg-muted/80"}`}
                  >
                    {s}s
                  </button>
                ))}
              </div>
              {/* A/B toggle for the LTE context chart only — GSM context always uses activeGsmContextSignal's own A/B fallback */}
              {!isGSMMode && (() => {
                const hasBSide = contextSignalBSide.length > 0;
                return (
                  <div className={`inline-flex rounded-md border border-border overflow-hidden ${!hasBSide && isLoadingRadio ? "opacity-40 pointer-events-none" : ""}`}>
                    <button
                      type="button"
                      onClick={() => setSelectedContextSide("A")}
                      className={`px-2 py-1 text-xs ${selectedContextSide === "A" ? "bg-primary text-primary-foreground" : "bg-muted text-foreground hover:bg-muted/80"}`}
                    >
                      A-side
                    </button>
                    <button
                      type="button"
                      onClick={() => hasBSide ? setSelectedContextSide("B") : undefined}
                      className={`px-2 py-1 text-xs border-l border-border ${selectedContextSide === "B" ? "bg-primary text-primary-foreground" : hasBSide ? "bg-muted text-foreground hover:bg-muted/80" : "bg-muted text-muted-foreground/40 cursor-not-allowed"}`}
                    >
                      B-side
                    </button>
                  </div>
                );
              })()}
            </div>
          </div>

          {/* GSM chart — RxLev / RxQual over the before/during/after window, shaded by gsmDuringZone */}
          {isGSMMode && gsmChartData.length > 0 && (
            <div>
              <div className="flex items-center gap-3 mb-1">
                <span className="text-xs text-muted-foreground">RxLev / RxQual</span>
                <span className="flex items-center gap-1 text-xs"><span className="inline-block w-3 h-2 rounded-sm bg-amber-400/30 border border-amber-400/50" />Πριν</span>
                <span className="flex items-center gap-1 text-xs"><span className="inline-block w-3 h-2 rounded-sm bg-blue-500/30 border border-blue-500/50" />Κατά</span>
                <span className="flex items-center gap-1 text-xs"><span className="inline-block w-3 h-2 rounded-sm bg-orange-400/30 border border-orange-400/50" />Μετά</span>
              </div>
              <ResponsiveContainer width="100%" height={160}>
                <LineChart data={gsmChartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#ffffff18" />
                  <XAxis
                    dataKey="idx"
                    type="number"
                    domain={[0, gsmChartData.length - 1]}
                    tickFormatter={(v: number) => gsmChartData[v]?.time ?? ""}
                    tick={{ fontSize: 9, fill: "#94a3b8" }}
                    interval="preserveStartEnd"
                  />
                  <YAxis yAxisId="rxlev" domain={[-120, -40]} tick={{ fontSize: 9, fill: "#94a3b8" }} width={32} />
                  <YAxis yAxisId="rxqual" orientation="right" domain={[7, 0]} tick={{ fontSize: 9, fill: "#94a3b8" }} width={22} />
                  <RechartsTooltip
                    contentStyle={{ backgroundColor: "#1e293b", border: "1px solid #334155", fontSize: 11 }}
                    labelFormatter={(v: number) => gsmChartData[v]?.time ?? ""}
                    formatter={(val: any, name: string) => [val != null ? Number(val).toFixed(1) : "—", name]}
                  />
                  {/* before — κίτρινο */}
                  {gsmDuringZone.first != null && (
                    <ReferenceArea yAxisId="rxlev" x1={0} x2={gsmDuringZone.first} fill="#f59e0b" fillOpacity={0.25} stroke="#f59e0b" strokeOpacity={0.4} strokeWidth={1} />
                  )}
                  {/* during — μπλε */}
                  {gsmDuringZone.first != null && gsmDuringZone.last != null && (
                    <ReferenceArea yAxisId="rxlev" x1={gsmDuringZone.first} x2={gsmDuringZone.last} fill="#3b82f6" fillOpacity={0.22} stroke="#3b82f6" strokeOpacity={0.5} strokeWidth={1} />
                  )}
                  {/* after — πορτοκαλί */}
                  {gsmDuringZone.last != null && (
                    <ReferenceArea yAxisId="rxlev" x1={gsmDuringZone.last} x2={gsmChartData.length - 1} fill="#f97316" fillOpacity={0.25} stroke="#f97316" strokeOpacity={0.4} strokeWidth={1} />
                  )}
                  <Line yAxisId="rxlev" dataKey="RxLevSub" stroke="#22c55e" dot={false} strokeWidth={2} connectNulls name="RxLev" />
                  <Line yAxisId="rxqual" dataKey="RxQualSub" stroke="#e2e8f0" dot={false} strokeWidth={1} connectNulls name="RxQual" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* LTE Signal chart — RSRP / RSRQ over the before/during/after window, shaded by duringZone */}
          {contextChartData.length > 0 && (
            <div>
              <div className="flex items-center gap-3 mb-1">
                <span className="text-xs text-muted-foreground">RSRP / RSRQ</span>
                <span className="flex items-center gap-1 text-xs"><span className="inline-block w-3 h-2 rounded-sm bg-amber-400/30 border border-amber-400/50" />Πριν</span>
                <span className="flex items-center gap-1 text-xs"><span className="inline-block w-3 h-2 rounded-sm bg-primary/20 border border-primary/40" />Κατά</span>
                <span className="flex items-center gap-1 text-xs"><span className="inline-block w-3 h-2 rounded-sm bg-orange-400/30 border border-orange-400/50" />Μετά</span>
              </div>
              <ResponsiveContainer width="100%" height={160}>
                <LineChart data={contextChartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#ffffff18" />
                  <XAxis
                    dataKey="idx"
                    type="number"
                    domain={[0, contextChartData.length - 1]}
                    tickFormatter={(v: number) => contextChartData[v]?.time ?? ""}
                    tick={{ fontSize: 9, fill: "#94a3b8" }}
                    interval="preserveStartEnd"
                  />
                  <YAxis yAxisId="rsrp" domain={[-140, -60]} tick={{ fontSize: 9, fill: "#94a3b8" }} width={32} />
                  <YAxis yAxisId="rsrq" orientation="right" domain={[-25, 0]} tick={{ fontSize: 9, fill: "#94a3b8" }} width={28} />
                  <RechartsTooltip
                    contentStyle={{ backgroundColor: "#1e293b", border: "1px solid #334155", fontSize: 11 }}
                    labelFormatter={(v: number) => contextChartData[v]?.time ?? ""}
                    formatter={(val: any, name: string) => [val != null ? Number(val).toFixed(1) : "—", name]}
                  />
                  {/* before — κίτρινο */}
                  {duringZone.first != null && (
                    <ReferenceArea yAxisId="rsrp" x1={0} x2={duringZone.first} fill="#f59e0b" fillOpacity={0.25} stroke="#f59e0b" strokeOpacity={0.4} strokeWidth={1} />
                  )}
                  {/* during — μπλε */}
                  {duringZone.first != null && duringZone.last != null && (
                    <ReferenceArea yAxisId="rsrp" x1={duringZone.first} x2={duringZone.last} fill="#3b82f6" fillOpacity={0.22} stroke="#3b82f6" strokeOpacity={0.5} strokeWidth={1} />
                  )}
                  {/* after — πορτοκαλί */}
                  {duringZone.last != null && (
                    <ReferenceArea yAxisId="rsrp" x1={duringZone.last} x2={contextChartData.length - 1} fill="#f97316" fillOpacity={0.25} stroke="#f97316" strokeOpacity={0.4} strokeWidth={1} />
                  )}
                  <Line yAxisId="rsrp" dataKey="RSRP" stroke="#22c55e" dot={false} strokeWidth={2} connectNulls name="RSRP" />
                  <Line yAxisId="rsrq" dataKey="RSRQ" stroke="#e2e8f0" dot={false} strokeWidth={1} connectNulls name="RSRQ" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Technology changes table */}
          {contextTechnology.length > 0 && (
            <div>
              <p className="text-xs text-muted-foreground mb-1">Αλλαγές τεχνολογίας</p>
              <div className="overflow-x-auto max-h-[140px] overflow-y-auto rounded border border-border/50">
                <table className="w-full text-xs text-center">
                  <thead className="sticky top-0 bg-muted border-b border-border z-10">
                    <tr>
                      <th className="px-2 py-1 font-semibold">Ώρα</th>
                      <th className="px-2 py-1 font-semibold">Από</th>
                      <th className="px-2 py-1 font-semibold">→ Σε</th>
                      <th className="px-2 py-1 font-semibold">Band</th>
                      <th className="px-2 py-1 font-semibold">LTE CA</th>
                      <th className="px-2 py-1 font-semibold">5G CA</th>
                      <th className="px-2 py-1 font-semibold">Φάση</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {contextTechnology.map((row, i) => {
                      // Same before/during/after color convention as the charts above (amber/primary/orange)
                      const phaseColor =
                        row.phase === "before" ? "bg-amber-500/10 text-amber-400" :
                        row.phase === "after"  ? "bg-orange-500/10 text-orange-400" :
                        "bg-primary/10 text-primary";
                      return (
                        <tr key={i} className="hover:bg-muted/40 transition-colors">
                          <td className="px-2 py-0.5 font-mono">{new Date(row.MsgTime).toLocaleTimeString("el-GR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</td>
                          <td className="px-2 py-0.5 text-muted-foreground">{row.PrevTechnology ?? "—"}</td>
                          <td className="px-2 py-0.5 font-semibold">{row.CurrTechnology ?? "—"}</td>
                          <td className="px-2 py-0.5">{row.Band ?? "—"}</td>
                          <td className="px-2 py-0.5">{row.LTEDLCarriers != null ? `${row.LTEDLCarriers}DL/${row.LTEULCarriers}UL` : "—"}</td>
                          <td className="px-2 py-0.5">{row.NR5GDLCarriers != null ? `${row.NR5GDLCarriers}DL/${row.NR5GULCarriers}UL` : "—"}</td>
                          <td className={`px-2 py-0.5 font-semibold rounded ${phaseColor}`}>{row.phase}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {contextChartData.length === 0 && contextTechnology.length === 0 && !(isGSMMode && gsmChartData.length > 0) && (
            <p className="text-xs text-muted-foreground">Δεν βρέθηκαν δεδομένα στο παράθυρο ±10 δευτ.</p>
          )}
        </div>
      )}

      {/* ── L3 Signaling (RRC / NAS / SIP) ── */}
      {(() => {
        // A/B toggle mirrors the pattern used elsewhere: B-side button is disabled until B-side data exists
        // (activeL3Data / l3Highlights are hoisted to component scope so useSignallingHighlights stays a top-level hook call)
        const hasL3BSide = !!l3DataBSide?.callWindow;
        if (!activeL3Data || !activeL3Data.callWindow) return null;
        return (
        <div className="bg-card border border-border rounded-lg p-3 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Signal className="h-4 w-4 text-primary" />
              L3 Signaling
              <span className={`text-xs px-2 py-0.5 rounded font-medium ${activeL3Data.callWindow.callDir === "MO" ? "bg-primary/10 text-primary" : "bg-accent/10 text-accent"}`}>
                {activeL3Data.callWindow.callDir ?? "—"}
              </span>
              <div className="inline-flex rounded-md border border-border overflow-hidden">
                <button
                  type="button"
                  onClick={() => setSelectedL3Side("A")}
                  className={`px-2 py-1 text-xs font-normal ${selectedL3Side === "A" ? "bg-primary text-primary-foreground" : "bg-muted text-foreground hover:bg-muted/80"}`}
                >
                  A-side
                </button>
                <button
                  type="button"
                  disabled={!hasL3BSide}
                  onClick={() => hasL3BSide && setSelectedL3Side("B")}
                  className={`px-2 py-1 text-xs font-normal border-l border-border ${selectedL3Side === "B" ? "bg-primary text-primary-foreground" : hasL3BSide ? "bg-muted text-foreground hover:bg-muted/80" : "bg-muted text-muted-foreground/40 cursor-not-allowed"}`}
                >
                  B-side
                </button>
              </div>
            </h3>
            {/* Summary badges — message count per phase, only rendered for phases that actually have messages */}
            <div className="flex items-center gap-2 text-xs">
              {(["before", "during", "after"] as const).map(phase => {
                const count = activeL3Data.summary.byPhase[phase];
                return count > 0 ? (
                  <span key={phase} className="px-2 py-0.5 rounded border border-primary/30 bg-primary/5 font-mono">
                    {phase} <b>{count}</b>
                  </span>
                ) : null;
              })}
              {activeL3Data.summary.total === 0 && (
                <span className="text-muted-foreground">Δεν βρέθηκαν L3 messages</span>
              )}
            </div>
          </div>

          {/* Unified L3 message log — combines RRC/NAS/SIP messages from all layers/technologies into
              one chronological table. PCI/ARFCN/SIP columns are only rendered when at least one row
              actually has that data, so e.g. a pure-SIP call doesn't show empty PCI/ARFCN columns. */}
          {activeL3Data.l3Messages.length > 0 && (() => {
            const rows = activeL3Data.l3Messages;
            const hasPci    = rows.some(r => r.PCI != null);
            const hasArfcn  = rows.some(r => r.ARFCN != null);
            const hasSip    = rows.some(r => r.SIPResponse != null || r.SIPCallId != null);

            return (
              <div className="overflow-x-auto max-h-[320px] overflow-y-auto rounded border border-border/50">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-muted border-b border-border z-10">
                    <tr>
                      <th className="px-2 py-1 font-semibold text-left">Φάση</th>
                      <th className="px-2 py-1 font-semibold text-left">Ώρα</th>
                      <th className="px-2 py-1 font-semibold text-left">Δευτ.</th>
                      <th className="px-2 py-1 font-semibold text-left">Τεχνολογία</th>
                      <th className="px-2 py-1 font-semibold text-left">Layer</th>
                      <th className="px-2 py-1 font-semibold text-left">Dir</th>
                      <th className="px-2 py-1 font-semibold text-left">Μήνυμα</th>
                      {hasPci   && <th className="px-2 py-1 font-semibold text-left">PCI</th>}
                      {hasArfcn && <th className="px-2 py-1 font-semibold text-left">ARFCN</th>}
                      {hasSip   && <th className="px-2 py-1 font-semibold text-left">SIP</th>}
                      <th className="px-2 py-1 font-semibold text-left">Λεπτομέρειες</th>
                      <th className="px-2 py-1 font-semibold text-right">Ειδοπ.</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {rows.map((r, i) => {
                      // Same before/during/after color convention used throughout this component
                      const phaseColor =
                        r.Phase === "before" ? "text-amber-400" :
                        r.Phase === "after"  ? "text-orange-400" :
                        "text-primary";
                      const h = l3Highlights[i] ?? { severity: "none" as const, reason: "" };
                      // Paging is high-volume noise in the L3 log — render it dimmed
                      const isPaging = /paging/i.test(r.SimpleMsgName || r.MsgName || "");
                      return (
                        <tr
                          key={i}
                          title={h.reason || undefined}
                          className={`hover:bg-muted/40 transition-colors ${SEV_ROW_CLASS[h.severity]}${isPaging ? " opacity-50" : ""}`}
                        >
                          <td className={`px-2 py-0.5 font-semibold ${phaseColor}`}>{r.Phase}</td>
                          <td className="px-2 py-0.5 font-mono whitespace-nowrap">
                            {r.MsgTime ? new Date(r.MsgTime).toLocaleTimeString("el-GR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—"}
                          </td>
                          <td className="px-2 py-0.5 font-mono text-right">
                            {r.SecondsFromCallStart != null ? `${r.SecondsFromCallStart > 0 ? "+" : ""}${r.SecondsFromCallStart.toFixed(1)}s` : "—"}
                          </td>
                          <td className="px-2 py-0.5 font-mono text-[10px] text-cyan-400">{r.Technology ?? "—"}</td>
                          <td className="px-2 py-0.5 font-mono text-[10px]">{r.Layer ?? "—"}</td>
                          <td className="px-2 py-0.5">{r.Direction ?? "—"}</td>
                          {/* Prefer the richest available message label: combined SIP response name, then
                              simplified name, then raw MsgName */}
                          <td className="px-2 py-0.5 max-w-[200px] truncate" title={r.MsgName ?? ""}>{r.CombinedMsgNameSIPResponse || r.SimpleMsgName || r.MsgName || "—"}</td>
                          {hasPci   && <td className="px-2 py-0.5 font-mono">{r.PCI ?? "—"}</td>}
                          {hasArfcn && <td className="px-2 py-0.5 font-mono">{r.ARFCN ?? "—"}</td>}
                          {hasSip   && <td className="px-2 py-0.5 font-mono text-[10px]">{r.SIPResponse ?? "—"}</td>}
                          <td className="px-2 py-0.5 font-mono text-[10px] max-w-[320px] truncate" title={r.Message ?? ""}>{r.Message ?? "—"}</td>
                          <td className={`px-2 py-0.5 text-right font-semibold text-[10px] whitespace-nowrap ${SEV_BADGE_CLASS[h.severity]}`}>
                            {SEV_LABEL[h.severity]}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            );
          })()}

          {activeL3Data.summary.total === 0 && (
            <p className="text-xs text-muted-foreground">Δεν βρέθηκαν L3 messages στο παράθυρο ±{activeL3Data.summary.windowBeforeSec}s.</p>
          )}
        </div>
        );
      })()}
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
