/**
 * Pure helpers για τα panels των native πηγών (NativeCallPanels) — χωρίς React, ώστε να
 * ελέγχονται μόνα τους.
 */
import type { CallDeviceInfo, CallEventRow, CallSide, CallTraceLogRow, MosTestRow, SpeechSampleRow, SyncDeviceRow } from "@/lib/api";

/** Όλα τα keys πλευράς του CDR (backend CDR_SIDE_COLUMNS) — ελέγχεται στα tests ότι το
 *  buildDeviceCdrGroups τα δείχνει όλα, από μία φορά. */
export const CDR_SIDE_KEYS = [
  "Operator", "Client", "System", "SessionId", "FileId", "FileName", "RouteName", "Category", "Mobility",
  "Latitude", "Longitude", "Direction", "SpeedKmph",
  "Imsi", "Imei", "Number", "Firmware", "Model",
  "CallTechnology", "SessionStartTechnology",
  "StartMcc", "StartMnc", "StartTacLac", "StartCellId", "StartCarrier", "StartScPciBsic", "StartRsrpRscpRxLev", "StartRsrqEcNo", "StartSinr",
  "StartCarrierNr", "StartPciNr", "SsbIndex", "StartRsrpNr", "StartRsrqNr", "StartSinrNr",
  "CallMode", "InternalStatus",
  "CsfbStatus", "CsfbStartTs", "CsfbDuration", "CsfbTechnology", "CsfbMcc", "CsfbMnc", "CsfbLac", "CsfbCellId", "CsfbCarrier", "CsfbScBsic", "CsfbRscpRxLev", "CsfbEcNo",
] as const;

type SideValues = Record<string, unknown>;
export interface DeviceCdrRow { label: string; a: unknown; b: unknown }
export interface DeviceCdrGroup { title: string; rows: DeviceCdrRow[] }

/** Η πρώτη τιμή που δεν είναι null/κενή. */
const firstValue = (...values: unknown[]): unknown => values.find((v) => v != null && v !== "") ?? null;

/**
 * Ενιαίος πίνακας «Scanner & Κινητό»: device info (DmnDevice / FileList) + CDR (FactCDRVoice),
 * κάθε πληροφορία ΜΙΑ φορά. Όπου υπάρχουν και στις δύο πηγές (Device/Model, IMEI, IMSI,
 * Number, Firmware, File) μένει μία γραμμή: πρώτα DmnDevice, μετά FileList, μετά CDR —
 * η ίδια σειρά προτίμησης που είχε το panel και πριν. Γραμμές χωρίς τιμή και στις δύο
 * πλευρές, και ομάδες χωρίς γραμμές, κρύβονται.
 */
export function buildDeviceCdrGroups(info: CallDeviceInfo | null, cdrA: SideValues | null, cdrB: SideValues | null): DeviceCdrGroup[] {
  const f = info?.fileInfo ?? null;
  const da = info?.aSideDevice ?? null;
  const db = info?.bSideDevice ?? null;
  const a = cdrA ?? {};
  const b = cdrB ?? {};
  const cdr = (keys: string[]): DeviceCdrRow[] => keys.map((k) => ({ label: k, a: a[k] ?? null, b: b[k] ?? null }));

  const groups: DeviceCdrGroup[] = [
    {
      title: "Συσκευή",
      rows: [
        { label: "Device", a: firstValue(da?.Model, f?.ASideDevice, a.Model), b: firstValue(db?.Model, f?.BSideDevice, b.Model) },
        { label: "IMEI", a: firstValue(da?.IMEI, f?.IMEI, a.Imei), b: firstValue(db?.IMEI, b.Imei) },
        { label: "IMSI", a: firstValue(da?.IMSI, f?.IMSI, a.Imsi), b: firstValue(db?.IMSI, b.Imsi) },
        { label: "Number", a: firstValue(da?.Number, f?.ASideNumber, a.Number), b: firstValue(db?.Number, f?.BSideNumber, b.Number) },
        { label: "OS", a: da?.OS ?? null, b: db?.OS ?? null },
        { label: "Firmware", a: firstValue(da?.Firmware, f?.FirmwareV, a.Firmware), b: firstValue(db?.Firmware, b.Firmware) },
        { label: "BaseBand", a: da?.BaseBand ?? null, b: db?.BaseBand ?? null },
        { label: "DeviceType", a: da?.DeviceType ?? null, b: db?.DeviceType ?? null },
        { label: "RF Manufacturer", a: da?.RFManufacturer ?? null, b: db?.RFManufacturer ?? null },
        { label: "RF Model", a: da?.RFModel ?? null, b: db?.RFModel ?? null },
        { label: "Serial", a: da?.SerialNumber ?? null, b: db?.SerialNumber ?? null },
        // Πεδία του FileList χωρίς B εκδοχή — όπως και πριν, μόνο στην A.
        { label: "SW Version", a: f?.SWVersion ?? null, b: null },
        { label: "MF Version", a: f?.MFVersion ?? null, b: null },
        { label: "Product Ver.", a: f?.ProductVersion ?? null, b: null },
      ],
    },
    {
      title: "Αρχείο & διαδρομή",
      rows: [
        { label: "File", a: firstValue(f?.ASideFileName, a.FileName), b: firstValue(f?.BSideFileName, b.FileName) },
        { label: "Location", a: f?.ASideLocation ?? null, b: f?.BSideLocation ?? null },
        ...cdr(["FileId", "RouteName", "Category", "Mobility", "Client", "System"]),
      ],
    },
    { title: "Δίκτυο & κλήση", rows: cdr(["Operator", "SessionId", "CallMode", "CallTechnology", "SessionStartTechnology", "InternalStatus"]) },
    { title: "Θέση έναρξης", rows: cdr(["Latitude", "Longitude", "Direction", "SpeedKmph"]) },
    { title: "Start cell LTE / legacy", rows: cdr(["StartMcc", "StartMnc", "StartTacLac", "StartCellId", "StartCarrier", "StartScPciBsic", "StartRsrpRscpRxLev", "StartRsrqEcNo", "StartSinr"]) },
    { title: "Start cell NR", rows: cdr(["StartCarrierNr", "StartPciNr", "SsbIndex", "StartRsrpNr", "StartRsrqNr", "StartSinrNr"]) },
    { title: "CSFB", rows: cdr(["CsfbStatus", "CsfbStartTs", "CsfbDuration", "CsfbTechnology", "CsfbMcc", "CsfbMnc", "CsfbLac", "CsfbCellId", "CsfbCarrier", "CsfbScBsic", "CsfbRscpRxLev", "CsfbEcNo"]) },
  ];

  const hasValue = (v: unknown) => v != null && v !== "";
  return groups
    .map((g) => ({ ...g, rows: g.rows.filter((r) => hasValue(r.a) || hasValue(r.b)) }))
    .filter((g) => g.rows.length > 0);
}

