import { useState, useEffect, useMemo } from "react";
import { motion } from "framer-motion";
import {
  ArrowLeft, Signal, Activity, Gauge, ArrowDown, ArrowUp,
  Wifi, Timer, Save, Edit2
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";
import type { CallRecord } from "@/lib/callData";
import { fetchLteValues, fetchLteValuesBSide, fetchGsmValues, fetchGsmValuesBSide, fetchMosValues, updateCallComment, fetchKpiValues, fetchCallSideComparison, fetchTracelogValues, type CallSideComparisonRow, type TraceLogRow } from "@/lib/api";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, Legend, ReferenceLine } from "recharts";
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
        const [lteRes, gsmRes, mosRes, kpiRes, comparisonRes, bSideLteRes, tracelogRes, bSideGsmRes] = await Promise.allSettled([
          call.callMode !== "CS" ? fetchLteValues(database, call.callId) : Promise.resolve({ lteValues: [] }),
          call.callMode === "CS" || call.callMode === "SRVCC" ? fetchGsmValues(database, call.callId) : Promise.resolve({ gsmValues: [] }),
          fetchMosValues(database, call.callId),
          fetchKpiValues(database, call.callId),
          fetchCallSideComparison(database, call.callId),
          call.callMode === "CS" ? Promise.resolve({ lteValuesBSide: [] }) : fetchLteValuesBSide(database, call.callId),
          fetchTracelogValues(database, call.callId),
          call.callMode === "CS" || call.callMode === "SRVCC" ? fetchGsmValuesBSide(database, call.callId) : Promise.resolve({ gsmValuesBSide: [] })
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
              {radioValues && radioValues.length > 0 && (
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

        {sideComparison.length > 0 && (
          <div className="mt-1 overflow-x-auto">
            <table className="w-full text-[10px]">
              <thead>
                <tr className="text-left text-muted-foreground border-b border-border/60">
                  <th className="py-0.5 pr-2 font-medium">Side</th>
                  <th className="py-0.5 pr-2 font-medium">Status</th>
                  <th className="py-0.5 pr-2 font-medium">Code</th>
                  <th className="py-0.5 pr-2 font-medium">Description</th>
                  <th className="py-0.5 text-right font-medium">Calls</th>
                </tr>
              </thead>
              <tbody>
                {sideComparison.map((row, idx) => (
                  <tr key={`${row.Side || "N"}-${row.code || "NA"}-${idx}`} className="border-b border-border/30">
                    <td className="py-0.5 pr-2 text-foreground font-mono">{row.Side || "N/A"}</td>
                    <td className="py-0.5 pr-2 text-muted-foreground">{row.callStatus || "N/A"}</td>
                    <td className="py-0.5 pr-2 font-mono text-foreground">{row.code || "N/A"}</td>
                    <td className="py-0.5 pr-2 text-muted-foreground">{row.codeDescription || "N/A"}</td>
                    <td className="py-0.5 text-right font-mono text-foreground">{row.calls ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Chart inside the top card */}
        {activeRadioValues && activeRadioValues.length > 0 && (
          <div className="mt-1 pt-1 border-t border-border">
            <h3 className="text-[10px] font-semibold text-foreground mb-1 flex items-center gap-1">
              <Activity className="h-3 w-3 text-primary" />
              {isGSMMode ? "GSM (RxLev / RxQual)" : "LTE (RSRP / RSRQ)"}
            </h3>
            <div className="h-[180px] w-full">
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
                      {showStrength && <Line yAxisId="left" type="monotone" dataKey="RxLevSub" stroke="hsl(200, 80%, 55%)" dot={false} strokeWidth={2} name="RxLevSub" />}
                      {showQuality && <Line yAxisId="right" type="monotone" dataKey="RxQualSub" stroke="hsl(0, 72%, 55%)" dot={false} strokeWidth={2} name="RxQualSub" />}
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
                      {showStrength && <Line yAxisId="left" type="monotone" dataKey="RSRP" stroke="hsl(200, 80%, 55%)" dot={false} strokeWidth={2} name="RSRP" />}
                      {showQuality && <Line yAxisId="right" type="monotone" dataKey="RSRQ" stroke="hsl(45, 93%, 58%)" dot={false} strokeWidth={2} name="RSRQ" />}
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
                    return (
                      <tr
                        key={`${val.FullDate ?? idx}-${idx}`}
                        style={isActive ? { boxShadow: "inset 3px 0 0 hsl(180, 90%, 55%)" } : undefined}
                        className={`transition-all duration-100 cursor-pointer ${isActive
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
    </motion.div>
  );
};

export default CallDetail;
