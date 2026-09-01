/* =============================================================================
 * QueryBuilder — visual SQL builder για το SwissQual / SmartAnalytics warehouse
 * -----------------------------------------------------------------------------
 * Τι άλλαξε σε σχέση με την προηγούμενη έκδοση
 *
 *  1. SCHEMA. Το star schema μοντελοποιείται όπως είναι πραγματικά στη βάση:
 *     Fact* -> DmnId<Role> -> Dmn<Dimension>.DmnId, με Bridge* πίνακες για τις
 *     many-to-many σχέσεις (cell information). Κάθε πίνακας/στήλη/σχέση φέρει
 *     σημαία `ok`: true = επαληθευμένο από query που τρέχει στη MTWS_26H2,
 *     false = draft (μεταφέρθηκε από την παλιά έκδοση, θέλει επαλήθευση).
 *
 *  2. JOIN GRAPH. Δεν υπάρχει πια χειροκίνητη λίστα ενός επιπέδου. Ένας BFS
 *     walker πάνω στις σχέσεις βρίσκει μονοπάτια έως 3 hops, άρα δουλεύουν
 *     αλυσίδες όπως FactLTEScanner -> DmnSession -> Sessions -> FileList και
 *     FactDataTest -> Bridge -> DmnCellInformation. Τα aliases παράγονται
 *     ντετερμινιστικά και δεν συγκρούονται ποτέ.
 *
 *  3. AGGREGATES. Ανά στήλη COUNT / COUNT DISTINCT / SUM / AVG / MIN / MAX με
 *     αυτόματο GROUP BY και ξεχωριστό HAVING — έτσι γράφονται τα per-cell /
 *     per-collection στατιστικά χωρίς να βγεις από τον builder.
 *
 *  4. ΣΩΣΤΟ SQL. Bracket-safe identifiers, escaping του ' σε '', type-aware
 *     quoting, escaping του _ σε [_] στα LIKE (τα collection names είναι γεμάτα
 *     underscores — χωρίς αυτό το φίλτρο επιστρέφει σκουπίδια), BETWEEN,
 *     NOT LIKE / NOT IN, πολλαπλό ORDER BY.
 *
 *  5. LIVE PREVIEW + WARNINGS. Βλέπεις το SQL όσο το χτίζεις, με προειδοποιήσεις
 *     για πολλαπλασιασμό γραμμών (1:N hops), DISTINCT/ORDER BY conflicts και
 *     χρήση μη επαληθευμένου schema.
 *
 *  6. SCHEMA CHECK. Το κουμπί «Έλεγχος schema» παράγει query πάνω στο
 *     INFORMATION_SCHEMA που επαληθεύει ΟΛΟΥΣ τους πίνακες/στήλες του builder
 *     απέναντι στη ζωντανή βάση και δείχνει τι λείπει.
 *
 * Drop-in: το component κρατάει το ίδιο interface — <QueryBuilder onApply={...}
 * initialSql={...} />. Όλα τα υπόλοιπα props είναι προαιρετικά.
 * ========================================================================== */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Wand2, Plus, Trash2, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Check,
  Hash, Type, Calendar, Key, ToggleLeft, Search, Copy, AlertTriangle, Info,
  Database, Sigma, X, Save, RotateCcw, ShieldCheck, HelpCircle, Link2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { AnimatePresence, motion } from "framer-motion";

/* ═══════════════════════════════════════════════════════════════════════════
 * 1. TYPES
 * ═══════════════════════════════════════════════════════════════════════════ */

export type ColType = "str" | "num" | "date" | "id" | "bool";
export type TableKind = "fact" | "dim" | "bridge" | "raw" | "view";
export type Cardinality = "N:1" | "1:N";
export type JoinType = "INNER" | "LEFT";
export type AggFn = "" | "COUNT" | "COUNT DISTINCT" | "SUM" | "AVG" | "MIN" | "MAX";
export type LikeMode = "contains" | "starts" | "ends" | "raw";

export interface ColDef {
  name: string;
  type: ColType;
  /** true = επαληθευμένο σε πραγματικό query, false = draft */
  ok: boolean;
  note?: string;
}

export interface TableDef {
  name: string;
  alias: string;
  category: string;
  kind: TableKind;
  ok: boolean;
  note?: string;
  columns: ColDef[];
}

export interface RelDef {
  from: string;
  fromCol: string;
  to: string;
  toCol: string;
  card: Cardinality;
  join: JoinType;
  ok: boolean;
  label?: string;
  /** custom ON για range / composite joins. Παίρνει τα aliases (from, to). */
  onSql?: (fromAlias: string, toAlias: string) => string;
}

export interface Cond {
  id: string;
  col: string;               // colKey => `${nodeKey}::${column}`
  op: string;
  value: string;
  value2: string;            // BETWEEN upper bound
  connector: "AND" | "OR";
  having: boolean;
  likeMode: LikeMode;
  escapeWild: boolean;
}

