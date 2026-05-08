import { useState, useEffect, useMemo } from "react";
import { motion } from "framer-motion";
import {
  ArrowLeft, Signal, Activity, Gauge, ArrowDown, ArrowUp,
  Wifi, Timer, Save, Edit2
} from "lucide-react";
import L from "leaflet";
import { MapContainer, TileLayer, CircleMarker, Marker, Polyline, useMap, Tooltip as LeafletTooltip } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";
import type { CallRecord } from "@/lib/callData";
import { fetchLteValues, fetchLteValuesBSide, fetchGsmValues, fetchGsmValuesBSide, fetchMosValues, updateCallComment, fetchKpiValues, fetchCallSideComparison, fetchTracelogValues, fetchCellInfo, fetchCellInfoBSide, fetchAntennas, fetchCallContextSignal, fetchCallContextTechnology, fetchCallPagingInfo, type CallSideComparisonRow, type TraceLogRow, type AntennaRow, type CallPagingInfoResponse, type PagingTimelineEvent } from "@/lib/api";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, Legend, ReferenceLine, ReferenceArea } from "recharts";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
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
}

/**
 * Παράδειγμα συνάρτησης με Types.
 * Δέχεται σαν είσοδο (iso) ένα string και εγγυάται(: string) 
 * ότι το αποτέλεσμά της θα είναι επίσης string.
 */
function rsrpColor(val: number | null | undefined): string {
  if (val == null) return "#6b7280";
  if (val >= -115) return "#22c55e";
  if (val >= -120) return "#f97316";
  return "#ef4444";
}

function rxLevColor(val: number | null | undefined): string {
  if (val == null) return "#6b7280";
  if (val >= -88) return "#22c55e";
  if (val >= -92) return "#f97316";
  return "#ef4444";
}

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