const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T(\d{2}:\d{2}:\d{2})(\.\d{1,3})?/;

/** Naive ISO της βάσης -> "HH:MM:SS.mmm" (κόψιμο string, χωρίς μετατροπή ζώνης). */
export function isoClock(iso: string | null | undefined): string {
  if (!iso) return "—";
  const match = ISO_DATETIME.exec(iso);
  if (!match) return iso;
  return `${match[1]}${match[2] ? match[2].padEnd(4, "0") : ".000"}`;
}

/** Τιμή κελιού: null -> "—", ISO datetime -> ώρα, float -> έως 3 δεκαδικά. */
export function fmtCell(value: unknown): string {
  if (value == null || value === "") return "—";
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)));
  if (typeof value === "string" && ISO_DATETIME.test(value)) return isoClock(value);
  return String(value);
}

/** Όνομα event χωρίς το "<TopGroup> - <Group> - " πρόθεμα του EventFullName. */
export function eventName(row: Pick<CallEventRow, "EventFullName" | "EventShortName" | "EventTopGroup" | "EventGroup">): string {
  if (row.EventShortName) return row.EventShortName;
  const full = row.EventFullName ?? "";
  const prefix = [row.EventTopGroup, row.EventGroup].filter(Boolean).join(" - ");
  if (prefix && full.startsWith(`${prefix} - `)) return full.slice(prefix.length + 3);
  return full || "—";
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Date -> "YYYY-MM-DDTHH:MM:SS" σε τοπική ώρα — η naive μορφή που περιμένει το backend
 *  (οι naive ώρες της βάσης διαβάζονται στο frontend ως τοπικές). */
export function toLocalNaiveIso(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** Μέση της κλήσης ως naive ISO — default στιγμή για το sync. */
export function callMidpoint(startIso: string, endIso: string): string | null {
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  if (!Number.isFinite(start)) return null;
  const at = Number.isFinite(end) && end > start ? start + (end - start) / 2 : start;
  return toLocalNaiveIso(new Date(at));
}

/** Το SessionId που ανοίγει την κλήση στη λίστα (κρατά μόνο A-side): σε CALL B session
 *  είναι το RelatedSessionId. null = δεν είναι κλήση. */
export function syncNavigateTarget(row: Pick<SyncDeviceRow, "SessionType" | "SessionSide" | "SessionId" | "RelatedSessionId">): string | null {
  if (row.SessionType !== "CALL") return null;
  if (row.SessionSide === "B") return row.RelatedSessionId != null ? String(row.RelatedSessionId) : null;
  return String(row.SessionId);
}

/** Είναι το iso μέσα στο ±tolerance του κοινού cursor; */
export function isNearTime(iso: string | null | undefined, hoveredTime: number | null, toleranceMs = 1500): boolean {
  if (hoveredTime == null || !iso) return false;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) && Math.abs(t - hoveredTime) <= toleranceMs;
}

/** Κείμενο Info μιας γραμμής TraceLog· οι γραμμές IP trace (fallback για πλευρά χωρίς
 *  TraceLog) γίνονται "Protocol · Direction · Source → Destination · Message". */
export function traceLogInfo(r: Pick<CallTraceLogRow, "TraceSource" | "Info" | "Source" | "Destination" | "Direction" | "Protocol" | "Message">): string | null {
  if (r.TraceSource !== "IP") return r.Info;
  const route = r.Source || r.Destination ? `${r.Source ?? "?"} → ${r.Destination ?? "?"}` : "";
  return [r.Protocol, r.Direction, route, r.Message].filter(Boolean).join(" · ") || null;
}

export interface CallAnalysisRow { key: string; a: unknown; b: unknown }
export interface CallAnalysisRowGroup { title: string; rows: CallAnalysisRow[] }

/**
 * Πίνακας A/B του CallAnalysis με τις ομάδες του backend (CA_GROUPS). Κρύβονται γραμμές χωρίς
 * τιμή και στις δύο πλευρές· στις ομάδες μετρητών (hideZero) και όσες έχουν 0 και στις δύο.
 * Ομάδες χωρίς γραμμές κρύβονται.
 */
export function buildCallAnalysisGroups(
  groups: ReadonlyArray<{ title: string; keys: string[]; hideZero: boolean }>,
  a: Record<string, unknown> | null,
  b: Record<string, unknown> | null,
): CallAnalysisRowGroup[] {
  const empty = (v: unknown, hideZero: boolean) => v == null || v === "" || (hideZero && v === 0);
  return groups
    .map((g) => ({
      title: g.title,
      rows: g.keys
        .map((key) => ({ key, a: a?.[key] ?? null, b: b?.[key] ?? null }))
        .filter((r) => !(empty(r.a, g.hideZero) && empty(r.b, g.hideZero))),
    }))
    .filter((g) => g.rows.length > 0);
}

/** Κείμενο αιτίας για το UI: το DescriptionA/B του Scene χωρίς το τελικό '/' ή ';'. */
export function cleanDescription(text: string | null | undefined): string | null {
  const cleaned = (text ?? "").replace(/[/;\s]+$/, "").trim();
  return cleaned || null;
}

/** Δεκαδικό κλάσμα (π.χ. FactSpeech.MissedVoiceDecimal) -> "x.x %". */
export function fmtPercent(fraction: number | null | undefined, digits = 1): string {
  return fraction == null ? "—" : `${(fraction * 100).toFixed(digits)} %`;
}

/** Ένα test του πίνακα «MOS ανά test & Speech samples»: τα στοιχεία του POLQA test
 *  (mos_test_detail), το FactSpeech δείγμα του ίδιου TestId και οι codecs του. */
export interface MosSpeechTest {
  testId: number;
  fullDate: string | null;
  side: CallSide | null;
  direction: string | null;
  mos: number | null;
  status: string | null;
  sample: SpeechSampleRow | null;
  /** Codec rows (FactSpeechCodecs) του test — κενό όταν το test υπάρχει μόνο στο FactSpeech. */
  codecs: MosTestRow[];
  lte: Pick<MosTestRow, "EARFCN" | "PCI" | "RSRP" | "RSRQ" | "SINR"> | null;
}

/**
 * Join MOS ανά test x FactSpeech με το TestId (στη DOD_26H2 1:1, ίδιο MOS και FullDate).
 * Full outer: tests μόνο στη μία πηγή μένουν. MOS = το POLQA του test, αλλιώς το LQ του
 * δείγματος. Σειρά: χρόνος, μετά TestId.
 */
export function buildMosSpeechTests(mosRows: readonly MosTestRow[], samples: readonly SpeechSampleRow[]): MosSpeechTest[] {
  const byTest = new Map<number, MosSpeechTest>();
  const entry = (testId: number) => {
    let t = byTest.get(testId);
    if (!t) {
      t = { testId, fullDate: null, side: null, direction: null, mos: null, status: null, sample: null, codecs: [], lte: null };
      byTest.set(testId, t);
    }
    return t;
  };
  for (const r of mosRows) {
    const t = entry(r.TestId);
    t.codecs.push(r);
    t.fullDate ??= r.FullDate;
    t.direction ??= r.Direction;
    t.mos ??= r.MOS;
    t.status ??= r.Status;
    t.lte ??= { EARFCN: r.EARFCN, PCI: r.PCI, RSRP: r.RSRP, RSRQ: r.RSRQ, SINR: r.SINR };
  }
  for (const s of samples) {
    const t = entry(s.TestId);
    if (t.sample) continue;
    t.sample = s;
    t.side = s.Side;
    t.fullDate = s.FullDate ?? t.fullDate;
    t.direction ??= s.Direction;
    t.mos ??= s.LQ;
  }
  const time = (iso: string | null) => (iso ? new Date(iso).getTime() : Number.POSITIVE_INFINITY);
  return [...byTest.values()].sort((x, y) => time(x.fullDate) - time(y.fullDate) || x.testId - y.testId);
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
