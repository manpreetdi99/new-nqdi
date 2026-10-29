/**
 * Panels της Call Detail πάνω στις native πηγές του SmartAnalytics Scene
 * (backend/routers/call_detail_native.py, call_analysis.py): event timeline, Call Analysis
 * (έξοδος του native classifier), συσκευές την ίδια στιγμή, markers, RTP/VoLTE, speech samples,
 * UE capability, Scanner & Κινητό (device info + CDR) — και τα κουμπιά PCAP του header.
 * Το TraceLog (με fallback σε IP trace) είναι το panel πάνω αριστερά της CallDetail.
 *
 * Κάθε panel φέρνει μόνο του τα δεδομένα του, ώστε ένα endpoint που αποτυγχάνει να μη
 * χαλάει τα υπόλοιπα. Το sync φορτώνεται μόνο όταν ανοίξει το panel του (ψάχνει σε όλη τη βάση).
 */
import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { ChevronRight, Download, Phone, Smartphone } from "lucide-react";
import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip as RechartsTooltip, XAxis, YAxis } from "recharts";
import { useLocalStorage } from "@/hooks/use-local-storage";
import { AXIS_STYLE, GRID_STYLE, LEGEND_WRAPPER_STYLE } from "@/lib/chartStyles";
import {
  CALL_EVENT_GROUPS,
  callPcapUrl,
  fetchCallAnalysis,
  fetchCallCdr,
  fetchCallEvents,
  fetchCallMarkersV2,
  fetchCallPcapInfo,
  fetchCallRtp,
  fetchMosTestDetail,
  fetchSpeechSamples,
  fetchSpeechTimeDomain,
  fetchSyncDevices,
  fetchUeCapability,
  type CallAnalysisResponse,
  type CallAnalysisSide,
  type CallDeviceInfo,
  type CallEventGroup,
  type CallEventRow,
  type CallSide,
  type RadioWindowValues,
  type RtpSummary,
  type SpeechSummary,
  type UeCapabilityItem,
  type UeCapabilitySide,
} from "@/lib/api";
import {
  buildCallAnalysisGroups,
  buildDeviceCdrGroups,
  buildMosSpeechTests,
  callMidpoint,
  cleanDescription,
  eventName,
  fmtCell,
  fmtPercent,
  formatBytes,
  isNearTime,
  isoClock,
  syncNavigateTarget,
  type DeviceCdrGroup,
  type MosSpeechTest,
} from "@/lib/nativeCallData";

// ---------------------------------------------------------------------------
// Κοινά
// ---------------------------------------------------------------------------

type FetchState<T> = { data: T | null; error: string | null; loading: boolean };