function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function fmtDist(m: number): string {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(2)} km`;
}

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

const CallDetail = ({ call, database, onBack }: CallDetailProps) => {
  const [radioValues, setRadioValues] = useState<any[]>([]);
  const [gsmValues, setGsmValues] = useState<any[]>([]);
  const [bSideGsmValues, setBSideGsmValues] = useState<any[]>([]);
  const [mosValues, setMosValues] = useState<any[]>([]);
  const [kpiValues, setKpiValues] = useState<any[]>([]);
  const [tracelogValues, setTracelogValues] = useState<TraceLogRow[]>([]);
  const [sideComparison, setSideComparison] = useState<CallSideComparisonRow[]>([]);
  const [bSideLteValues, setBSideLteValues] = useState<any[]>([]);
  const [selectedLteSide, setSelectedLteSide] = useState<"A" | "B">("A");
  const [srvccNetwork, setSrvccNetwork] = useState<"LTE" | "GSM">("LTE");

  const [cellInfo, setCellInfo] = useState<{ eNBId: number | null; EARFCN: number | null; PCI: number | null } | null>(null);
  const [bSideCellInfo, setBSideCellInfo] = useState<{ eNBId: number | null; EARFCN: number | null; PCI: number | null } | null>(null);
  const [matchedAntenna, setMatchedAntenna] = useState<{ lat: number; lon: number; cellName: string | null; distanceM: number; azimuth: number | null; freq: number | null; vendor: string | null; enbName: string | null; tech: string | null; height: number | null; downtilt: number | null; siteId: number | null; cellId: number | null } | null>(null);
  const [matchedAntennaBSide, setMatchedAntennaBSide] = useState<{ lat: number; lon: number; cellName: string | null; distanceM: number; azimuth: number | null; freq: number | null; vendor: string | null; enbName: string | null; tech: string | null; height: number | null; downtilt: number | null; siteId: number | null; cellId: number | null } | null>(null);

  const [contextSignal, setContextSignal] = useState<any[]>([]);
  const [contextTechnology, setContextTechnology] = useState<any[]>([]);
  const [pagingData, setPagingData] = useState<CallPagingInfoResponse | null>(null);

  const isGSMMode = call.callMode === "CS" || (call.callMode === "SRVCC" && srvccNetwork === "GSM");
  const [isLoadingRadio, setIsLoadingRadio] = useState(false);
  const [showStrength, setShowStrength] = useState(true);
  const [showQuality, setShowQuality] = useState(true);
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

  useEffect(() => {
    async function loadRadio() {
      setIsLoadingRadio(true);
      try {
        const [lteRes, gsmRes, mosRes, kpiRes, comparisonRes, bSideLteRes, tracelogRes, bSideGsmRes, cellInfoRes, bSideCellInfoRes, ctxSignalRes, ctxTechRes, pagingRes] = await Promise.allSettled([
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
          fetchCallContextSignal(database, call.callId),
          fetchCallContextTechnology(database, call.callId),
          fetchCallPagingInfo(database, call.callId),
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
          setPagingData(pagingRes.value as CallPagingInfoResponse);
        } else {
          setPagingData(null);
        }
      } catch (err) {
        console.error("Failed to load metrics", err);
      } finally {
        setIsLoadingRadio(false);
      }
    }
    if (call.callId && database) {
      setSelectedLteSide("A");
      setSrvccNetwork("LTE");
      loadRadio();
    }
  }, [database, call.callId, call.callMode]);

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

  const activeRadioValues = useMemo(() => {
    if (call.callMode === "CS") return selectedLteSide === "B" ? bSideGsmValues : gsmValues;
    if (call.callMode === "SRVCC" && srvccNetwork === "GSM") return selectedLteSide === "B" ? bSideGsmValues : gsmValues;
    return selectedLteSide === "B" ? bSideLteValues : radioValues;
  }, [call.callMode, selectedLteSide, radioValues, bSideLteValues, gsmValues, bSideGsmValues, srvccNetwork]);

  const metrics = [
    { label: "Download", value: `${call.downloadSpeed.toFixed(1)} Mbps`, icon: ArrowDown, color: "text-primary" },
    { label: "Upload", value: `${call.uploadSpeed.toFixed(1)} Mbps`, icon: ArrowUp, color: "text-accent" },
    { label: "Latency", value: `${call.latency.toFixed(0)} ms`, icon: Gauge, color: "text-warning" },
    { label: "AVG Mos", value: `${call.avgMos.toFixed(2)}`, icon: Gauge, color: "text-warning" },
    { label: "Jitter", value: `${call.jitter.toFixed(1)} ms`, icon: Activity, color: "text-chart-4" },
    { label: "Packet Loss", value: `${call.packetLoss.toFixed(2)}%`, icon: Wifi, color: call.packetLoss > 2 ? "text-destructive" : "text-success" },
    { label: "Setup Time", value: `${call.setupTime_ms} ms`, icon: Timer, color: call.setupTime_ms > 500 ? "text-warning" : "text-success" },
  ];

  const chartData = useMemo(() => {
    return activeRadioValues.map(val => {
      const isGSM = isGSMMode;

      // Βοηθητική συνάρτηση για να μην μετατρέπεται το null/κενό σε 0 από την Number()
      const parseValue = (v: any) => (v == null || v === "") ? undefined : Number(v);

      return {
        time: new Date(val.MsgTime).toLocaleTimeString("el-GR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
        RxLevSub: isGSM ? parseValue(val.RxLevSub) : undefined,
        RxQualSub: isGSM ? parseValue(val.RxQualSub) : undefined,
        RSRP: !isGSM ? parseValue(val.RSRP) : undefined,
        RSRQ: !isGSM ? parseValue(val.RSRQ) : undefined,
      };
    });
  }, [activeRadioValues, isGSMMode]);

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

  const isCosmoteFree = call.region?.toLowerCase().includes("cosmote free");

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

  const mapFitPts = useMemo((): [number, number][] => {
    const pts: [number, number][] = mapActivePts.map(p => p.pos);
    if (mapActiveAntenna) pts.push([mapActiveAntenna.lat, mapActiveAntenna.lon]);
    return pts;
  }, [mapActivePts, mapActiveAntenna]);

  const contextChartData = useMemo(() =>
    contextSignal.map((v, idx) => ({
      idx,
      time: new Date(v.MsgTime).toLocaleTimeString("el-GR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
      RSRP: v.RSRP != null ? Number(v.RSRP) : undefined,
      RSRQ: v.RSRQ != null ? Number(v.RSRQ) : undefined,
      phase: v.phase as "before" | "during" | "after",
    }))
  , [contextSignal]);

  const duringZone = useMemo(() => {
    const firstIdx = contextChartData.findIndex(d => d.phase === "during");
    const lastIdx  = [...contextChartData].reverse().findIndex(d => d.phase === "during");
    const last = lastIdx === -1 ? -1 : contextChartData.length - 1 - lastIdx;
    return {
      first: firstIdx >= 0 ? firstIdx : null,
      last:  last     >= 0 ? last     : null,
    };
  }, [contextChartData]);

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
                </div>
              )}
            </div>
            <p className="text-xs text-muted-foreground">{call.callType} · {call.technology} · {call.operator}</p>
            <div className="text-[10px] text-muted-foreground flex flex-wrap gap-x-3 mt-0.5">
              <span>Έναρξη: {formatDateTime(call.startTime)}</span>
              <span>Λήξη: {formatDateTime(call.endTime)}</span>
              <span className="font-mono text-foreground">{Math.floor(call.duration_s / 60)}m {call.duration_s % 60}s</span>
            </div>
            {cellInfo && cellInfo.eNBId !== null && (
              <div className="flex items-center gap-x-3 gap-y-0.5 flex-wrap mt-0.5 text-[10px] font-mono">
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
              </div>
            )}
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
            {isEditingComment ? (
              <div className="space-y-1">
                {/* Dropdown quick-select */}
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
                  <CartesianGrid strokeDasharray="3 3" opacity={0.2} vertical={false} />
                  <XAxis dataKey="time" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} axisLine={false} tickLine={false} />

                  {isGSMMode ? (
                    <>
                      {showStrength && <YAxis yAxisId="left" domain={[-105, dataMax => Math.max(dataMax, -60)]} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} axisLine={false} tickLine={false} />}
                      {showQuality && <YAxis yAxisId="right" orientation="right" reversed={true} domain={[0, 7]} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} axisLine={false} tickLine={false} />}
                      {showStrength && !showQuality && <ReferenceLine y={-88} yAxisId="left" stroke="hsl(var(--warning, 45 93% 58%))" strokeDasharray="3 3" />}
                      {showStrength && !showQuality && <ReferenceLine y={-92} yAxisId="left" stroke="hsl(var(--destructive, 0 72% 51%))" strokeDasharray="3 3" />}
                      {showQuality && !showStrength && <ReferenceLine y={5} yAxisId="right" stroke="hsl(var(--warning, 45 93% 58%))" strokeDasharray="3 3" />}
                      {showQuality && !showStrength && <ReferenceLine y={6} yAxisId="right" stroke="hsl(var(--destructive, 0 72% 51%))" strokeDasharray="3 3" />}
                      <RechartsTooltip contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', borderRadius: '8px', fontSize: '12px' }} itemStyle={{ color: 'hsl(var(--foreground))' }} />
                      <Legend wrapperStyle={{ fontSize: '12px' }} />
                      {showStrength && <Line yAxisId="left" type="monotone" dataKey="RxLevSub" stroke="hsl(200, 80%, 55%)" dot={(p: any) => p.index === chartHighlightIndex && p.cx != null && p.cy != null ? <circle key={p.index} cx={p.cx} cy={p.cy} r={5} fill="hsl(200, 80%, 55%)" stroke="white" strokeWidth={1.5} /> : <g key={p.index} />} activeDot={false} strokeWidth={2} name="RxLevSub" />}
                      {showQuality && <Line yAxisId="right" type="monotone" dataKey="RxQualSub" stroke="hsl(0, 72%, 55%)" dot={(p: any) => p.index === chartHighlightIndex && p.cx != null && p.cy != null ? <circle key={p.index} cx={p.cx} cy={p.cy} r={5} fill="hsl(0, 72%, 55%)" stroke="white" strokeWidth={1.5} /> : <g key={p.index} />} activeDot={false} strokeWidth={2} name="RxQualSub" />}
                      {chartHighlightTime && (
                        <ReferenceLine
                          x={chartHighlightTime}
                          yAxisId={showStrength ? "left" : showQuality ? "right" : "left"}
                          stroke="hsl(180, 90%, 55%)"
                          strokeWidth={3}
                          label={{ value: "│", position: "insideTopLeft", fill: "hsl(180, 90%, 65%)", fontSize: 18, fontWeight: 800 }}
                        />
                      )}
                    </>
                  ) : (
                    <>
                      {showStrength && <YAxis yAxisId="left" domain={[-140, dataMax => Math.max(dataMax, -100)]} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} axisLine={false} tickLine={false} />}
                      {showQuality && <YAxis yAxisId="right" orientation="right" domain={[-25, -12]} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} axisLine={false} tickLine={false} />}
                      {showStrength && !showQuality && <ReferenceLine y={-115} yAxisId="left" stroke="hsl(var(--warning, 45 93% 58%))" strokeDasharray="3 3" />}
                      {showStrength && !showQuality && <ReferenceLine y={-120} yAxisId="left" stroke="hsl(var(--destructive, 0 72% 51%))" strokeDasharray="3 3" />}
                      {showQuality && !showStrength && <ReferenceLine y={-16} yAxisId="right" stroke="hsl(var(--warning, 45 93% 58%))" strokeDasharray="3 3" />}
                      {showQuality && !showStrength && <ReferenceLine y={-18} yAxisId="right" stroke="hsl(var(--destructive, 0 72% 51%))" strokeDasharray="3 3" />}
                      <RechartsTooltip contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', borderRadius: '8px', fontSize: '12px' }} itemStyle={{ color: 'hsl(var(--foreground))' }} />
                      <Legend wrapperStyle={{ fontSize: '12px' }} />
                      {showStrength && <Line yAxisId="left" type="monotone" dataKey="RSRP" stroke="hsl(200, 80%, 55%)" dot={(p: any) => p.index === chartHighlightIndex && p.cx != null && p.cy != null ? <circle key={p.index} cx={p.cx} cy={p.cy} r={5} fill="hsl(200, 80%, 55%)" stroke="white" strokeWidth={1.5} /> : <g key={p.index} />} activeDot={false} strokeWidth={2} name="RSRP" />}
                      {showQuality && <Line yAxisId="right" type="monotone" dataKey="RSRQ" stroke="hsl(45, 93%, 58%)" dot={(p: any) => p.index === chartHighlightIndex && p.cx != null && p.cy != null ? <circle key={p.index} cx={p.cx} cy={p.cy} r={5} fill="hsl(45, 93%, 58%)" stroke="white" strokeWidth={1.5} /> : <g key={p.index} />} activeDot={false} strokeWidth={2} name="RSRQ" />}
                      {chartHighlightTime && (
                        <ReferenceLine
                          x={chartHighlightTime}
                          yAxisId={showStrength ? "left" : showQuality ? "right" : "left"}
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
          ) : tracelogValues && tracelogValues.length > 0 ? (
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
                  {tracelogValues.map((val, idx) => {
                    const tStr = toChartTime(val.FullDate ?? null);
                    const isActive = tStr !== null && tStr === hoveredTimeStr;
                    const isCritical = val.Info != null && [
                      "No sync signal found",
                      "Task stopped",
                      "Close Engine",
                      "System Release",
                    ].some(kw => val.Info!.includes(kw));
                    return (
                      <tr
                        key={`${val.FullDate ?? idx}-${idx}`}
                        style={isCritical
                          ? { boxShadow: "inset 3px 0 0 hsl(0, 72%, 51%)" }
                          : isActive
                            ? { boxShadow: "inset 3px 0 0 hsl(180, 90%, 55%)" }
                            : undefined}
                        className={`transition-all duration-100 cursor-pointer ${isCritical
                          ? "bg-red-500/15 text-red-400"
                          : isActive
                            ? "bg-cyan-500/10"
                            : "hover:bg-muted/40"
                          }`}
                        onMouseEnter={() => { setHoveredRadioIndex(null); setHoveredTimeStr(tStr); }}
                        onMouseLeave={() => setHoveredTimeStr(null)}
                      >
                        <td className="px-1 py-0.5">{val.FullDate ? formatDateTime(val.FullDate) : "N/A"}</td>
                        <td className="px-1 py-0.5 font-mono">{val.Side ?? "N/A"}</td>
                        <td className="px-1 py-0.5 font-mono">{val.SessionId ?? "N/A"}</td>
                        <td className="px-1 py-0.5 font-mono whitespace-pre-wrap break-words max-w-[400px]">{val.Info ?? "N/A"}</td>
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
                    <th className="px-2 py-1 font-semibold">KPIId</th>
                    <th className="px-2 py-1 font-semibold">ErrorCode</th>
                    {/* <th className="px-2 py-1 font-semibold">Value1</th>
                    <th className="px-2 py-1 font-semibold">Value2</th> */}
                    <th className="px-2 py-1 font-semibold">Value3</th>
                    <th className="px-2 py-1 font-semibold">Value4</th>
                    <th className="px-2 py-1 font-semibold">Value5</th>
                    <th className="px-2 py-1 font-semibold">MsgTime</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {kpiValues.map((val, idx) => {
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
                        <td className="px-1 py-0.5 font-mono">{val.KPIId}</td>
                        <td className="px-1 py-0.5 font-mono">{val.ErrorCode}</td>
                        {/* <td className="px-1 py-0.5 font-mono">{val.Value1}</td>
                        <td className="px-1 py-0.5 font-mono">{val.Value2}</td> */}
                        <td className="px-1 py-0.5 font-mono max-w-[80px] break-all whitespace-normal overflow-hidden">{val.Value3}</td>
                        <td className="px-1 py-0.5 font-mono max-w-[80px] break-all whitespace-normal overflow-hidden">{val.Value4}</td>
                        <td className="px-1 py-0.5 font-mono max-w-[80px] break-all whitespace-normal overflow-hidden">{val.Value5}</td>
                        <td className="px-1 py-0.5">{formatDateTime(val.StartTime)}</td>
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
              {isGSMMode ? (
                <table className="w-full text-xs text-center">
                  <thead className="sticky top-0 bg-muted border-b border-border z-10">
                    <tr>
                      <th className="px-1 py-1 font-semibold">SessionId</th>
                      <th className="px-1 py-1 font-semibold">RxLevSub</th>
                      <th className="px-1 py-1 font-semibold">RxQualSub</th>
                      <th className="px-1 py-1 font-semibold">MsgTime</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {activeRadioValues.map((val, idx) => {
                      const rxAbs = Math.abs(Number(val.RxLevSub));
                      const rxColor = rxAbs >= 95 ? "text-destructive" : rxAbs >= 90 ? "text-warning" : "text-primary";
                      const rxqAbs = Math.abs(Number(val.RxQualSub));
                      const rsrqColor = rxqAbs >= 6 ? "text-destructive" : rxqAbs >= 5 ? "text-warning" : "text-primary";
                      const isActive = hoveredRadioIndex === idx;

                      return (
                        <tr
                          key={idx}
                          style={isActive ? { boxShadow: "inset 3px 0 0 hsl(180, 90%, 55%)" } : undefined}
                          className={`transition-all duration-100 cursor-pointer ${isActive ? "bg-cyan-500/10" : "hover:bg-muted/40"
                            }`}
                          onMouseEnter={() => { setHoveredTimeStr(null); setHoveredRadioIndex(idx); }}
                          onMouseLeave={() => setHoveredRadioIndex(null)}
                        >
                          <td className="px-1 py-0.5 font-mono">{val.SessionId}</td>
                          <td className={`px-1 py-0.5 font-mono font-bold ${rxColor}`}>{val.RxLevSub}</td>
                          <td className={`px-1 py-0.5 font-mono font-bold ${rsrqColor}`}>{val.RxQualSub}</td>
                          <td className="px-1 py-0.5">{formatDateTime(val.MsgTime)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : (
                <table className="w-full text-xs text-center">
                  <thead className="sticky top-0 bg-muted border-b border-border z-10">
                    <tr>
                      <th className="px-1 py-1 font-semibold">EARFCN</th>
                      <th className="px-1 py-1 font-semibold">RSRP</th>
                      <th className="px-1 py-1 font-semibold">RSRQ</th>
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

                      return (
                        <tr
                          key={idx}
                          style={isActive ? { boxShadow: "inset 3px 0 0 hsl(180, 90%, 55%)" } : undefined}
                          className={`transition-all duration-100 cursor-pointer ${isActive ? "bg-cyan-500/10" : "hover:bg-muted/40"
                            }`}
                          onMouseEnter={() => { setHoveredTimeStr(null); setHoveredRadioIndex(idx); }}
                          onMouseLeave={() => setHoveredRadioIndex(null)}
                        >
                          <td className="px-1 py-0.5 font-mono">{val.EARFCN}</td>
                          <td className={`px-1 py-0.5 font-mono font-bold ${rsrpColor}`}>{val.RSRP}</td>
                          <td className={`px-1 py-0.5 font-mono font-bold ${rsrqColor}`}>{val.RSRQ}</td>
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

      {/* ── Συμπεριφορά δικτύου πριν / κατά / μετά κλήση ── */}
      {(contextChartData.length > 0 || contextTechnology.length > 0) && (
        <div className="bg-card border border-border rounded-lg p-3 space-y-3">
          <h3 className="text-sm font-semibold text-foreground">
            Συμπεριφορά δικτύου ±10 δευτ. πριν / μετά κλήση
          </h3>

          {/* Signal chart */}
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

          {contextChartData.length === 0 && contextTechnology.length === 0 && (
            <p className="text-xs text-muted-foreground">Δεν βρέθηκαν δεδομένα στο παράθυρο ±10 δευτ.</p>
          )}
        </div>
      )}

      {/* ── Paging & Call Setup Signaling ── */}
      {pagingData && pagingData.callWindow && (
        <div className="bg-card border border-border rounded-lg p-3 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Signal className="h-4 w-4 text-primary" />
              Paging &amp; Call Setup Signaling
              <span className={`text-xs px-2 py-0.5 rounded font-medium ${pagingData.callWindow.callDir === "MO" ? "bg-primary/10 text-primary" : "bg-accent/10 text-accent"}`}>
                {pagingData.callWindow.callDir ?? "—"}
              </span>
            </h3>
            {/* Summary badges */}
            <div className="flex items-center gap-2 text-xs">
              {(["ltePagingEDRX", "lteRrcPaging", "nrRrcPaging"] as const).map(key => {
                const count = pagingData.summary[key];
                const labels: Record<string, string> = { ltePagingEDRX: "LTE eDRX", lteRrcPaging: "LTE RRC", nrRrcPaging: "NR RRC" };
                return count > 0 ? (
                  <span key={key} className="px-2 py-0.5 rounded border border-primary/30 bg-primary/5 font-mono">
                    {labels[key]} <b>{count}</b>
                  </span>
                ) : null;
              })}
              {pagingData.summary.totalPagingEvents === 0 && (
                <span className="text-muted-foreground">Δεν βρέθηκαν paging events</span>
              )}
            </div>
          </div>

          {/* Unified Timeline Table */}
          {pagingData.timeline.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold uppercase text-muted-foreground mb-1 tracking-wider">Timeline</p>
              <div className="overflow-x-auto max-h-[280px] overflow-y-auto rounded border border-border/50">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-muted border-b border-border z-10">
                    <tr>
                      <th className="px-2 py-1 font-semibold text-left">Φάση</th>
                      <th className="px-2 py-1 font-semibold text-left">Ώρα</th>
                      <th className="px-2 py-1 font-semibold text-left">Δευτ.</th>
                      <th className="px-2 py-1 font-semibold text-left">Τύπος</th>
                      <th className="px-2 py-1 font-semibold text-left">Τίτλος</th>
                      <th className="px-2 py-1 font-semibold text-left">EARFCN / Freq</th>
                      <th className="px-2 py-1 font-semibold text-left">PCI</th>
                      <th className="px-2 py-1 font-semibold text-left">Cycle</th>
                      <th className="px-2 py-1 font-semibold text-left">Nb</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {pagingData.timeline.map((ev, i) => {
                      const phaseColor =
                        ev.phase === "before" ? "text-amber-400" :
                        ev.phase === "after"  ? "text-orange-400" :
                        "text-primary";
                      const typeColor =
                        ev.type === "lte_paging_edrx" ? "text-cyan-400" :
                        ev.type === "nr_rrc_paging"   ? "text-purple-400" :
                        "text-emerald-400";
                      const d = ev.details;
                      return (
                        <tr key={i} className="hover:bg-muted/40 transition-colors">
                          <td className={`px-2 py-0.5 font-semibold ${phaseColor}`}>{ev.phase}</td>
                          <td className="px-2 py-0.5 font-mono whitespace-nowrap">
                            {ev.time ? new Date(ev.time).toLocaleTimeString("el-GR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—"}
                          </td>
                          <td className="px-2 py-0.5 font-mono text-right">
                            {ev.secondsFromCallStart != null ? `${ev.secondsFromCallStart > 0 ? "+" : ""}${ev.secondsFromCallStart.toFixed(1)}s` : "—"}
                          </td>
                          <td className={`px-2 py-0.5 font-mono text-[10px] ${typeColor}`}>
                            {ev.type === "lte_paging_edrx" ? "LTE eDRX" : ev.type === "lte_rrc_paging" ? "LTE RRC" : "NR RRC"}
                          </td>
                          <td className="px-2 py-0.5 max-w-[180px] truncate" title={ev.title}>{ev.title}</td>
                          <td className="px-2 py-0.5 font-mono">{d.EARFCN ?? d.Freq ?? "—"}</td>
                          <td className="px-2 py-0.5 font-mono">{d.PCI ?? d.PhyCellId ?? "—"}</td>
                          <td className="px-2 py-0.5 font-mono text-[10px]">{d.PagingCycleDecoded != null ? `${d.PagingCycleDecoded} ms` : "—"}</td>
                          <td className="px-2 py-0.5 font-mono text-[10px]">{d.NbDecoded ?? "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* LTE eDRX detail: eDRX fields when present */}
          {pagingData.ltePagingEDRX.some(r => r.EDRXCycleLength != null) && (
            <div>
              <p className="text-[10px] font-semibold uppercase text-muted-foreground mb-1 tracking-wider">eDRX Parameters</p>
              <div className="overflow-x-auto rounded border border-border/50">
                <table className="w-full text-xs">
                  <thead className="bg-muted border-b border-border">
                    <tr>
                      <th className="px-2 py-1 font-semibold">MsgTime</th>
                      <th className="px-2 py-1 font-semibold">eDRX Cycle (ms)</th>
                      <th className="px-2 py-1 font-semibold">PTW (ms)</th>
                      <th className="px-2 py-1 font-semibold">PageStart</th>
                      <th className="px-2 py-1 font-semibold">PageEnd</th>
                      <th className="px-2 py-1 font-semibold">HF Offset</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {pagingData.ltePagingEDRX.filter(r => r.EDRXCycleLength != null).map((r, i) => (
                      <tr key={i} className="hover:bg-muted/40">
                        <td className="px-2 py-0.5 font-mono">{r.MsgTime ? new Date(r.MsgTime).toLocaleTimeString("el-GR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—"}</td>
                        <td className="px-2 py-0.5 font-mono text-center">{r.EDRXCycleLength ?? "—"}</td>
                        <td className="px-2 py-0.5 font-mono text-center">{r.EDRXPTWLength ?? "—"}</td>
                        <td className="px-2 py-0.5 font-mono text-center">{r.EDRXPageStartOffset ?? "—"}</td>
                        <td className="px-2 py-0.5 font-mono text-center">{r.EDRXPageEndOffset ?? "—"}</td>
                        <td className="px-2 py-0.5 font-mono text-center">{r.EDRXHyperFrameOffset ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* RRC Paging message content */}
          {pagingData.lteRrcPaging.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold uppercase text-muted-foreground mb-1 tracking-wider">LTE RRC Paging Messages</p>
              <div className="overflow-x-auto max-h-[200px] overflow-y-auto rounded border border-border/50">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-muted border-b border-border z-10">
                    <tr>
                      <th className="px-2 py-1 font-semibold text-left">Ώρα</th>
                      <th className="px-2 py-1 font-semibold text-left">Φάση</th>
                      <th className="px-2 py-1 font-semibold text-left">MsgTypeName</th>
                      <th className="px-2 py-1 font-semibold text-left">Direction</th>
                      <th className="px-2 py-1 font-semibold text-left">ChnType</th>
                      <th className="px-2 py-1 font-semibold text-left">PCI</th>
                      <th className="px-2 py-1 font-semibold text-left">Msg</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {pagingData.lteRrcPaging.map((r, i) => (
                      <tr key={i} className="hover:bg-muted/40">
                        <td className="px-2 py-0.5 font-mono whitespace-nowrap">{r.MsgTime ? new Date(r.MsgTime).toLocaleTimeString("el-GR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—"}</td>
                        <td className={`px-2 py-0.5 font-semibold ${r.Phase === "before" ? "text-amber-400" : r.Phase === "after" ? "text-orange-400" : "text-primary"}`}>{r.Phase}</td>
                        <td className="px-2 py-0.5">{r.MsgTypeName ?? "—"}</td>
                        <td className="px-2 py-0.5">{r.Direction ?? "—"}</td>
                        <td className="px-2 py-0.5">{r.ChnType ?? "—"}</td>
                        <td className="px-2 py-0.5 font-mono">{r.PhyCellId ?? "—"}</td>
                        <td className="px-2 py-0.5 font-mono text-[10px] max-w-[320px] truncate" title={r.Msg ?? ""}>{r.Msg ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {pagingData.summary.totalPagingEvents === 0 && (
            <p className="text-xs text-muted-foreground">Δεν βρέθηκαν paging events στο παράθυρο ±{60}s.</p>
          )}
        </div>
      )}
    </motion.div>
  );
};

export default CallDetail;