export interface OrderRow {
  id: string;
  col: string;               // colKey
  dir: "ASC" | "DESC";
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 2. SCHEMA — πίνακες
 *    V(...) = επαληθευμένο,  D(...) = draft / θέλει επαλήθευση
 * ═══════════════════════════════════════════════════════════════════════════ */

const V = (name: string, type: ColType, note?: string): ColDef => ({ name, type, ok: true, note });
const D = (name: string, type: ColType, note?: string): ColDef => ({ name, type, ok: false, note });

const t = (
  name: string, alias: string, category: string, kind: TableKind,
  ok: boolean, columns: ColDef[], note?: string,
): TableDef => ({ name, alias, category, kind, ok, columns, note });

export const CAT_DIM = "Dimensions (Dmn*)";
export const CAT_SCANNER = "Scanner facts";
export const CAT_TEST = "Test facts";
export const CAT_RADIO = "Radio facts";
export const CAT_BRIDGE = "Bridges";
export const CAT_RAW = "Raw SwissQual";
export const CAT_RESULTS = "Results";
export const CAT_LEGACY = "Legacy / draft";

export const TABLES: TableDef[] = [
  /* ── Dimensions ─────────────────────────────────────────────────────── */
  t("DmnFile", "DF", CAT_DIM, "dim", true, [
    V("DmnId", "id"), V("CollectionName", "str"), V("Location", "str"),
    D("FileId", "id"), D("FileName", "str"), D("CampaignName", "str"),
    D("TaskName", "str"), D("Zone", "str"), D("Side", "str"),
    D("Valid", "str"), D("InvalidReason", "str"),
  ], "Collection / Location — το βασικό φίλτρο σε κάθε fact query"),

  t("DmnSession", "DSN", CAT_DIM, "dim", true, [
    V("DmnId", "id"), V("SessionId", "id"),
  ], "Γέφυρα από τα facts προς τον raw πίνακα Sessions"),

  t("DmnTest", "DT", CAT_DIM, "dim", true, [
    V("DmnId", "id"), V("TestId", "id"), V("Direction", "str"),
    D("TestType", "str"), D("TestName", "str"),
  ], "Direction: κάθε κατεύθυνση είναι ξεχωριστό TestId στα HTTP transfers"),

  t("DmnOperator", "DOP", CAT_DIM, "dim", true, [
    V("DmnId", "id"), V("Provider", "str"), V("MCC", "num"), V("MNC", "num"),
  ], "MCC 202 = Ελλάδα (COSMOTE 1 / Vodafone 5 / NOVA 10)"),

  t("DmnTopN", "DTN", CAT_DIM, "dim", true, [
    V("DmnId", "id"), V("TopNID", "num"),
  ], "TopNID = 1 -> το ισχυρότερο cell/beam του κάθε operator στο sample"),

  t("DmnTopNServerStatus", "DTS", CAT_DIM, "dim", true, [
    V("DmnId", "id"), V("StatusId", "num"), D("StatusName", "str"),
  ], "1/2/3 = best server, 4 = TopN & interfering, 5 = other TopN, 99 = not set"),

  t("DmnCellInformation", "DCI", CAT_DIM, "dim", true, [
    V("DmnId", "id"), V("Technology", "str"), V("eNBId_SectorId", "str"),
    V("TAC", "num"), V("PCI_LTE", "num"), V("PCI_5GNR", "num"), V("AbsFreqSSB", "num"),
    D("CGI", "str"), D("EARFCN", "num"),
  ], "Προσπελάσιμο μόνο μέσω Bridge — πολλαπλασιάζει γραμμές"),

  t("DmnCellInformationNR5G", "DCN", CAT_DIM, "dim", true, [
    V("DmnId", "id"), V("PCI", "num"), V("AbsFreqSSB", "num"),
    D("NCI", "num"), D("BeamIndex", "num"),
  ]),

  t("DmnPosition", "DP", CAT_DIM, "dim", false, [
    D("DmnId", "id"), D("Latitude", "num"), D("Longitude", "num"),
    D("Speed", "num"), D("Altitude", "num"), D("Direction", "num"),
    D("NavigationMode", "str"),
  ]),

  /* ── Scanner facts ──────────────────────────────────────────────────── */
  t("FactLTEScanner", "FLS", CAT_SCANNER, "fact", true, [
    V("DmnIdSession", "id"), V("DmnIdFile", "id"), V("DmnIdOperator", "id"),
    V("DmnIdTopN_RSRP_Operator", "id"), V("DmnIdTopNServerStatus", "id"),
    V("RSRP", "num"), V("RSRQ", "num"), V("SINR", "num"),
    V("PCI", "num"), V("CId", "num"), V("RFBand", "num"),
    D("FactId", "id"), D("FullDate", "date"), D("EARFCN", "num"),
    D("RSSI", "num"), D("DmnIdPosition", "id"),
  ]),

  t("FactNR5GScannerBeam", "NRS", CAT_SCANNER, "fact", true, [
    V("DmnIdSession", "id"), V("DmnIdFile", "id"), V("DmnIdOperator", "id"),
    V("DmnIdTopN_SS_RSRP_Operator", "id"), V("DmnIdTopNServerStatus", "id"),
    V("SS_RSRP", "num"), V("SS_RSRQ", "num"), V("SS_SINR", "num"),
    V("PCI", "num"), V("NCI", "num"), V("BeamIndex", "num"), V("AbsFreqSSB", "num"),
    D("FactId", "id"), D("FullDate", "date"), D("RFBand", "num"), D("DmnIdPosition", "id"),
  ]),

  t("FactGSMScanner", "FGS", CAT_SCANNER, "fact", true, [
    V("DmnIdSession", "id"), V("DmnIdFile", "id"), V("DmnIdOperator", "id"),
    V("DmnIdTopN_RxLev_Operator", "id"),
    V("RxLev", "num"), V("BCCH", "num"),
    D("FactId", "id"), D("FullDate", "date"), D("BSIC", "num"),
    D("CId", "num"), D("LAC", "num"), D("RFBand", "num"), D("DmnIdPosition", "id"),
  ], "Στον GSM scanner δεν υπάρχει DmnTopNServerStatus — μόνο DmnTopN"),

  /* ── Test facts ─────────────────────────────────────────────────────── */
  t("FactDataTest", "FDT", CAT_TEST, "fact", true, [
    V("FactId", "id"), V("DmnIdTest", "id"), V("TestType", "str"),
    D("DmnIdFile", "id"), D("DmnIdSession", "id"), D("DmnIdPosition", "id"),
  ], "TestType = 'Capacity' κ.λπ. — τα throughput νούμερα είναι στα Results* raw"),

  t("FactHttpTransfer", "FHT", CAT_TEST, "fact", true, [
    V("FactId", "id"), V("TestId", "id"), V("DmnIdFile", "id"), V("DmnIdTest", "id"),
    V("ApplicationThroughput_kbps", "num"),
    D("DmnIdSession", "id"), D("DmnIdPosition", "id"),
  ], "Κρατάει TestId απευθείας και το throughput ήδη σε kbps"),

  /* ── Radio facts ────────────────────────────────────────────────────── */
  t("FactNR5GRadio", "NR", CAT_RADIO, "fact", true, [
    V("FactId", "id"), V("DmnIdCellInformationNR5G", "id"), V("DmnIdCellInformation", "id"),
    D("DmnIdFile", "id"), D("DmnIdSession", "id"), D("DmnIdPosition", "id"),
    D("SS_RSRP", "num"), D("SS_RSRQ", "num"), D("SS_SINR", "num"),
    D("FullDate", "date"),
  ]),

  t("FactLTERadio", "FLR", CAT_RADIO, "fact", false, [
    D("FactId", "id"), D("DmnIdFile", "id"), D("DmnIdSession", "id"),
    D("DmnIdPosition", "id"), D("DmnIdCellInformation", "id"),
    D("FullDate", "date"), D("EARFCN", "num"), D("PhyCellId", "num"),
    D("RSRP", "num"), D("RSRQ", "num"), D("RSSI", "num"), D("SINR", "num"),
    D("DistanceToBTS", "num"), D("CGI", "str"),
  ]),

  t("FactGSMRadio", "FGR", CAT_RADIO, "fact", false, [
    D("FactId", "id"), D("DmnIdFile", "id"), D("DmnIdSession", "id"),
    D("DmnIdPosition", "id"), D("FullDate", "date"),
    D("RxLev", "num"), D("RxQual", "num"), D("RxLevSub", "num"), D("RxQualSub", "num"),
    D("BCCH", "num"), D("BSIC", "num"), D("CGI", "str"), D("DistanceToBTS", "num"),
  ]),

  /* ── Bridges ────────────────────────────────────────────────────────── */
  t("BridgeFactDataTestDmnCellInformation", "BDC", CAT_BRIDGE, "bridge", true, [
    V("FactId", "id"), V("DmnId", "id"),
  ]),
  t("BridgeFactHttpTransferDmnCellInformation", "BHC", CAT_BRIDGE, "bridge", true, [
    V("FactId", "id"), V("DmnId", "id"),
  ]),
  t("BridgeFactNR5GRadioDmnTest", "BNT", CAT_BRIDGE, "bridge", true, [
    V("FactId", "id"), V("DmnIdTest", "id"),
  ]),

  /* ── Raw SwissQual ──────────────────────────────────────────────────── */
  t("Sessions", "S", CAT_RAW, "raw", true, [
    V("SessionId", "id"), V("FileId", "id"), V("sessionType", "str"),
    V("startTime", "date"), V("duration", "num"), V("valid", "bool"),
    V("SpeedAvg", "num"), V("StartNetworkId", "id"), V("NetworkId", "id"),
    D("SpeedCategory", "num"), D("InvalidReason", "str"),
  ], "sessionType 'CALL' / 'IDLE' — ο scanner κόβεται σε IDLE των 30 s"),

  t("FileList", "FL", CAT_RAW, "raw", true, [
    V("FileId", "id"), V("CollectionName", "str"),
    V("ASideLocation", "str"), V("ASideFileName", "str"),
    D("BSideLocation", "str"), D("ASideDevice", "str"), D("BSideDevice", "str"),
    D("ASideNumber", "str"), D("BSideNumber", "str"), D("BSideFileName", "str"),
    D("IMEI", "str"), D("IMSI", "str"), D("FirmwareV", "str"),
    D("MFVersion", "str"), D("SWVersion", "str"),
  ], "ASideLocation = το unit (π.χ. 'Cosmote Data' ή το serial του scanner)"),

  t("TestInfo", "TI", CAT_RAW, "raw", true, [
    V("TestId", "id"), V("SessionId", "id"), V("startTime", "date"),
    V("duration", "num"), V("Valid", "bool"), V("direction", "str"),
    V("NetworkId", "id"), V("StartNetworkId", "id"),
    D("InvalidReason", "str"), D("ErrorCode", "num"),
    D("TestName", "str"), D("TestType", "str"), D("FileId", "id"),
  ], "Προσοχή: ti.Valid = 1 κόβει tests που ΜΕΤΡΑΕΙ το export"),

  t("NetworkInfo", "NI", CAT_RAW, "raw", true, [
    V("NetworkId", "id"), V("FileId", "id"), V("MsgTime", "date"),
    V("technology", "str"), V("Operator", "str"), V("CGI", "str"),
    V("CID", "num"), V("LAC", "num"), V("MCC", "num"), V("MNC", "num"),
    V("RAC", "num"), V("BCCH", "num"), V("SC1", "num"), V("RFBand", "num"),
    V("Duration", "num"), V("Status", "num"), V("DCNetworkId", "id"),
    D("CGI2", "str"), D("CGI3", "str"),
  ], "CGI κενό -> ανασύνθεση ως CID-LAC-MNC-MCC. eNB-Id = CID/256, Sector = CID%256"),

  t("Technology", "T", CAT_RAW, "raw", true, [
    V("TestId", "id"), V("NetworkId", "id"), V("StartNetworkId", "id"),
    D("SessionId", "id"), D("FileId", "id"), D("MsgTime", "date"),
    D("PrevTechnology", "str"), D("CurrTechnology", "str"), D("Duration", "num"),
    D("Band", "str"), D("LTEDLCarriers", "num"), D("LTEULCarriers", "num"),
    D("NR5GDLCarriers", "num"), D("NR5GULCarriers", "num"),
  ]),

  t("NetworkIdRelation", "NIR", CAT_RAW, "raw", true, [
    V("TestId", "id"), V("NetworkId", "id"),
  ]),

  t("DCNetworkInfo", "DC", CAT_RAW, "raw", true, [
    V("DCNetworkId", "id"), V("FileId", "id"), V("PCI", "num"),
  ], "Το NR PCI του dual-connectivity leg"),

  /* ── Results ────────────────────────────────────────────────────────── */
  t("ResultsCapacityTest", "RCT", CAT_RESULTS, "raw", true, [
    V("TestId", "id"), V("ErrorCode", "num"), V("LastBlock", "bool"),
    V("ThroughputGet", "num"), V("ThroughputPut", "num"),
  ], "kbps = ThroughputGet * 0.008 · φίλτρο LastBlock = 1"),

  t("ResultsCapacityTestParameters", "RCP", CAT_RESULTS, "raw", true, [
    V("TestId", "id"), V("Direction", "str"),
  ], "Direction LIKE '%get%' = Downlink, '%put%' = Uplink"),

  t("ResultsLQ08Avg", "LQ", CAT_RESULTS, "raw", false, [
    D("MsgId", "id"), D("SessionId", "id"), D("TestID", "id"),
    D("LQWB", "num"), D("LQNB", "num"), D("OptionalWB", "num"), D("OptionalNB", "num"),
    D("QualityCode", "str"), D("MissedVoice", "num"), D("RcvDelay", "num"),
  ]),

  /* ── Legacy / draft (από την παλιά έκδοση — μη επαληθευμένα) ─────────── */
  t("FactCDRVoice", "FCV", CAT_LEGACY, "fact", false, [
    D("SessionIdA", "id"), D("SessionIdB", "id"), D("FileIdA", "id"), D("FileIdB", "id"),
    D("CallSessionStartTS", "date"), D("CallSessionEndTs", "date"),
    D("CallStatus", "str"), D("CallType", "str"), D("CallDirection", "str"),
    D("CallModeA", "str"), D("CallTechnologyA", "str"), D("SessionStartTechnologyA", "str"),
    D("CallSetupTime_s", "num"), D("CallDuration_s", "num"),
    D("AvgSQ", "num"), D("MinSQ", "num"), D("LatitudeA", "num"), D("LongitudeA", "num"),
    D("Valid", "str"), D("InvalidReason", "str"), D("DmnIdFile", "id"),
  ]),

  t("FactCDRCombined", "FCC", CAT_LEGACY, "fact", false, [
    D("SessionId", "id"), D("TestId", "id"), D("FileId", "id"),
    D("Test Start TS", "date"), D("Test Name", "str"), D("Technology", "str"),
    D("Start Technology", "str"), D("Transfer Status", "str"), D("Scoring Status", "str"),
    D("TestDirection", "str"), D("Host", "str"),
    D("Transfer Throughput (kbps)", "num"),
    D("Capacity_Sustainable Throughput (kbps)", "num"),
    D("Ping_RTT Avg (ms)", "num"), D("YouTube_Avg. Video MOS", "num"),
    D("LAT", "num"), D("LON", "num"), D("valid", "bool"),
    D("InvalidReason", "str"), D("DmnIdFile", "id"),
  ]),

  t("CallAnalysis", "CA", CAT_LEGACY, "raw", false, [
    D("SessionId", "id"), D("FileId", "id"), D("SessionIdA", "id"),
    D("callType", "str"), D("callDir", "str"), D("callStatus", "str"),
    D("technology", "str"), D("band", "str"), D("CallMode", "str"),
    D("setupTime", "num"), D("callDuration", "num"),
    D("callStartTimeStamp", "date"), D("callEndTimeStamp", "date"),
    D("StartTechnology", "str"), D("EndTechnology", "str"),
    D("CallTechnologies", "str"), D("Side", "str"),
    D("disconCause", "str"), D("disconClass", "str"), D("disconDirection", "str"),
    D("disconLocation", "str"), D("code", "str"), D("codeDescription", "str"),
    D("LastHoType", "str"), D("LastHoCause", "str"), D("LastHoTimeStamp", "date"),
    D("avgRxLev", "num"), D("avgRxQual", "num"), D("avgRLT", "num"),
    D("avgLTERSRP", "num"), D("avgLTERSRQ", "num"), D("avgLTESINR", "num"),
    D("avgNR5GRSRP", "num"), D("avgNR5GRSRQ", "num"), D("avgNR5GSINR", "num"),
    D("avgBLER", "num"), D("avgTotEcIo", "num"),
    D("avgUETxPwr", "num"), D("avgUERxPwr", "num"),
    D("NoService", "num"), D("Initializing", "num"),
  ]),

  t("CDRCombined", "CC", CAT_LEGACY, "raw", false, [
    D("TestId", "id"), D("SessionId", "id"), D("FileId", "id"),
    D("Technology", "str"), D("Test Name", "str"), D("Test Start TS", "date"),
    D("Transfer Status", "str"), D("Scoring Status", "str"),
    D("Transfer Throughput (kbps)", "num"), D("Transfer Duration (ms)", "num"),
    D("TestDirection", "str"), D("Host", "str"), D("Start Technology", "str"),
    D("Capacity_Sustainable Throughput (kbps)", "num"),
    D("YouTube_Avg. Video MOS", "num"), D("Ping_RTT Avg (ms)", "num"), D("valid", "bool"),
  ]),

  t("Position", "POS", CAT_LEGACY, "raw", false, [
    D("PosId", "id"), D("SessionId", "id"), D("MsgTime", "date"),
    D("latitude", "num"), D("longitude", "num"), D("speed", "num"),
    D("altitude", "num"), D("Direction", "num"),
  ]),

  t("Markers", "MK", CAT_LEGACY, "raw", false, [
    D("markerId", "id"), D("SessionId", "id"), D("MsgTime", "date"),
    D("MarkerText", "str"), D("NetworkId", "id"),
  ]),

  t("LTEMeasurementReport", "LMR", CAT_LEGACY, "raw", false, [
    D("MsgId", "id"), D("SessionId", "id"), D("MsgTime", "date"),
    D("EARFCN", "num"), D("PhyCellId", "num"), D("RSRP", "num"),
    D("RSRQ", "num"), D("RSSI", "num"), D("SINR0", "num"), D("SINR1", "num"),
  ]),

  t("GSMMeasReport", "GMR", CAT_LEGACY, "raw", false, [
    D("MsgId", "id"), D("SessionId", "id"), D("MsgTime", "date"),
    D("RxLevFull", "num"), D("RxLevSub", "num"),
    D("RxQualFull", "num"), D("RxQualSub", "num"),
  ]),

  t("CallSession", "CS", CAT_LEGACY, "raw", false, [
    D("SessionId", "id"), D("FileId", "id"), D("Callstatus", "str"),
    D("Callcause", "str"), D("Calltype", "str"), D("Calldir", "str"),
    D("VoiceCallType", "str"), D("SetupTime", "num"), D("CallDuration", "num"),
    D("ErrorCode", "num"), D("StartTime", "date"), D("EndTime", "date"),
  ]),

  t("vResultsKPI", "KPI", CAT_LEGACY, "view", false, [
    D("TestId", "id"), D("SessionId", "id"), D("ErrorCode", "num"),
    D("ResultValue", "num"), D("KPIName", "str"), D("Units", "str"),
  ]),

  t("vVoiceCodecTest", "VC", CAT_LEGACY, "view", false, [
    D("TestId", "id"), D("SessionId", "id"), D("CodecName", "str"),
    D("CodecRate", "num"), D("Technology", "str"), D("Duration", "num"),
    D("MsgTime", "date"),
  ]),

  t("FactIPThroughput", "IPT", CAT_LEGACY, "fact", false, [
    D("FactId", "id"), D("SessionId", "id"), D("MsgTime", "date"),
    D("DLThroughput", "num"), D("ULThroughput", "num"),
    D("Technology", "str"), D("Host", "str"), D("TestType", "str"),
  ]),
];

const TABLE_BY_NAME = new Map(TABLES.map((x) => [x.name, x]));
export const CATEGORIES = [
  CAT_SCANNER, CAT_TEST, CAT_RADIO, CAT_RAW, CAT_RESULTS, CAT_DIM, CAT_BRIDGE, CAT_LEGACY,
];

/* ═══════════════════════════════════════════════════════════════════════════
 * 3. SCHEMA — σχέσεις
 * ═══════════════════════════════════════════════════════════════════════════ */

const r = (
  from: string, fromCol: string, to: string, toCol: string,
  card: Cardinality, join: JoinType, ok: boolean, label?: string,
): RelDef => ({ from, fromCol, to, toCol, card, join, ok, label });

/** DmnId<Role> -> Dmn<Dimension>. Πρώτο match κερδίζει. */
const DMN_FK_TARGETS: Array<[RegExp, string]> = [
  [/^DmnIdTopNServerStatus$/, "DmnTopNServerStatus"],
  [/^DmnIdTopN/, "DmnTopN"],
  [/^DmnIdCellInformationNR5G$/, "DmnCellInformationNR5G"],
  [/^DmnIdCellInformation$/, "DmnCellInformation"],
  [/^DmnIdSession$/, "DmnSession"],
  [/^DmnIdFile$/, "DmnFile"],
  [/^DmnIdOperator$/, "DmnOperator"],
  [/^DmnIdPosition$/, "DmnPosition"],
  [/^DmnIdTest$/, "DmnTest"],
];

function autoDmnRelations(): RelDef[] {
  const out: RelDef[] = [];
  for (const tbl of TABLES) {
    for (const col of tbl.columns) {
      if (!col.name.startsWith("DmnId") || col.name === "DmnId") continue;
      const hit = DMN_FK_TARGETS.find(([re]) => re.test(col.name));
      const target = hit ? hit[1] : `Dmn${col.name.slice(5)}`;
      if (target === tbl.name || !TABLE_BY_NAME.has(target)) continue;
      out.push({
        from: tbl.name, fromCol: col.name, to: target, toCol: "DmnId",
        card: "N:1", join: col.ok ? "INNER" : "LEFT", ok: col.ok,
        label: col.name.replace(/^DmnId/, "") || target,
      });
    }
  }
  return out;
}

const EXPLICIT_RELATIONS: RelDef[] = [
  /* raw core — όλα επαληθευμένα */
  r("Sessions", "FileId", "FileList", "FileId", "N:1", "INNER", true),
  r("TestInfo", "SessionId", "Sessions", "SessionId", "N:1", "INNER", true),
  r("DmnSession", "SessionId", "Sessions", "SessionId", "N:1", "INNER", true),
  r("DmnTest", "TestId", "TestInfo", "TestId", "N:1", "INNER", true),
  r("NetworkInfo", "FileId", "FileList", "FileId", "N:1", "INNER", true),
  r("NetworkIdRelation", "TestId", "TestInfo", "TestId", "N:1", "INNER", true),
  r("NetworkIdRelation", "NetworkId", "NetworkInfo", "NetworkId", "N:1", "INNER", true),
  r("Technology", "TestId", "TestInfo", "TestId", "N:1", "LEFT", true),
  r("Technology", "NetworkId", "NetworkInfo", "NetworkId", "N:1", "LEFT", true),
  r("ResultsCapacityTest", "TestId", "TestInfo", "TestId", "N:1", "INNER", true),
  r("ResultsCapacityTestParameters", "TestId", "TestInfo", "TestId", "N:1", "LEFT", true),
  r("FactHttpTransfer", "TestId", "TestInfo", "TestId", "N:1", "INNER", true),

  /* window join: τα NetworkInfo records που "βλέπει" το session */
  {
    from: "Sessions", fromCol: "", to: "NetworkInfo", toCol: "", card: "1:N",
    join: "INNER", ok: true, label: "NetworkInfo στο παράθυρο του session",
    onSql: (s, n) =>
      `${n}.FileId = ${s}.FileId AND ${n}.NetworkId BETWEEN ${s}.StartNetworkId AND ${s}.NetworkId`,
  },
  /* composite: το DC leg ανά αρχείο */
  {
    from: "NetworkInfo", fromCol: "DCNetworkId", to: "DCNetworkInfo", toCol: "DCNetworkId",
    card: "N:1", join: "LEFT", ok: true, label: "DC leg (5G NR anchor)",
    onSql: (n, d) => `${d}.DCNetworkId = ${n}.DCNetworkId AND ${d}.FileId = ${n}.FileId`,
  },

  /* bridges */
  r("FactDataTest", "FactId", "BridgeFactDataTestDmnCellInformation", "FactId", "1:N", "INNER", true, "bridge"),
  r("BridgeFactDataTestDmnCellInformation", "DmnId", "DmnCellInformation", "DmnId", "N:1", "INNER", true),
  r("FactHttpTransfer", "FactId", "BridgeFactHttpTransferDmnCellInformation", "FactId", "1:N", "INNER", true, "bridge"),
  r("BridgeFactHttpTransferDmnCellInformation", "DmnId", "DmnCellInformation", "DmnId", "N:1", "INNER", true),
  r("FactNR5GRadio", "FactId", "BridgeFactNR5GRadioDmnTest", "FactId", "1:N", "INNER", true, "bridge"),

  /* legacy / draft */
  r("CallAnalysis", "FileId", "FileList", "FileId", "N:1", "LEFT", false),
  r("CallAnalysis", "SessionId", "Sessions", "SessionId", "N:1", "LEFT", false),
  r("CDRCombined", "FileId", "FileList", "FileId", "N:1", "LEFT", false),
  r("CDRCombined", "SessionId", "Sessions", "SessionId", "N:1", "LEFT", false),
  r("Position", "SessionId", "Sessions", "SessionId", "N:1", "LEFT", false),
  r("Markers", "SessionId", "Sessions", "SessionId", "N:1", "LEFT", false),
  r("ResultsLQ08Avg", "SessionId", "Sessions", "SessionId", "N:1", "LEFT", false),
  r("ResultsLQ08Avg", "TestID", "TestInfo", "TestId", "N:1", "LEFT", false),
  r("LTEMeasurementReport", "SessionId", "Sessions", "SessionId", "N:1", "LEFT", false),
  r("GSMMeasReport", "SessionId", "Sessions", "SessionId", "N:1", "LEFT", false),
  r("CallSession", "SessionId", "Sessions", "SessionId", "N:1", "LEFT", false),
  r("CallSession", "FileId", "FileList", "FileId", "N:1", "LEFT", false),
  r("vResultsKPI", "TestId", "TestInfo", "TestId", "N:1", "LEFT", false),
  r("vResultsKPI", "SessionId", "Sessions", "SessionId", "N:1", "LEFT", false),
  r("vVoiceCodecTest", "TestId", "TestInfo", "TestId", "N:1", "LEFT", false),
  r("FactIPThroughput", "SessionId", "Sessions", "SessionId", "N:1", "LEFT", false),
];

export const RELATIONS: RelDef[] = [...EXPLICIT_RELATIONS, ...autoDmnRelations()];

/* ═══════════════════════════════════════════════════════════════════════════
 * 4. JOIN GRAPH
 * ═══════════════════════════════════════════════════════════════════════════ */

const ROOT = "$";
const MAX_DEPTH = 3;
const MAX_NODES = 48;

export interface JoinNode {
  key: string;
  table: TableDef;
  alias: string;
  depth: number;
  parent: string;
  rel?: RelDef;
  reverse: boolean;
  multiplies: boolean;
  ok: boolean;
  via: string;        // "DmnSession → Sessions"
}

interface Hop {
  id: string;
  rel: RelDef;
  reverse: boolean;
  target: string;
  multiplies: boolean;
  role: string;
}

function hopsFrom(table: string, allowReverse: boolean): Hop[] {
  const out: Hop[] = [];
  RELATIONS.forEach((rel, i) => {
    if (rel.from === table) {
      out.push({
        id: `f${i}`, rel, reverse: false, target: rel.to,
        multiplies: rel.card === "1:N", role: rel.fromCol || rel.label || rel.to,
      });
    } else if (allowReverse && rel.to === table) {
      out.push({
        id: `r${i}`, rel, reverse: true, target: rel.from,
        multiplies: rel.card === "N:1", role: rel.toCol || rel.label || rel.from,
      });
    }
  });
  // οι επαληθευμένες σχέσεις προηγούνται, ώστε το shortest path να είναι και το σωστό
  out.sort((a, b) => Number(b.rel.ok) - Number(a.rel.ok));
  return out;
}

function uniqueAlias(base: string, role: string, used: Set<string>): string {
  if (!used.has(base)) { used.add(base); return base; }
  const hint = role.replace(/^DmnId/, "").replace(/[^A-Za-z0-9]/g, "").slice(0, 6).toUpperCase();
  if (hint) {
    const withHint = `${base}_${hint}`;
    if (!used.has(withHint)) { used.add(withHint); return withHint; }
  }
  let i = 2;
  while (used.has(`${base}${i}`)) i += 1;
  used.add(`${base}${i}`);
  return `${base}${i}`;
}

export interface JoinTree {
  root: JoinNode;
  nodes: JoinNode[];                 // χωρίς το root
  byKey: Map<string, JoinNode>;
}

function buildJoinTree(rootName: string): JoinTree {
  const rootTable = TABLE_BY_NAME.get(rootName) ?? TABLES[0];
  const used = new Set<string>([rootTable.alias]);
  const root: JoinNode = {
    key: ROOT, table: rootTable, alias: rootTable.alias, depth: 0,
    parent: "", reverse: false, multiplies: false, ok: rootTable.ok, via: "",
  };
  const byKey = new Map<string, JoinNode>([[ROOT, root]]);
  const nodes: JoinNode[] = [];
  const queue: JoinNode[] = [root];
  const seen = new Set<string>([rootTable.name]);

  while (queue.length && nodes.length < MAX_NODES) {
    const node = queue.shift() as JoinNode;
    if (node.depth >= MAX_DEPTH) continue;

    // ancestors του τρέχοντος μονοπατιού — αποφυγή κύκλων
    const ancestors = new Set<string>();
    for (let cur: JoinNode | undefined = node; cur; cur = byKey.get(cur.parent)) {
      ancestors.add(cur.table.name);
      if (cur.key === ROOT) break;
    }

    for (const hop of hopsFrom(node.table.name, node.depth === 0)) {
      const target = TABLE_BY_NAME.get(hop.target);
      if (!target || ancestors.has(target.name)) continue;
      if (node.depth >= 1 && seen.has(target.name)) continue;
      if (nodes.length >= MAX_NODES) break;

      const key = `${node.key}>${hop.id}`;
      const child: JoinNode = {
        key,
        table: target,
        alias: uniqueAlias(target.alias, hop.role, used),
        depth: node.depth + 1,
        parent: node.key,
        rel: hop.rel,
        reverse: hop.reverse,
        multiplies: hop.multiplies || node.multiplies,
        ok: hop.rel.ok && target.ok,
        via: node.key === ROOT ? "" : `${node.table.name} → `,
      };
      byKey.set(key, child);
      nodes.push(child);
      queue.push(child);
      seen.add(target.name);
    }
  }
  return { root, nodes, byKey };
}

/** Το ON του join, με σωστή φορά ακόμη και σε reverse traversal. */
function joinOn(node: JoinNode, parentAlias: string): string {
  const rel = node.rel as RelDef;
  if (rel.onSql) {
    return node.reverse ? rel.onSql(node.alias, parentAlias) : rel.onSql(parentAlias, node.alias);
  }
  return node.reverse
    ? `${node.alias}.${rel.fromCol} = ${parentAlias}.${rel.toCol}`
    : `${node.alias}.${rel.toCol} = ${parentAlias}.${rel.fromCol}`;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 5. SQL HELPERS
 * ═══════════════════════════════════════════════════════════════════════════ */

const SAFE_IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Bracket-safe identifier: `Test Name` -> `[Test Name]`. */
export const ident = (name: string): string => {
  const bare = name.replace(/^\[/, "").replace(/\]$/, "");
  return SAFE_IDENT.test(bare) ? bare : `[${bare.replace(/\]/g, "]]")}]`;
};

const quote = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** Type-aware literal. Τα @variables περνάνε αυτούσια. */
function literal(raw: string, type: ColType): string {
  const s = raw.trim();
  if (s === "") return "''";
  if (/^@[A-Za-z_]\w*$/.test(s)) return s;
  if (/^(NULL|GETDATE\(\))$/i.test(s)) return s.toUpperCase();
  if (type === "num" || type === "id" || type === "bool") {
    return /^-?\d+(\.\d+)?$/.test(s) ? s : quote(s);
  }
  return quote(s);
}

/** LIKE pattern με escaping των wildcards — τα collection names έχουν παντού `_`. */
function likePattern(raw: string, mode: LikeMode, escapeWild: boolean): string {
  const esc = (v: string) => (escapeWild ? v.replace(/[[_%]/g, (m) => `[${m}]`) : v);
  const body = esc(raw).replace(/'/g, "''");
  if (mode === "raw") return `'${raw.replace(/'/g, "''")}'`;
  if (mode === "starts") return `'${body}%'`;
  if (mode === "ends") return `'%${body}'`;
  return `'%${body}%'`;
}

const uid = () => Math.random().toString(36).slice(2, 9);
const nodeKeyOf = (colKey: string) => colKey.slice(0, colKey.indexOf("::"));
const colNameOf = (colKey: string) => colKey.slice(colKey.indexOf("::") + 2);
const mkColKey = (nodeKey: string, col: string) => `${nodeKey}::${col}`;

const AGGS: AggFn[] = ["", "COUNT", "COUNT DISTINCT", "SUM", "AVG", "MIN", "MAX"];
const OPERATORS = [
  "=", "<>", ">", "<", ">=", "<=",
  "LIKE", "NOT LIKE", "IN", "NOT IN", "BETWEEN", "IS NULL", "IS NOT NULL",
];
const NO_VALUE_OPS = new Set(["IS NULL", "IS NOT NULL"]);

/* ═══════════════════════════════════════════════════════════════════════════
 * 6. BUILD STATE + SQL GENERATION
 * ═══════════════════════════════════════════════════════════════════════════ */

export interface BuildState {
  primary: string;
  activeJoins: string[];
  joinTypes: Record<string, JoinType>;
  selected: string[];
  aggs: Record<string, AggFn>;
  conds: Cond[];
  orders: OrderRow[];
  distinct: boolean;
  useTop: boolean;
  top: string;
  countRows: boolean;
  database: string;
  emitUse: boolean;
  withSchema: boolean;
}

interface BuildResult {
  sql: string;
  warnings: Array<{ level: "error" | "warn" | "info"; text: string }>;
}

function buildSQL(state: BuildState, tree: JoinTree): BuildResult {
  const warnings: BuildResult["warnings"] = [];
  const prefix = state.withSchema ? "dbo." : "";

  const nodeOf = (key: string) => tree.byKey.get(key);
  const colOf = (colKey: string): { node: JoinNode; col: ColDef } | null => {
    const node = nodeOf(nodeKeyOf(colKey));
    if (!node) return null;
    const col = node.table.columns.find((c) => c.name === colNameOf(colKey));
    return col ? { node, col } : null;
  };
  const exprOf = (colKey: string): string => {
    const hit = colOf(colKey);
    return hit ? `${hit.node.alias}.${ident(hit.col.name)}` : colKey;
  };
  const aggExprOf = (colKey: string): string => {
    const agg = state.aggs[colKey] ?? "";
    const base = exprOf(colKey);
    if (!agg) return base;
    if (agg === "COUNT DISTINCT") return `COUNT(DISTINCT ${base})`;
    return `${agg}(${base})`;
  };
  const outAliasOf = (colKey: string): string => {
    const hit = colOf(colKey);
    const agg = state.aggs[colKey] ?? "";
    if (!hit || !agg) return "";
    const short = agg === "COUNT DISTINCT" ? "CNT" : agg;
    return ident(`${hit.col.name} ${short}`);
  };

  /* ---- ενεργά joins, με τους προγόνους τους, σε σειρά βάθους ---- */
  const activeSet = new Set<string>();
  for (const key of state.activeJoins) {
    let cur = tree.byKey.get(key);
    while (cur && cur.key !== ROOT) {
      activeSet.add(cur.key);
      cur = tree.byKey.get(cur.parent);
    }
  }
  const activeNodes = tree.nodes
    .filter((n) => activeSet.has(n.key))
    .sort((a, b) => a.depth - b.depth || a.key.localeCompare(b.key));

  /* ---- SELECT ---- */
  const selectLines: string[] = [];
  if (state.countRows) selectLines.push("  COUNT(*) AS [Rows]");
  for (const colKey of state.selected) {
    if (!colOf(colKey)) continue;
    const alias = outAliasOf(colKey);
    selectLines.push(`  ${aggExprOf(colKey)}${alias ? ` AS ${alias}` : ""}`);
  }
  if (selectLines.length === 0) {
    selectLines.push(`  ${tree.root.alias}.*`);
    warnings.push({ level: "warn", text: "Καμία στήλη επιλεγμένη — το query επιστρέφει SELECT *." });
  }

  const head = `SELECT${state.distinct ? " DISTINCT" : ""}${
    state.useTop && state.top ? ` TOP (${parseInt(state.top, 10) || 1000})` : ""
  }`;

  const lines: string[] = [];
  if (state.emitUse && state.database) lines.push(`USE ${ident(state.database)};`, "GO", "");
  lines.push(head, selectLines.join(",\n"), `FROM ${prefix}${tree.root.table.name} AS ${tree.root.alias}`);

  for (const node of activeNodes) {
    const parent = tree.byKey.get(node.parent);
    if (!parent) continue;
    const jt = state.joinTypes[node.key] ?? (node.rel as RelDef).join;
    lines.push(`${jt} JOIN ${prefix}${node.table.name} AS ${node.alias} ON ${joinOn(node, parent.alias)}`);
  }

  /* ---- WHERE / HAVING ---- */
  const renderCond = (c: Cond): string | null => {
    const hit = colOf(c.col);
    if (!hit) return null;
    const target = c.having ? aggExprOf(c.col) : exprOf(c.col);
    if (NO_VALUE_OPS.has(c.op)) return `${target} ${c.op}`;
    if (c.op === "LIKE" || c.op === "NOT LIKE") {
      return `${target} ${c.op} ${likePattern(c.value, c.likeMode, c.escapeWild)}`;
    }
    if (c.op === "IN" || c.op === "NOT IN") {
      const items = c.value.split(",").map((v) => v.trim()).filter(Boolean);
      if (!items.length) return null;
      return `${target} ${c.op} (${items.map((v) => literal(v, hit.col.type)).join(", ")})`;
    }
    if (c.op === "BETWEEN") {
      return `${target} BETWEEN ${literal(c.value, hit.col.type)} AND ${literal(c.value2, hit.col.type)}`;
    }
    return `${target} ${c.op} ${literal(c.value, hit.col.type)}`;
  };

  const emitClause = (rows: Cond[], keyword: "WHERE" | "HAVING") => {
    const parts = rows.map((c) => ({ c, sql: renderCond(c) })).filter((x) => x.sql);
    parts.forEach((p, i) => {
      lines.push(i === 0 ? `${keyword} ${p.sql}` : `  ${p.c.connector} ${p.sql}`);
    });
    const connectors = new Set(parts.slice(1).map((p) => p.c.connector));
    if (connectors.size > 1) {
      warnings.push({
        level: "warn",
        text: `${keyword}: το AND δεσμεύει ισχυρότερα από το OR — έλεγξε αν χρειάζονται παρενθέσεις.`,
      });
    }
  };

  const whereRows = state.conds.filter((c) => !c.having);
  const havingRows = state.conds.filter((c) => c.having);
  emitClause(whereRows, "WHERE");

  /* ---- GROUP BY ---- */
  const grouped = state.selected.filter((k) => !state.aggs[k] && colOf(k));
  const hasAgg = state.countRows || state.selected.some((k) => state.aggs[k]);
  if (hasAgg && grouped.length) {
    lines.push(`GROUP BY ${grouped.map(exprOf).join(", ")}`);
  }
  if (havingRows.length) {
    if (!hasAgg) {
      warnings.push({ level: "error", text: "Υπάρχει HAVING χωρίς κανένα aggregate — μετακίνησέ το σε WHERE." });
    }
    emitClause(havingRows, "HAVING");
  }

  /* ---- ORDER BY ---- */
  const orderParts = state.orders
    .filter((o) => colOf(o.col))
    .map((o) => `${hasAgg || state.distinct ? aggExprOf(o.col) : exprOf(o.col)} ${o.dir}`);
  if (orderParts.length) lines.push(`ORDER BY ${orderParts.join(", ")}`);

  /* ---- warnings ---- */
  if (state.useTop && !orderParts.length) {
    warnings.push({ level: "info", text: "TOP χωρίς ORDER BY — οι γραμμές που θα γυρίσουν δεν είναι ντετερμινιστικές." });
  }
  if (state.distinct) {
    const missing = state.orders.filter((o) => !state.selected.includes(o.col));
    if (missing.length) {
      warnings.push({ level: "error", text: "Με DISTINCT, το ORDER BY πρέπει να δείχνει μόνο σε επιλεγμένες στήλες." });
    }
  }
  const multiplying = activeNodes.filter((n) => n.multiplies);
  if (multiplying.length && !state.distinct && !hasAgg) {
    warnings.push({
      level: "warn",
      text: `1:N join (${multiplying.map((n) => n.table.name).join(", ")}) — πολλαπλασιάζει γραμμές. Βάλε DISTINCT ή aggregation.`,
    });
  }
  const draftBits = new Set<string>();
  if (!tree.root.table.ok) draftBits.add(tree.root.table.name);
  activeNodes.forEach((n) => { if (!n.ok) draftBits.add(n.table.name); });
  [...state.selected, ...state.conds.map((c) => c.col), ...state.orders.map((o) => o.col)].forEach((k) => {
    const hit = colOf(k);
    if (hit && !hit.col.ok) draftBits.add(`${hit.node.table.name}.${hit.col.name}`);
  });
  if (draftBits.size) {
    warnings.push({
      level: "warn",
      text: `Μη επαληθευμένο schema: ${[...draftBits].slice(0, 6).join(", ")}${draftBits.size > 6 ? " …" : ""}. Τρέξε «Έλεγχος schema».`,
    });
  }
  state.conds.forEach((c) => {
    if (!NO_VALUE_OPS.has(c.op) && c.value.trim() === "") {
      warnings.push({ level: "error", text: `Φίλτρο χωρίς τιμή: ${exprOf(c.col)} ${c.op}` });
    }
  });

  /* WHERE πάνω σε LEFT JOIN πίνακα -> τον μετατρέπει σιωπηλά σε INNER */
  const leftFiltered = new Set<string>();
  state.conds.forEach((c) => {
    if (c.having || c.op === "IS NULL") return;
    const node = nodeOf(nodeKeyOf(c.col));
    if (!node || node.key === ROOT || !node.rel) return;
    const jt = state.joinTypes[node.key] ?? node.rel.join;
    if (jt === "LEFT") leftFiltered.add(node.table.name);
  });
  if (leftFiltered.size) {
    warnings.push({
      level: "warn",
      text: `WHERE πάνω σε LEFT JOIN (${[...leftFiltered].join(", ")}) — ακυρώνει το LEFT. Βάλε INNER ή μετακίνησε τη συνθήκη στο ON.`,
    });
  }

  return { sql: lines.join("\n"), warnings };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 7. SCHEMA CHECK QUERY
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Query που ελέγχει κάθε πίνακα/στήλη του builder απέναντι στο
 * INFORMATION_SCHEMA της ζωντανής βάσης. Ό,τι γυρίσει MISSING πρέπει να
 * διορθωθεί εδώ μέσα.
 */
export function buildSchemaCheckSQL(database?: string, draftOnly = false): string {
  const rows: string[] = [];
  for (const tbl of TABLES) {
    for (const col of tbl.columns) {
      if (draftOnly && col.ok && tbl.ok) continue;
      rows.push(`('${tbl.name}','${col.name.replace(/'/g, "''")}','${col.ok && tbl.ok ? "V" : "D"}')`);
    }
  }
  const chunks: string[] = [];
  for (let i = 0; i < rows.length; i += 500) {
    chunks.push(`    SELECT * FROM (VALUES\n      ${rows.slice(i, i + 500).join(",\n      ")}\n    ) AS v(TableName, ColumnName, Flag)`);
  }
  return [
    database ? `USE ${ident(database)};\nGO\n` : "",
    "/* Schema check του QueryBuilder — MISSING = διόρθωσε το schema στο component */",
    ";WITH expected(TableName, ColumnName, Flag) AS (",
    chunks.join("\n    UNION ALL\n"),
    ")",
    "SELECT e.TableName, e.ColumnName,",
    "       CASE WHEN e.Flag = 'V' THEN 'verified' ELSE 'draft' END AS BuilderFlag,",
    "       CASE WHEN c.COLUMN_NAME IS NULL THEN 'MISSING' ELSE 'OK' END AS Status,",
    "       c.DATA_TYPE, c.IS_NULLABLE",
    "FROM       expected AS e",
    "LEFT  JOIN INFORMATION_SCHEMA.COLUMNS AS c",
    "        ON c.TABLE_NAME = e.TableName AND c.COLUMN_NAME = e.ColumnName",
    "ORDER BY Status DESC, e.TableName, e.ColumnName;",
  ].filter(Boolean).join("\n");
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 8. SQL -> BUILDER STATE (best effort)
 * ═══════════════════════════════════════════════════════════════════════════ */

interface ParsedState {
  primary: string;
  activeJoins: string[];
  selected: string[];
  distinct: boolean;
  useTop: boolean;
  top: string;
  orders: OrderRow[];
}

function parseSql(sql: string): ParsedState | null {
  const s = sql.replace(/\r?\n/g, " ").replace(/\s+/g, " ").trim();
  const from = s.match(/\bFROM\s+(?:dbo\.)?(\w+)\s+(?:AS\s+)?(\w+)/i);
  if (!from) return null;
  const table = TABLES.find((x) => x.name.toLowerCase() === from[1].toLowerCase());
  if (!table) return null;

  const tree = buildJoinTree(table.name);
  const distinct = /SELECT\s+DISTINCT\b/i.test(s);
  const topMatch = s.match(/SELECT\s+(?:DISTINCT\s+)?TOP\s*\(?\s*(\d+)/i);

  /* joins: ταιριάζουμε τα ονόματα πινάκων που εμφανίζονται σε JOIN */
  const joined = new Set<string>();
  const joinRe = /\bJOIN\s+(?:dbo\.)?(\w+)\b/gi;
  let m: RegExpExecArray | null;
  while ((m = joinRe.exec(s)) !== null) joined.add(m[1].toLowerCase());
  const activeJoins = tree.nodes
    .filter((n) => joined.has(n.table.name.toLowerCase()))
    .map((n) => n.key);

  /* select columns: tokenize alias.column (bracket-safe) */
  const fromIdx = s.search(/\bFROM\b/i);
  const selectStr = s.slice(0, fromIdx);
  const activeNodes = [tree.root, ...tree.nodes.filter((n) => activeJoins.includes(n.key))];
  const aliasMap = new Map(activeNodes.map((n) => [n.alias.toLowerCase(), n]));
  const selected: string[] = [];
  const tokenRe = /([A-Za-z_][A-Za-z0-9_]*)\.(\[[^\]]+\]|[A-Za-z_][A-Za-z0-9_]*)/g;
  while ((m = tokenRe.exec(selectStr)) !== null) {
    const node = aliasMap.get(m[1].toLowerCase());
    if (!node) continue;
    const bare = m[2].replace(/^\[/, "").replace(/\]$/, "");
    const col = node.table.columns.find((c) => c.name.toLowerCase() === bare.toLowerCase());
    if (!col) continue;
    const key = mkColKey(node.key, col.name);
    if (!selected.includes(key)) selected.push(key);
  }

  /* order by */
  const orders: OrderRow[] = [];
  const orderMatch = s.match(/\bORDER\s+BY\s+(.+?)(?:\s+OPTION\b|;|$)/i);
  if (orderMatch) {
    for (const part of orderMatch[1].split(",")) {
      const om = part.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)\.(\[[^\]]+\]|[A-Za-z_][A-Za-z0-9_]*)(?:\s+(ASC|DESC))?/i);
      if (!om) continue;
      const node = aliasMap.get(om[1].toLowerCase());
      if (!node) continue;
      const bare = om[2].replace(/^\[/, "").replace(/\]$/, "");
      const col = node.table.columns.find((c) => c.name.toLowerCase() === bare.toLowerCase());
      if (!col) continue;
      orders.push({
        id: uid(), col: mkColKey(node.key, col.name),
        dir: (om[3] || "ASC").toUpperCase() as "ASC" | "DESC",
      });
    }
  }

  return {
    primary: table.name,
    activeJoins,
    selected,
    distinct,
    useTop: !!topMatch,
    top: topMatch ? topMatch[1] : "1000",
    orders,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 9. TEMPLATES  (γραμμένα πάνω στο επαληθευμένο schema)
 * ═══════════════════════════════════════════════════════════════════════════ */

interface TemplateDef {
  label: string;
  description: string;
  table: string;
  joins?: string[];                     // ονόματα πινάκων
  cols: string[];                       // "Table.Column"
  aggs?: Record<string, AggFn>;         // "Table.Column" -> agg
  conds?: Array<{ col: string; op: string; value: string; likeMode?: LikeMode; escapeWild?: boolean }>;
  orders?: Array<{ col: string; dir: "ASC" | "DESC" }>;
  distinct?: boolean;
  top?: string;
  countRows?: boolean;
}

const TEMPLATES: TemplateDef[] = [
  {
    label: "Scanner LTE / collection",
    description: "RSRP-SINR ανά Collection & Operator, μόνο best server (StatusId 1,2,3)",
    table: "FactLTEScanner",
    joins: ["DmnFile", "DmnOperator", "DmnTopNServerStatus"],
    cols: ["DmnFile.CollectionName", "DmnOperator.Provider", "FactLTEScanner.RSRP", "FactLTEScanner.SINR", "FactLTEScanner.RSRQ"],
    aggs: { "FactLTEScanner.RSRP": "AVG", "FactLTEScanner.SINR": "AVG", "FactLTEScanner.RSRQ": "AVG" },
    conds: [
      { col: "DmnOperator.MCC", op: "=", value: "202" },
      { col: "DmnTopNServerStatus.StatusId", op: "IN", value: "1, 2, 3" },
      { col: "DmnFile.CollectionName", op: "LIKE", value: "MTWS", likeMode: "contains", escapeWild: true },
    ],
    orders: [{ col: "DmnFile.CollectionName", dir: "ASC" }],
    countRows: true,
  },
  {
    label: "Scanner 5G NR / collection",
    description: "SS-RSRP / SS-SINR ανά Collection & Operator (beam level)",
    table: "FactNR5GScannerBeam",
    joins: ["DmnFile", "DmnOperator", "DmnTopNServerStatus"],
    cols: ["DmnFile.CollectionName", "DmnOperator.Provider", "FactNR5GScannerBeam.SS_RSRP", "FactNR5GScannerBeam.SS_SINR"],
    aggs: { "FactNR5GScannerBeam.SS_RSRP": "AVG", "FactNR5GScannerBeam.SS_SINR": "AVG" },
    conds: [
      { col: "DmnOperator.MCC", op: "=", value: "202" },
      { col: "DmnTopNServerStatus.StatusId", op: "IN", value: "1, 2, 3" },
    ],
    orders: [{ col: "DmnFile.CollectionName", dir: "ASC" }],
    countRows: true,
  },
  {
    label: "Scanner GSM / collection",
    description: "RxLev ανά Collection & Operator, best cell (TopNID = 1)",
    table: "FactGSMScanner",
    joins: ["DmnFile", "DmnOperator", "DmnTopN"],
    cols: ["DmnFile.CollectionName", "DmnOperator.Provider", "FactGSMScanner.RxLev"],
    aggs: { "FactGSMScanner.RxLev": "AVG" },
    conds: [
      { col: "DmnOperator.MCC", op: "=", value: "202" },
      { col: "DmnTopN.TopNID", op: "=", value: "1" },
    ],
    countRows: true,
  },
  {
    label: "Scanner LTE / session",
    description: "Samples ανά scanner session, με unit & collection από το FileList",
    table: "FactLTEScanner",
    joins: ["DmnSession", "Sessions", "FileList", "DmnFile"],
    cols: [
      "Sessions.SessionId", "Sessions.startTime", "Sessions.SpeedAvg",
      "FileList.ASideLocation", "DmnFile.CollectionName", "FactLTEScanner.RSRP",
    ],
    aggs: { "FactLTEScanner.RSRP": "AVG" },
    orders: [{ col: "Sessions.startTime", dir: "ASC" }],
    countRows: true,
    top: "2000",
  },
  {
    label: "HTTP transfer / cell",
    description: "Throughput ανά eNB-Id/Sector μέσω του bridge στο DmnCellInformation",
    table: "FactHttpTransfer",
    joins: ["DmnFile", "DmnTest", "BridgeFactHttpTransferDmnCellInformation", "DmnCellInformation"],
    cols: [
      "DmnCellInformation.eNBId_SectorId", "DmnFile.CollectionName", "DmnFile.Location",
      "DmnCellInformation.Technology", "DmnCellInformation.TAC",
      "DmnCellInformation.PCI_LTE", "DmnCellInformation.PCI_5GNR", "DmnCellInformation.AbsFreqSSB",
      "DmnTest.Direction", "FactHttpTransfer.TestId", "FactHttpTransfer.ApplicationThroughput_kbps",
    ],
    aggs: {
      "FactHttpTransfer.TestId": "COUNT DISTINCT",
      "FactHttpTransfer.ApplicationThroughput_kbps": "AVG",
    },
    conds: [{ col: "DmnFile.Location", op: "=", value: "Cosmote Data" }],
    orders: [{ col: "DmnCellInformation.eNBId_SectorId", dir: "ASC" }],
  },
  {
    label: "Data test / cell",
    description: "Capacity tests ανά cell (FactDataTest + bridge)",
    table: "FactDataTest",
    joins: ["DmnTest", "BridgeFactDataTestDmnCellInformation", "DmnCellInformation"],
    cols: [
      "DmnCellInformation.eNBId_SectorId", "DmnCellInformation.Technology",
      "DmnCellInformation.TAC", "DmnCellInformation.PCI_LTE", "DmnCellInformation.PCI_5GNR",
      "DmnTest.Direction", "DmnTest.TestId",
    ],
    aggs: { "DmnTest.TestId": "COUNT DISTINCT" },
    conds: [{ col: "FactDataTest.TestType", op: "=", value: "Capacity" }],
  },
  {
    label: "Capacity raw (throughput)",
    description: "TestInfo + ResultsCapacityTest, LastBlock = 1",
    table: "TestInfo",
    joins: ["Sessions", "FileList", "ResultsCapacityTest", "ResultsCapacityTestParameters"],
    cols: [
      "FileList.CollectionName", "FileList.ASideLocation", "TestInfo.TestId",
      "TestInfo.startTime", "ResultsCapacityTestParameters.Direction",
      "ResultsCapacityTest.ThroughputGet", "ResultsCapacityTest.ThroughputPut",
    ],
    conds: [
      { col: "ResultsCapacityTest.LastBlock", op: "=", value: "1" },
      { col: "ResultsCapacityTest.ErrorCode", op: "=", value: "0" },
      { col: "Sessions.valid", op: "=", value: "1" },
    ],
    orders: [{ col: "TestInfo.startTime", dir: "DESC" }],
    top: "1000",
  },
  {
    label: "CGI ανά κλήση (window)",
    description: "Τα NetworkInfo records μέσα στο παράθυρο κάθε CALL session",
    table: "Sessions",
    joins: ["FileList", "NetworkInfo"],
    cols: [
      "Sessions.SessionId", "FileList.CollectionName", "NetworkInfo.MsgTime",
      "NetworkInfo.technology", "NetworkInfo.Operator", "NetworkInfo.CGI",
      "NetworkInfo.CID", "NetworkInfo.LAC", "NetworkInfo.RFBand",
    ],
    conds: [
      { col: "Sessions.sessionType", op: "=", value: "CALL" },
      { col: "Sessions.valid", op: "=", value: "1" },
    ],
    orders: [{ col: "NetworkInfo.MsgTime", dir: "ASC" }],
    top: "2000",
  },
  {
    label: "Collections (distinct)",
    description: "Λίστα collection names από το DmnFile",
    table: "DmnFile",
    cols: ["DmnFile.CollectionName"],
    distinct: true,
    orders: [{ col: "DmnFile.CollectionName", dir: "ASC" }],
  },
];

/* ═══════════════════════════════════════════════════════════════════════════
 * 10. UI BITS
 * ═══════════════════════════════════════════════════════════════════════════ */

const TYPE_META: Record<ColType, { icon: ReactNode; cls: string }> = {
  id: { icon: <Key className="h-2.5 w-2.5" />, cls: "text-muted-foreground/60" },
  num: { icon: <Hash className="h-2.5 w-2.5" />, cls: "text-sky-400/80" },
  str: { icon: <Type className="h-2.5 w-2.5" />, cls: "text-emerald-400/80" },
  date: { icon: <Calendar className="h-2.5 w-2.5" />, cls: "text-amber-400/80" },
  bool: { icon: <ToggleLeft className="h-2.5 w-2.5" />, cls: "text-violet-400/80" },
};

const KIND_LABEL: Record<TableKind, string> = {
  fact: "fact", dim: "dim", bridge: "bridge", raw: "raw", view: "view",
};

function StepLabel({ n, label, hint }: { n: number; label: string; hint?: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="flex h-4 w-4 items-center justify-center rounded-full bg-primary/20 text-primary text-[9px] font-bold leading-none ring-1 ring-primary/40">
        {n}
      </span>
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
      {hint && <span className="text-[10px] text-muted-foreground/50">· {hint}</span>}
    </div>
  );
}

function OkBadge({ ok }: { ok: boolean }) {
  return (
    <span
      title={ok ? "Επαληθευμένο σε πραγματικό query" : "Draft — δεν έχει επαληθευτεί στη βάση"}
      className="inline-flex shrink-0"
    >
      {ok
        ? <ShieldCheck className="h-2.5 w-2.5 text-emerald-500/70" />
        : <HelpCircle className="h-2.5 w-2.5 text-amber-500/70" />}
    </span>
  );
}

function ColGroup({
  node, selected, filter, showDraft, onToggle, onAll, onNone,
}: {
  node: JoinNode;
  selected: Set<string>;
  filter: string;
  showDraft: boolean;
  onToggle: (colKey: string) => void;
  onAll: (node: JoinNode, cols: ColDef[]) => void;
  onNone: (node: JoinNode, cols: ColDef[]) => void;
}) {
  const f = filter.trim().toLowerCase();
  const cols = node.table.columns.filter(
    (c) => (showDraft || c.ok) && (!f || c.name.toLowerCase().includes(f) || node.table.name.toLowerCase().includes(f)),
  );
  if (!cols.length) return null;
  const on = cols.filter((c) => selected.has(mkColKey(node.key, c.name))).length;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[10px] font-semibold text-primary min-w-0">
          <span className="rounded px-1 py-0.5 bg-primary/10 font-mono text-[9px] shrink-0">{node.alias}</span>
          <span className="truncate">{node.table.name}</span>
          <OkBadge ok={node.table.ok} />
        </span>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-[9px] text-muted-foreground">{on}/{cols.length}</span>
          <button type="button" onClick={() => onAll(node, cols)} className="text-[9px] px-1.5 py-0.5 rounded border border-border bg-muted/60 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">Όλες</button>
          <button type="button" onClick={() => onNone(node, cols)} className="text-[9px] px-1.5 py-0.5 rounded border border-border bg-muted/60 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">Καμία</button>
        </div>
      </div>
      <div className="flex flex-wrap gap-1">
        {cols.map((c) => {
          const key = mkColKey(node.key, c.name);
          const isOn = selected.has(key);
          const tm = TYPE_META[c.type];
          return (
            <button
              key={key}
              type="button"
              aria-pressed={isOn}
              title={c.note ?? (c.ok ? "" : "Draft — δεν έχει επαληθευτεί")}
              onClick={() => onToggle(key)}
              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono border transition-all ${
                isOn
                  ? "bg-primary/15 border-primary/40 text-primary shadow-sm shadow-primary/10"
                  : c.ok
                    ? "bg-muted/30 border-border/60 text-muted-foreground hover:border-border hover:text-foreground"
                    : "bg-muted/20 border-dashed border-border/60 text-muted-foreground/70 hover:text-foreground"
              }`}
            >
              <span className={isOn ? "text-primary/70" : tm.cls}>{tm.icon}</span>
              {c.name}
              {isOn && <Check className="h-2 w-2 text-primary/60 ml-0.5" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 11. COMPONENT
 * ═══════════════════════════════════════════════════════════════════════════ */

const PRESET_STORE = "fasmetrics.querybuilder.presets.v1";
const DATABASES = ["MTWS_26H2", "MTWS_26H1"];

export interface QueryBuilderProps {
  onApply: (sql: string) => void;
  initialSql?: string;
  defaultDatabase?: string;
  databases?: string[];
  defaultOpen?: boolean;
  className?: string;
}

export default function QueryBuilder({
  onApply, initialSql, defaultDatabase, databases, defaultOpen = false, className = "",
}: QueryBuilderProps) {
  const dbOptions = databases && databases.length > 0 ? databases : DATABASES;
  // Άδειο/απόν defaultDatabase (π.χ. δεν έχει επιλεγεί ακόμα βάση από πάνω) → πέσε πίσω στην πρώτη διαθέσιμη.
  const resolvedDefaultDatabase = defaultDatabase || dbOptions[0];
  const parsed = useMemo(() => (initialSql ? parseSql(initialSql) : null), [initialSql]);

  const [open, setOpen] = useState(defaultOpen);
  const [primary, setPrimary] = useState(parsed?.primary ?? "FactLTEScanner");
  const [activeJoins, setActiveJoins] = useState<string[]>(parsed?.activeJoins ?? []);
  const [joinTypes, setJoinTypes] = useState<Record<string, JoinType>>({});
  const [selected, setSelected] = useState<string[]>(parsed?.selected ?? []);
  const [aggs, setAggs] = useState<Record<string, AggFn>>({});
  const [conds, setConds] = useState<Cond[]>([]);
  const [orders, setOrders] = useState<OrderRow[]>(parsed?.orders ?? []);
  const [distinct, setDistinct] = useState(parsed?.distinct ?? false);
  const [useTop, setUseTop] = useState(parsed?.useTop ?? true);
  const [top, setTop] = useState(parsed?.top ?? "1000");
  const [countRows, setCountRows] = useState(false);
  const [database, setDatabase] = useState(resolvedDefaultDatabase);
  const [emitUse, setEmitUse] = useState(false);
  const [withSchema, setWithSchema] = useState(true);
  const [colFilter, setColFilter] = useState("");
  const [showDraft, setShowDraft] = useState(true);
  const [showDeep, setShowDeep] = useState(false);
  const [copied, setCopied] = useState(false);
  const [presets, setPresets] = useState<Array<{ name: string; state: BuildState }>>([]);
  const [presetName, setPresetName] = useState("");

  const tree = useMemo(() => buildJoinTree(primary), [primary]);
  const rootTable = tree.root.table;

  const activeKeySet = useMemo(() => {
    const set = new Set<string>();
    for (const key of activeJoins) {
      let cur = tree.byKey.get(key);
      while (cur && cur.key !== ROOT) { set.add(cur.key); cur = tree.byKey.get(cur.parent); }
    }
    return set;
  }, [activeJoins, tree]);

  const activeNodes = useMemo(
    () => tree.nodes.filter((n) => activeKeySet.has(n.key)).sort((a, b) => a.depth - b.depth),
    [tree, activeKeySet],
  );
  const availableNodes = useMemo(() => [tree.root, ...activeNodes], [tree, activeNodes]);
  const availableKeys = useMemo(() => new Set(availableNodes.map((n) => n.key)), [availableNodes]);
  const selectedSet = useMemo(() => new Set(selected), [selected]);

  const allCols = useMemo(
    () => availableNodes.flatMap((n) => n.table.columns.map((c) => ({ node: n, col: c }))),
    [availableNodes],
  );

  const state: BuildState = useMemo(() => ({
    primary, activeJoins, joinTypes, selected, aggs, conds, orders,
    distinct, useTop, top, countRows, database, emitUse, withSchema,
  }), [primary, activeJoins, joinTypes, selected, aggs, conds, orders,
    distinct, useTop, top, countRows, database, emitUse, withSchema]);

  const { sql, warnings } = useMemo(() => buildSQL(state, tree), [state, tree]);

  /* ── presets (localStorage, best-effort) ─────────────────────────────── */
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(PRESET_STORE);
      if (raw) setPresets(JSON.parse(raw));
    } catch { /* private mode / disabled storage */ }
  }, []);
  const persistPresets = useCallback((next: Array<{ name: string; state: BuildState }>) => {
    setPresets(next);
    try { window.localStorage.setItem(PRESET_STORE, JSON.stringify(next)); } catch { /* ignore */ }
  }, []);

  /* ── συγχρονισμός με τη βάση που επιλέγεται στο πάνω-πάνω dropdown ──── */
  useEffect(() => {
    if (defaultDatabase) setDatabase(defaultDatabase);
  }, [defaultDatabase]);

  /* ── καθάρισμα αναφορών σε joins που έφυγαν ──────────────────────────── */
  useEffect(() => {
    const keep = (colKey: string) => availableKeys.has(nodeKeyOf(colKey));
    setSelected((prev) => (prev.every(keep) ? prev : prev.filter(keep)));
    setConds((prev) => (prev.every((c) => keep(c.col)) ? prev : prev.filter((c) => keep(c.col))));
    setOrders((prev) => (prev.every((o) => keep(o.col)) ? prev : prev.filter((o) => keep(o.col))));
  }, [availableKeys]);

  /* ── handlers ────────────────────────────────────────────────────────── */

  const resetFor = useCallback((tableName: string) => {
    const t2 = buildJoinTree(tableName);
    const preset = t2.root.table.columns.filter((c) => c.ok && !c.name.startsWith("DmnId")).slice(0, 6);
    setPrimary(tableName);
    setActiveJoins([]);
    setJoinTypes({});
    setSelected(preset.map((c) => mkColKey(ROOT, c.name)));
    setAggs({});
    setConds([]);
    setOrders([]);
    setCountRows(false);
    setDistinct(false);
  }, []);

  const toggleJoin = useCallback((key: string) => {
    setActiveJoins((prev) => {
      if (prev.includes(key)) return prev.filter((k) => k !== key && !k.startsWith(`${key}>`));
      const withAncestors = new Set(prev);
      let cur = tree.byKey.get(key);
      while (cur && cur.key !== ROOT) { withAncestors.add(cur.key); cur = tree.byKey.get(cur.parent); }
      return [...withAncestors];
    });
  }, [tree]);

  const toggleCol = useCallback((colKey: string) => {
    setSelected((prev) => (prev.includes(colKey) ? prev.filter((k) => k !== colKey) : [...prev, colKey]));
  }, []);

  const addAllCols = useCallback((node: JoinNode, cols: ColDef[]) => {
    setSelected((prev) => {
      const next = [...prev];
      cols.forEach((c) => { const k = mkColKey(node.key, c.name); if (!next.includes(k)) next.push(k); });
      return next;
    });
  }, []);

  const removeCols = useCallback((node: JoinNode, cols: ColDef[]) => {
    const drop = new Set(cols.map((c) => mkColKey(node.key, c.name)));
    setSelected((prev) => prev.filter((k) => !drop.has(k)));
  }, []);

  const moveCol = useCallback((index: number, delta: number) => {
    setSelected((prev) => {
      const next = [...prev];
      const target = index + delta;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }, []);

  const addCond = useCallback(() => {
    const first = allCols[0];
    if (!first) return;
    setConds((prev) => [...prev, {
      id: uid(), col: mkColKey(first.node.key, first.col.name), op: "=",
      value: "", value2: "", connector: "AND", having: false,
      likeMode: "contains", escapeWild: true,
    }]);
  }, [allCols]);

  const patchCond = useCallback((id: string, patch: Partial<Cond>) => {
    setConds((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }, []);

  const addOrder = useCallback(() => {
    const first = selected[0] ?? (allCols[0] ? mkColKey(allCols[0].node.key, allCols[0].col.name) : "");
    if (!first) return;
    setOrders((prev) => [...prev, { id: uid(), col: first, dir: "DESC" }]);
  }, [selected, allCols]);

  const applyTemplate = useCallback((tpl: TemplateDef) => {
    const t2 = buildJoinTree(tpl.table);
    const nodeFor = (tableName: string): JoinNode | undefined =>
      tableName === tpl.table ? t2.root : t2.nodes.find((n) => n.table.name === tableName);

    const joinKeys = new Set<string>();
    for (const name of tpl.joins ?? []) {
      const node = nodeFor(name);
      if (!node || node.key === ROOT) continue;
      let cur: JoinNode | undefined = node;
      while (cur && cur.key !== ROOT) { joinKeys.add(cur.key); cur = t2.byKey.get(cur.parent); }
    }
    const resolve = (ref: string): string | null => {
      const dot = ref.indexOf(".");
      const node = nodeFor(ref.slice(0, dot));
      const colName = ref.slice(dot + 1);
      if (!node) return null;
      const col = node.table.columns.find((c) => c.name === colName);
      return col ? mkColKey(node.key, col.name) : null;
    };

    setPrimary(tpl.table);
    setActiveJoins([...joinKeys]);
    setJoinTypes({});
    const cols = (tpl.cols.map(resolve).filter(Boolean) as string[]);
    setSelected(cols);
    const nextAggs: Record<string, AggFn> = {};
    Object.entries(tpl.aggs ?? {}).forEach(([ref, fn]) => {
      const key = resolve(ref);
      if (key) nextAggs[key] = fn;
    });
    setAggs(nextAggs);
    setConds((tpl.conds ?? []).map((c) => {
      const key = resolve(c.col);
      return key ? {
        id: uid(), col: key, op: c.op, value: c.value, value2: "",
        connector: "AND" as const, having: false,
        likeMode: c.likeMode ?? "contains", escapeWild: c.escapeWild ?? true,
      } : null;
    }).filter(Boolean) as Cond[]);
    setOrders((tpl.orders ?? []).map((o) => {
      const key = resolve(o.col);
      return key ? { id: uid(), col: key, dir: o.dir } : null;
    }).filter(Boolean) as OrderRow[]);
    setDistinct(!!tpl.distinct);
    setCountRows(!!tpl.countRows);
    setUseTop(!!tpl.top);
    setTop(tpl.top ?? "1000");
  }, []);

  const loadPreset = useCallback((snapshot: BuildState) => {
    setPrimary(snapshot.primary);
    setActiveJoins(snapshot.activeJoins ?? []);
    setJoinTypes(snapshot.joinTypes ?? {});
    setSelected(snapshot.selected ?? []);
    setAggs(snapshot.aggs ?? {});
    setConds(snapshot.conds ?? []);
    setOrders(snapshot.orders ?? []);
    setDistinct(!!snapshot.distinct);
    setUseTop(!!snapshot.useTop);
    setTop(snapshot.top ?? "1000");
    setCountRows(!!snapshot.countRows);
    setDatabase(snapshot.database ?? resolvedDefaultDatabase);
    setEmitUse(!!snapshot.emitUse);
    setWithSchema(snapshot.withSchema !== false);
  }, [resolvedDefaultDatabase]);

  const copySql = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(sql);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard blocked */ }
  }, [sql]);

  const hasErrors = warnings.some((w) => w.level === "error");
  const apply = useCallback(() => { onApply(sql); setOpen(false); }, [onApply, sql]);

  /* ── join chips ──────────────────────────────────────────────────────── */
  const joinChips = useMemo(() => {
    const visible = tree.nodes.filter((n) => (showDeep ? true : n.depth === 1) && (showDraft || n.ok));
    return visible.sort((a, b) => a.depth - b.depth || a.table.name.localeCompare(b.table.name));
  }, [tree, showDeep, showDraft]);

  const pathLabel = useCallback((node: JoinNode): string => {
    const parts: string[] = [];
    let cur: JoinNode | undefined = tree.byKey.get(node.parent);
    while (cur && cur.key !== ROOT) { parts.unshift(cur.table.name); cur = tree.byKey.get(cur.parent); }
    return parts.length ? `via ${parts.join(" → ")}` : "";
  }, [tree]);

  /* ── render ──────────────────────────────────────────────────────────── */

  return (
    <div className={`rounded-lg border border-border bg-card overflow-hidden ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-2.5 hover:bg-muted/20 transition-colors group"
      >
        <span className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/10 group-hover:bg-primary/20 transition-colors">
            <Wand2 className="h-3.5 w-3.5 text-primary" />
          </span>
          <span className="text-xs font-semibold tracking-wide text-foreground">Query Builder</span>
          <span className="rounded-full bg-muted px-2 py-0.5 text-[9px] font-mono text-muted-foreground">{database}</span>
          {open && selected.length > 0 && (
            <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[9px] font-semibold text-primary">
              {selected.length} στήλες
            </span>
          )}
        </span>
        <span className="flex items-center gap-2">
          {!open && (
            <span className="text-[10px] text-muted-foreground hidden sm:block">
              {rootTable.name} · {selected.length} στήλες · {activeNodes.length} joins
            </span>
          )}
          {open ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
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

              {/* ── Toolbar ── */}
              <div className="px-4 py-2.5 bg-muted/5 flex flex-wrap items-center gap-2">
                <span
                  className="flex items-center gap-1.5 text-[10px] text-muted-foreground"
                  title="Καθορίζεται από το Database dropdown πιο πάνω"
                >
                  <Database className="h-3 w-3" />
                  <span className="bg-muted border border-border rounded px-1.5 py-1 text-[10px] font-mono">
                    {database || "—"}
                  </span>
                </span>
                <label className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                  <input type="checkbox" checked={emitUse} onChange={(e) => setEmitUse(e.target.checked)} className="accent-primary" />
                  USE {database};
                </label>
                <label className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                  <input type="checkbox" checked={withSchema} onChange={(e) => setWithSchema(e.target.checked)} className="accent-primary" />
                  dbo. prefix
                </label>
                <label className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                  <input type="checkbox" checked={showDraft} onChange={(e) => setShowDraft(e.target.checked)} className="accent-primary" />
                  Εμφάνιση draft schema
                </label>
                <button
                  type="button"
                  onClick={() => onApply(buildSchemaCheckSQL(emitUse ? database : undefined))}
                  className="ml-auto inline-flex items-center gap-1 px-2 py-1 rounded-md border border-border/60 bg-muted/30 hover:bg-primary/10 hover:border-primary/40 hover:text-primary text-[10px] text-muted-foreground transition-all"
                  title="Παράγει query που ελέγχει όλους τους πίνακες/στήλες του builder στη ζωντανή βάση"
                >
                  <ShieldCheck className="h-3 w-3" /> Έλεγχος schema
                </button>
              </div>

              {/* ── Templates ── */}
              <div className="px-4 py-2.5">
                <p className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Έτοιμα queries</p>
                <div className="flex flex-wrap gap-1.5">
                  {TEMPLATES.map((tpl) => (
                    <button
                      key={tpl.label}
                      type="button"
                      onClick={() => applyTemplate(tpl)}
                      title={tpl.description}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-border/60 bg-muted/30 hover:bg-primary/10 hover:border-primary/40 hover:text-primary text-[10px] text-muted-foreground transition-all"
                    >
                      {tpl.label}
                    </button>
                  ))}
                </div>
                {presets.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2 pt-2 border-t border-border/40">
                    {presets.map((p) => (
                      <span key={p.name} className="inline-flex items-center rounded-md border border-border/60 bg-muted/30 text-[10px] overflow-hidden">
                        <button type="button" onClick={() => loadPreset(p.state)} className="px-2 py-1 hover:text-primary transition-colors">
                          {p.name}
                        </button>
                        <button
                          type="button"
                          onClick={() => persistPresets(presets.filter((x) => x.name !== p.name))}
                          className="px-1 py-1 text-muted-foreground/50 hover:text-destructive transition-colors"
                          aria-label={`Διαγραφή ${p.name}`}
                        >
                          <X className="h-2.5 w-2.5" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* ── 1. Primary table ── */}
              <div className="px-4 py-3 space-y-2">
                <StepLabel n={1} label="Κύριος πίνακας" hint={`${KIND_LABEL[rootTable.kind]}${rootTable.ok ? " · verified" : " · draft"}`} />
                <select
                  value={primary}
                  onChange={(e) => resetFor(e.target.value)}
                  className="w-full bg-muted/40 border border-border rounded-md px-3 py-2 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-primary/40 transition-shadow"
                >
                  {CATEGORIES.map((cat) => {
                    const inCat = TABLES.filter((x) => x.category === cat && (showDraft || x.ok));
                    if (!inCat.length) return null;
                    return (
                      <optgroup key={cat} label={`── ${cat} ──`}>
                        {inCat.map((x) => (
                          <option key={x.name} value={x.name}>
                            {x.ok ? "✓ " : "? "}{x.name} ({x.alias})
                          </option>
                        ))}
                      </optgroup>
                    );
                  })}
                </select>
                {rootTable.note && (
                  <p className="text-[10px] text-muted-foreground/70 flex items-start gap-1">
                    <Info className="h-3 w-3 mt-px shrink-0" /> {rootTable.note}
                  </p>
                )}
              </div>

              {/* ── 2. Joins ── */}
              <div className="px-4 py-3 space-y-2">
                <div className="flex items-center justify-between">
                  <StepLabel n={2} label="Joins" hint={`${activeNodes.length} ενεργά`} />
                  <label className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                    <input type="checkbox" checked={showDeep} onChange={(e) => setShowDeep(e.target.checked)} className="accent-primary" />
                    και έμμεσα (έως 3 hops)
                  </label>
                </div>
                {joinChips.length === 0 ? (
                  <p className="text-[10px] text-muted-foreground/60 italic">Δεν υπάρχουν καταγεγραμμένες σχέσεις για αυτόν τον πίνακα.</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {joinChips.map((n) => {
                      const on = activeKeySet.has(n.key);
                      const jt = joinTypes[n.key] ?? (n.rel as RelDef).join;
                      return (
                        <span
                          key={n.key}
                          className={`inline-flex items-center rounded-md border text-[10px] font-medium overflow-hidden transition-all ${
                            on ? "bg-primary/15 border-primary/40 text-primary" : "bg-muted/30 border-border/60 text-muted-foreground"
                          }`}
                        >
                          <button
                            type="button"
                            aria-pressed={on}
                            onClick={() => toggleJoin(n.key)}
                            title={`${pathLabel(n) || "άμεσο"}${n.rel?.label ? ` · ${n.rel.label}` : ""}${n.multiplies ? " · 1:N — πολλαπλασιάζει γραμμές" : ""}`}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 hover:bg-primary/10 transition-colors"
                          >
                            {on && <Check className="h-2.5 w-2.5" />}
                            {n.depth > 1 && <Link2 className="h-2.5 w-2.5 opacity-60" />}
                            {n.table.name}
                            <span className="rounded px-1 bg-muted/60 font-mono text-[9px] text-muted-foreground">{n.alias}</span>
                            {n.multiplies && <AlertTriangle className="h-2.5 w-2.5 text-amber-500/80" />}
                            {!n.ok && <HelpCircle className="h-2.5 w-2.5 text-amber-500/70" />}
                          </button>
                          {on && (
                            <button
                              type="button"
                              onClick={() => setJoinTypes((prev) => ({ ...prev, [n.key]: jt === "INNER" ? "LEFT" : "INNER" }))}
                              className="px-1.5 py-1 border-l border-primary/30 font-mono text-[9px] hover:bg-primary/20 transition-colors"
                              title="Εναλλαγή INNER / LEFT"
                            >
                              {jt}
                            </button>
                          )}
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* ── 3. Columns ── */}
              <div className="px-4 py-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <StepLabel n={3} label="Στήλες" hint={`${selected.length} επιλεγμένες`} />
                  <div className="relative">
                    <Search className="h-3 w-3 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground/60" />
                    <input
                      value={colFilter}
                      onChange={(e) => setColFilter(e.target.value)}
                      placeholder="αναζήτηση στήλης…"
                      className="bg-muted border border-border rounded pl-6 pr-2 py-1 text-[10px] w-44 focus:outline-none focus:ring-1 focus:ring-primary/40"
                    />
                  </div>
                </div>

                <div className="space-y-3 rounded-md border border-border/60 bg-muted/10 p-3 max-h-64 overflow-y-auto">
                  {availableNodes.map((n, i) => (
                    <div key={n.key} className={i > 0 ? "pt-2 border-t border-border/40" : ""}>
                      <ColGroup
                        node={n}
                        selected={selectedSet}
                        filter={colFilter}
                        showDraft={showDraft}
                        onToggle={toggleCol}
                        onAll={addAllCols}
                        onNone={removeCols}
                      />
                    </div>
                  ))}
                </div>

                {/* selected columns + aggregates */}
                {selected.length > 0 && (
                  <div className="rounded-md border border-border/60 bg-muted/5 divide-y divide-border/40">
                    <div className="flex items-center justify-between px-2 py-1">
                      <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Σειρά εξόδου & aggregates
                      </span>
                      <label className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                        <input type="checkbox" checked={countRows} onChange={(e) => setCountRows(e.target.checked)} className="accent-primary" />
                        <Sigma className="h-3 w-3" /> COUNT(*)
                      </label>
                    </div>
                    {selected.map((key, i) => {
                      const node = tree.byKey.get(nodeKeyOf(key));
                      const colName = colNameOf(key);
                      return (
                        <div key={key} className="flex items-center gap-1.5 px-2 py-1">
                          <span className="font-mono text-[10px] text-muted-foreground truncate flex-1 min-w-0">
                            <span className="text-primary/70">{node?.alias}</span>.{colName}
                          </span>
                          <select
                            value={aggs[key] ?? ""}
                            onChange={(e) => setAggs((prev) => ({ ...prev, [key]: e.target.value as AggFn }))}
                            className="bg-muted border border-border rounded px-1 py-0.5 text-[10px] w-[110px] focus:outline-none"
                          >
                            {AGGS.map((a) => <option key={a || "none"} value={a}>{a || "— (group by)"}</option>)}
                          </select>
                          <button type="button" onClick={() => moveCol(i, -1)} className="text-muted-foreground/50 hover:text-foreground" aria-label="πάνω">
                            <ChevronLeft className="h-3 w-3 rotate-90" />
                          </button>
                          <button type="button" onClick={() => moveCol(i, 1)} className="text-muted-foreground/50 hover:text-foreground" aria-label="κάτω">
                            <ChevronRight className="h-3 w-3 rotate-90" />
                          </button>
                          <button type="button" onClick={() => toggleCol(key)} className="text-muted-foreground/50 hover:text-destructive" aria-label="αφαίρεση">
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* ── 4. Filters ── */}
              <div className="px-4 py-3 space-y-2">
                <div className="flex items-center justify-between">
                  <StepLabel n={4} label="Φίλτρα" hint="WHERE / HAVING" />
                  <button
                    type="button"
                    onClick={addCond}
                    className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-md border border-border bg-muted/40 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <Plus className="h-3 w-3" /> Προσθήκη
                  </button>
                </div>

                {conds.length === 0 ? (
                  <p className="text-[10px] text-muted-foreground/60 italic py-1">Χωρίς φίλτρα — επιστρέφει όλες τις γραμμές.</p>
                ) : (
                  <div className="space-y-1.5">
                    {conds.map((c, i) => {
                      const node = tree.byKey.get(nodeKeyOf(c.col));
                      const col = node?.table.columns.find((x) => x.name === colNameOf(c.col));
                      const isLike = c.op === "LIKE" || c.op === "NOT LIKE";
                      return (
                        <div key={c.id} className="flex items-center gap-1.5 rounded-md bg-muted/20 border border-border/40 px-2 py-1.5 flex-wrap">
                          {i > 0 ? (
                            <select
                              value={c.connector}
                              onChange={(e) => patchCond(c.id, { connector: e.target.value as "AND" | "OR" })}
                              className="bg-muted border border-border rounded px-1 py-0.5 text-[10px] font-semibold w-14 focus:outline-none text-primary"
                            >
                              <option>AND</option><option>OR</option>
                            </select>
                          ) : (
                            <span className="w-14 text-[10px] font-semibold text-muted-foreground/60">{c.having ? "HAVING" : "WHERE"}</span>
                          )}

                          <select
                            value={c.col}
                            onChange={(e) => patchCond(c.id, { col: e.target.value })}
                            className="bg-muted border border-border rounded px-1 py-0.5 text-[10px] font-mono flex-1 min-w-[150px] focus:outline-none"
                          >
                            {allCols.map(({ node: n, col: cd }) => (
                              <option key={mkColKey(n.key, cd.name)} value={mkColKey(n.key, cd.name)}>
                                {n.alias}.{cd.name}
                              </option>
                            ))}
                          </select>

                          <select
                            value={c.op}
                            onChange={(e) => patchCond(c.id, { op: e.target.value })}
                            className="bg-muted border border-border rounded px-1 py-0.5 text-[10px] w-[96px] focus:outline-none"
                          >
                            {OPERATORS.map((op) => <option key={op}>{op}</option>)}
                          </select>

                          {isLike && (
                            <select
                              value={c.likeMode}
                              onChange={(e) => patchCond(c.id, { likeMode: e.target.value as LikeMode })}
                              className="bg-muted border border-border rounded px-1 py-0.5 text-[10px] w-[92px] focus:outline-none"
                            >
                              <option value="contains">περιέχει</option>
                              <option value="starts">αρχίζει με</option>
                              <option value="ends">τελειώνει σε</option>
                              <option value="raw">raw pattern</option>
                            </select>
                          )}

                          {!NO_VALUE_OPS.has(c.op) && (
                            <input
                              value={c.value}
                              onChange={(e) => patchCond(c.id, { value: e.target.value })}
                              placeholder={c.op === "IN" || c.op === "NOT IN" ? "a, b, c" : col?.type === "date" ? "2026-01-01 00:00" : "τιμή ή @param"}
                              className="bg-muted border border-border rounded px-1.5 py-0.5 text-[10px] font-mono flex-1 min-w-[90px] focus:outline-none focus:ring-1 focus:ring-primary/40"
                            />
                          )}
                          {c.op === "BETWEEN" && (
                            <input
                              value={c.value2}
                              onChange={(e) => patchCond(c.id, { value2: e.target.value })}
                              placeholder="έως"
                              className="bg-muted border border-border rounded px-1.5 py-0.5 text-[10px] font-mono flex-1 min-w-[90px] focus:outline-none focus:ring-1 focus:ring-primary/40"
                            />
                          )}

                          {isLike && c.likeMode !== "raw" && (
                            <label className="flex items-center gap-1 text-[9px] text-muted-foreground" title="Τα _ και % γίνονται [_] και [%] ώστε να μη λειτουργούν ως wildcards">
                              <input type="checkbox" checked={c.escapeWild} onChange={(e) => patchCond(c.id, { escapeWild: e.target.checked })} className="accent-primary" />
                              esc _
                            </label>
                          )}

                          <button
                            type="button"
                            onClick={() => patchCond(c.id, { having: !c.having })}
                            className={`px-1.5 py-0.5 rounded border text-[9px] font-mono transition-colors ${
                              c.having ? "bg-primary/15 border-primary/40 text-primary" : "bg-muted/40 border-border/60 text-muted-foreground"
                            }`}
                            title="Μετακίνηση σε HAVING (φίλτρο πάνω στο aggregate)"
                          >
                            HAVING
                          </button>

                          <button
                            type="button"
                            onClick={() => setConds((prev) => prev.filter((x) => x.id !== c.id))}
                            className="text-muted-foreground/50 hover:text-destructive transition-colors"
                            aria-label="διαγραφή φίλτρου"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* ── 5. Sort & limit ── */}
              <div className="px-4 py-3 space-y-2">
                <div className="flex items-center justify-between">
                  <StepLabel n={5} label="Ταξινόμηση & όριο" />
                  <button
                    type="button"
                    onClick={addOrder}
                    className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-md border border-border bg-muted/40 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <Plus className="h-3 w-3" /> ORDER BY
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-2 text-[10px] text-muted-foreground">
                    <input type="checkbox" checked={distinct} onChange={(e) => setDistinct(e.target.checked)} className="accent-primary" />
                    DISTINCT
                  </label>
                  <label className="flex items-center gap-2 text-[10px] text-muted-foreground">
                    <input type="checkbox" checked={useTop} onChange={(e) => setUseTop(e.target.checked)} className="accent-primary" />
                    TOP
                    <input
                      type="number" value={top} onChange={(e) => setTop(e.target.value)}
                      min={1} max={1000000} disabled={!useTop}
                      className="w-20 bg-muted border border-border rounded px-2 py-1 text-[10px] font-mono focus:outline-none focus:ring-1 focus:ring-primary/40 disabled:opacity-40"
                    />
                    <span>γραμμές</span>
                  </label>
                </div>

                {orders.length > 0 && (
                  <div className="space-y-1.5">
                    {orders.map((o) => (
                      <div key={o.id} className="flex items-center gap-1.5 rounded-md bg-muted/20 border border-border/40 px-2 py-1">
                        <select
                          value={o.col}
                          onChange={(e) => setOrders((prev) => prev.map((x) => (x.id === o.id ? { ...x, col: e.target.value } : x)))}
                          className="bg-muted border border-border rounded px-1 py-0.5 text-[10px] font-mono flex-1 min-w-[150px] focus:outline-none"
                        >
                          {(selected.length ? selected : allCols.map((a) => mkColKey(a.node.key, a.col.name))).map((key) => {
                            const n = tree.byKey.get(nodeKeyOf(key));
                            return <option key={key} value={key}>{n?.alias}.{colNameOf(key)}</option>;
                          })}
                        </select>
                        <div className="flex rounded-md border border-border overflow-hidden">
                          {(["ASC", "DESC"] as const).map((d) => (
                            <button
                              key={d}
                              type="button"
                              onClick={() => setOrders((prev) => prev.map((x) => (x.id === o.id ? { ...x, dir: d } : x)))}
                              className={`px-2 py-0.5 text-[10px] font-medium transition-colors ${
                                o.dir === d ? "bg-primary/20 text-primary" : "bg-muted/40 text-muted-foreground hover:text-foreground"
                              }`}
                            >
                              {d}
                            </button>
                          ))}
                        </div>
                        <button
                          type="button"
                          onClick={() => setOrders((prev) => prev.filter((x) => x.id !== o.id))}
                          className="text-muted-foreground/50 hover:text-destructive transition-colors"
                          aria-label="διαγραφή ταξινόμησης"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* ── Preview ── */}
              <div className="px-4 py-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">Προεπισκόπηση SQL</span>
                  <button
                    type="button"
                    onClick={copySql}
                    className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-md border border-border bg-muted/40 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
                    {copied ? "Αντιγράφηκε" : "Αντιγραφή"}
                  </button>
                </div>
                <pre className="rounded-md border border-border/60 bg-muted/20 p-3 text-[10px] font-mono leading-relaxed max-h-56 overflow-auto whitespace-pre">
                  {sql}
                </pre>

                {warnings.length > 0 && (
                  <ul className="space-y-1">
                    {warnings.map((w, i) => (
                      <li
                        key={`${w.level}-${i}`}
                        className={`flex items-start gap-1.5 text-[10px] ${
                          w.level === "error" ? "text-destructive"
                            : w.level === "warn" ? "text-amber-500"
                              : "text-muted-foreground"
                        }`}
                      >
                        {w.level === "info"
                          ? <Info className="h-3 w-3 mt-px shrink-0" />
                          : <AlertTriangle className="h-3 w-3 mt-px shrink-0" />}
                        <span>{w.text}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* ── Apply ── */}
              <div className="px-4 py-3 bg-muted/10 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <input
                    value={presetName}
                    onChange={(e) => setPresetName(e.target.value)}
                    placeholder="όνομα preset"
                    className="bg-muted border border-border rounded px-2 py-1 text-[10px] w-32 focus:outline-none focus:ring-1 focus:ring-primary/40"
                  />
                  <button
                    type="button"
                    disabled={!presetName.trim()}
                    onClick={() => {
                      const name = presetName.trim();
                      persistPresets([...presets.filter((p) => p.name !== name), { name, state }].slice(-12));
                      setPresetName("");
                    }}
                    className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-md border border-border bg-muted/40 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
                  >
                    <Save className="h-3 w-3" /> Αποθήκευση
                  </button>
                  <button
                    type="button"
                    onClick={() => resetFor(primary)}
                    className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-md border border-border bg-muted/40 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <RotateCcw className="h-3 w-3" /> Καθαρισμός
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  <p className="text-[10px] text-muted-foreground">
                    {selected.length} στήλες · {conds.length} φίλτρα · {activeNodes.length} joins
                  </p>
                  <Button size="sm" onClick={apply} disabled={hasErrors} className="gap-1.5 text-xs font-semibold">
                    <Wand2 className="h-3.5 w-3.5" />
                    Build &amp; Apply SQL
                  </Button>
                </div>
              </div>

            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