/** `load` = null -> δεν φορτώνει (κλειστό lazy panel)· κρατά ό,τι είχε ήδη φέρει. */
function useFetch<T>(load: (() => Promise<T>) | null, deps: unknown[]): FetchState<T> {
  const [state, setState] = useState<FetchState<T>>({ data: null, error: null, loading: false });
  useEffect(() => {
    if (!load) return;
    let cancelled = false;
    setState((prev) => ({ data: prev.data, error: null, loading: true }));
    load().then(
      (data) => { if (!cancelled) setState({ data, error: null, loading: false }); },
      (err) => { if (!cancelled) setState({ data: null, error: err instanceof Error ? err.message : String(err), loading: false }); },
    );
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}

const SIDE_BADGE: Record<CallSide, string> = {
  A: "bg-sky-500/15 text-sky-400",
  B: "bg-violet-500/15 text-violet-400",
};

function SideBadge({ side }: { side: string | null | undefined }) {
  if (side !== "A" && side !== "B") return <span className="text-muted-foreground">—</span>;
  return <span className={`inline-block min-w-[1.5rem] rounded px-1 text-center font-semibold ${SIDE_BADGE[side]}`}>{side}</span>;
}

/** Χωρίς `onToggle` το panel είναι μόνιμα ανοιχτό: σκέτος τίτλος, χωρίς βελάκι. */
function Section({ title, subtitle, open, onToggle, actions, children }: {
  title: string;
  subtitle?: ReactNode;
  open: boolean;
  onToggle?: () => void;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const heading = (
    <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
      {onToggle && <ChevronRight className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`} />}
      {title}
      {subtitle != null && <span className="text-[10px] font-normal text-muted-foreground">{subtitle}</span>}
    </h3>
  );
  return (
    <div className="bg-card border border-border rounded-lg p-3 space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        {onToggle
          ? <button type="button" onClick={onToggle} aria-expanded={open} className="min-w-0 text-left">{heading}</button>
          : <div className="min-w-0">{heading}</div>}
        {open && actions}
      </div>
      {open && children}
    </div>
  );
}

function StatusLine({ state, empty, isEmpty }: { state: FetchState<unknown>; empty: string; isEmpty: boolean }) {
  if (state.loading && state.data == null) return <p className="text-xs text-muted-foreground">Φόρτωση δεδομένων...</p>;
  if (state.error) return <p className="text-xs text-destructive">Σφάλμα: {state.error}</p>;
  if (isEmpty) return <p className="text-xs text-muted-foreground">{empty}</p>;
  return null;
}

function ToggleChip({ active, onClick, children, title }: { active: boolean; onClick: () => void; children: ReactNode; title?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`h-6 px-2 text-[10px] rounded border transition-colors ${active ? "border-primary/60 bg-primary/15 text-primary" : "border-border bg-muted/30 text-muted-foreground hover:bg-muted"}`}
    >
      {children}
    </button>
  );
}

const TH = "px-2 py-1 font-semibold";
const TABLE_WRAP = "overflow-x-auto max-h-[360px] overflow-y-auto rounded border border-border/50";
const THEAD = "sticky top-0 bg-muted border-b border-border z-10";

/** Γραμμή πίνακα συγχρονισμένη με τον κοινό cursor της σελίδας. */
function TimedRow({ iso, hoveredTime, onHoverTime, children, onClick, extraClass = "" }: {
  iso: string | null;
  hoveredTime: number | null;
  onHoverTime: (t: number | null) => void;
  children: ReactNode;
  onClick?: () => void;
  extraClass?: string;
}) {
  const active = isNearTime(iso, hoveredTime);
  return (
    <tr
      onMouseEnter={() => {
        const t = iso ? new Date(iso).getTime() : NaN;
        onHoverTime(Number.isFinite(t) ? t : null);
      }}
      onMouseLeave={() => onHoverTime(null)}
      onClick={onClick}
      style={active ? { boxShadow: "inset 3px 0 0 hsl(180, 90%, 55%)" } : undefined}
      className={`transition-colors ${active ? "bg-cyan-500/10" : "hover:bg-muted/40"} ${extraClass}`}
    >
      {children}
    </tr>
  );
}

// ---------------------------------------------------------------------------
// PCAP (header)
// ---------------------------------------------------------------------------

/** Κουμπιά download PCAP ανά πλευρά — εμφανίζονται μόνο όταν υπάρχει αρχείο. */
export function PcapButtons({ database, sessionId }: { database: string; sessionId: string }) {
  const state = useFetch(() => fetchCallPcapInfo(database, sessionId), [database, sessionId]);
  const info = state.data;
  if (!info) return null;
  const sides = (["a", "b"] as const).filter((s) => info[s].available && info[s].sessionId != null);
  if (sides.length === 0) return null;
  return (
    <span className="inline-flex items-center gap-1">
      {sides.map((s) => (
        <a
          key={s}
          href={callPcapUrl(database, info[s].sessionId as number)}
          title={`${info[s].fileName ?? "PCAP"} · ${formatBytes(info[s].bytes)} (PCAPData)`}
          className="inline-flex items-center gap-1 h-5 px-1.5 text-[10px] font-medium rounded border border-border bg-muted/50 hover:bg-muted transition-colors"
        >
          <Download className="h-3 w-3" /> PCAP {s.toUpperCase()}
        </a>
      ))}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Scanner & Κινητό (device info + CDR)
// ---------------------------------------------------------------------------

/** Οι ομάδες που φαίνονται πάντα, ως κάρτα ανά πλευρά· οι υπόλοιπες πάνε στο «More details». */
const DEVICE_CARD_GROUPS = ["Συσκευή", "Αρχείο & διαδρομή"];

const SIDE_CARD: Record<CallSide, string> = {
  A: "border-sky-500/30 bg-sky-500/5",
  B: "border-violet-500/30 bg-violet-500/5",
};

/** Μακριές τιμές (π.χ. Firmware) κόβονται εδώ με «…»· η πλήρης τιμή μένει στο tooltip. */
const CARD_VALUE_MAX = 50;

/** Κάρτα μίας πλευράς: συσκευή + αριθμός στην κεφαλίδα, από κάτω τα υπόλοιπα πεδία ανά ομάδα.
 *  Οι δύο κάρτες έχουν τις ίδιες γραμμές (κενό = «—»), ώστε να συγκρίνονται οριζόντια. */
function DeviceSideCard({ side, groups }: { side: CallSide; groups: DeviceCdrGroup[] }) {
  const key = side === "A" ? "a" : "b";
  const rows = groups.flatMap((g) => g.rows);
  const pick = (label: string) => rows.find((r) => r.label === label)?.[key];
  return (
    <div className={`rounded-md border p-2.5 space-y-2 ${SIDE_CARD[side]}`}>
      <div className="flex items-center gap-2 flex-wrap">
        <SideBadge side={side} />
        <Smartphone className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="text-base font-semibold text-foreground">{fmtCell(pick("Device"))}</span>
        {pick("Number") != null && (
          <span className="ml-auto inline-flex items-center gap-1 font-mono text-sm text-foreground">
            <Phone className="h-3.5 w-3.5 text-muted-foreground" />{fmtCell(pick("Number"))}
          </span>
        )}
      </div>
      {groups.map((g) => {
        const fields = g.rows.filter((r) => r.label !== "Device" && r.label !== "Number");
        if (fields.length === 0) return null;
        return (
          <div key={g.title}>
            <div className="mb-0.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{g.title}</div>
            <dl className="grid grid-cols-[8.5rem_minmax(0,1fr)] gap-x-2 gap-y-0.5 text-[13px]">
              {fields.map((r) => {
                const value = fmtCell(r[key]);
                const cut = value.length > CARD_VALUE_MAX;
                return (
                  <Fragment key={r.label}>
                    <dt className="text-muted-foreground">{r.label}</dt>
                    <dd className="font-mono break-all text-foreground" title={cut ? value : undefined}>
                      {cut ? `${value.slice(0, CARD_VALUE_MAX)}…` : value}
                    </dd>
                  </Fragment>
                );
              })}
            </dl>
          </div>
        );
      })}
    </div>
  );
}

/** Συσκευή και αρχείο (βλ. buildDeviceCdrGroups) φαίνονται πάντα, ως κάρτα ανά πλευρά. Τα
 *  υπόλοιπα του CDR είναι πίσω από το «More details». Από τη γραμμή της κλήσης λείπουν όσα
 *  δείχνει ήδη ο header (status, τύπος, έναρξη/λήξη, διάρκεια, setup time). */
function DeviceCdrSection({ database, sessionId, deviceInfo }: { database: string; sessionId: string; deviceInfo: CallDeviceInfo | null }) {
  const [moreOpen, setMoreOpen] = useLocalStorage<boolean>("call-detail-native-device-more-open", false);
  const state = useFetch(() => fetchCallCdr(database, sessionId), [database, sessionId]);
  const call = state.data?.call ?? null;
  const allGroups = buildDeviceCdrGroups(deviceInfo, state.data?.a ?? null, state.data?.b ?? null);
  const cardGroups = allGroups.filter((g) => DEVICE_CARD_GROUPS.includes(g.title));
  const groups = allGroups.filter((g) => !DEVICE_CARD_GROUPS.includes(g.title));

  const callItems: Array<[string, unknown]> = call ? [
    ["Direction", call.CallDirection], ["Dial", call.DialTs],
    ["SQ min/avg/max", call.SqSampleCount ? `${fmtCell(call.MinSQ)} / ${fmtCell(call.AvgSQ)} / ${fmtCell(call.MaxSQ)}` : null],
    ["SQ samples", call.SqSampleCount], ["Bad samples", call.BadSampleCount],
  ] : [];

  return (
    <Section
      title="Scanner & Κινητό"
      subtitle="(DmnDevice · FileList · FactCDRVoice)"
      open
    >
      {state.error && <p className="text-xs text-destructive">Σφάλμα CDR: {state.error}</p>}
      {state.loading && allGroups.length === 0 && <p className="text-xs text-muted-foreground">Φόρτωση δεδομένων...</p>}
      {!state.loading && allGroups.length === 0 && <p className="text-xs text-muted-foreground">Δεν υπάρχουν στοιχεία συσκευής ή CDR.</p>}
      {cardGroups.length > 0 && (
        <div className="grid gap-2 md:grid-cols-2">
          <DeviceSideCard side="A" groups={cardGroups} />
          <DeviceSideCard side="B" groups={cardGroups} />
        </div>
      )}
      {(call || groups.length > 0) && (
        <button
          type="button"
          onClick={() => setMoreOpen(!moreOpen)}
          aria-expanded={moreOpen}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronRight className={`h-3.5 w-3.5 transition-transform ${moreOpen ? "rotate-90" : ""}`} />
          More details
        </button>
      )}
      {moreOpen && call && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] font-mono">
          {callItems.filter(([, v]) => v != null && v !== "").map(([label, value]) => (
            <span key={label} className="text-muted-foreground">{label} <b className="text-foreground">{fmtCell(value)}</b></span>
          ))}
          {call.Valid != null && (
            <span className="text-muted-foreground" title={call.InvalidReason != null ? String(call.InvalidReason) : undefined}>
              Valid <b className={call.Valid === "Valid" ? "text-success" : "text-destructive"}>{fmtCell(call.Valid)}</b>
              {call.InvalidReason ? ` (${call.InvalidReason})` : ""}
            </span>
          )}
        </div>
      )}
      {moreOpen && groups.length > 0 && (
        <div className={TABLE_WRAP}>
          <table className="w-full text-xs text-left">
            <thead className={THEAD}>
              <tr>
                <th className={`${TH} w-40`}>Πεδίο</th>
                <th className={`${TH} text-sky-400`}>A-Side</th>
                <th className={`${TH} text-violet-400`}>B-Side</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {groups.map((g) => (
                <Fragment key={g.title}>
                  <tr className="bg-muted/30">
                    <td colSpan={3} className="px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{g.title}</td>
                  </tr>
                  {g.rows.map((r) => (
                    <tr key={r.label} className="hover:bg-muted/30">
                      <td className="px-2 py-0.5 text-muted-foreground">{r.label}</td>
                      <td className="px-2 py-0.5 font-mono break-all">{fmtCell(r.a)}</td>
                      <td className="px-2 py-0.5 font-mono break-all">{fmtCell(r.b)}</td>
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Event timeline
// ---------------------------------------------------------------------------

function eventTone(e: CallEventRow): string {
  const name = (e.EventFullName ?? "").toLowerCase();
  if (e.EventGroup === "Call Status") return /fail|drop/.test(name) ? "text-destructive" : "text-success";
  if (/fail|drop|reject|error/.test(name)) return "text-destructive";
  if (e.EventTopGroup === "Voice Service") return "text-sky-400";
  if (e.EventTopGroup === "RRM") return "text-cyan-400";
  return "text-amber-400";
}

type SideFilter = "both" | CallSide;

function SideFilterChips({ value, onChange }: { value: SideFilter; onChange: (v: SideFilter) => void }) {
  return (
    <span className="inline-flex gap-1">
      {(["both", "A", "B"] as const).map((s) => (
        <ToggleChip key={s} active={value === s} onClick={() => onChange(s)}>{s === "both" ? "A+B" : s}</ToggleChip>
      ))}
    </span>
  );
}

/** Event timeline — ξεχωριστό export: στη Call Detail μπαίνει πάνω από το L3 Signaling. */
export function CallEventsPanel({ database, sessionId, hoveredTime, onHoverTime, onVoiceEvents }: {
  database: string;
  sessionId: string;
  hoveredTime: number | null;
  onHoverTime: (t: number | null) => void;
  onVoiceEvents?: (events: CallEventRow[]) => void;
}) {
  const [open, setOpen] = useLocalStorage<boolean>("call-detail-native-events-open-v2", false);
  const [groups, setGroups] = useLocalStorage<CallEventGroup[]>("call-detail-native-event-groups", ["Voice Service", "RRM"]);
  const [side, setSide] = useState<SideFilter>("both");
  // Όλα τα groups μία φορά — το φίλτρο είναι μόνο εμφάνισης, χωρίς refetch.
  const state = useFetch(() => fetchCallEvents(database, sessionId, CALL_EVENT_GROUPS), [database, sessionId]);
  const all = useMemo(() => state.data?.events ?? [], [state.data]);

  useEffect(() => {
    onVoiceEvents?.(all.filter((e) => e.EventTopGroup === "Voice Service"));
  }, [all, onVoiceEvents]);

  const countByGroup = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of all) m.set(e.EventTopGroup ?? "", (m.get(e.EventTopGroup ?? "") ?? 0) + 1);
    return m;
  }, [all]);

  const visible = all.filter((e) =>
    groups.includes(e.EventTopGroup as CallEventGroup) && (side === "both" || e.Side === side));
  const toggleGroup = (g: CallEventGroup) =>
    setGroups(groups.includes(g) ? groups.filter((x) => x !== g) : [...groups, g]);

  return (
    <Section
      title="Event timeline"
      subtitle={state.data ? `(FactAdvancedTriggerEvent · ${visible.length} από ${all.length} events)` : "(FactAdvancedTriggerEvent)"}
      open={open}
      onToggle={() => setOpen(!open)}
      actions={
        <div className="flex flex-wrap items-center gap-1">
          {CALL_EVENT_GROUPS.map((g) => (
            <ToggleChip key={g} active={groups.includes(g)} onClick={() => toggleGroup(g)}>
              {g} <span className="opacity-70">({countByGroup.get(g) ?? 0})</span>
            </ToggleChip>
          ))}
          <span className="w-px h-4 bg-border mx-1" />
          <SideFilterChips value={side} onChange={setSide} />
        </div>
      }
    >
      <StatusLine state={state} empty="Δεν υπάρχουν events για τα επιλεγμένα φίλτρα." isEmpty={visible.length === 0} />
      {visible.length > 0 && (
        <div className={TABLE_WRAP}>
          <table className="w-full text-xs text-left">
            <thead className={THEAD}>
              <tr>
                <th className={TH}>Ώρα</th>
                <th className={TH}>Πλευρά</th>
                <th className={TH}>Group</th>
                <th className={TH}>Event</th>
                <th className={TH} title="SummaryInfo — το κείμενο του native Scene, όπως είναι">Περιγραφή</th>
                <th className={TH} title="FactL3Messages — μόνο για RRM events">L3</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {visible.map((e) => (
                <TimedRow key={e.FactId} iso={e.FullDate} hoveredTime={hoveredTime} onHoverTime={onHoverTime}>
                  <td className="px-2 py-0.5 font-mono whitespace-nowrap">{isoClock(e.FullDate)}</td>
                  <td className="px-2 py-0.5"><SideBadge side={e.Side} /></td>
                  <td className="px-2 py-0.5 text-muted-foreground whitespace-nowrap">{e.EventGroup ?? e.EventTopGroup ?? "—"}</td>
                  <td className={`px-2 py-0.5 font-semibold whitespace-nowrap ${eventTone(e)}`} title={e.EventFullName ?? undefined}>{eventName(e)}</td>
                  <td className="px-2 py-0.5 text-muted-foreground break-words min-w-[280px]">{e.SummaryInfo ?? "—"}</td>
                  <td className="px-2 py-0.5 font-mono text-[10px] whitespace-nowrap" title={e.L3MsgInfo ?? undefined}>
                    {e.L3MsgName ? `${e.L3Direction ?? ""} ${e.L3MsgName}`.trim() : "—"}
                  </td>
                </TimedRow>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// RTP / VoLTE
// ---------------------------------------------------------------------------

const RTP_METRICS: Array<[keyof RtpSummary, string, number]> = [
  ["AvgJitter", "Jitter (ms)", 1],
  ["PacketLossRate", "Packet loss rate", 4],
  ["AvgIPDV", "IPDV (ms)", 1],
  ["AvgPDV", "PDV (ms)", 1],
  ["NumLostPackets", "Lost pkts / sample", 2],
  ["MaxConseqLostPackets", "Max consec. lost", 2],
  ["NumOutOfOrderPackets", "Out of order", 2],
];

function RtpSideCard({ side, summary }: { side: CallSide; summary: RtpSummary | undefined }) {
  const sip = summary
    ? (Object.entries(summary) as Array<[string, unknown]>).filter(([k, v]) => k.startsWith("SIP ") && v != null)
    : [];
  return (
    <div className="rounded border border-border/60 bg-muted/20 p-2 space-y-2">
      <p className={`text-[10px] font-semibold uppercase tracking-wider ${side === "A" ? "text-sky-400" : "text-violet-400"}`}>
        {side}-Side <span className="font-normal normal-case text-muted-foreground">({summary?.SampleCount ?? 0} samples · {fmtCell(summary?.NumPackets)} packets)</span>
      </p>
      {!summary || summary.SampleCount === 0 ? (
        <p className="text-xs text-muted-foreground">Χωρίς RTP samples.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
            {RTP_METRICS.map(([key, label, digits]) => {
              const v = summary[key] as number | null;
              return (
                <div key={key} className="rounded bg-card border border-border/50 px-1.5 py-1">
                  <p className="text-[9px] uppercase text-muted-foreground">{label}</p>
                  <p className="text-xs font-bold font-mono">{v != null ? Number(v).toFixed(digits) : "—"}</p>
                </div>
              );
            })}
          </div>
          <div className="text-[10px] font-mono space-y-0.5">
            {summary.streams.map((s, i) => (
              <div key={i} className="text-muted-foreground">
                {s.Mode ?? "—"} · <b className="text-foreground">{s.Codec ?? "—"}</b> · PT {s.PayloadType ?? "—"} · SSRC {s.SSRC ?? "—"}
              </div>
            ))}
          </div>
          {sip.length > 0 && (
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] font-mono">
              {sip.map(([k, v]) => (
                <span key={k} className="text-muted-foreground">{k.replace(/^SIP /, "")} <b className="text-foreground">{String(v)} ms</b></span>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function RtpSection({ database, sessionId, hoveredTime, onHoverTime }: {
  database: string;
  sessionId: string;
  hoveredTime: number | null;
  onHoverTime: (t: number | null) => void;
}) {
  const [open, setOpen] = useLocalStorage<boolean>("call-detail-native-rtp-open-v2", false);
  const state = useFetch(() => fetchCallRtp(database, sessionId), [database, sessionId]);
  const samples = useMemo(() => state.data?.samples ?? [], [state.data]);
  const series = useMemo(() => {
    const bySide = { A: [] as Array<{ t: number; jitter: number | null }>, B: [] as Array<{ t: number; jitter: number | null }> };
    for (const s of samples) {
      const t = new Date(s.FullDate).getTime();
      if (!Number.isFinite(t) || (s.Side !== "A" && s.Side !== "B")) continue;
      bySide[s.Side].push({ t, jitter: s.AvgJitter });
    }
    return bySide;
  }, [samples]);

  return (
    <Section
      title="RTP / VoLTE"
      subtitle={state.data ? `(FactVoLTE · ${samples.length} samples)` : "(FactVoLTE)"}
      open={open}
      onToggle={() => setOpen(!open)}
    >
      <StatusLine
        state={state}
        empty="Δεν υπάρχουν RTP δεδομένα — π.χ. CS/CSFB κλήση ή αποτυχία πριν στηθεί το RTP."
        isEmpty={samples.length === 0}
      />
      {samples.length > 0 && state.data && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <RtpSideCard side="A" summary={state.data.summary.a} />
            <RtpSideCard side="B" summary={state.data.summary.b} />
          </div>
          <div className="h-[160px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                margin={{ top: 4, right: 8, bottom: 0, left: -16 }}
                onMouseMove={(e) => onHoverTime(typeof e?.activeLabel === "number" ? e.activeLabel : null)}
                onMouseLeave={() => onHoverTime(null)}
              >
                <CartesianGrid {...GRID_STYLE} />
                <XAxis
                  dataKey="t"
                  type="number"
                  domain={["dataMin", "dataMax"]}
                  tickFormatter={(v: number) => new Date(v).toLocaleTimeString("el-GR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                  {...AXIS_STYLE}
                />
                <YAxis {...AXIS_STYLE} unit=" ms" width={56} />
                <RechartsTooltip
                  contentStyle={{ backgroundColor: "hsl(var(--card))", borderColor: "hsl(var(--border))", borderRadius: 8, fontSize: 11 }}
                  itemStyle={{ color: "hsl(var(--foreground))" }}
                  labelFormatter={(v: number) => new Date(v).toLocaleTimeString("el-GR")}
                />
                <Legend wrapperStyle={LEGEND_WRAPPER_STYLE} />
                <Line data={series.A} dataKey="jitter" name="Jitter A" stroke="#38bdf8" dot={false} strokeWidth={1.5} isAnimationActive={false} />
                <Line data={series.B} dataKey="jitter" name="Jitter B" stroke="#a78bfa" dot={false} strokeWidth={1.5} isAnimationActive={false} />
                {hoveredTime != null && <ReferenceLine x={hoveredTime} stroke="hsl(180, 90%, 55%)" strokeDasharray="3 3" />}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Markers
// ---------------------------------------------------------------------------

function MarkersSection({ database, sessionId, hoveredTime, onHoverTime }: {
  database: string;
  sessionId: string;
  hoveredTime: number | null;
  onHoverTime: (t: number | null) => void;
}) {
  const [open, setOpen] = useLocalStorage<boolean>("call-detail-native-markers-open", false);
  const [hiddenTypes, setHiddenTypes] = useState<string[]>([]);
  const [side, setSide] = useState<SideFilter>("both");
  const state = useFetch(() => fetchCallMarkersV2(database, sessionId), [database, sessionId]);
  const markers = useMemo(() => state.data?.markers ?? [], [state.data]);
  const types = useMemo(() => [...new Set(markers.map((m) => m.MarkerType ?? "—"))], [markers]);
  const visible = markers.filter((m) => !hiddenTypes.includes(m.MarkerType ?? "—") && (side === "both" || m.Side === side));
  const countA = markers.filter((m) => m.Side === "A").length;

  return (
    <Section
      title="Markers"
      subtitle={state.data ? `(FactMarkers · A ${countA} / B ${markers.length - countA})` : "(FactMarkers)"}
      open={open}
      onToggle={() => setOpen(!open)}
      actions={
        <div className="flex flex-wrap items-center gap-1">
          {types.map((t) => (
            <ToggleChip
              key={t}
              active={!hiddenTypes.includes(t)}
              onClick={() => setHiddenTypes(hiddenTypes.includes(t) ? hiddenTypes.filter((x) => x !== t) : [...hiddenTypes, t])}
            >
              {t}
            </ToggleChip>
          ))}
          <span className="w-px h-4 bg-border mx-1" />
          <SideFilterChips value={side} onChange={setSide} />
        </div>
      }
    >
      <StatusLine state={state} empty="Δεν υπάρχουν markers." isEmpty={visible.length === 0} />
      {visible.length > 0 && (
        <div className={TABLE_WRAP}>
          <table className="w-full text-xs text-left">
            <thead className={THEAD}>
              <tr>
                <th className={TH}>Ώρα</th>
                <th className={TH}>Πλευρά</th>
                <th className={TH}>Type</th>
                <th className={TH} title="DmnMarkerInfo.Category / Class">Category / Class</th>
                <th className={TH}>Κείμενο</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {visible.map((m) => (
                <TimedRow key={m.FactId} iso={m.FullDate} hoveredTime={hoveredTime} onHoverTime={onHoverTime}>
                  <td className="px-2 py-0.5 font-mono whitespace-nowrap">{isoClock(m.FullDate)}</td>
                  <td className="px-2 py-0.5"><SideBadge side={m.Side} /></td>
                  <td className="px-2 py-0.5 whitespace-nowrap">{m.MarkerType ?? "—"}</td>
                  <td className="px-2 py-0.5 text-muted-foreground whitespace-nowrap">{[m.Category, m.Class].filter(Boolean).join(" / ") || "—"}</td>
                  <td className="px-2 py-0.5 font-mono break-words" title={m.FullName ?? undefined}>{m.MarkerText ?? "—"}</td>
                </TimedRow>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Call Analysis (native classifier)
// ---------------------------------------------------------------------------

function sideTone(side: CallSide) {
  return side === "A" ? "text-sky-400" : "text-violet-400";
}

/** Μία γραμμή ανά πλευρά: status, code, αιτία όπως στο Scene, ή γιατί έμεινε αταξινόμητη. */
function ClassificationLine({ data }: { data: CallAnalysisSide }) {
  const reason = data.UnclassifiedReason as string | null;
  const description = cleanDescription((data.Description ?? data.codeDescription) as string | null);
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 text-xs">
      <SideBadge side={data.Side} />
      <b>{fmtCell(data.callStatus)}</b>
      <span className="font-mono">{fmtCell(data.code)}</span>
      {reason
        ? <span className="text-amber-400">{reason}</span>
        : <span className="text-muted-foreground">{description ?? "—"}</span>}
      {data.DescriptionGroup && <span className="text-[10px] px-1 rounded bg-muted/50">{String(data.DescriptionGroup)}</span>}
    </div>
  );
}

const fmtDb = (v: number | null | undefined) => (v == null ? "—" : v.toFixed(1));

/** Παράθυρο radio του classifier ανά πλευρά, με προειδοποίηση όταν το disconnect είναι εκτός κλήσης. */
function RadioWindowCard({ data }: { data: CallAnalysisSide }) {
  const w = data.radioWindow;
  if (!w?.applies) return null;
  const row = (label: string, v: RadioWindowValues, tone = "") => (
    <tr>
      <td className="pr-2 text-muted-foreground">{label}</td>
      <td className={`pr-2 font-mono ${tone}`}>{fmtDb(v.rsrp)}</td>
      <td className={`pr-2 font-mono ${tone}`}>{fmtDb(v.rsrq)}</td>
      <td className={`pr-2 font-mono ${tone}`}>{fmtDb(v.sinr)}</td>
      <td className="font-mono text-muted-foreground">{v.n ?? 0}</td>
    </tr>
  );
  return (
    <div className={`rounded border p-2 space-y-1 ${w.outsideCall ? "border-amber-500/50 bg-amber-500/5" : "border-border/60 bg-muted/20"}`}>
      <p className={`text-[10px] font-semibold uppercase tracking-wider ${sideTone(data.Side)}`}>
        {data.Side}-Side <span className="font-normal normal-case text-muted-foreground">· disconnect {isoClock(w.disconnectNative)}</span>
      </p>
      {w.outsideCall && (
        <p className="text-[11px] text-amber-400">
          Το disconnect είναι {((w.overshootMs ?? 0) / 1000).toFixed(1)} s μετά το τέλος του session: το sqCallAnalysis
          πήρε SIP από το επόμενο (IDLE) session (join SessionId + 1), οπότε το παράθυρο radio έπεσε εκτός κλήσης.
          Διορθωμένο disconnect: {isoClock(w.disconnectFixed)}.
        </p>
      )}
      <table className="text-xs">
        <thead>
          <tr className="text-[10px] text-muted-foreground">
            <th className="pr-2 text-left font-normal" />
            <th className="pr-2 text-left font-normal">RSRP</th>
            <th className="pr-2 text-left font-normal">RSRQ</th>
            <th className="pr-2 text-left font-normal">SINR</th>
            <th className="text-left font-normal">reports</th>
          </tr>
        </thead>
        <tbody>
          {row("Native", w.native)}
          {w.fixed && row("Διορθωμένο", w.fixed, "text-amber-400")}
        </tbody>
      </table>
    </div>
  );
}

function CallAnalysisSection({ database, sessionId, onData }: {
  database: string;
  sessionId: string;
  onData?: (data: CallAnalysisResponse | null) => void;
}) {
  const [open, setOpen] = useLocalStorage<boolean>("call-detail-native-ca-open", false);
  // Φορτώνει πάντα (όχι lazy): το disconnect του classifier μπαίνει και στο signal chart.
  const state = useFetch(() => fetchCallAnalysis(database, sessionId), [database, sessionId]);
  const data = state.data;
  useEffect(() => { onData?.(data); }, [data, onData]);

  const groups = useMemo(
    () => (data ? buildCallAnalysisGroups(data.groups, data.a, data.b) : []),
    [data],
  );
  const sides = [data?.a, data?.b].filter((s): s is CallAnalysisSide => s != null);
  const outside = sides.some((s) => s.radioWindow?.outsideCall);
  const anyWindow = sides.some((s) => s.radioWindow?.applies);

  return (
    <Section
      title="Call Analysis"
      subtitle={
        <>
          (CallAnalysis · {sides.map((s) => `${s.Side} ${s.code ?? "—"}`).join(" / ") || "—"})
          {outside && <span className="ml-1 text-amber-400">⚠ παράθυρο radio εκτός κλήσης</span>}
        </>
      }
      open={open}
      onToggle={() => setOpen(!open)}
    >
      <StatusLine state={state} empty="Η κλήση δεν έχει γραμμή στο CallAnalysis." isEmpty={sides.length === 0} />
      {sides.length > 0 && (
        <div className="space-y-1">
          {sides.map((s) => <ClassificationLine key={s.Side} data={s} />)}
        </div>
      )}
      {anyWindow && (
        <>
          <p className="text-[10px] text-muted-foreground">
            Μέσοι όροι radio του classifier (κανόνες Low RSRP/RSRQ/SINR): τα τελευταία 8 LTE measurement reports στα 20 s
            πριν από το disconnect, απλός μέσος όρος σε dB — μόνο σε Dropped/Failed.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {sides.map((s) => <RadioWindowCard key={s.Side} data={s} />)}
          </div>
        </>
      )}
      {groups.length > 0 && (
        <div className={TABLE_WRAP}>
          <table className="w-full text-xs text-left">
            <thead className={THEAD}>
              <tr>
                <th className={`${TH} w-56`}>Πεδίο</th>
                <th className={`${TH} text-sky-400`}>A-Side</th>
                <th className={`${TH} text-violet-400`}>B-Side</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {groups.map((g) => (
                <Fragment key={g.title}>
                  <tr className="bg-muted/30">
                    <td colSpan={3} className="px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{g.title}</td>
                  </tr>
                  {g.rows.map((r) => (
                    <tr key={r.key} className="hover:bg-muted/30">
                      <td className="px-2 py-0.5 text-muted-foreground font-mono text-[11px]">{r.key}</td>
                      <td className="px-2 py-0.5 font-mono break-words">{fmtCell(r.a)}</td>
                      <td className="px-2 py-0.5 font-mono break-words">{fmtCell(r.b)}</td>
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// MOS ανά test & Speech samples (POLQA x FactSpeechCodecs x FactSpeech + FactSpeechTimeDomain)
// ---------------------------------------------------------------------------

const fmtFixed = (digits: number) => (v: number | null) => (v == null ? "—" : v.toFixed(digits));

const SPEECH_TILES: Array<[keyof SpeechSummary, string, (v: number | null) => string]> = [
  ["LQ", "MOS avg", fmtFixed(2)],
  ["MinLQ", "MOS min", fmtFixed(2)],
  ["IPAudioRTT", "Audio RTT (ms)", fmtFixed(0)],
  ["MissedVoiceDecimal", "Missed voice", (v) => fmtPercent(v)],
  ["FrontClippingDecimal", "Front clipping", (v) => fmtPercent(v)],
  ["DelaySpread", "Delay spread", fmtFixed(1)],
  ["NoiseRcv", "Noise rcv (dB)", fmtFixed(1)],
  ["StaticSNR", "SNR (dB)", fmtFixed(1)],
];

function SpeechSideCard({ side, summary }: { side: CallSide; summary: SpeechSummary | undefined }) {
  return (
    <div className="rounded border border-border/60 bg-muted/20 p-2 space-y-2">
      <p className={`text-[10px] font-semibold uppercase tracking-wider ${sideTone(side)}`}>
        {side}-Side ακούει <span className="font-normal normal-case text-muted-foreground">
          ({summary?.SampleCount ?? 0} δείγματα · {summary?.BadCount ?? 0} bad · {summary?.SilentCount ?? 0} silent)
        </span>
      </p>
      {!summary || summary.SampleCount === 0 ? (
        <p className="text-xs text-muted-foreground">Χωρίς speech δείγματα.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
            {SPEECH_TILES.map(([key, label, fmt]) => (
              <div key={key} className="rounded bg-card border border-border/50 px-1.5 py-1">
                <p className="text-[9px] uppercase text-muted-foreground">{label}</p>
                <p className="text-xs font-bold font-mono">{fmt(summary[key] as number | null)}</p>
              </div>
            ))}
          </div>
          <p className="text-[10px] font-mono text-muted-foreground">
            LQ sub-scores: coloration {fmtCell(summary.LQColoration)} · discontinuity {fmtCell(summary.LQDiscontinuity)} ·
            noisiness {fmtCell(summary.LQNoisiness)} · loudness {fmtCell(summary.LQLoudness)}
          </p>
        </>
      )}
    </div>
  );
}

function SpeechTimeDomainChart({ database, sessionId, test }: { database: string; sessionId: string; test: MosSpeechTest }) {
  const state = useFetch(() => fetchSpeechTimeDomain(database, sessionId, test.testId), [database, sessionId, test.testId]);
  const points = state.data?.points ?? [];
  return (
    <div className="space-y-1">
      <p className="text-[10px] text-muted-foreground">
        Test {test.testId} · {test.direction ?? "—"} · MOS {fmtCell(test.mos)} — FactSpeechTimeDomain ({points.length} σημεία)
      </p>
      <StatusLine state={state} empty="Δεν υπάρχουν time-domain δεδομένα για αυτό το test." isEmpty={points.length === 0} />
      {points.length > 0 && (
        <div className="h-[180px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={points} margin={{ top: 4, right: 8, bottom: 0, left: -16 }}>
              <CartesianGrid {...GRID_STYLE} />
              <XAxis dataKey="Time" type="number" domain={["dataMin", "dataMax"]} unit=" s" tickFormatter={(v: number) => v.toFixed(1)} {...AXIS_STYLE} />
              <YAxis yAxisId="db" {...AXIS_STYLE} unit=" dB" width={60} />
              <YAxis yAxisId="sim" orientation="right" domain={[0, 1]} {...AXIS_STYLE} width={36} />
              <RechartsTooltip
                contentStyle={{ backgroundColor: "hsl(var(--card))", borderColor: "hsl(var(--border))", borderRadius: 8, fontSize: 11 }}
                itemStyle={{ color: "hsl(var(--foreground))" }}
                labelFormatter={(v: number) => `${Number(v).toFixed(2)} s`}
              />
              <Legend wrapperStyle={LEGEND_WRAPPER_STYLE} />
              <Line yAxisId="db" dataKey="SentSignal" name="Sent" stroke="#94a3b8" dot={false} strokeWidth={1} isAnimationActive={false} />
              <Line yAxisId="db" dataKey="ReceivedSignal" name="Received" stroke="#38bdf8" dot={false} strokeWidth={1} isAnimationActive={false} />
              <Line yAxisId="sim" dataKey="Similarity" name="Similarity" stroke="#22c55e" dot={false} strokeWidth={1.5} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

const mosTone = (mos: number | null, bad: boolean) =>
  mos == null ? "text-muted-foreground/40" : bad || mos < 3 ? "text-destructive" : mos < 3.5 ? "text-warning" : "text-primary";
const absTone = (v: number | null, bad: number, warn: number) => {
  const abs = v != null ? Math.abs(v) : null;
  return abs == null ? "text-muted-foreground/40" : abs >= bad ? "text-destructive" : abs >= warn ? "text-warning" : "text-primary";
};
const UL_DL: Record<string, string> = { "A->B": "UL", "B->A": "DL" };
const fmtNum = (v: number | null | undefined, digits: number) => (v == null ? "—" : Number(v).toFixed(digits));

/**
 * Ένας πίνακας για το MOS ανά test και τα speech samples, joined με το TestId
 * (buildMosSpeechTests): ένα test = ένα block με ένα row ανά codec (FactSpeechCodecs, Active,
 * Duration <> 0)· τα πεδία του test, του δείγματος και οι μέσες τιμές LTE μπαίνουν μία φορά
 * (rowSpan). Κλικ σε test -> time-domain γράφημα. Οι δύο πηγές φορτώνουν χωριστά, ώστε αν
 * αποτύχει η μία να φαίνεται η άλλη.
 */
function MosSpeechSection({ database, sessionId, hoveredTime, onHoverTime }: {
  database: string;
  sessionId: string;
  hoveredTime: number | null;
  onHoverTime: (t: number | null) => void;
}) {
  const [open, setOpen] = useLocalStorage<boolean>("call-detail-native-speech-open", false);
  const [selected, setSelected] = useState<number | null>(null);
  const speech = useFetch(open ? () => fetchSpeechSamples(database, sessionId) : null, [database, sessionId, open]);
  const mos = useFetch(open ? () => fetchMosTestDetail(database, sessionId) : null, [database, sessionId, open]);
  const tests = useMemo(
    () => buildMosSpeechTests(mos.data?.mosTests ?? [], speech.data?.samples ?? []),
    [mos.data, speech.data],
  );
  const selectedTest = tests.find((t) => t.testId === selected) ?? null;
  const loaded = speech.data != null || mos.data != null;
  const state: FetchState<unknown> = {
    data: loaded ? tests : null,
    loading: speech.loading || mos.loading,
    error: speech.error && mos.error ? speech.error : null,
  };
  const partialError = state.error ? null : speech.error ? `speech samples — ${speech.error}` : mos.error ? `MOS ανά test — ${mos.error}` : null;

  return (
    <Section
      title="MOS ανά test & Speech samples"
      subtitle={loaded ? `(${tests.length} tests · POLQA x FactSpeech x FactSpeechCodecs)` : "(POLQA x FactSpeech x FactSpeechCodecs)"}
      open={open}
      onToggle={() => setOpen(!open)}
    >
      <StatusLine state={state} empty="Δεν υπάρχουν speech δείγματα / MOS tests — π.χ. Failed κλήση." isEmpty={tests.length === 0} />
      {partialError && <p className="text-[10px] text-amber-400">Μερικά δεδομένα: {partialError}</p>}
      {tests.length > 0 && (
        <>
          {speech.data && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <SpeechSideCard side="A" summary={speech.data.summary.A} />
              <SpeechSideCard side="B" summary={speech.data.summary.B} />
            </div>
          )}
          <p className="text-[10px] text-muted-foreground">
            Ένα block ανά test, ένα row ανά codec (με έντονα ο codec της κατεύθυνσης του MOS). Κλικ σε test για τα
            time-domain γραφήματα (σήμα αποστολής/λήψης, similarity).
          </p>
          <div className={TABLE_WRAP}>
            <table className="w-full text-xs text-left">
              <thead className={THEAD}>
                <tr>
                  <th className={TH}>Ώρα</th>
                  <th className={TH}>TestId</th>
                  <th className={TH} title="Η πλευρά που άκουσε το δείγμα">Πλευρά</th>
                  <th className={TH} title="A->B = UL, B->A = DL">Dir</th>
                  <th className={TH} title="vResultsLQAvgP863SWBSimpleCodec.LQWBP863float (αλλιώς FactSpeech.LQ)">MOS</th>
                  <th className={TH} title="DmnTest.Status">Status</th>
                  <th className={TH}>Category</th>
                  <th className={TH} title="IPAudioRTT — Two-way Audio Delay">RTT ms</th>
                  <th className={TH}>Missed</th>
                  <th className={TH}>Clipping</th>
                  <th className={TH}>Delay spr.</th>
                  <th className={TH} title="FactSpeechCodecs.CodecDirection + CodecName">Codec</th>
                  <th className={TH}>Rate</th>
                  <th className={TH}>Dur s</th>
                  <th className={TH} title="FactSpeechCodecs.CodecRatePerTestRatio">% test</th>
                  <th className={TH}>EARFCN</th>
                  <th className={TH}>PCI</th>
                  <th className={TH} title="AVG vJointLTEMeasurementReport μέσα στο TestId">RSRP</th>
                  <th className={TH}>RSRQ</th>
                  <th className={TH}>SINR</th>
                  <th className={TH} title="Coloration / Discontinuity / Noisiness / Loudness">Sub-scores</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {tests.map((test, ti) => {
                  const s = test.sample;
                  const codecRows = test.codecs.length > 0 ? test.codecs : [null];
                  const span = codecRows.length;
                  const cell = "px-2 py-0.5 align-middle";
                  const mono = `${cell} font-mono whitespace-nowrap`;
                  const dirLabel = UL_DL[test.direction ?? ""];
                  const isSelected = selected === test.testId;
                  return codecRows.map((codec, ci) => {
                    const isMosDir = codec != null && dirLabel === codec.CodecDirection;
                    return (
                      <TimedRow
                        key={`${test.testId}-${ci}`}
                        iso={test.fullDate}
                        hoveredTime={hoveredTime}
                        onHoverTime={onHoverTime}
                        onClick={() => setSelected(isSelected ? null : test.testId)}
                        extraClass={`cursor-pointer ${isSelected ? "bg-primary/10" : ""} ${ci === 0 && ti > 0 ? "border-t-2 border-border" : ""}`}
                      >
                        {ci === 0 && <>
                          <td rowSpan={span} className={mono}>{isoClock(test.fullDate)}</td>
                          <td rowSpan={span} className={mono}>{test.testId}</td>
                          <td rowSpan={span} className={cell}><SideBadge side={test.side} /></td>
                          <td rowSpan={span} className={mono}>
                            {test.direction ?? "—"}
                            {dirLabel && <span className="ml-1 text-[10px] text-muted-foreground">{dirLabel}</span>}
                          </td>
                          <td rowSpan={span} className={`${mono} font-semibold ${mosTone(test.mos, Boolean(s?.LQIsBad))}`}>{fmtNum(test.mos, 2)}</td>
                          <td rowSpan={span} className={`${cell} whitespace-nowrap`}>{test.status ?? "—"}</td>
                          <td rowSpan={span} className={`${cell} whitespace-nowrap`}>{s?.QualityCategory ?? "—"}</td>
                          <td rowSpan={span} className={mono}>{fmtCell(s?.IPAudioRTT)}</td>
                          <td rowSpan={span} className={mono}>{s ? fmtPercent(s.MissedVoiceDecimal) : "—"}</td>
                          <td rowSpan={span} className={mono}>{s ? fmtPercent(s.FrontClippingDecimal) : "—"}</td>
                          <td rowSpan={span} className={mono}>{fmtCell(s?.DelaySpread)}</td>
                        </>}
                        {codec ? <>
                          <td className={`${mono} ${isMosDir ? "font-bold text-foreground" : "text-muted-foreground"}`}>
                            {[codec.CodecDirection, codec.CodecName].filter(Boolean).join(" ") || "—"}
                          </td>
                          <td className={mono}>{fmtNum(codec.CodecRate, 2)}</td>
                          <td className={mono}>{codec.Duration != null ? (Number(codec.Duration) / 1000).toFixed(2) : "—"}</td>
                          <td className={mono}>{fmtPercent(codec.CodecRatePerTestRatio)}</td>
                        </> : <>
                          <td className={`${mono} text-muted-foreground`} title="FactSpeech (χωρίς FactSpeechCodecs)">{s?.CodecName ?? "—"}</td>
                          <td className={mono}>{fmtNum(s?.CodecRate, 2)}</td>
                          <td className={mono}>—</td>
                          <td className={mono}>—</td>
                        </>}
                        {ci === 0 && <>
                          <td rowSpan={span} className={mono}>{test.lte?.EARFCN ?? "—"}</td>
                          <td rowSpan={span} className={mono}>{test.lte?.PCI ?? "—"}</td>
                          <td rowSpan={span} className={`${mono} font-semibold ${absTone(test.lte?.RSRP ?? null, 120, 115)}`}>{fmtNum(test.lte?.RSRP, 1)}</td>
                          <td rowSpan={span} className={`${mono} font-semibold ${absTone(test.lte?.RSRQ ?? null, 18, 16)}`}>{fmtNum(test.lte?.RSRQ, 1)}</td>
                          <td rowSpan={span} className={mono}>{fmtNum(test.lte?.SINR, 1)}</td>
                          <td rowSpan={span} className={`${mono} text-muted-foreground`}>
                            {s ? [s.LQColoration, s.LQDiscontinuity, s.LQNoisiness, s.LQLoudness].map((v) => fmtCell(v)).join(" / ") : "—"}
                          </td>
                        </>}
                      </TimedRow>
                    );
                  });
                })}
              </tbody>
            </table>
          </div>
          {selectedTest && <SpeechTimeDomainChart database={database} sessionId={sessionId} test={selectedTest} />}
        </>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// UE capability
// ---------------------------------------------------------------------------

function CapabilityItem({ item, callSessionId }: { item: UeCapabilityItem; callSessionId: number | null }) {
  const fromOtherSession = callSessionId != null && item.sessionId !== callSessionId;
  return (
    <details className="rounded border border-border/50 bg-card">
      <summary className="cursor-pointer px-2 py-1 text-xs flex flex-wrap items-center gap-x-2">
        <b className="font-mono">{item.ratType}</b>
        <span className="text-muted-foreground font-mono">{isoClock(item.fullDate)}</span>
        <span className="text-muted-foreground">({item.fields.length} πεδία)</span>
        {fromOtherSession && (
          <span className="text-[10px] text-amber-400" title="Το capability στέλνεται συχνά σε IDLE session πριν την κλήση· βρέθηκε στο ίδιο αρχείο (FileId).">
            από session {item.sessionId}
          </span>
        )}
      </summary>
      <div className="px-2 pb-2 space-y-1 max-h-[320px] overflow-y-auto">
        {item.fields.map((f, i) => (
          <div key={`${f.key}-${i}`} className="flex items-start gap-2 text-xs">
            <span className="text-muted-foreground w-40 shrink-0 break-words">{f.key || "—"}</span>
            <div className="min-w-0 space-y-0.5">
              {f.values.length === 0 && <span className="text-muted-foreground">—</span>}
              {f.values.map((v, j) => Array.isArray(v) ? (
                <div key={j} className="flex flex-wrap gap-1">
                  {v.map((x) => <span key={x} className="px-1 rounded bg-muted/50 font-mono text-[10px]">{x}</span>)}
                </div>
              ) : (
                <div key={j} className="font-mono break-all">{v || "—"}</div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </details>
  );
}

function CapabilitySide({ side, data }: { side: CallSide; data: UeCapabilitySide | null | undefined }) {
  return (
    <div className="rounded border border-border/60 bg-muted/20 p-2 space-y-1.5">
      <p className={`text-[10px] font-semibold uppercase tracking-wider ${side === "A" ? "text-sky-400" : "text-violet-400"}`}>
        {side}-Side {data && <span className="font-normal normal-case text-muted-foreground">(FileId {data.fileId})</span>}
      </p>
      {!data || data.items.length === 0
        ? <p className="text-xs text-muted-foreground">Δεν βρέθηκε UE capability στο αρχείο της πλευράς.</p>
        : data.items.map((item) => <CapabilityItem key={item.ratType} item={item} callSessionId={data.sessionId} />)}
    </div>
  );
}

function UeCapabilitySection({ database, sessionId }: { database: string; sessionId: string }) {
  const [open, setOpen] = useLocalStorage<boolean>("call-detail-native-uecap-open", false);
  const state = useFetch(() => fetchUeCapability(database, sessionId), [database, sessionId]);
  const rats = (s: UeCapabilitySide | null | undefined) => s?.items.map((i) => i.ratType).join(", ") || "—";

  return (
    <Section
      title="UE Capability"
      subtitle={state.data ? `(A: ${rats(state.data.a)} · B: ${rats(state.data.b)})` : "(UECapabilityInformation)"}
      open={open}
      onToggle={() => setOpen(!open)}
    >
      <StatusLine state={state} empty="" isEmpty={false} />
      {state.data && (
        <>
          <p className="text-[10px] text-muted-foreground">
            Ανά RatType η τελευταία αναφορά μέχρι το τέλος της κλήσης στο ίδιο αρχείο (συναγόμενος κανόνας από το native UeCapabilityService).
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <CapabilitySide side="A" data={state.data.a} />
            <CapabilitySide side="B" data={state.data.b} />
          </div>
        </>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Sync: συσκευές την ίδια στιγμή
// ---------------------------------------------------------------------------

function SyncSection({ database, sessionId, callStart, callEnd, onNavigateToCall }: {
  database: string;
  sessionId: string;
  callStart: string;
  callEnd: string;
  onNavigateToCall?: (sessionId: string) => void;
}) {
  const [open, setOpen] = useLocalStorage<boolean>("call-detail-native-sync-open", false);
  const [at, setAt] = useState<string>(() => callMidpoint(callStart, callEnd) ?? "");
  const state = useFetch(open && at ? () => fetchSyncDevices(database, at) : null, [database, open, at]);
  const devices = state.data?.devices ?? [];

  return (
    <Section
      title="Συσκευές την ίδια στιγμή"
      subtitle={state.data ? `(${devices.length} sessions)` : "(Sync)"}
      open={open}
      onToggle={() => setOpen(!open)}
      actions={
        <label className="flex items-center gap-1 text-[10px] text-muted-foreground">
          Στιγμή
          <input
            type="datetime-local"
            step={1}
            value={at}
            onChange={(e) => setAt(e.target.value.length === 16 ? `${e.target.value}:00` : e.target.value)}
            className="h-6 px-1 rounded border border-border bg-muted/30 text-foreground font-mono text-[10px]"
          />
        </label>
      }
    >
      <p className="text-[10px] text-muted-foreground">
        Ανά συσκευή το session που καλύπτει τη στιγμή (StartTime ≤ t &lt; EndTime) — συναγόμενο από το native SyncService. Κλικ σε κλήση για άνοιγμα.
      </p>
      <StatusLine state={state} empty="Καμία συσκευή δεν έχει session σε αυτή τη στιγμή." isEmpty={devices.length === 0} />
      {devices.length > 0 && (
        <div className={TABLE_WRAP}>
          <table className="w-full text-xs text-left">
            <thead className={THEAD}>
              <tr>
                <th className={TH}>Συσκευή</th>
                <th className={TH}>Τύπος</th>
                <th className={TH}>Πλευρά</th>
                <th className={TH}>IMEI</th>
                <th className={TH}>Operator</th>
                <th className={TH}>Session</th>
                <th className={TH}>Είδος</th>
                <th className={TH}>Έναρξη</th>
                <th className={TH}>Λήξη</th>
                <th className={TH} title="DwSession.RelatedSessionId">Related</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {devices.map((d) => {
                const target = syncNavigateTarget(d);
                const isCurrent = String(d.SessionId) === String(sessionId) || String(d.RelatedSessionId) === String(sessionId);
                const clickable = !!target && !isCurrent && !!onNavigateToCall;
                return (
                  <tr
                    key={d.SessionId}
                    onClick={clickable ? () => onNavigateToCall?.(target as string) : undefined}
                    className={`${isCurrent ? "bg-primary/10" : ""} ${clickable ? "cursor-pointer hover:bg-muted/40" : ""}`}
                    title={isCurrent ? "Η κλήση που βλέπεις" : clickable ? `Άνοιγμα κλήσης ${target}` : undefined}
                  >
                    <td className="px-2 py-0.5 font-mono whitespace-nowrap">{d.DeviceName ?? "—"}</td>
                    <td className="px-2 py-0.5">{d.DeviceType ?? "—"}</td>
                    <td className="px-2 py-0.5"><SideBadge side={d.SessionSide ?? d.Side} /></td>
                    <td className="px-2 py-0.5 font-mono">{d.IMEI ?? "—"}</td>
                    <td className="px-2 py-0.5">{d.Operator ?? "—"}</td>
                    <td className="px-2 py-0.5 font-mono">{d.SessionId}</td>
                    <td className="px-2 py-0.5">{d.SessionType ?? "—"}</td>
                    <td className="px-2 py-0.5 font-mono whitespace-nowrap">{isoClock(d.StartTime)}</td>
                    <td className="px-2 py-0.5 font-mono whitespace-nowrap">{isoClock(d.EndTime)}</td>
                    <td className="px-2 py-0.5 font-mono">{d.RelatedSessionId ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------

export interface NativeCallPanelsProps {
  database: string;
  sessionId: string;
  /** ISO της κλήσης (CallRecord.startTime / endTime) — για τη default στιγμή του sync. */
  callStart: string;
  callEnd: string;
  hoveredTime: number | null;
  onHoverTime: (t: number | null) => void;
  onNavigateToCall?: (sessionId: string) => void;
  /** /api/call_device_info — μπαίνει στον ίδιο πίνακα με το CDR («Scanner & Κινητό»). */
  deviceInfo: CallDeviceInfo | null;
  /** Το CallAnalysis A+B μόλις φορτώσει — για το disconnect του classifier στο signal chart. */
  onCallAnalysis?: (data: CallAnalysisResponse | null) => void;
}

/** Τα panels κάτω από το L3 Signaling, κλειστά by default, με αυτή τη σειρά:
 *  Call Analysis → Markers → MOS ανά test & Speech samples → RTP / VoLTE → UE Capability →
 *  Συσκευές την ίδια στιγμή → Scanner & Κινητό (μόνιμα ανοιχτό).
 *  Το Event timeline είναι ξεχωριστό (CallEventsPanel, πάνω από το L3). */
export function NativeCallPanels({
  database, sessionId, callStart, callEnd, hoveredTime, onHoverTime, onNavigateToCall, deviceInfo, onCallAnalysis,
}: NativeCallPanelsProps) {
  const timed = { database, sessionId, hoveredTime, onHoverTime };
  return (
    <>
      <CallAnalysisSection database={database} sessionId={sessionId} onData={onCallAnalysis} />
      <MarkersSection {...timed} />
      <MosSpeechSection {...timed} />
      <RtpSection {...timed} />
      <UeCapabilitySection database={database} sessionId={sessionId} />
      <SyncSection database={database} sessionId={sessionId} callStart={callStart} callEnd={callEnd} onNavigateToCall={onNavigateToCall} />
      <DeviceCdrSection database={database} sessionId={sessionId} deviceInfo={deviceInfo} />
    </>
  );
}
