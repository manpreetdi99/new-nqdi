import { useEffect, useRef, useState } from "react";
import {
  Play,
  Plus,
  X,
  Database,
  ChevronDown,
  Copy,
  Download,
  Clock,
  Rows,
  AlertCircle,
  ChevronRight,
  Trash2,
  BarChart2,
  Table2,
  SlidersHorizontal,
  Code2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { motion, AnimatePresence } from "framer-motion";
import QueryBuilder from "@/components/QueryBuilder";
import ResultCharts, { type ChartType } from "@/components/ResultCharts";

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────
interface DefaultChart {
  type: ChartType;
  xCol: string;
  yCols: string[];
  rightCols?: string[];
  axisOverrides?: Record<string, { domain: [number, number]; reversed?: boolean }>;
  aggFn?: "count" | "sum" | "avg" | "min" | "max";
  aggEnabled?: boolean;
  groupCol?: string;
}

interface QueryTab {
  id: string;
  label: string;
  sql: string;
  defaultChart?: DefaultChart;
}

interface QueryResult {
  id: string;
  label: string;
  executionTime: number;
  rowsReturned: number;
  columns: string[];
  data: Record<string, unknown>[];
  error?: string;
}

interface QueryEditorProps {
  onRunQueries: (queries: string[]) => void;
  isRunning: boolean;
  collectionNames: string[];
  collectionsLoading: boolean;
  results?: QueryResult[];
  totalTime?: number;
}

// ──────────────────────────────────────────────
// Quick-pick templates
// ──────────────────────────────────────────────
const TEMPLATE_CATEGORY_ORDER = [
  "SmartAnalytics R24",
  "General", "KPI", "MOS", "Signal", "Data",
  "LQ Voice", "LQ Stats", "Codec", "SRVCC", "Events", "Cell ID",
  "Data Tests", "Browsing", "Multimedia", "5G",
] as const;

const TEMPLATES: { label: string; category: string; sql: string; defaultChart?: DefaultChart }[] = [
  {
    label: "R24 Voice calls",
    category: "SmartAnalytics R24",
    defaultChart: { type: "bar", xCol: "Location", yCols: ["CallStatus"], aggFn: "sum", aggEnabled: false },
    sql: `SELECT
  FCV.SessionIdA,
  FCV.SessionIdB,
  DF.CollectionName,
  DF.Location,
  FCV.CallSessionStartTS,
  FCV.CallStatus,
  FCV.CallType,
  FCV.CallDirection,
  FCV.CallModeA,
  FCV.CallTechnologyA,
  FCV.SessionStartTechnologyA,
  ROUND(FCV.CallSetupTime_s, 3) AS setup_s,
  ROUND(FCV.CallDuration_s, 3) AS duration_s,
  ROUND(FCV.AvgSQ, 3) AS avg_mos,
  FCV.Valid,
  FCV.InvalidReason
FROM FactCDRVoice FCV
LEFT JOIN DmnFile DF ON DF.DmnId = FCV.DmnIdFile
ORDER BY FCV.CallSessionStartTS DESC`,
  },
  {
    label: "R24 Voice KPI by location",
    category: "SmartAnalytics R24",
    defaultChart: { type: "bar", xCol: "Location", yCols: ["total_calls", "bad_calls"], aggFn: "sum", aggEnabled: false },
    sql: `SELECT
  DF.CollectionName,
  DF.Location,
  COUNT(*) AS total_calls,
  SUM(CASE
        WHEN FCV.CallStatus LIKE '%Drop%'
          OR FCV.CallStatus LIKE '%Fail%'
          OR FCV.CallStatus LIKE '%System Release%'
        THEN 1 ELSE 0
      END) AS bad_calls,
  ROUND(100.0 * SUM(CASE
        WHEN FCV.CallStatus LIKE '%Drop%'
          OR FCV.CallStatus LIKE '%Fail%'
          OR FCV.CallStatus LIKE '%System Release%'
        THEN 1 ELSE 0
      END) / NULLIF(COUNT(*), 0), 2) AS bad_call_pct,
  ROUND(AVG(FCV.CallSetupTime_s), 3) AS avg_setup_s,
  ROUND(AVG(FCV.CallDuration_s), 3) AS avg_duration_s,
  ROUND(AVG(FCV.AvgSQ), 3) AS avg_mos
FROM FactCDRVoice FCV
LEFT JOIN DmnFile DF ON DF.DmnId = FCV.DmnIdFile
GROUP BY DF.CollectionName, DF.Location
ORDER BY bad_call_pct DESC, total_calls DESC`,
  },
  {
    label: "R24 Data sessions",
    category: "SmartAnalytics R24",
    defaultChart: { type: "bar", xCol: "Location", yCols: ["TransferThroughputKbps"], aggFn: "avg", aggEnabled: true },
    sql: `SELECT
  C.SessionId,
  C.TestId,
  DF.CollectionName,
  DF.Location,
  C.[Test Start TS],
  C.[Test Name],
  C.Technology,
  C.[Start Technology],
  C.[Transfer Status],
  C.[Scoring Status],
  C.TestDirection,
  C.Host,
  ROUND(CAST(C.[Transfer Throughput (kbps)] AS FLOAT), 2) AS TransferThroughputKbps,
  ROUND(CAST(C.[Capacity_Sustainable Throughput (kbps)] AS FLOAT), 2) AS CapacityThroughputKbps,
  ROUND(CAST(C.[Ping_RTT Avg (ms)] AS FLOAT), 2) AS PingRttAvgMs,
  ROUND(CAST(C.[YouTube_Avg. Video MOS] AS FLOAT), 3) AS YoutubeMos,
  C.LAT,
  C.LON,
  C.valid,
  C.InvalidReason
FROM FactCDRCombined C
LEFT JOIN DmnFile DF ON DF.DmnId = C.DmnIdFile
ORDER BY C.[Test Start TS] DESC`,
  },
  {
    label: "R24 Data KPI by test",
    category: "SmartAnalytics R24",
    defaultChart: { type: "bar", xCol: "TestName", yCols: ["avg_transfer_kbps", "avg_capacity_kbps"], aggFn: "avg", aggEnabled: false },
    sql: `SELECT
  DF.CollectionName,
  DF.Location,
  C.[Test Name] AS TestName,
  COUNT(*) AS tests,
  SUM(CASE WHEN C.[Scoring Status] LIKE '%Fail%' OR C.[Transfer Status] LIKE '%Fail%' THEN 1 ELSE 0 END) AS failed_tests,
  ROUND(AVG(CAST(C.[Transfer Throughput (kbps)] AS FLOAT)), 2) AS avg_transfer_kbps,
  ROUND(AVG(CAST(C.[Capacity_Sustainable Throughput (kbps)] AS FLOAT)), 2) AS avg_capacity_kbps,
  ROUND(AVG(CAST(C.[Ping_RTT Avg (ms)] AS FLOAT)), 2) AS avg_ping_ms,
  ROUND(AVG(CAST(C.[YouTube_Avg. Video MOS] AS FLOAT)), 3) AS avg_youtube_mos
FROM FactCDRCombined C
LEFT JOIN DmnFile DF ON DF.DmnId = C.DmnIdFile
GROUP BY DF.CollectionName, DF.Location, C.[Test Name]
ORDER BY DF.CollectionName, DF.Location, TestName`,
  },
  {
    label: "R24 LTE radio quality",
    category: "SmartAnalytics R24",
    defaultChart: { type: "bar", xCol: "Location", yCols: ["avg_rsrp", "avg_sinr"], aggFn: "avg", aggEnabled: false },
    sql: `SELECT
  DF.CollectionName,
  DF.Location,
  LR.EARFCN,
  LR.PhyCellId AS PCI,
  COUNT(*) AS samples,
  ROUND(AVG(CAST(LR.RSRP AS FLOAT)), 2) AS avg_rsrp,
  ROUND(AVG(CAST(LR.RSRQ AS FLOAT)), 2) AS avg_rsrq,
  ROUND(AVG(CAST(LR.SINR AS FLOAT)), 2) AS avg_sinr,
  ROUND(MIN(CAST(LR.RSRP AS FLOAT)), 2) AS min_rsrp
FROM FactLTERadio LR
LEFT JOIN DmnFile DF ON DF.DmnId = LR.DmnIdFile
WHERE LR.RSRP IS NOT NULL
GROUP BY DF.CollectionName, DF.Location, LR.EARFCN, LR.PhyCellId
ORDER BY avg_rsrp ASC`,
  },
  {
    label: "R24 GSM radio quality",
    category: "SmartAnalytics R24",
    defaultChart: { type: "bar", xCol: "Location", yCols: ["avg_rxlev", "avg_rxqual"], aggFn: "avg", aggEnabled: false },
    sql: `SELECT
  DF.CollectionName,
  DF.Location,
  GR.BCCH,
  GR.BSIC,
  COUNT(*) AS samples,
  ROUND(AVG(CAST(GR.RxLevSub AS FLOAT)), 2) AS avg_rxlev,
  ROUND(AVG(CAST(GR.RxQualSub AS FLOAT)), 2) AS avg_rxqual,
  ROUND(MIN(CAST(GR.RxLevSub AS FLOAT)), 2) AS min_rxlev,
  ROUND(MAX(CAST(GR.RxQualSub AS FLOAT)), 2) AS max_rxqual
FROM FactGSMRadio GR
LEFT JOIN DmnFile DF ON DF.DmnId = GR.DmnIdFile
WHERE GR.RxLevSub IS NOT NULL
GROUP BY DF.CollectionName, DF.Location, GR.BCCH, GR.BSIC
ORDER BY avg_rxlev ASC`,
  },
  {
    label: "R24 LTE scanner top RSRP",
    category: "SmartAnalytics R24",
    defaultChart: { type: "bar", xCol: "Location", yCols: ["avg_rsrp", "avg_sinr"], aggFn: "avg", aggEnabled: false },
    sql: `SELECT
  DF.CollectionName,
  DF.Location,
  LS.EARFCN,
  LS.PCI,
  COUNT(*) AS samples,
  ROUND(AVG(CAST(LS.RSRP AS FLOAT)), 2) AS avg_rsrp,
  ROUND(AVG(CAST(LS.RSRQ AS FLOAT)), 2) AS avg_rsrq,
  ROUND(AVG(CAST(LS.SINR AS FLOAT)), 2) AS avg_sinr
FROM FactLTEScanner LS
LEFT JOIN DmnFile DF ON DF.DmnId = LS.DmnIdFile
WHERE LS.DmnIdTopN_RSRP = 1
GROUP BY DF.CollectionName, DF.Location, LS.EARFCN, LS.PCI
ORDER BY avg_rsrp ASC`,
  },
  {
    label: "R24 Capacity summary",
    category: "SmartAnalytics R24",
    defaultChart: { type: "bar", xCol: "Location", yCols: ["avg_sustainable_kbps"], aggFn: "avg", aggEnabled: false },
    sql: `SELECT
  DF.CollectionName,
  DF.Location,
  COUNT(*) AS tests,
  ROUND(AVG(CAST(CAP.SustainableThroughput AS FLOAT)), 2) AS avg_sustainable_kbps,
  ROUND(MAX(CAST(CAP.SustainableThroughput AS FLOAT)), 2) AS max_sustainable_kbps,
  ROUND(AVG(CAST(CAP.RoundTripTime AS FLOAT)), 2) AS avg_rtt_ms,
  SUM(CASE WHEN CAP.CountSuccessful = 1 THEN 1 ELSE 0 END) AS successful_tests
FROM FactCapacity CAP
LEFT JOIN DmnFile DF ON DF.DmnId = CAP.DmnIdFile
GROUP BY DF.CollectionName, DF.Location
ORDER BY avg_sustainable_kbps DESC`,
  },
  {
    label: "R24 Scanner vs Radio RSRP (time bins)",
    category: "SmartAnalytics R24",
    defaultChart: { type: "line", xCol: "TimeBin", yCols: ["Scan_RSRP", "Radio_RSRP"], aggFn: "avg", aggEnabled: false },
    sql: `DECLARE @MaxRows INT = 5000;
DECLARE @Collection NVARCHAR(200) = '%';   -- π.χ. '%Epirus%'

WITH Combined AS (
    -- Πηγή 1: Scanner
    SELECT
        'SCAN'          AS Src,
        fs.FullDate,
        fs.RSRP, fs.RSRQ, fs.SINR, fs.RSSI,
        CAST(NULL AS FLOAT) AS RSRP_Rx0,
        CAST(NULL AS FLOAT) AS RSRP_Rx1,
        CAST(NULL AS FLOAT) AS SINR_Rx0,
        CAST(NULL AS FLOAT) AS SINR_Rx1,
        CAST(NULL AS FLOAT) AS Latitude,
        CAST(NULL AS FLOAT) AS Longitude,
        df.CollectionName
    FROM FactLTEScanner fs
    JOIN DmnFile df    ON df.FileId = fs.DmnIdFile
    WHERE fs.MccMncList = '202-1'
      AND fs.RSRP IS NOT NULL
      AND dmnIdTopN_RSRP = 1
      AND df.CollectionName LIKE @Collection

    UNION ALL

    -- Πηγή 2: Radio (UE)
    SELECT
        'RADIO'         AS Src,
        fr.FullDate,
        fr.RSRP, fr.RSRQ, fr.SINR, fr.RSSI,
        fr.RSRP_Rx0, fr.RSRP_Rx1,
        fr.SINR_Rx0, fr.SINR_Rx1,
        dp.Latitude, dp.Longitude,
        df.CollectionName
    FROM FactLTERadio fr
    LEFT JOIN DmnPosition dp ON dp.DmnId = fr.DmnIdPosition
    INNER JOIN DmnFile df    ON df.FileId = fr.DmnIdFile
    WHERE df.Location LIKE '%cos%a'
      AND df.CollectionName LIKE @Collection
),
Ranked AS (
    SELECT *,
        NTILE(@MaxRows) OVER (ORDER BY FullDate) AS BinId
    FROM Combined
),
BinCollections AS (
    -- διακριτά CollectionNames ανά bin (όχι ένα ανά δείγμα)
    SELECT BinId,
           STRING_AGG(CAST(CollectionName AS NVARCHAR(MAX)), ', ')
             WITHIN GROUP (ORDER BY CollectionName) AS Collections
    FROM (SELECT DISTINCT BinId, CollectionName FROM Ranked) d
    GROUP BY BinId
),
Agg AS (
    SELECT
        BinId
       ,MIN(FullDate)                                          AS TimeBin
       ,COUNT(*)                                               AS Samples_Total
       ,SUM(CASE WHEN Src = 'SCAN'  THEN 1 ELSE 0 END)         AS Samples_Scanner
       ,SUM(CASE WHEN Src = 'RADIO' THEN 1 ELSE 0 END)         AS Samples_Radio
        -- Scanner metrics
       ,ROUND(AVG(CASE WHEN Src = 'SCAN' THEN RSRP END), 2)    AS Scan_RSRP
       ,ROUND(AVG(CASE WHEN Src = 'SCAN' THEN RSRQ END), 2)    AS Scan_RSRQ
       ,ROUND(AVG(CASE WHEN Src = 'SCAN' THEN SINR END), 2)    AS Scan_SINR
       ,ROUND(AVG(CASE WHEN Src = 'SCAN' THEN RSSI END), 2)    AS Scan_RSSI
        -- Radio (UE) metrics
       ,ROUND(AVG(CASE WHEN Src = 'RADIO' THEN RSRP END), 2)   AS Radio_RSRP
       ,ROUND(AVG(CASE WHEN Src = 'RADIO' THEN RSRQ END), 2)   AS Radio_RSRQ
       ,ROUND(AVG(CASE WHEN Src = 'RADIO' THEN SINR END), 2)   AS Radio_SINR
       ,ROUND(AVG(CASE WHEN Src = 'RADIO' THEN RSSI END), 2)   AS Radio_RSSI
       ,ROUND(AVG(CASE WHEN Src = 'RADIO' THEN RSRP_Rx0 END), 2) AS Radio_RSRP_Rx0
       ,ROUND(AVG(CASE WHEN Src = 'RADIO' THEN RSRP_Rx1 END), 2) AS Radio_RSRP_Rx1
       ,ROUND(AVG(CASE WHEN Src = 'RADIO' THEN SINR_Rx0 END), 2) AS Radio_SINR_Rx0
       ,ROUND(AVG(CASE WHEN Src = 'RADIO' THEN SINR_Rx1 END), 2) AS Radio_SINR_Rx1
        -- Θέση (μόνο από radio)
       ,AVG(CASE WHEN Src = 'RADIO' THEN Latitude END)         AS Latitude
       ,AVG(CASE WHEN Src = 'RADIO' THEN Longitude END)        AS Longitude
    FROM Ranked
    GROUP BY BinId
)
SELECT
    a.TimeBin, a.Samples_Total, a.Samples_Scanner, a.Samples_Radio,
    a.Scan_RSRP, a.Scan_RSRQ, a.Scan_SINR, a.Scan_RSSI,
    a.Radio_RSRP, a.Radio_RSRQ, a.Radio_SINR, a.Radio_RSSI,
    a.Radio_RSRP_Rx0, a.Radio_RSRP_Rx1, a.Radio_SINR_Rx0, a.Radio_SINR_Rx1,
    a.Latitude, a.Longitude,
    bc.Collections
FROM Agg a
LEFT JOIN BinCollections bc ON bc.BinId = a.BinId
ORDER BY a.TimeBin`,
  },
  {
    label: "All calls",
    category: "General",
    defaultChart: { type: "bar", xCol: "Location", yCols: ["callStatus"], aggFn: "sum", aggEnabled: false },
    sql: `SELECT
  CA.SessionId,
  CA.technology,
  CA.callMode,
  CA.callType,
  CA.callDir,
  CA.callStatus,
  ROUND(CA.setupTime, 2) AS setupTime,
  (CA.callDuration / 1000) AS callDuration_s,
  FL.CollectionName,
  FL.ASideLocation AS Location
FROM CallAnalysis CA
LEFT JOIN FileList FL ON CA.FileId = FL.FileId
LEFT JOIN Sessions S  ON S.SessionId = CA.SessionId
WHERE S.Valid IN (0, 1)
ORDER BY CA.SessionId DESC`,
  },
  // ── General ──
  {
    label: "Drop / Fail / Sys Rel  summary",
    category: "General",
    defaultChart: { type: "bar", xCol: "callStatus", yCols: ["total"], aggFn: "sum", aggEnabled: true },
    sql: `SELECT
  FL.ASideLocation AS Location,
  CA.callStatus,
  CA.callType,
  CA.technology,
  COUNT(*) AS total
FROM CallAnalysis CA
LEFT JOIN FileList FL ON CA.FileId = FL.FileId
LEFT JOIN Sessions S  ON S.SessionId = CA.SessionId
WHERE S.Valid IN (0, 1)
  AND (CA.callStatus LIKE '%Drop%' OR CA.callStatus LIKE '%Fail%' OR CA.callStatus LIKE '%Sys%%Rel%')
GROUP BY FL.ASideLocation, CA.callStatus, CA.callType, CA.technology
ORDER BY total DESC`,
  },
  {
    label: "All Collection Names",
    category: "General",
    sql: `SELECT DISTINCT CollectionName
FROM FileList
ORDER BY CollectionName`,
  },
    {
    label: "All Call with HO",
    category: "General",
    sql: `SELECT CA.SessionId,
    CA.callStartTimeStamp,
    CA.callStatus,
    CA.technology,
    CA.LastLTEHoType        AS LastHoType,      -- π.χ. 'Intra LTE', 'LTE to UMTS', 'LTE to GSM'
    CA.LastHoCause          AS LastHoCause,
    CA.LastLTEHoTimeStamp   AS LastHoTime,
    DF.CollectionName,
    DF.ASideLocation
FROM CallAnalysis CA
LEFT JOIN FileList DF ON DF.FileId = CA.FileId
WHERE CA.LastLTEHoType IS NOT NULL
  AND CA.LastLTEHoType <> ''
ORDER BY CA.callStartTimeStamp`,
  },

  
  // ── KPI ──
  {
    label: "Avg setup time per technology",
    category: "KPI",
    defaultChart: { type: "bar", xCol: "Location", yCols: ["avg_setup_ms"], aggFn: "avg", aggEnabled: false },
    sql: `SELECT
  FL.ASideLocation AS Location,
  CA.technology,
  FL.CollectionName,
  COUNT(*)              AS calls,
  ROUND(AVG(CA.setupTime), 2) AS avg_setup_ms,
  ROUND(MIN(CA.setupTime), 2) AS min_setup_ms,
  ROUND(MAX(CA.setupTime), 2) AS max_setup_ms
FROM CallAnalysis CA
LEFT JOIN FileList FL ON CA.FileId = FL.FileId
LEFT JOIN Sessions S  ON S.SessionId = CA.SessionId
WHERE S.Valid IN (0, 1)
GROUP BY FL.ASideLocation, CA.technology, FL.CollectionName
ORDER BY avg_setup_ms,FL.CollectionName`,
  },
  {
    label: "KPIs ανά operator (calls)",
    category: "KPI",
    defaultChart: { type: "bar", xCol: "Location", yCols: ["total_calls", "drop_fail"], aggFn: "sum", aggEnabled: false },
    sql: `SELECT
  FL.ASideLocation                            AS Location,
  COUNT(*)                                    AS total_calls,
  SUM(CASE WHEN CA.callStatus LIKE '%Drop%' OR CA.callStatus LIKE '%Fail%'
           THEN 1 ELSE 0 END)                 AS drop_fail,
  ROUND(
    100.0 * SUM(CASE WHEN CA.callStatus LIKE '%Drop%' OR CA.callStatus LIKE '%Fail%'
                     THEN 1 ELSE 0 END)
    / NULLIF(COUNT(*), 0), 2)                 AS drop_fail_pct,
  ROUND(AVG(CA.setupTime), 2)                 AS avg_setup_ms,
  ROUND(AVG(LQ.OptionalWB), 3)               AS avg_mos
FROM CallAnalysis CA
LEFT JOIN FileList FL        ON CA.FileId    = FL.FileId
LEFT JOIN Sessions S         ON S.SessionId  = CA.SessionId
LEFT JOIN ResultsLQ08Avg LQ  ON LQ.SessionId = CA.SessionId
WHERE S.Valid IN (0, 1)
GROUP BY FL.ASideLocation
ORDER BY total_calls DESC`,
  },
  {
    label: "Setup time ανά callType & technology",
    category: "KPI",
    sql: `SELECT
  FL.ASideLocation AS Location,
  CA.callType,
  CA.technology,
  COUNT(*)                          AS calls,
  ROUND(AVG(CA.setupTime), 2)       AS avg_setup_ms,
  ROUND(MIN(CA.setupTime), 2)       AS min_setup_ms,
  ROUND(MAX(CA.setupTime), 2)       AS max_setup_ms,
  ROUND(STDEV(CA.setupTime), 2)     AS stdev_setup_ms
FROM CallAnalysis CA
LEFT JOIN FileList FL ON CA.FileId = FL.FileId
LEFT JOIN Sessions S  ON S.SessionId = CA.SessionId
WHERE S.Valid IN (0, 1)
  AND CA.setupTime IS NOT NULL
GROUP BY FL.ASideLocation, CA.callType, CA.technology
ORDER BY CA.callType, avg_setup_ms`,
  },
  // ── MOS ──
  {
    label: "MOS ανά operator & collection",
    category: "MOS",
    defaultChart: { type: "bar", xCol: "CollectionName", yCols: ["avg_mos"], groupCol: "Location", aggFn: "avg", aggEnabled: false },
    sql: `SELECT
  FL.CollectionName,
  FL.ASideLocation  AS Location,
  COUNT(*)          AS calls,
  ROUND(AVG(LQ.OptionalWB), 3) AS avg_mos,
  ROUND(MIN(LQ.OptionalWB), 3) AS min_mos,
  ROUND(MAX(LQ.OptionalWB), 3) AS max_mos
FROM ResultsLQ08Avg LQ
LEFT JOIN Sessions S  ON S.SessionId = LQ.SessionId
LEFT JOIN FileList FL ON FL.FileId   = S.FileId
WHERE LQ.OptionalWB IS NOT NULL
GROUP BY FL.CollectionName, FL.ASideLocation
ORDER BY FL.CollectionName, avg_mos DESC`,
  },
  {
    label: "MOS raw ανά call (για γράφημα)",
    category: "MOS",
    defaultChart: { type: "bar", xCol: "Location", yCols: ["MOS"], aggFn: "avg", aggEnabled: true },
    sql: `SELECT
  FL.ASideLocation                AS Location,
  FL.CollectionName,
  CA.technology,
  CA.callStatus,
  ROUND(LQ.OptionalWB, 3)        AS MOS,
  ROUND(CA.setupTime, 2)         AS setupTime,
  ROUND(CA.callDuration / 1000.0, 1) AS callDuration_s
FROM ResultsLQ08Avg LQ
LEFT JOIN Sessions S  ON S.SessionId  = LQ.SessionId
LEFT JOIN CallAnalysis CA ON CA.SessionId = LQ.SessionId
LEFT JOIN FileList FL ON FL.FileId    = S.FileId
WHERE LQ.OptionalWB IS NOT NULL
  AND S.Valid IN (0, 1)
ORDER BY LQ.SessionId DESC`,
  },
  {
    label: "MOS + Codec ανά call (FactSpeech + ResultsLQ08Avg)",
    category: "MOS",
    sql: `SELECT
  FL.ASideLocation              AS Location,
  FL.CollectionName,
  FS.CodecName,
  FS.CodecRate,
  FS.Direction,
  FS.SpeechAlgorithm            AS Algorithm,
  FS.Band,
  ROUND(LQ.OptionalWB, 3)       AS MOS_POLQA,
  ROUND(FS.LQ, 3)               AS LQ_Speech,
  FS.[Quality Category]         AS QualityCategory
FROM FactSpeech FS
  JOIN ResultsLQ08Avg LQ        ON LQ.MsgId = FS.MsgId
  LEFT JOIN Sessions S          ON S.SessionId = FS.SessionId
  LEFT JOIN FileList FL         ON FL.FileId   = S.FileId
WHERE LQ.OptionalWB IS NOT NULL
  AND S.Valid IN (0, 1)
ORDER BY FS.SessionId DESC`,
  },
  {
    label: "Avg MOS ανά Codec (FactSpeech + ResultsLQ08Avg)",
    category: "MOS",
    defaultChart: { type: "bar", xCol: "CodecName", yCols: ["avg_MOS"], aggFn: "avg", aggEnabled: false },
    sql: `SELECT
  FL.ASideLocation              AS Location,
  FS.CodecName,
  FS.CodecRate,
  COUNT(*)                      AS calls,
  ROUND(AVG(LQ.OptionalWB), 3)  AS avg_MOS,
  ROUND(MIN(LQ.OptionalWB), 3)  AS min_MOS,
  ROUND(MAX(LQ.OptionalWB), 3)  AS max_MOS
FROM FactSpeech FS
  JOIN ResultsLQ08Avg LQ        ON LQ.MsgId = FS.MsgId
  LEFT JOIN Sessions S          ON S.SessionId = FS.SessionId
  LEFT JOIN FileList FL         ON FL.FileId   = S.FileId
WHERE LQ.OptionalWB IS NOT NULL
  AND S.Valid IN (0, 1)
GROUP BY FL.ASideLocation, FS.CodecName, FS.CodecRate
ORDER BY avg_MOS DESC`,
  },
  // ── Signal ──
   {
    label: "Avg RSRP ανά operator",
    category: "Signal",
    defaultChart: { type: "bar", xCol: "Location", yCols: ["avg_RSRP", "avg_SINR"], aggFn: "avg", aggEnabled: false },
    sql: `SELECT
  FL.ASideLocation  AS Location,
  COUNT(*)          AS measurements,
  ROUND(AVG(CAST(LM.RSRP  AS FLOAT)), 2) AS avg_RSRP,
  ROUND(AVG(CAST(LM.RSRQ  AS FLOAT)), 2) AS avg_RSRQ,
  ROUND(AVG(CAST(LM.SINR0 AS FLOAT)), 2) AS avg_SINR
FROM LTEMeasurementReport LM
LEFT JOIN Sessions S  ON S.SessionId = LM.SessionId
LEFT JOIN FileList FL ON FL.FileId   = S.FileId
WHERE S.Valid IN (0, 1)
  AND LM.RSRP IS NOT NULL
GROUP BY FL.ASideLocation
ORDER BY avg_RSRP DESC`,
  },
  {
    label: "RSRP + MOS ανά operator & collection",
    category: "Signal",
    defaultChart: { type: "bar", xCol: "CollectionName", yCols: ["avg_rsrp"], groupCol: "Location", aggFn: "avg", aggEnabled: false },
    sql: `WITH RSRP_CTE AS (
  SELECT
    FL.CollectionName,
    FL.ASideLocation AS Location,
    ROUND(AVG(CAST(LM.RSRP AS FLOAT)), 2) AS avg_rsrp,
    ROUND(MAX(CAST(LM.RSRP AS FLOAT)), 2) AS max_rsrp,
    ROUND(MIN(CAST(LM.RSRP AS FLOAT)), 2) AS min_rsrp
  FROM LTEMeasurementReport LM
  LEFT JOIN Sessions S  ON S.SessionId = LM.SessionId
  LEFT JOIN FileList FL ON FL.FileId   = S.FileId
  WHERE S.Valid IN (0, 1)
    AND LM.RSRP IS NOT NULL
  GROUP BY FL.CollectionName, FL.ASideLocation
),
MOS_CTE AS (
  SELECT
    FL.CollectionName,
    FL.ASideLocation AS Location,
    ROUND(AVG(LQ.OptionalWB), 3) AS avg_mos
  FROM ResultsLQ08Avg LQ
  LEFT JOIN Sessions S  ON S.SessionId = LQ.SessionId
  LEFT JOIN FileList FL ON FL.FileId   = S.FileId
  WHERE LQ.OptionalWB IS NOT NULL
  GROUP BY FL.CollectionName, FL.ASideLocation
)
SELECT
  R.CollectionName,
  R.Location,
  R.avg_rsrp,
  R.max_rsrp,
  R.min_rsrp,
  M.avg_mos
FROM RSRP_CTE R
LEFT JOIN MOS_CTE M ON M.CollectionName = R.CollectionName AND M.Location = R.Location
ORDER BY R.CollectionName, R.avg_rsrp DESC`,
  },
  {
    label: "LTE μετρήσεις raw (για γράφημα)",
    category: "Signal",
    defaultChart: { type: "bar", xCol: "Location", yCols: ["RSRP", "SINR"], aggFn: "avg", aggEnabled: true },
    sql: `SELECT
  FL.ASideLocation  AS Location,
  CA.technology,
  ROUND(CAST(LM.RSRP  AS FLOAT), 2) AS RSRP,
  ROUND(CAST(LM.RSRQ  AS FLOAT), 2) AS RSRQ,
  ROUND(CAST(LM.SINR0 AS FLOAT), 2) AS SINR
FROM LTEMeasurementReport LM
LEFT JOIN Sessions S  ON S.SessionId = LM.SessionId
LEFT JOIN FileList FL ON FL.FileId   = S.FileId
LEFT JOIN CallAnalysis CA ON CA.SessionId = LM.SessionId
WHERE S.Valid IN (0, 1)
  AND LM.RSRP IS NOT NULL
ORDER BY LM.SessionId, LM.MsgTime`,
  },
  {
    label: "GSM RxLev/RxQual ανά operator",
    category: "Signal",
    sql: `SELECT
  FL.ASideLocation                              AS Location,
  COUNT(*)                                      AS measurements,
  ROUND(AVG(CAST(GM.RxLevSub  AS FLOAT)), 2)   AS avg_RxLev,
  ROUND(MIN(CAST(GM.RxLevSub  AS FLOAT)), 2)   AS min_RxLev,
  ROUND(MAX(CAST(GM.RxLevSub  AS FLOAT)), 2)   AS max_RxLev,
  ROUND(AVG(CAST(GM.RxQualSub AS FLOAT)), 2)   AS avg_RxQual
FROM GSMRadioParameters GM
LEFT JOIN Sessions S  ON S.SessionId = GM.SessionId
LEFT JOIN FileList FL ON FL.FileId   = S.FileId
WHERE S.Valid IN (0, 1)
  AND GM.RxLevSub IS NOT NULL
GROUP BY FL.ASideLocation
ORDER BY avg_RxLev DESC`,
  },
  {
    label: "GSM RxLev/RxQual ανά κλήση (30s buckets, μόνο GSM end)",
    category: "Signal",
    defaultChart: {
      type: "line",
      xCol: "BucketTs",
      yCols: ["AvgRxLev", "AvgRxQual", "OutcomeFlag"],
      // AvgRxQual: δικός του κρυφός άξονας 0–7, ανάποδα (7=χαμηλή ποιότητα κάτω, 0=καλή ποιότητα πάνω),
      // ώστε να πιάνει όλο το ύψος του chart ανεξάρτητα από την κλίμακα του AvgRxLev.
      axisOverrides: { AvgRxQual: { domain: [0, 7], reversed: true } },
      groupCol: "SessionId",
      aggFn: "avg",
      aggEnabled: false,
    },
    sql: `WITH loc_files AS (
  SELECT FileId
  FROM FileList
  WHERE ASideLocation LIKE '%%'
    AND CollectionName LIKE '%%'
),
gsm_calls AS (
  -- κλήσεις που ΚΑΤΑΛΗΓΟΥΝ σε GSM, με outcome flag 0/1
  SELECT
    CA.SessionId,
    CA.FileId,
    CA.callStatus,
    CASE
      WHEN CA.callStatus LIKE '%Complet%' THEN 1
      WHEN CA.callStatus LIKE '%Drop%'
        OR CA.callStatus LIKE '%Fail%'
        OR CA.callStatus LIKE '%Release%' THEN 0
      ELSE NULL
    END AS OutcomeFlag
  FROM CallAnalysis CA
  INNER JOIN loc_files LF ON LF.FileId = CA.FileId
  WHERE CA.EndTechnology = 'GSM'
),
radio_bucketed AS (
  -- 30άρια buckets πάνω στο FullDate
  SELECT
    GR.SessionId,
    DATEADD(
      SECOND,
      (DATEDIFF(SECOND, '2000-01-01', GR.FullDate) / 30) * 30,
      '2000-01-01'
    ) AS BucketTs,
    GR.RxLevSub,
    GR.RxQualSub
  FROM FactGSMRadio GR
  INNER JOIN gsm_calls GC ON GC.SessionId = GR.SessionId
  WHERE GR.RxLevSub IS NOT NULL
)
SELECT
  GC.SessionId,
  GC.FileId,
  GC.callStatus,
  GC.OutcomeFlag,
  RB.BucketTs,
  ROUND(AVG(CAST(RB.RxLevSub  AS FLOAT)), 2) AS AvgRxLev,
  ROUND(AVG(CAST(RB.RxQualSub AS FLOAT)), 2) AS AvgRxQual,
  COUNT(*)                                   AS SampleCount
FROM gsm_calls GC
LEFT JOIN radio_bucketed RB ON RB.SessionId = GC.SessionId
GROUP BY
  GC.SessionId, GC.FileId, GC.callStatus, GC.OutcomeFlag, RB.BucketTs
ORDER BY
  GC.SessionId, RB.BucketTs`,
  },
  {
    label: "NR 5G Bands",
    category: "Signal",
    sql: `SELECT
  FileList.CollectionName,
  FileList.ASideLocation,
  FactNR5GRadio.PosId,
  FactNR5GRadio.SessionId,
  FactNR5GRadio.PCI,
  FactNR5GRadio.NRARFCN,
  FactNR5GCellInfo.Band AS 'N BAND',
  FactNR5GRadio.RSRP,
  FactNR5GRadio.RSRQ,
  FactNR5GRadio.SINR
FROM FactNR5GRadio
  JOIN Sessions   ON (FactNR5GRadio.SessionId = Sessions.SessionId)
  JOIN FileList   ON (FactNR5GRadio.FileId    = FileList.FileId)
  JOIN FactNR5GCellInfo ON (FactNR5GRadio.FactIdFactNR5GCellInfo = FactNR5GCellInfo.NR5GCACellInfoId)
WHERE CollectionName LIKE '%%' AND FileList.ASideLocation LIKE '%Data%'`,
  },
  // ── Data ──
  {
    label: "Data sessions throughput ανά collection",
    category: "Data",
    defaultChart: { type: "bar", xCol: "Location", yCols: ["avg_DL_Mbps", "avg_UL_Mbps"], aggFn: "avg", aggEnabled: false },
    sql: `SELECT
  FL.CollectionName,
  FL.ASideLocation  AS Location,
  COUNT(*)          AS sessions,
  ROUND(AVG(CAST(DS.DLThroughput AS FLOAT)) / 1000.0, 2) AS avg_DL_Mbps,
  ROUND(MAX(CAST(DS.DLThroughput AS FLOAT)) / 1000.0, 2) AS max_DL_Mbps,
  ROUND(AVG(CAST(DS.ULThroughput AS FLOAT)) / 1000.0, 2) AS avg_UL_Mbps,
  ROUND(SUM(CAST(DS.TransferredBytes AS FLOAT)) / 1048576.0, 2) AS total_MB
FROM DataSessionAnalysis DS
LEFT JOIN Sessions S  ON S.SessionId = DS.SessionId
LEFT JOIN FileList FL ON FL.FileId   = S.FileId
WHERE S.Valid IN (0, 1)
  AND DS.DLThroughput IS NOT NULL
GROUP BY FL.CollectionName, FL.ASideLocation
ORDER BY avg_DL_Mbps DESC`,
  },
  // ── LQ Voice ──

  {
    label: "MOS (Free A)",
    category: "LQ Voice",
    sql: `SELECT
  NetworkInfo.CID,
  NetworkInfo.LAC,
  NetworkInfo.MCC,
  NetworkInfo.MNC,
  NetworkInfo.CGI,
  NetworkInfo.Technology,
  NetworkInfo.BCCH as NI_BCCH,
  NetworkInfo.SC1 as NI_SC1,
  NetworkInfo.SC2 as NI_SC2,
  NetworkInfo.SC3 as NI_SC3,
  Sessions.FileId,
  Sessions.SessionId,
  FileList.AsideLocation,
  FileList.ASideDevice,
  FileList.Zone,
  FileList.CollectionName,
  NetworkInfo.NetworkId,
  NetworkInfo.MsgTime
FROM Sessions as Sessions, Position, FileList, NetworkInfo
  LEFT JOIN vBTSList ON vBTSList.CGI = NetworkInfo.CGI
  LEFT JOIN vBTSList as bts2 ON bts2.CGI = NetworkInfo.CGI2
  LEFT JOIN vBTSList as bts3 ON bts3.CGI = NetworkInfo.CGI3
WHERE CollectionName like '%%' AND
  Sessions.FileId = FileList.FileId AND
  Sessions.Valid = 1 AND
  Sessions.SessionId = Position.SessionId AND
  Networkinfo.NetworkId=(Select Max(tech_2.NetworkId) From NetworkInfo tech_2
    Where tech_2.FileId=Position.FileID and tech_2.MsgTime<Position.msgtime) AND
  ASideLocation Like '%Free A%'`,
  },
  {
    label: "LQ UMTS/GSM Data (GSM)",
    category: "LQ Voice",
    sql: `SELECT
  NetworkInfo.CID,
  NetworkInfo.LAC,
  NetworkInfo.MCC,
  NetworkInfo.MNC,
  NetworkInfo.CGI,
  NetworkInfo.Technology,
  NetworkInfo.BCCH as NI_BCCH,
  NetworkInfo.SC1 as NI_SC1,
  NetworkInfo.SC2 as NI_SC2,
  NetworkInfo.SC3 as NI_SC3,
  Sessions.FileId,
  Sessions.SessionId,
  Filelist.ASideLocation,
  FileList.ASideDevice,
  FileList.Zone,
  FileList.CollectionName,
  NetworkInfo.NetworkId,
  NetworkInfo.MsgTime
FROM Sessions as Sessions, Position, FileList,
  NetworkInfo
  LEFT JOIN vBTSList ON vBTSList.CGI = NetworkInfo.CGI
  LEFT JOIN vBTSList as bts2 ON bts2.CGI = NetworkInfo.CGI2
  LEFT JOIN vBTSList as bts3 ON bts3.CGI = NetworkInfo.CGI3
WHERE CollectionName like '%%' AND
  Sessions.FileId = FileList.FileId AND
  Sessions.Valid = 1 AND
  Sessions.SessionId = Position.SessionId AND
  Networkinfo.NetworkId=(Select Max(tech_2.NetworkId) From NetworkInfo tech_2
    Where tech_2.FileId=Position.FileID and tech_2.MsgTime<Position.msgtime) AND
  ASideLocation Like '%GSM'`,
  },
  // ── LQ Stats ──
 
  {
    label: "Low MOS Sessions (1/3)",
    category: "LQ Stats",
    sql: `WITH TempCTE AS (
  SELECT
    FileList.CollectionName AS CollectionName,
    l1.sessionid AS SessionID,
    TestInfo.valid,
    FileList.ASideLocation AS ASideLocation,
    Filelist.FileId AS FileID,
    l1.TESTid AS TESTID_1, l2.TESTID AS TESTID_2, l3.TESTID AS TESTID_3,
    l1.optionalWB AS MOS_1, l2.optionalWB AS MOS_2, l3.optionalWB AS MOS_3,
    l1.QualityCode AS CODE1, l2.QualityCode AS CODE2, l3.QualityCode AS CODE3,
    l1.status AS L1status, l2.status AS L2status, l3.status AS L3status
  FROM ResultsLQ08Avg l1
    LEFT JOIN ResultsLQ08Avg l2 ON (l1.TestId + 1 = l2.TestId AND l1.sessionid = l2.SessionId)
    LEFT JOIN ResultsLQ08Avg l3 ON (l1.TestId + 2 = l3.TestId AND l1.sessionid = l3.SessionId)
    JOIN CallSession ON (CallSession.SessionId = l1.SessionID AND CallSession.callStatus = 'Completed')
    JOIN Sessions ON (CallSession.SessionId = Sessions.SessionId)
    JOIN FileList ON (FileList.FileId = Sessions.FileId)
    JOIN TestInfo ON (TestInfo.TestId = l1.TestId)
  WHERE CollectionName like '%%' AND TestInfo.valid = 1
  GROUP BY
    l1.sessionid, FileList.CollectionName, TestInfo.valid, FileList.ASideLocation, Filelist.FileId,
    l1.TESTid, l2.TESTID, l3.TESTID, l1.optionalWB, l2.optionalWB, l3.optionalWB,
    l1.QualityCode, l2.QualityCode, l3.QualityCode, l1.status, l2.status, l3.status
)
SELECT DISTINCT CollectionName, SessionID, ASideLocation
FROM TempCTE
WHERE
  ((MOS_1 < 1.29 AND MOS_1 > 1.01) OR (L1status = 'Silence' AND (CODE1 = '0001000000000000' OR CODE1 = '0000001000000000')))
  AND ((MOS_2 < 1.29 AND MOS_2 > 1.01) OR (L2status = 'Silence' AND (CODE2 = '0001000000000000' OR CODE2 = '0000001000000000')))
  OR
  ((MOS_1 < 1.29 AND MOS_1 > 1.01) OR (L1status = 'Silence' AND (CODE1 = '0001000000000000' OR CODE1 = '0000001000000000')))
  AND ((MOS_3 < 1.29 AND MOS_3 > 1.01) OR (L3status = 'Silence' AND (CODE3 = '0001000000000000' OR CODE3 = '0000001000000000')))
ORDER BY SessionID`,
  },
  {
    label: "LQ PDF Data",
    category: "LQ Stats",
    sql: `WITH SessionCTE AS (
  SELECT
    Filelist.FileID, 'CM ' + Filelist.CallingModule AS CallingModule,
    Sessions.SessionID, Networkinfo.NetworkID, Networkinfo.Operator, Networkinfo.Technology
  FROM Networkinfo, Filelist
    JOIN Sessions ON Filelist.FileID = Sessions.FileID
    JOIN Callsession ON Sessions.SessionID = Callsession.SessionID
  WHERE CollectionName like '%%' AND Sessions.Valid = 1
    AND Callsession.Callstatus NOT IN ('System Release')
    AND Callsession.VoiceCallType IN ('Intrusive')
    AND Networkinfo.NetworkId = (
      SELECT MAX(nf.NetworkId) FROM Networkinfo nf
      WHERE Filelist.FileId = nf.FileId AND Sessions.StartTime > nf.Msgtime)
  GROUP BY Filelist.FileID, Filelist.CallingModule, Sessions.SessionID,
    Networkinfo.NetworkID, Networkinfo.Operator, Networkinfo.Technology
)
SELECT
  FL.ASideLocation AS Location,
  SessionCTE.FileID, SessionCTE.CallingModule, SessionCTE.Operator,
  CASE WHEN Testinfo.direction = 'B->A' THEN 'downlink'
       WHEN Testinfo.direction = 'A->B' THEN 'uplink' ELSE '--' END AS Direction,
  SessionCTE.Technology,
  CASE WHEN vvct.CodecName IS NULL THEN 'no codec rate'
       WHEN vvct.CodecName = '-' THEN 'no codec rate' ELSE vvct.CodecName END AS CodecRate,
  'PDF' AS PDFCDF,
  ROUND(AVG(ResultsLQ08Avg.OptionalWB), 2),
  ROUND(MIN(ResultsLQ08Avg.OptionalWB), 2),
  ROUND(MAX(ResultsLQ08Avg.OptionalWB), 2),
  ROUND(STDEV(ResultsLQ08Avg.OptionalWB), 2),
  COUNT(ResultsLQ08Avg.OptionalWB) AS CountLQ
FROM SessionCTE
  JOIN Testinfo ON SessionCTE.SessionID = Testinfo.SessionId
  JOIN ResultsLQ08Avg ON Testinfo.TestId = ResultsLQ08Avg.TestId
  LEFT JOIN FileList FL ON FL.FileId = SessionCTE.FileID
  LEFT JOIN vVoiceCodecTest vvct ON Testinfo.TestID = vvct.TestID AND (
    (TestInfo.direction = 'A->B' AND vvct.Direction = 'U') OR
    (TestInfo.direction = 'B->A' AND vvct.Direction = 'D'))
WHERE Testinfo.Valid = 1 AND ResultsLQ08Avg.OptionalWB >= 1 AND ResultsLQ08Avg.OptionalWB <= 5
GROUP BY FL.ASideLocation, SessionCTE.FileID, SessionCTE.CallingModule, SessionCTE.Operator,
  Testinfo.direction, SessionCTE.Technology, vvct.CodecName`,
  },
  // ── Codec ──
  {
    label: "Call Codec Rate (Free A)",
    category: "Codec",
    sql: `WITH SessionCTE AS (
  SELECT
    Filelist.FileID, Sessions.SessionID,
    Networkinfo.NetworkID, Networkinfo.Operator, Networkinfo.Technology
  FROM Networkinfo, Filelist
    JOIN Sessions ON Filelist.FileID = Sessions.FileID
    JOIN Callsession ON Sessions.SessionID = Callsession.SessionID
  WHERE Sessions.Valid = 1
    AND Callsession.Callstatus NOT IN ('System Release')
    AND Callsession.VoiceCallType IN ('Intrusive')
    AND Networkinfo.NetworkId = (
      SELECT MAX(nf.NetworkId) FROM Networkinfo nf
      WHERE Filelist.FileId = nf.FileId AND Sessions.StartTime > nf.Msgtime)
    AND ASideLocation LIKE '%Free A%'
)
SELECT
  FileList.ASideFileName, FileList.TestDescription, FileList.CollectionName,
  FileList.CampaignName, FileList.UserName, Filelist.AsideLocation,
  Filelist.ASideDevice, Filelist.BSideDevice, Filelist.ASideNumber, FileList.BSideNumber,
  Filelist.FileID, SessionCTE.SessionID, SessionCTE.NetworkID, SessionCTE.Operator, SessionCTE.Technology,
  CASE WHEN vvct.CodecName IS NULL THEN 'no codec rate'
       WHEN vvct.CodecName = '-' THEN 'no codec rate' ELSE vvct.CodecName END AS CodecRate,
  SUM(Testinfo.duration * 0.001) AS Testduration,
  COUNT(Testinfo.testid)
FROM Filelist
  JOIN SessionCTE ON Filelist.FileID = SessionCTE.FileID
  JOIN Testinfo ON SessionCTE.SessionID = Testinfo.SessionID AND Testinfo.Valid = 1
  JOIN ResultsLQ08Avg ON Testinfo.TestId = ResultsLQ08Avg.TestId AND ResultsLq08Avg.Appl % 10 <> 0
  LEFT JOIN vVoiceCodecTest vvct ON Testinfo.TestID = vvct.TestID AND (
    (TestInfo.direction = 'A->B' AND vvct.Direction = 'U') OR
    (TestInfo.direction = 'B->A' AND vvct.Direction = 'D'))
WHERE CollectionName like '%%' AND ASideFileName IS NOT NULL
GROUP BY
  FileList.ASideFileName, FileList.TestDescription, FileList.CollectionName, FileList.CampaignName,
  FileList.UserName, FileList.AsideLocation, Filelist.ASideDevice, Filelist.BSideDevice,
  Filelist.ASideNumber, FileList.BSideNumber, Filelist.FileID, SessionCTE.SessionID,
  SessionCTE.NetworkID, SessionCTE.Operator, SessionCTE.Technology, vvct.CodecName`,
  },
  {
    label: "Call Codec Rate (GSM)",
    category: "Codec",
    sql: `WITH SessionCTE AS (
  SELECT
    Filelist.FileID, Sessions.SessionID,
    Networkinfo.NetworkID, Networkinfo.Operator, Networkinfo.Technology
  FROM Networkinfo, Filelist
    JOIN Sessions ON Filelist.FileID = Sessions.FileID
    JOIN Callsession ON Sessions.SessionID = Callsession.SessionID
  WHERE Sessions.Valid = 1
    AND Callsession.Callstatus NOT IN ('System Release')
    AND Callsession.VoiceCallType IN ('Intrusive')
    AND Networkinfo.NetworkId = (
      SELECT MAX(nf.NetworkId) FROM Networkinfo nf
      WHERE Filelist.FileId = nf.FileId AND Sessions.StartTime > nf.Msgtime)
    AND ASideLocation LIKE '%GSM'
  GROUP BY Filelist.FileID, Sessions.SessionID, Networkinfo.NetworkID, Networkinfo.Operator, Networkinfo.Technology
)
SELECT
  FileList.ASideFileName, FileList.TestDescription, FileList.CollectionName,
  FileList.CampaignName, FileList.UserName, Filelist.ASideLocation,
  Filelist.ASideDevice, Filelist.BSideDevice, Filelist.ASideNumber, FileList.BSideNumber,
  Filelist.FileID, SessionCTE.SessionID, SessionCTE.NetworkID, SessionCTE.Operator, SessionCTE.Technology,
  CASE WHEN vvct.CodecName IS NULL THEN 'no codec rate'
       WHEN vvct.CodecName = '-' THEN 'no codec rate' ELSE vvct.CodecName END AS CodecRate,
  SUM(Testinfo.duration * 0.001) AS Testduration,
  COUNT(Testinfo.testid) AS TestCount
FROM Filelist
  JOIN SessionCTE ON Filelist.FileID = SessionCTE.FileID
  JOIN Testinfo ON SessionCTE.SessionID = Testinfo.SessionID AND Testinfo.Valid = 1
  JOIN ResultsLQ08Avg ON Testinfo.TestId = ResultsLQ08Avg.TestId AND ResultsLq08Avg.Appl % 10 <> 0
  LEFT JOIN vVoiceCodecTest vvct ON Testinfo.TestID = vvct.TestID AND (
    (TestInfo.direction = 'A->B' AND vvct.Direction = 'U') OR
    (TestInfo.direction = 'B->A' AND vvct.Direction = 'D'))
WHERE CollectionName like '%%' AND ASideFileName IS NOT NULL
GROUP BY
  FileList.ASideFileName, FileList.TestDescription, FileList.CollectionName, FileList.CampaignName,
  FileList.UserName, Filelist.ASideLocation, Filelist.ASideDevice, Filelist.BSideDevice,
  Filelist.ASideNumber, FileList.BSideNumber, Filelist.FileID, SessionCTE.SessionID,
  SessionCTE.NetworkID, SessionCTE.Operator, SessionCTE.Technology, vvct.CodecName`,
  },
  // ── SRVCC ──
  {
    label: "SRVCC RAW",
    category: "SRVCC",
    sql: `SELECT DISTINCT Sessions.SessionId,
  FileList.CollectionName,
  Case When ResultsKPI.KPIId = 38040 then '4G->3G'
       When ResultsKPI.KPIId = 38050 then '4G->2G' Else 'N/A' end as 'HO',
  Case When ResultsKPI.ErrorCode = 0 then 'Success'
       When ResultsKPI.ErrorCode = 108003 then 'Fail' Else 'N/A' End as 'HO_Status',
  CallSession.CallTechnology AS 'Technology',
  ASideLocation as Operator,
  Networkinfo.Technology,
  CallSession.callDir,
  Case When Callsession.Callstatus in ('Completed','Dropped','Failed') then 1 else 0 end as 'CallAttemps',
  Case When Callsession.Callstatus in ('Failed') then 0 else 1 end as 'Callconnected',
  Case When Callsession.Callstatus in ('Completed') then 1 else 0 end as 'CallCompleted',
  Case When Callsession.Callstatus in ('Dropped') then 1 else 0 end as 'CallDropped',
  Case When Callsession.Callstatus in ('Failed') then 1 else 0 end as 'CallFailed'
FROM NetworkInfo, CallSession
  JOIN Sessions ON CallSession.SessionId = Sessions.SessionId
  JOIN FileList ON FileList.FileId = Sessions.FileId
  JOIN ResultsKPI ON CallSession.SessionId = ResultsKPI.SessionId
WHERE CollectionName like '%%' AND
  Sessions.valid = 1 AND
  callStatus IN ('Completed','Failed','Dropped') AND
  ASideLocation like '%Free A%' AND
  Networkinfo.NetworkId=(Select max(nf.NetworkId) From Networkinfo nf Where Filelist.FileId = nf.FileId And Sessions.StartTime > nf.Msgtime)
  AND ResultsKPI.KPIId IN (38040, 38050)
GROUP BY
  FileList.CollectionName, CallSession.SessionId, CallSession.CallTechnology, CallSession.callDir,
  Networkinfo.Technology, callStatus, ASideLocation, Sessions.SessionId,
  ResultsKPI.KPIId, ResultsKPI.ErrorCode
ORDER BY ASideLocation`,
  },
  // ── Events ──
  {
    label: "Event List (Valid)",
    category: "Events",
    sql: `SELECT
  dbo.FileList.CollectionName,
  dbo.FileList.ASideLocation AS ASideLocation,
  dbo.FileList.TaskName,
  dbo.FileList.FileId,
  dbo.Sessions.SessionId,
  dbo.Sessions.startTime,
  dbo.Sessions.sessionType,
  dbo.CallAnalysis.callType,
  dbo.CallAnalysis.callDir,
  dbo.CallAnalysis.callStatus,
  dbo.AnalysisComment.Comment AS UserComment,
  dbo.CallAnalysis.codeDescription AS DiversityComment,
  dbo.FileList.ASideFileName,
  dbo.FileList.BSideFileName,
  dbo.Sessions.valid as SessionValidity
FROM dbo.Sessions
  INNER JOIN dbo.CallAnalysis ON dbo.Sessions.SessionId = dbo.CallAnalysis.SessionId
  INNER JOIN dbo.AnalysisCommentSessionsBridge ON dbo.AnalysisCommentSessionsBridge.sessionID = dbo.Sessions.SessionId
  INNER JOIN dbo.AnalysisComment ON dbo.AnalysisCommentSessionsBridge.commentId = dbo.AnalysisComment.commentID
  INNER JOIN dbo.FileList ON dbo.FileList.FileId = dbo.Sessions.FileId
WHERE CollectionName like '%%' AND
  dbo.Sessions.sessionType = 'CALL' AND
  dbo.Sessions.valid = '1'`,
  },
  {
    label: "Event List (Invalid/Fake)",
    category: "Events",
    sql: `SELECT
  dbo.FileList.CollectionName,
  dbo.FileList.ASideLocation AS ASideLocation,
  dbo.FileList.TaskName,
  dbo.FileList.FileId,
  dbo.Sessions.SessionId,
  dbo.Sessions.startTime,
  dbo.Sessions.sessionType,
  dbo.CallAnalysis.callType,
  dbo.CallAnalysis.callDir,
  dbo.CallAnalysis.callStatus,
  dbo.AnalysisComment.Comment AS UserComment,
  dbo.CallAnalysis.codeDescription AS DiversityComment,
  dbo.FileList.ASideFileName,
  dbo.FileList.BSideFileName,
  dbo.Sessions.valid as SessionValidity
FROM dbo.Sessions
  INNER JOIN dbo.CallAnalysis ON dbo.Sessions.SessionId = dbo.CallAnalysis.SessionId
  INNER JOIN dbo.AnalysisCommentSessionsBridge ON dbo.AnalysisCommentSessionsBridge.sessionID = dbo.Sessions.SessionId
  INNER JOIN dbo.AnalysisComment ON dbo.AnalysisCommentSessionsBridge.commentId = dbo.AnalysisComment.commentID
  INNER JOIN dbo.FileList ON dbo.FileList.FileId = dbo.Sessions.FileId
WHERE CollectionName like '%%' AND
  dbo.Sessions.sessionType = 'CALL' AND
  dbo.Sessions.valid = '0'`,
  },
//   // ── Cell ID ──
//   {
//     label: "Cell ID — Cosmote Free A",
//     category: "Cell ID",
//     sql: `SELECT
//   NetworkInfo.CID, NetworkInfo.LAC, NetworkInfo.MCC, NetworkInfo.MNC,
//   NetworkInfo.CGI, NetworkInfo.CGI2, NetworkInfo.CGI3, NetworkInfo.Technology,
//   NetworkInfo.BCCH as NI_BCCH, NetworkInfo.SC1 as NI_SC1, NetworkInfo.SC2 as NI_SC2, NetworkInfo.SC3 as NI_SC3,
//   vBTSList.BTSName, vBTSList.CellName as BTSCellName, vBTSList.Direction as BTSDirection,
//   vBTSList.BCCH as BTSBCCH, vBTSList.BSIC as BTSBSIC,
//   Position.Latitude, Position.Longitude, Position.PosId, Position.Level as FloorPlanLevel,
//   dbo.GetFloorPlanId(FileList.FileId, Position.FloorPlanId) as FloorPlanId,
//   Position.Direction + 90 - 360 * FLOOR(((Position.Direction + 90) / 360)) as PositionDirection,
//   Sessions.FileId, Sessions.SessionId, FileList.CallingModule, FileList.ASideDevice,
//   FileList.ASideLocation, FileList.Zone, FileList.CollectionName,
//   SubString(FileList.ASideFileName, 1, 41) as Logname,
//   NULL as IndoorMap, NetworkInfo.NetworkId, NetworkInfo.MsgTime
// FROM Sessions as Sessions, Position, FileList,
//   NetworkIdRelation nr1, NetworkIdRelation nr2,
//   NetworkInfo
//   LEFT JOIN vBTSList ON vBTSList.CGI = NetworkInfo.CGI
//   LEFT JOIN vBTSList as bts2 ON bts2.CGI = NetworkInfo.CGI2
//   LEFT JOIN vBTSList as bts3 ON bts3.CGI = NetworkInfo.CGI3
// WHERE CollectionName like '%%' AND
//   Sessions.FileId = FileList.FileId AND Sessions.Valid = 1 AND
//   Sessions.SessionId = Position.SessionId AND FileList.FileId = NetworkInfo.FileId AND
//   NetworkInfo.FileId = Position.FileId AND
//   (NetworkInfo.NetworkId = nr1.NetworkId and Position.PosId > nr1.PosId) AND
//   (NetworkInfo.NetworkId + 1 = nr2.NetworkId and Position.PosId <= nr2.PosId) AND
//   nr2.type = 'NetworkId' AND nr1.type = 'NetworkId' AND NetworkInfo.CId > 0 AND
//   ASideLocation = 'Cosmote Free A'`,
//   },
//   {
//     label: "Cell ID — Cosmote GSM",
//     category: "Cell ID",
//     sql: `SELECT
//   NetworkInfo.CID, NetworkInfo.LAC, NetworkInfo.MCC, NetworkInfo.MNC,
//   NetworkInfo.CGI, NetworkInfo.CGI2, NetworkInfo.CGI3, NetworkInfo.Technology,
//   NetworkInfo.BCCH as NI_BCCH, NetworkInfo.SC1 as NI_SC1, NetworkInfo.SC2 as NI_SC2, NetworkInfo.SC3 as NI_SC3,
//   vBTSList.BTSName, vBTSList.CellName as BTSCellName, vBTSList.Direction as BTSDirection,
//   vBTSList.BCCH as BTSBCCH, vBTSList.BSIC as BTSBSIC,
//   Position.Latitude, Position.Longitude, Position.PosId, Position.Level as FloorPlanLevel,
//   dbo.GetFloorPlanId(FileList.FileId, Position.FloorPlanId) as FloorPlanId,
//   Position.Direction + 90 - 360 * FLOOR(((Position.Direction + 90) / 360)) as PositionDirection,
//   Sessions.FileId, Sessions.SessionId, FileList.CallingModule, FileList.ASideDevice,
//   FileList.ASideLocation, FileList.Zone, FileList.CollectionName,
//   SubString(FileList.ASideFileName, 1, 41) as Logname,
//   NULL as IndoorMap, NetworkInfo.NetworkId, NetworkInfo.MsgTime
// FROM Sessions as Sessions, Position, FileList,
//   NetworkIdRelation nr1, NetworkIdRelation nr2,
//   NetworkInfo
//   LEFT JOIN vBTSList ON vBTSList.CGI = NetworkInfo.CGI
//   LEFT JOIN vBTSList as bts2 ON bts2.CGI = NetworkInfo.CGI2
//   LEFT JOIN vBTSList as bts3 ON bts3.CGI = NetworkInfo.CGI3
// WHERE CollectionName like '%%' AND
//   Sessions.FileId = FileList.FileId AND Sessions.Valid = 1 AND
//   Sessions.SessionId = Position.SessionId AND FileList.FileId = NetworkInfo.FileId AND
//   NetworkInfo.FileId = Position.FileId AND
//   (NetworkInfo.NetworkId = nr1.NetworkId and Position.PosId > nr1.PosId) AND
//   (NetworkInfo.NetworkId + 1 = nr2.NetworkId and Position.PosId <= nr2.PosId) AND
//   nr2.type = 'NetworkId' AND nr1.type = 'NetworkId' AND NetworkInfo.CId > 0 AND
//   ASideLocation = 'Cosmote GSM'`,
//   },
//   {
//     label: "Cell ID — Vodafone Free A",
//     category: "Cell ID",
//     sql: `SELECT
//   NetworkInfo.CID, NetworkInfo.LAC, NetworkInfo.MCC, NetworkInfo.MNC,
//   NetworkInfo.CGI, NetworkInfo.CGI2, NetworkInfo.CGI3, NetworkInfo.Technology,
//   NetworkInfo.BCCH as NI_BCCH, NetworkInfo.SC1 as NI_SC1, NetworkInfo.SC2 as NI_SC2, NetworkInfo.SC3 as NI_SC3,
//   vBTSList.BTSName, vBTSList.CellName as BTSCellName, vBTSList.Direction as BTSDirection,
//   vBTSList.BCCH as BTSBCCH, vBTSList.BSIC as BTSBSIC,
//   Position.Latitude, Position.Longitude, Position.PosId, Position.Level as FloorPlanLevel,
//   dbo.GetFloorPlanId(FileList.FileId, Position.FloorPlanId) as FloorPlanId,
//   Position.Direction + 90 - 360 * FLOOR(((Position.Direction + 90) / 360)) as PositionDirection,
//   Sessions.FileId, Sessions.SessionId, FileList.CallingModule, FileList.ASideDevice,
//   FileList.ASideLocation, FileList.Zone, FileList.CollectionName,
//   SubString(FileList.ASideFileName, 1, 41) as Logname,
//   NULL as IndoorMap, NetworkInfo.NetworkId, NetworkInfo.MsgTime
// FROM Sessions as Sessions, Position, FileList,
//   NetworkIdRelation nr1, NetworkIdRelation nr2,
//   NetworkInfo
//   LEFT JOIN vBTSList ON vBTSList.CGI = NetworkInfo.CGI
//   LEFT JOIN vBTSList as bts2 ON bts2.CGI = NetworkInfo.CGI2
//   LEFT JOIN vBTSList as bts3 ON bts3.CGI = NetworkInfo.CGI3
// WHERE CollectionName like '%%' AND
//   Sessions.FileId = FileList.FileId AND Sessions.Valid = 1 AND
//   Sessions.SessionId = Position.SessionId AND FileList.FileId = NetworkInfo.FileId AND
//   NetworkInfo.FileId = Position.FileId AND
//   (NetworkInfo.NetworkId = nr1.NetworkId and Position.PosId > nr1.PosId) AND
//   (NetworkInfo.NetworkId + 1 = nr2.NetworkId and Position.PosId <= nr2.PosId) AND
//   nr2.type = 'NetworkId' AND nr1.type = 'NetworkId' AND NetworkInfo.CId > 0 AND
//   ASideLocation = 'Vodafone Free A'`,
//   },
//   {
//     label: "Cell ID — Vodafone GSM",
//     category: "Cell ID",
//     sql: `SELECT
//   NetworkInfo.CID, NetworkInfo.LAC, NetworkInfo.MCC, NetworkInfo.MNC,
//   NetworkInfo.CGI, NetworkInfo.CGI2, NetworkInfo.CGI3, NetworkInfo.Technology,
//   NetworkInfo.BCCH as NI_BCCH, NetworkInfo.SC1 as NI_SC1, NetworkInfo.SC2 as NI_SC2, NetworkInfo.SC3 as NI_SC3,
//   vBTSList.BTSName, vBTSList.CellName as BTSCellName, vBTSList.Direction as BTSDirection,
//   vBTSList.BCCH as BTSBCCH, vBTSList.BSIC as BTSBSIC,
//   Position.Latitude, Position.Longitude, Position.PosId, Position.Level as FloorPlanLevel,
//   dbo.GetFloorPlanId(FileList.FileId, Position.FloorPlanId) as FloorPlanId,
//   Position.Direction + 90 - 360 * FLOOR(((Position.Direction + 90) / 360)) as PositionDirection,
//   Sessions.FileId, Sessions.SessionId, FileList.CallingModule, FileList.ASideDevice,
//   FileList.ASideLocation, FileList.Zone, FileList.CollectionName,
//   SubString(FileList.ASideFileName, 1, 41) as Logname,
//   NULL as IndoorMap, NetworkInfo.NetworkId, NetworkInfo.MsgTime
// FROM Sessions as Sessions, Position, FileList,
//   NetworkIdRelation nr1, NetworkIdRelation nr2,
//   NetworkInfo
//   LEFT JOIN vBTSList ON vBTSList.CGI = NetworkInfo.CGI
//   LEFT JOIN vBTSList as bts2 ON bts2.CGI = NetworkInfo.CGI2
//   LEFT JOIN vBTSList as bts3 ON bts3.CGI = NetworkInfo.CGI3
// WHERE CollectionName like '%%' AND
//   Sessions.FileId = FileList.FileId AND Sessions.Valid = 1 AND
//   Sessions.SessionId = Position.SessionId AND FileList.FileId = NetworkInfo.FileId AND
//   NetworkInfo.FileId = Position.FileId AND
//   (NetworkInfo.NetworkId = nr1.NetworkId and Position.PosId > nr1.PosId) AND
//   (NetworkInfo.NetworkId + 1 = nr2.NetworkId and Position.PosId <= nr2.PosId) AND
//   nr2.type = 'NetworkId' AND nr1.type = 'NetworkId' AND NetworkInfo.CId > 0 AND
//   ASideLocation = 'Vodafone GSM'`,
//   },
//   {
//     label: "Cell ID — Nova Free A",
//     category: "Cell ID",
//     sql: `SELECT
//   NetworkInfo.CID, NetworkInfo.LAC, NetworkInfo.MCC, NetworkInfo.MNC,
//   NetworkInfo.CGI, NetworkInfo.CGI2, NetworkInfo.CGI3, NetworkInfo.Technology,
//   NetworkInfo.BCCH as NI_BCCH, NetworkInfo.SC1 as NI_SC1, NetworkInfo.SC2 as NI_SC2, NetworkInfo.SC3 as NI_SC3,
//   vBTSList.BTSName, vBTSList.CellName as BTSCellName, vBTSList.Direction as BTSDirection,
//   vBTSList.BCCH as BTSBCCH, vBTSList.BSIC as BTSBSIC,
//   Position.Latitude, Position.Longitude, Position.PosId, Position.Level as FloorPlanLevel,
//   dbo.GetFloorPlanId(FileList.FileId, Position.FloorPlanId) as FloorPlanId,
//   Position.Direction + 90 - 360 * FLOOR(((Position.Direction + 90) / 360)) as PositionDirection,
//   Sessions.FileId, Sessions.SessionId, FileList.CallingModule, FileList.ASideDevice,
//   FileList.ASideLocation, FileList.Zone, FileList.CollectionName,
//   SubString(FileList.ASideFileName, 1, 41) as Logname,
//   NULL as IndoorMap, NetworkInfo.NetworkId, NetworkInfo.MsgTime
// FROM Sessions as Sessions, Position, FileList,
//   NetworkIdRelation nr1, NetworkIdRelation nr2,
//   NetworkInfo
//   LEFT JOIN vBTSList ON vBTSList.CGI = NetworkInfo.CGI
//   LEFT JOIN vBTSList as bts2 ON bts2.CGI = NetworkInfo.CGI2
//   LEFT JOIN vBTSList as bts3 ON bts3.CGI = NetworkInfo.CGI3
// WHERE CollectionName like '%%' AND
//   Sessions.FileId = FileList.FileId AND Sessions.Valid = 1 AND
//   Sessions.SessionId = Position.SessionId AND FileList.FileId = NetworkInfo.FileId AND
//   NetworkInfo.FileId = Position.FileId AND
//   (NetworkInfo.NetworkId = nr1.NetworkId and Position.PosId > nr1.PosId) AND
//   (NetworkInfo.NetworkId + 1 = nr2.NetworkId and Position.PosId <= nr2.PosId) AND
//   nr2.type = 'NetworkId' AND nr1.type = 'NetworkId' AND NetworkInfo.CId > 0 AND
//   ASideLocation = 'Nova Free A'`,
//   },
//   {
//     label: "Cell ID — Nova GSM",
//     category: "Cell ID",
//     sql: `SELECT
//   NetworkInfo.CID, NetworkInfo.LAC, NetworkInfo.MCC, NetworkInfo.MNC,
//   NetworkInfo.CGI, NetworkInfo.CGI2, NetworkInfo.CGI3, NetworkInfo.Technology,
//   NetworkInfo.BCCH as NI_BCCH, NetworkInfo.SC1 as NI_SC1, NetworkInfo.SC2 as NI_SC2, NetworkInfo.SC3 as NI_SC3,
//   vBTSList.BTSName, vBTSList.CellName as BTSCellName, vBTSList.Direction as BTSDirection,
//   vBTSList.BCCH as BTSBCCH, vBTSList.BSIC as BTSBSIC,
//   Position.Latitude, Position.Longitude, Position.PosId, Position.Level as FloorPlanLevel,
//   dbo.GetFloorPlanId(FileList.FileId, Position.FloorPlanId) as FloorPlanId,
//   Position.Direction + 90 - 360 * FLOOR(((Position.Direction + 90) / 360)) as PositionDirection,
//   Sessions.FileId, Sessions.SessionId, FileList.CallingModule, FileList.ASideDevice,
//   FileList.ASideLocation, FileList.Zone, FileList.CollectionName,
//   SubString(FileList.ASideFileName, 1, 41) as Logname,
//   NULL as IndoorMap, NetworkInfo.NetworkId, NetworkInfo.MsgTime
// FROM Sessions as Sessions, Position, FileList,
//   NetworkIdRelation nr1, NetworkIdRelation nr2,
//   NetworkInfo
//   LEFT JOIN vBTSList ON vBTSList.CGI = NetworkInfo.CGI
//   LEFT JOIN vBTSList as bts2 ON bts2.CGI = NetworkInfo.CGI2
//   LEFT JOIN vBTSList as bts3 ON bts3.CGI = NetworkInfo.CGI3
// WHERE CollectionName like '%%' AND
//   Sessions.FileId = FileList.FileId AND Sessions.Valid = 1 AND
//   Sessions.SessionId = Position.SessionId AND FileList.FileId = NetworkInfo.FileId AND
//   NetworkInfo.FileId = Position.FileId AND
//   (NetworkInfo.NetworkId = nr1.NetworkId and Position.PosId > nr1.PosId) AND
//   (NetworkInfo.NetworkId + 1 = nr2.NetworkId and Position.PosId <= nr2.PosId) AND
//   nr2.type = 'NetworkId' AND nr1.type = 'NetworkId' AND NetworkInfo.CId > 0 AND
//   ASideLocation = 'Nova GSM'`,
//   },
  // ── Data Tests ──
  {
    label: "Capacity RAW",
    category: "Data Tests",
    sql: `SELECT
  FileList.ASideFileName AS 'A Side File Name',
  FileList.CollectionName AS 'Collection Name',
  FileList.CampaignName AS 'Campaign Name',
  FileList.CallingModule AS 'Calling Module',
  FileList.UserName AS 'User Name',
  FileList.ASideDevice AS 'A Device',
  FileList.ASideLocation AS 'A Side Location',
  DataSession.JobName AS 'Job Name',
  TestInfo.TestName AS 'Test Name',
  convert(varchar,TestInfo.StartTime,104) as 'Date',
  convert(varchar,TestInfo.StartTime,108) as 'Time',
  NetworkInfo.Technology,
  Sessions.SessionId AS 'Session ID',
  TestInfo.TestId AS 'Test ID',
  Case when capa.ErrorCode = 0 and para.Direction like '%get%' and capa.ThroughputGet <> 0
    then convert(float,capa.ThroughputGet)*0.008 else NULL end as 'DLThrptkbps',
  Case when capa.ErrorCode = 0 and para.Direction like '%put%' and capa.ThroughputPut <> 0
    then convert(float,capa.ThroughputPut)*0.008 else NULL end as 'ULThrptkbps',
  Case capa.duration when 0 then null else capa.duration*0.001 end as 'Duration',
  Case when para.Direction like '%get%' then capa.bytesTransferredget*0.001 else NULL end as 'DLTranskbyte',
  Case when para.Direction like '%put%' then capa.bytesTransferredput*0.001 else NULL end as 'ULTranskbyte',
  Case when para.Direction like 'get' then 'Downlink'
       when para.Direction like 'put' then 'Uplink'
       when para.Direction like 'getandput' then 'Downlink/Uplink' else '--' end as 'Direction',
  para.URICount As 'Number of URIs',
  para.Protocol As 'Protocol',
  capa.ErrorCode AS 'Error Code',
  Errorcodes.msg AS 'Error msg',
  Case When capa.ErrorCode=0 Then 'successful' Else 'failed' End as 'Error Status',
  Case When capa.ErrorCode=0 Then 1 Else 0 End as 'Complete',
  Case When capa.ErrorCode<>0 Then 1 Else 0 End as 'Failed',
  Technology.summary AS 'all Technologies',
  AccessPoints.Name AS 'AP Name', AccessPoints.APN AS 'AP APN'
FROM Sessions
  Join FileList On(Sessions.FileId=FileList.FileId)
  Join DataSession On(Sessions.SessionId=DataSession.SessionId)
  Join TestInfo On(Sessions.SessionId=TestInfo.SessionId)
  Join NetworkInfo On(TestInfo.NetworkId=NetworkInfo.NetworkId)
  Join ResultsCapacityTest capa On(TestInfo.TestId=capa.TestId)
  Join ResultsCapacityTestParameters para On(capa.TestId=para.TestId)
  Join ErrorCodes On(capa.errorcode=ErrorCodes.Code)
  Left Join AccessPoints On(TestInfo.TestId=AccessPoints.TestId)
  Join Technology On(Testinfo.Testid=Technology.Testid and Technology.TriggerMsg like '%test end%')
WHERE CollectionName like '%%' AND Sessions.Valid=1 AND TestInfo.Valid=1 AND capa.lastblock=1`,
  },
  {
    label: "HTTPS Transfer RAW",
    category: "Data Tests",
    sql: `SELECT
  FileList.ASideFileName as 'A Side File Name',
  FileList.CollectionName As 'Collection Name',
  FileList.ASideLocation As 'A Side Location',
  DataSession.JobName As 'Job Name',
  TestInfo.TestName As 'Test Name',
  convert(varchar,TestInfo.StartTime,104) as 'Date',
  convert(varchar,TestInfo.StartTime,108) as 'Time',
  NetworkInfo.Technology,
  Sessions.SessionId As 'Session ID',
  TestInfo.TestId As 'Test ID',
  case when http.ErrorCode = 0 then convert(float,http.Throughput)*0.008 else NULL end as 'Throughput',
  case when http.ErrorCode = 0 then http.duration*0.001 else NULL end as Duration,
  http.bytesTransferred*0.001 As 'bytes transferred',
  Case when para.operation ='get' then 'Downlink'
       when para.operation ='put' then 'Uplink' else '--' end as Direction,
  para.host As 'Host',
  http.ErrorCode As 'Error Code',
  Errorcodes.msg As 'Error msg',
  Case When http.ErrorCode = 0 Then 'successful' Else 'failed' End as 'Error Status',
  Case When http.ErrorCode = 0 Then 1 Else 0 End as 'Complete',
  Case When http.ErrorCode <>0 Then 1 Else 0 End as 'Failed',
  Technology.summary As 'all Technologies'
FROM Sessions
  Join FileList On(Sessions.FileId=FileList.FileId)
  Join DataSession On(Sessions.SessionId=DataSession.SessionId)
  Join TestInfo On(Sessions.SessionId=TestInfo.SessionId)
  Join NetworkInfo On(TestInfo.NetworkId=NetworkInfo.NetworkId)
  Join ResultsHTTPTransferTest http On(TestInfo.TestId=http.TestId)
  Join ResultsHTTPTransferParameters para On(http.TestId=para.TestId)
  Join ErrorCodes On(http.errorcode=ErrorCodes.Code)
  Join Technology On(Testinfo.Testid=Technology.Testid and Technology.TriggerMsg like '%test end%')
WHERE CollectionName like '%%' AND Sessions.Valid=1 AND TestInfo.Valid=1 AND http.lastblock=1`,
  },
  {
    label: "Data Technology RAW",
    category: "Data Tests",
    sql: `SELECT
  NetworkInfo.CID, NetworkInfo.LAC, NetworkInfo.MCC, NetworkInfo.MNC,
  NetworkInfo.CGI, NetworkInfo.Technology,
  Sessions.FileId, Sessions.SessionId,
  FileList.ASideDevice, FileList.ASideLocation, FileList.CollectionName,
  SubString(FileList.ASideFileName, 1, 41) as Logname,
  Networkinfo.NetworkId,
  Position.SessionId, Position.TestId, Position.MsgTime,
  Technology.CurrTechnology
FROM Sessions as Sessions, Position, FileList, Technology, TestInfo,
  NetworkInfo
  LEFT JOIN vBTSList ON vBTSList.CGI = NetworkInfo.CGI
  LEFT JOIN vBTSList as bts2 ON bts2.CGI = NetworkInfo.CGI2
  LEFT JOIN vBTSList as bts3 ON bts3.CGI = NetworkInfo.CGI3
WHERE CollectionName like '%%' AND
  Sessions.FileId = FileList.FileId AND Sessions.Valid = 1 AND TestInfo.Valid = 1 AND
  Sessions.FileId = FileList.FileId AND
  Sessions.SessionId = TestInfo.SessionId AND
  TestInfo.TestId = Position.TestId AND
  TestInfo.TestName in ('Capacity DL','FTP DL','HTTP TRANSFER (DL)') AND
  TestInfo.NetworkId = NetworkInfo.NetworkId AND
  Technology.SessionId = Sessions.SessionId AND
  Technology.MsgTime=(Select Max(tech_2.MsgTime) From Technology tech_2
    Where tech_2.TestId=Position.TestID and tech_2.MsgTime<Position.msgtime and tech_2.CurrTechnology is not null)`,
  },
  {
    label: "Ping RAW",
    category: "Data Tests",
    sql: `SELECT
  FileList.ASideFileName,
  FileList.TestDescription,
  FileList.CollectionName,
  FileList.ASideDevice as 'A Device',
  Sessions.SessionId,
  TestInfo.TestId,
  NetworkInfo.Cid, NetworkInfo.LAC,
  FileList.ASideLocation,
  ResultsPingTest.Host,
  case when (ResultsPingTest.ErrorCode=0) then ResultsPingTest.RTT else NULL end as RTT,
  ResultsPingTest.PacketSize,
  ErrorCodes.msg As ErrorCode,
  case when (ResultsPingTest.ErrorCode=0) then 1 else 0 end as Success,
  case when (ResultsPingTest.ErrorCode=0) then 0 else 1 end as Failed,
  ResultsPingTest.seqNumber as 'Sequence Number'
FROM FileList, Sessions, TestInfo, NetworkInfo, ResultsPingTest, ErrorCodes
WHERE CollectionName like '%%' AND Sessions.Valid = 1 AND TestInfo.Valid = 1 AND
  FileList.FileId = Sessions.FileId AND
  TestInfo.SessionId = Sessions.SessionId AND
  ResultsPingTest.TestId = TestInfo.TestId AND
  ResultsPingTest.ErrorCode = ErrorCodes.Code AND
  TestInfo.NetworkId = NetworkInfo.NetworkId`,
  },
  {
    label: "DNS RAW",
    category: "Data Tests",
    sql: `SELECT
  FileList.ASideLocation,
  KPIStatus AS 'Status',
  COUNT(KPIStatus) AS 'Num',
  Round(AVG(Convert(float, vResultsKPI.Duration)) * COUNT(vResultsKPI.Duration), 3) AS 'Avg',
  Round(MIN(Convert(float, vResultsKPI.Duration)), 3) AS 'MinVal',
  Round(MAX(Convert(float, vResultsKPI.Duration)), 3) AS 'MaxVal',
  Round(STDEV(Convert(float, vResultsKPI.Duration)), 3) AS 'StdVal'
FROM Sessions
  JOIN FileList ON FileList.FileId = Sessions.FileId
  JOIN vResultsKPI ON vResultsKPI.SessionId = Sessions.SessionId AND vResultsKPI.KPIID = 31100
WHERE CollectionName like '%%' AND Sessions.Valid = 1 AND ASideLocation LIKE '%Data'
GROUP BY FileList.ASideLocation, KPIStatus`,
  },
  {
    label: "Interactivity RAW",
    category: "Data Tests",
    sql: `SELECT
  TestInfo.TestId,
  Sessions.SessionId,
  HomeOperator,
  FileList.ASideLocation,
  FileList.CollectionName,
  technology,
  CASE WHEN ErrorCode = 0 THEN 'Successful' ELSE 'Failed' END AS ErrorCode,
  PatternName,
  Connectivity,
  PacketsSent, PacketsNotSent, PacketsLost, PacketsLostRate,
  Throughput, ThroughputKbps,
  RTT10thPercentile,
  RTTMedian as RTTAverage,
  PacketDelayVarMedian as PacketDelayMedian,
  TestInfo.duration as Duration,
  qualityIndication as QualityIndex,
  FactInteractivity.QoEScore
FROM Sessions
  INNER JOIN NetworkInfo ON NetworkInfo.NetworkId = Sessions.NetworkId
  INNER JOIN FactInteractivity ON FactInteractivity.SessionId = Sessions.SessionId
  INNER JOIN Testinfo ON TestInfo.TestId = FactInteractivity.TestId AND TestInfo.Valid = 1
  INNER JOIN FileList ON FileList.FileId = Sessions.FileId
  INNER JOIN DmnInteractivity ON DmnInteractivity.DmnId = FactInteractivity.DmnIdInteractivity
WHERE CollectionName like '%%' AND Sessions.Valid = 1`,
  },
  {
    label: "OOKLA Speed Test DL",
    category: "Data Tests",
    sql: `WITH SessionsCTE AS (
  SELECT SessionId, FileId, info FROM Sessions WHERE valid = 1
  GROUP BY SessionId, FileId, info
)
SELECT
  ti.SessionId,
  ti.TestId,
  fl.CollectionName,
  fl.ASideDevice,
  fl.ASideFileName,
  fl.ASideNumber,
  s.info AS Session_Info,
  ti.TestName,
  ti.TypeOfTest,
  fl.ASideLocation,
  ni.HomeOperator,
  ni.Technology,
  t.PrevTechnology as 'Data_Technology',
  aaf.dir AS Direction,
  CONVERT(VARCHAR, COALESCE(aa.MsgTime, aaf.MsgTime), 121) AS EndTime,
  atp.ServiceProvider AS App,
  atp.ServiceProfileName AS ProfileName,
  COALESCE(aa.ActionId, aaf.ActionId) AS ActionId,
  COALESCE(aa.Duration, aaf.Duration) AS 'Duration[ms]',
  CASE aaf.thp WHEN 0 THEN NULL ELSE aaf.thp END AS 'Throughput[Mbps]',
  CASE COALESCE(aa.ErrorCode, aaf.ErrorCode) WHEN 0 THEN 'Success' ELSE 'Failed' END AS ActionStatus,
  aaf.Latency AS 'Latency[ms]',
  aaf.PacketLossPercent AS 'PacketLoss[%]',
  ni.CGI,
  DATEADD(MS, -1 * COALESCE(aa.Duration, aaf.Duration),
    COALESCE(aa.MsgTime, aaf.MsgTime)) AS StartTime
FROM SessionsCTE s
  INNER JOIN FileList fl ON fl.FileId = s.FileId
  INNER JOIN TestInfo ti ON s.SessionId = ti.SessionId AND ti.Valid = 1
  INNER JOIN ResultsAppTestParameters atp ON ti.TestId = atp.TestId
  LEFT JOIN ResultsAppAction aa ON ti.TestId = aa.TestId AND aa.LastBlock = 1
  LEFT JOIN (
    SELECT 'DL' AS dir, raap.TestId, raap.ActionId, raap.MsgTime, raap.ErrorCode, raap.NetworkId,
           CAST(raap.DLThroughput AS FLOAT) * 8.0 / 1000000.0              AS thp,
           CAST(ISNULL(raap.Ping, raap.Latency) AS FLOAT) / 1000.0         AS ping_s,
           1000 * CAST(raap.DLSize AS REAL) / NULLIF(raap.DLThroughput, 0) AS Duration,
           ISNULL(raap.Ping, raap.Latency)                                  AS Latency,
           raap.PacketLossPercent
    FROM ResultsAppActionPerformance raap
    UNION ALL
    SELECT 'UL', raap.TestId, raap.ActionId, raap.MsgTime, raap.ErrorCode, raap.NetworkId,
           CAST(raap.ULThroughput AS FLOAT) * 8.0 / 1000000.0,
           CAST(ISNULL(raap.Ping, raap.Latency) AS FLOAT) / 1000.0,
           1000 * CAST(raap.ULSize AS REAL) / NULLIF(raap.ULThroughput, 0),
           ISNULL(raap.Ping, raap.Latency),
           raap.PacketLossPercent
    FROM ResultsAppActionPerformance raap
  ) aaf ON ti.TestId = aaf.TestId
  INNER JOIN NetworkInfo ni ON ni.NetworkId = ISNULL(ISNULL(aa.NetworkId, aaf.NetworkId), ti.NetworkId)
  LEFT JOIN Technology t ON t.PrevTechnology IS NOT NULL AND (
    (t.TestId = aaf.TestId AND aaf.MsgTime BETWEEN DATEADD(ms, -1 * t.Duration, t.MsgTime) AND t.MsgTime) OR
    (t.TestId = aa.TestId  AND aa.MsgTime  BETWEEN DATEADD(ms, -1 * t.Duration, t.MsgTime) AND t.MsgTime))
WHERE CollectionName like '%%' AND s.SessionId IS NOT NULL AND aaf.dir = 'DL'
ORDER BY ti.TestId, ISNULL(aa.ActionId, aaf.ActionId)`,
  },
  {
    label: "OOKLA Speed Test UL",
    category: "Data Tests",
    sql: `WITH SessionsCTE AS (
  SELECT SessionId, FileId, info FROM Sessions WHERE valid = 1
  GROUP BY SessionId, FileId, info
)
SELECT
  ti.SessionId,
  ti.TestId,
  fl.CollectionName,
  fl.ASideDevice,
  fl.ASideFileName,
  fl.ASideNumber,
  s.info AS Session_Info,
  ti.TestName,
  ti.TypeOfTest,
  fl.ASideLocation,
  ni.HomeOperator,
  ni.Technology,
  t.PrevTechnology as 'Data_Technology',
  aaf.dir AS Direction,
  CONVERT(VARCHAR, COALESCE(aa.MsgTime, aaf.MsgTime), 121) AS EndTime,
  atp.ServiceProvider AS App,
  atp.ServiceProfileName AS ProfileName,
  COALESCE(aa.ActionId, aaf.ActionId) AS ActionId,
  COALESCE(aa.Duration, aaf.Duration) AS 'Duration[ms]',
  CASE aaf.thp WHEN 0 THEN NULL ELSE aaf.thp END AS 'Throughput[Mbps]',
  CASE COALESCE(aa.ErrorCode, aaf.ErrorCode) WHEN 0 THEN 'Success' ELSE 'Failed' END AS ActionStatus,
  aaf.Latency AS 'Latency[ms]',
  aaf.PacketLossPercent AS 'PacketLoss[%]',
  ni.CGI,
  DATEADD(MS, -1 * COALESCE(aa.Duration, aaf.Duration),
    COALESCE(aa.MsgTime, aaf.MsgTime)) AS StartTime
FROM SessionsCTE s
  INNER JOIN FileList fl ON fl.FileId = s.FileId
  INNER JOIN TestInfo ti ON s.SessionId = ti.SessionId AND ti.Valid = 1
  INNER JOIN ResultsAppTestParameters atp ON ti.TestId = atp.TestId
  LEFT JOIN ResultsAppAction aa ON ti.TestId = aa.TestId AND aa.LastBlock = 1
  LEFT JOIN (
    SELECT 'DL' AS dir, raap.TestId, raap.ActionId, raap.MsgTime, raap.ErrorCode, raap.NetworkId,
           CAST(raap.DLThroughput AS FLOAT) * 8.0 / 1000000.0              AS thp,
           CAST(ISNULL(raap.Ping, raap.Latency) AS FLOAT) / 1000.0         AS ping_s,
           1000 * CAST(raap.DLSize AS REAL) / NULLIF(raap.DLThroughput, 0) AS Duration,
           ISNULL(raap.Ping, raap.Latency)                                  AS Latency,
           raap.PacketLossPercent
    FROM ResultsAppActionPerformance raap
    UNION ALL
    SELECT 'UL', raap.TestId, raap.ActionId, raap.MsgTime, raap.ErrorCode, raap.NetworkId,
           CAST(raap.ULThroughput AS FLOAT) * 8.0 / 1000000.0,
           CAST(ISNULL(raap.Ping, raap.Latency) AS FLOAT) / 1000.0,
           1000 * CAST(raap.ULSize AS REAL) / NULLIF(raap.ULThroughput, 0),
           ISNULL(raap.Ping, raap.Latency),
           raap.PacketLossPercent
    FROM ResultsAppActionPerformance raap
  ) aaf ON ti.TestId = aaf.TestId
  INNER JOIN NetworkInfo ni ON ni.NetworkId = ISNULL(ISNULL(aa.NetworkId, aaf.NetworkId), ti.NetworkId)
  LEFT JOIN Technology t ON t.PrevTechnology IS NOT NULL AND (
    (t.TestId = aaf.TestId AND aaf.MsgTime BETWEEN DATEADD(ms, -1 * t.Duration, t.MsgTime) AND t.MsgTime) OR
    (t.TestId = aa.TestId  AND aa.MsgTime  BETWEEN DATEADD(ms, -1 * t.Duration, t.MsgTime) AND t.MsgTime))
WHERE CollectionName like '%%' AND s.SessionId IS NOT NULL AND aaf.dir = 'UL'
ORDER BY ti.TestId, ISNULL(aa.ActionId, aaf.ActionId)`,
  },
  // ── Browsing ──
  {
    label: "HTTP Browsing Page Load Time",
    category: "Browsing",
    sql: `SELECT
  TestInfo.testname AS 'Collection Name',
  FileList.ASideLocation,
  NetworkInfo.Operator AS 'Serving Operator',
  KPIStatus AS 'Status',
  COUNT(KPIStatus) AS 'Num',
  Round(AVG(Convert(float, vResultsKPI.Duration*0.001)) * COUNT(vResultsKPI.Duration*0.001), 3) AS 'Avg',
  Round(MIN(Convert(float, vResultsKPI.Duration*0.001)), 3) AS 'MinVal',
  Round(MAX(Convert(float, vResultsKPI.Duration*0.001)), 3) AS 'MaxVal',
  Round(STDEV(Convert(float, vResultsKPI.Duration*0.001)), 3) AS 'StdVal',
  vResultsKPI.Value5 AS 'URL'
FROM Sessions
  JOIN FileList ON FileList.FileId = Sessions.FileId
  JOIN NetworkInfo ON NetworkInfo.NetworkId = Sessions.NetworkId
  JOIN vResultsKPI ON vResultsKPI.SessionId = Sessions.SessionId AND vResultsKPI.KPIID = 10410
  JOIN Testinfo ON TestInfo.TestId = vResultsKPI.TestId AND TestInfo.Valid = 1
WHERE CollectionName like '%%' AND Sessions.Valid = 1
GROUP BY TestInfo.testname, FileList.ASideLocation, NetworkInfo.Operator, KPIStatus, Value5`,
  },
  {
    label: "HTTP Browsing Throughput",
    category: "Browsing",
    sql: `SELECT
  TestInfo.testname AS 'Collection Name',
  FileList.ASideLocation,
  NetworkInfo.Operator AS 'Serving Operator',
  KPIStatus AS 'Status',
  COUNT(KPIStatus) AS 'Num',
  Round(AVG(Convert(float, vResultsKPI.value1*8*0.001)) * COUNT(vResultsKPI.value1*8*0.001), 3) AS 'Avg',
  Round(MIN(Convert(float, vResultsKPI.value1*8*0.001)), 3) AS 'MinVal',
  Round(MAX(Convert(float, vResultsKPI.value1*8*0.001)), 3) AS 'MaxVal',
  Round(STDEV(Convert(float, vResultsKPI.value1*8*0.001)), 3) AS 'StdVal',
  vResultsKPI.Value5 AS 'URL'
FROM Sessions
  JOIN FileList ON FileList.FileId = Sessions.FileId
  JOIN NetworkInfo ON NetworkInfo.NetworkId = Sessions.NetworkId
  JOIN vResultsKPI ON vResultsKPI.SessionId = Sessions.SessionId AND vResultsKPI.KPIID = 30407
  JOIN Testinfo ON TestInfo.TestId = vResultsKPI.TestId AND TestInfo.Valid = 1
WHERE CollectionName like '%%' AND Sessions.Valid = 1
GROUP BY TestInfo.testname, FileList.ASideLocation, NetworkInfo.Operator, KPIStatus, Value5`,
  },
  {
    label: "HTTPS Browser Page Load",
    category: "Browsing",
    sql: `SELECT
  TestInfo.testname as 'Collection Name',
  FileList.ASideLocation,
  NetworkInfo.Operator as 'Serving Operator',
  KPIStatus as 'Status',
  COUNT(KPIStatus) as 'Num',
  Round(AVG(Convert(float, vResultsKPI.Duration*0.001)) * COUNT(vResultsKPI.Duration*0.001), 3) as 'Avg',
  Round(MIN(Convert(float, vResultsKPI.Duration*0.001)), 3) As 'MinVal',
  Round(MAX(Convert(float, vResultsKPI.Duration*0.001)), 3) As 'MaxVal',
  Round(STDEV(Convert(float, vResultsKPI.Duration*0.001)), 3) As 'StdVal',
  vResultsKPI.Value5 As 'URL'
FROM Sessions
  JOIN FileList ON FileList.FileId = Sessions.FileId
  JOIN NetworkInfo ON NetworkInfo.NetworkId = Sessions.NetworkId
  JOIN vResultsKPI ON vResultsKPI.SessionId = Sessions.SessionId AND vResultsKPI.KPIID = 20404
  JOIN Testinfo ON TestInfo.TestId = vResultsKPI.TestId AND TestInfo.Valid = 1
WHERE CollectionName like '%%' AND vResultsKPI.Value5 IS NOT NULL AND Sessions.Valid = 1
GROUP BY TestInfo.testname, FileList.ASideLocation, NetworkInfo.Operator, KPIStatus, Value5`,
  },
  {
    label: "HTTPS Setup Time",
    category: "Browsing",
    sql: `SELECT
  TestInfo.testname AS 'Collection Name',
  FileList.ASideLocation,
  NetworkInfo.Operator AS 'Serving Operator',
  KPIStatus as 'Status',
  COUNT(KPIStatus) AS 'Num',
  Round(AVG(Convert(float, vResultsKPI.Duration*0.001)) * COUNT(vResultsKPI.Duration*0.001), 3) AS 'cAvg',
  Round(MIN(Convert(float, vResultsKPI.Duration*0.001)), 3) AS 'MinVal',
  Round(MAX(Convert(float, vResultsKPI.Duration*0.001)), 3) AS 'MaxVal',
  Round(STDEV(Convert(float, vResultsKPI.Duration*0.001)), 3) AS 'StdVal',
  vResultsKPI.Value5 as 'URL'
FROM Sessions
  JOIN FileList ON FileList.FileId = Sessions.FileId
  JOIN NetworkInfo ON NetworkInfo.NetworkId = Sessions.NetworkId
  JOIN vResultsKPI ON vResultsKPI.SessionId = Sessions.SessionId AND vResultsKPI.KPIID = 10404
  JOIN Testinfo ON TestInfo.TestId = vResultsKPI.TestId AND TestInfo.Valid = 1
WHERE CollectionName like '%%' AND vResultsKPI.Value5 IS NOT NULL AND Sessions.Valid = 1
GROUP BY TestInfo.testname, FileList.ASideLocation, NetworkInfo.Operator, KPIStatus, Value5`,
  },
  {
    label: "HTTPS Throughput (PDF)",
    category: "Browsing",
    sql: `SELECT
  TestInfo.testname as 'Collection Name',
  FileList.ASideLocation,
  NetworkInfo.Operator as 'Serving Operator',
  KPIStatus as 'Status',
  COUNT(KPIStatus) as 'Num',
  Round(AVG(Convert(float, vResultsKPI.value1*0.008)) * COUNT(vResultsKPI.value1*0.008), 3) as 'Avg',
  Round(MIN(Convert(float, vResultsKPI.value1*0.008)), 3) as 'MinVal',
  Round(MAX(Convert(float, vResultsKPI.value1*0.008)), 3) as 'MaxVal',
  Round(STDEV(Convert(float, vResultsKPI.value1*0.008)), 3) as 'StdVal',
  vResultsKPI.Value5 as 'URL',
  COUNT(vResultsKPI.value1*0.008) AS 'GSum'
FROM Sessions
  JOIN FileList ON FileList.FileId = Sessions.FileId
  JOIN NetworkInfo ON NetworkInfo.NetworkId = Sessions.NetworkId
  JOIN vResultsKPI ON vResultsKPI.SessionId = Sessions.SessionId AND vResultsKPI.KPIID = 30404
  JOIN Testinfo ON TestInfo.TestId = vResultsKPI.TestId AND TestInfo.Valid = 1
WHERE CollectionName like '%%' AND Sessions.Valid = 1
GROUP BY TestInfo.testname, FileList.ASideLocation, NetworkInfo.Operator, KPIStatus, Value5`,
  },
  // ── Multimedia ──
  {
    label: "YouTube RAW",
    category: "Multimedia",
    sql: `WITH SessionsCTE AS (
  SELECT Sessions.FileId, Sessions.SessionId, Testinfo.TestId
  FROM Sessions
    JOIN Testinfo ON Sessions.SessionId = Testinfo.SessionId
  WHERE Sessions.Valid = 1 AND TestInfo.Valid = 1 AND Sessions.jtId IN (4, 5, 7)
  GROUP BY Sessions.FileId, Sessions.SessionId, Testinfo.TestId
)
SELECT
  FileList.CollectionName as 'Collection Name',
  FileList.ASideLocation as 'A Side Location',
  TestInfo.TestName as 'Test Name',
  SessionsCTE.SessionId as 'Session ID',
  TestInfo.TestId as 'Test ID',
  CONVERT(VARCHAR, TestInfo.StartTime, 104) AS 'Date',
  CONVERT(VARCHAR, TestInfo.StartTime, 108) AS 'Time',
  NetworkInfo.Operator,
  NetworkInfo.Technology,
  ResultsVideoStream.VideoResolution as 'Video Resolution',
  vResultsVideoStreamAvg.SessionQuality as 'Session Quality',
  vResultsVideoStreamAvg.TestQualityAvg as 'Avg Visual Quality',
  vResultsVideoStreamAvg.TestQualityMin as 'Min Visual Quality',
  vResultsVideoStreamAvg.TestQualityMax as 'Max Visual Quality',
  vResultsVideoStreamAvg.Freezing,
  vResultsVideoStreamAvg.FreezingPercent * 0.01 AS 'Freezing Ratio',
  vResultsVideoStreamAvg.Status,
  CASE WHEN vResultsVideoStreamAvg.Status LIKE '%ok%' THEN 1 ELSE 0 END AS Ok,
  CASE WHEN vResultsVideoStreamAvg.Status LIKE '%ok%' THEN 0 ELSE 1 END AS Failed,
  CASE WHEN ResultsVideoStreamTCPData.TimeToFirstPicture IS NOT NULL
    THEN ResultsVideoStreamTCPData.TimeToFirstPicture * 0.001
    ELSE ResultsVideoStreamTCPData.TimeToFirstPicturePlayer * 0.001
  END AS 'Time To First Picture',
  ResultsVQ08StreamAvg.Jerkiness,
FROM SessionsCTE
  JOIN FileList ON SessionsCTE.FileID = FileList.FileID
  JOIN TestInfo ON SessionsCTE.TestId = TestInfo.TestId
  JOIN NetworkInfo ON TestInfo.NetworkId = NetworkInfo.NetworkId
  JOIN vResultsVideoStreamAvg ON TestInfo.TestId = vResultsVideoStreamAvg.TestId
  JOIN ResultsVQ08StreamAvg ON TestInfo.TestId = ResultsVQ08StreamAvg.TestId
  JOIN ResultsVideoStream ON TestInfo.TestId = ResultsVideoStream.TestId
  JOIN DataSession ON SessionsCTE.SessionId = DataSession.SessionID
  LEFT JOIN ResultsVideoStreamTCPData ON TestInfo.TestId = ResultsVideoStreamTCPData.TestId
WHERE CollectionName like '%%' AND SessionsCTE.SessionId IS NOT NULL
  AND vResultsVideoStreamAvg.Model IS NOT NULL`,
  },
  {
    label: "YT IP Layer (Throughput Map)",
    category: "Multimedia",
    sql: `SELECT
  NetworkInfo.CID, NetworkInfo.LAC, NetworkInfo.MCC, NetworkInfo.MNC,
  Position.Latitude, Position.Longitude, Position.PosId,
  Sessions.FileId, Sessions.SessionId,
  FileList.ASideDevice, FileList.ASideLocation, FileList.CollectionName,
  TestInfo.TestName,
  FactIPThroughput.TestId,
  FactIPThroughput.FullDate as 'msgTime',
  FactIPThroughput.ThroughputKbps AS Throughput,
  FactIPThroughput.direction
FROM Sessions as Sessions, Position, FileList, FactIPThroughput, TestInfo,
  NetworkInfo
  LEFT JOIN vBTSList ON vBTSList.CGI = NetworkInfo.CGI
  LEFT JOIN vBTSList as bts2 ON bts2.CGI = NetworkInfo.CGI2
  LEFT JOIN vBTSList as bts3 ON bts3.CGI = NetworkInfo.CGI3
WHERE CollectionName like '%%' AND
  Sessions.FileId = FileList.FileId AND Sessions.Valid = 1 AND
  Sessions.SessionId = TestInfo.SessionId AND TestInfo.Valid = 1 AND
  TestInfo.TestId = FactIPThroughput.TestId AND
  TestInfo.TestName in ('YouTube Service','YouTube Service_Live','YouTube Service_4K') AND
  FactIPThroughput.PosId = Position.PosId AND
  FactIPThroughput.NetworkId = NetworkInfo.NetworkId AND
  FactIPThroughput.direction = 'Downlink'`,
  },
  // ── 5G ──
  {
    label: "5G Phone – SS-RSRP / RSRQ / SINR (avg ανά θέση)",
    defaultChart: { type: "bar", xCol: "Location", yCols: ["SS-RSRP", "SS-RSRQ", "SS-SINR"], aggFn: "avg", aggEnabled: true },
    category: "5G",
    sql: `SELECT
  nr.NRARFCN,
  AVG(nr.RSRP)                  AS [SS-RSRP],
  AVG(nr.RSRQ)                  AS [SS-RSRQ],
  AVG(nr.SINR)                  AS [SS-SINR],
  CAST(pos.latitude  AS FLOAT)  AS latitude,
  CAST(pos.longitude AS FLOAT)  AS longitude,
  fl.CollectionName,
  fl.ASideLocation              AS Location,
  NRcarrier.CarrierIndexName
FROM [dbo].[FactNR5GRadio] nr
LEFT JOIN Position           pos       ON pos.PosId   = nr.PosId
LEFT JOIN FileList           fl        ON fl.FileId   = nr.FileId
LEFT JOIN DmnNR5GCarrierInfo NRcarrier ON NRcarrier.DmnId = nr.DmnIdNR5GCarrierInfo
WHERE fl.Valid = 1
  AND fl.CollectionName LIKE '%%'
GROUP BY nr.SessionId, nr.PosId, nr.NRARFCN,
         pos.latitude, pos.longitude,
         fl.CollectionName, fl.ASideLocation, NRcarrier.CarrierIndexName
ORDER BY nr.PosId`,
  },
  {
    label: "5G Phone – raw μετρήσεις (FactNR5GRadio)",
    category: "5G",
    sql: `SELECT TOP 2000
  nr.SessionId,
  nr.PosId,
  nr.NRARFCN,
  nr.PCI,
  nr.RSRP                       AS [SS-RSRP],
  nr.RSRQ                       AS [SS-RSRQ],
  nr.SINR                       AS [SS-SINR],
  nr.FullDate,
  CAST(pos.latitude  AS FLOAT)  AS latitude,
  CAST(pos.longitude AS FLOAT)  AS longitude,
  fl.CollectionName,
  fl.ASideLocation              AS Location
FROM [dbo].[FactNR5GRadio] nr
LEFT JOIN Position pos ON pos.PosId  = nr.PosId
LEFT JOIN FileList fl  ON fl.FileId  = nr.FileId
WHERE fl.Valid = 1
  AND fl.CollectionName LIKE '%%'
ORDER BY nr.FullDate`,
  },
  {
    label: "5G Scanner – SS-RSRP top beam (FactNR5GScannerBeam)",
    category: "5G",
    sql: `SELECT
  nr.PCI,
  nr.AbsFreqSSB                 AS NRARFCN,
  nr.SS_RSRP,
  nr.SS_SINR,
  fl.CollectionName,
  fl.ASideLocation              AS Location,
  CAST(pos.Latitude  AS FLOAT)  AS latitude,
  CAST(pos.Longitude AS FLOAT)  AS longitude
FROM [dbo].[FactNR5GScannerBeam] nr
LEFT JOIN [dbo].[FileList] fl  ON fl.[FileId] = nr.[FileId]
LEFT JOIN [dbo].[Position] pos ON pos.[PosId] = nr.[PosId]
WHERE nr.[DmnIdTopN_SS_RSRP] = 1
  AND fl.CollectionName LIKE '%%'
ORDER BY latitude, longitude`,
  },
  {
    label: "5G Scanner – avg SS-RSRP ανά NRARFCN & collection",
    category: "5G",
    sql: `SELECT
  nr.AbsFreqSSB                        AS NRARFCN,
  fl.CollectionName,
  fl.ASideLocation                     AS Location,
  COUNT(*)                             AS measurements,
  ROUND(AVG(nr.SS_RSRP), 2)           AS avg_SS_RSRP,
  ROUND(MIN(nr.SS_RSRP), 2)           AS min_SS_RSRP,
  ROUND(MAX(nr.SS_RSRP), 2)           AS max_SS_RSRP,
  ROUND(AVG(nr.SS_SINR), 2)           AS avg_SS_SINR
FROM [dbo].[FactNR5GScannerBeam] nr
LEFT JOIN [dbo].[FileList] fl ON fl.[FileId] = nr.[FileId]
WHERE nr.[DmnIdTopN_SS_RSRP] = 1
  AND fl.CollectionName LIKE '%%'
GROUP BY nr.AbsFreqSSB, fl.CollectionName, fl.ASideLocation
ORDER BY fl.ASideLocation, nr.AbsFreqSSB`,
  },
];

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────
const uid = () => Math.random().toString(36).slice(2, 8);

function exportCsv(columns: string[], data: Record<string, unknown>[], filename: string) {
  const header = columns.join(",");
  const rows = data.map((row) =>
    columns
      .map((col) => {
        const val = row[col];
        if (val === null || val === undefined) return "";
        const str = String(val);
        return str.includes(",") || str.includes('"') || str.includes("\n")
          ? `"${str.replace(/"/g, '""')}"`
          : str;
      })
      .join(","),
  );
  const blob = new Blob([[header, ...rows].join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ──────────────────────────────────────────────
// Sub-components
// ──────────────────────────────────────────────
function ResultGrid({ result, defaultChart }: { result: QueryResult; defaultChart?: DefaultChart }) {
  const canChart = result.columns.length > 1;
  const [showChart, setShowChart] = useState(!!defaultChart && canChart);
  const [page, setPage] = useState(0);
  const pageSize = 50;
  const totalPages = Math.ceil(result.data.length / pageSize);
  const pageData = result.data.slice(page * pageSize, (page + 1) * pageSize);

  if (result.error) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
        <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span className="font-mono">{result.error}</span>
      </div>
    );
  }

  if (result.data.length === 0) {
    return (
      <p className="py-4 text-center text-xs text-muted-foreground">
        Query returned 0 rows.
      </p>
    );
  }

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      {/* Tab strip */}
      <div className="flex items-center border-b border-border bg-muted/20">
        {([
          { active: !showChart, label: "Table", icon: <Table2 className="h-3.5 w-3.5" />, onClick: () => setShowChart(false), disabled: false },
          { active: showChart,  label: "Chart", icon: <BarChart2 className="h-3.5 w-3.5" />, onClick: () => setShowChart(true), disabled: !canChart },
        ] as const).map(({ active, label, icon, onClick, disabled }) => (
          <button
            key={label}
            onClick={onClick}
            disabled={disabled}
            title={disabled ? "Το query επιστρέφει μόνο μία στήλη" : undefined}
            className={[
              "flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium border-b-2 transition-all",
              active
                ? "border-primary text-foreground bg-background"
                : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/30",
              disabled ? "opacity-40 cursor-not-allowed hover:bg-transparent hover:text-muted-foreground" : "",
            ].join(" ")}
          >
            {icon}
            {label}
          </button>
        ))}
        <button
          onClick={() => exportCsv(result.columns, result.data, `${result.label.replace(/\s+/g, "_")}.csv`)}
          className="ml-auto flex items-center gap-1.5 px-3 py-2.5 text-[10px] text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors border-l border-border"
        >
          <Download className="h-3 w-3" /> Export CSV
        </button>
      </div>

      {/* Content */}
      <div className="p-3">
        {showChart ? (
          <ResultCharts
            key={result.executionTime}
            columns={result.columns}
            data={result.data}
            defaultChartType={defaultChart?.type}
            defaultXCol={defaultChart?.xCol}
            defaultYCols={defaultChart?.yCols}
            defaultRightCols={defaultChart?.rightCols}
            defaultAxisOverrides={defaultChart?.axisOverrides}
            defaultAggFn={defaultChart?.aggFn}
            defaultAggEnabled={defaultChart?.aggEnabled}
            defaultGroupCol={defaultChart?.groupCol}
          />
        ) : (
          <div className="space-y-1.5">
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted/50 text-left text-muted-foreground uppercase tracking-wider">
                    {result.columns.map((col) => (
                      <th key={col} className="px-3 py-1.5 font-semibold whitespace-nowrap">
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pageData.map((row, i) => (
                    <tr
                      key={i}
                      className="border-b border-border/50 transition-colors hover:bg-muted/20"
                    >
                      {result.columns.map((col) => (
                        <td key={col} className="px-3 py-1.5 font-mono text-foreground whitespace-nowrap">
                          {row[col] === null || row[col] === undefined ? (
                            <span className="text-muted-foreground italic">NULL</span>
                          ) : (
                            String(row[col])
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                <button
                  disabled={page === 0}
                  onClick={() => setPage((p) => p - 1)}
                  className="px-2 py-0.5 rounded border border-border bg-muted disabled:opacity-40 hover:bg-muted/70"
                >
                  ‹ Prev
                </button>
                <span>Page {page + 1} / {totalPages}</span>
                <button
                  disabled={page >= totalPages - 1}
                  onClick={() => setPage((p) => p + 1)}
                  className="px-2 py-0.5 rounded border border-border bg-muted disabled:opacity-40 hover:bg-muted/70"
                >
                  Next ›
                </button>
                <span className="ml-auto">{result.data.length} total rows</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────
// Main component
// ──────────────────────────────────────────────
const QueryEditor = ({
  onRunQueries,
  isRunning,
  results = [],
  totalTime = 0,
}: QueryEditorProps) => {
  const [tabs, setTabs] = useState<QueryTab[]>([
    { id: uid(), label: "Query 1", sql: TEMPLATES[0].sql },
  ]);
  const [activeTabId, setActiveTabId] = useState(tabs[0].id);
  const [showTemplates, setShowTemplates] = useState(false);
  const [showBuilder, setShowBuilder] = useState(false);
  const [builderKey, setBuilderKey]   = useState(0);
  const [showSql,     setShowSql]     = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const templatesRef = useRef<HTMLDivElement>(null);

  // Close templates dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (templatesRef.current && !templatesRef.current.contains(e.target as Node)) {
        setShowTemplates(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0];

  const addTab = () => {
    const newTab: QueryTab = {
      id: uid(),
      label: `Query ${tabs.length + 1}`,
      sql: "",
    };
    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(newTab.id);
  };

  const removeTab = (id: string) => {
    if (tabs.length === 1) return;
    const idx = tabs.findIndex((t) => t.id === id);
    const newTabs = tabs.filter((t) => t.id !== id);
    setTabs(newTabs);
    if (activeTabId === id) {
      setActiveTabId(newTabs[Math.max(0, idx - 1)].id);
    }
  };

  const updateSql = (id: string, sql: string) => {
    setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, sql } : t)));
  };

  const applyTemplate = (sql: string, defaultChart?: DefaultChart) => {
    setTabs((prev) =>
      prev.map((t) => (t.id === activeTabId ? { ...t, sql, defaultChart } : t)),
    );
    setShowTemplates(false);
    textareaRef.current?.focus();
  };

  const handleRun = () => {
    const sqls = tabs.map((t) => t.sql.trim()).filter(Boolean);
    if (sqls.length > 0) onRunQueries(sqls);
  };

  const handleRunActive = () => {
    const sql = activeTab.sql.trim();
    if (sql) onRunQueries([sql]);
  };

  const canRun = tabs.some((t) => t.sql.trim());

  // Map results by tab order (index)
  const resultForTab = (tabIdx: number): QueryResult | undefined => results[tabIdx];

  return (
    <div className="space-y-3">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Database className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            SQL Query Editor
          </h2>
        </div>

        <div className="flex items-center gap-2">
          {/* Query Builder toggle */}
          <Button
            variant={showBuilder ? "secondary" : "outline"}
            size="sm"
            onClick={() => {
              if (!showBuilder) setBuilderKey((k) => k + 1);
              setShowBuilder((v) => !v);
            }}
            className="text-xs gap-1"
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            Builder
          </Button>

          {/* Show/hide SQL editor */}
          <Button
            variant={showSql ? "secondary" : "outline"}
            size="sm"
            onClick={() => setShowSql((v) => !v)}
            className="text-xs gap-1"
          >
            <Code2 className="h-3.5 w-3.5" />
            {showSql ? "Hide Query" : "Show Query"}
          </Button>

          {/* Templates picker */}
          <div className="relative" ref={templatesRef}>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowTemplates((v) => !v)}
              className="text-xs gap-1"
            >
              Templates <ChevronDown className="h-3 w-3" />
            </Button>
            <AnimatePresence>
              {showTemplates && (
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  className="absolute right-0 top-full z-50 mt-1 w-72 rounded-md border border-border bg-card shadow-lg overflow-hidden"
                >
                  <div className="max-h-96 overflow-y-auto">
                    {TEMPLATE_CATEGORY_ORDER
                      .filter(cat => TEMPLATES.some(t => t.category === cat))
                      .map(cat => {
                        const items = TEMPLATES.filter(t => t.category === cat);
                        return (
                          <div key={cat}>
                            <div className="px-3 py-1 text-[9px] font-bold uppercase tracking-wider text-muted-foreground bg-muted/60 border-b border-border/40 sticky top-0">
                              {cat}
                            </div>
                            {items.map(tpl => (
                              <button
                                key={tpl.label}
                                onClick={() => applyTemplate(tpl.sql, tpl.defaultChart)}
                                className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-muted/60 border-b border-border/50 last:border-0 transition-colors"
                              >
                                <ChevronRight className="h-3 w-3 text-primary shrink-0" />
                                {tpl.label}
                                {tpl.defaultChart && (
                                  <BarChart2 className="h-3 w-3 text-primary/60 ml-auto shrink-0" />
                                )}
                              </button>
                            ))}
                          </div>
                        );
                      })}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <Button variant="outline" size="sm" onClick={addTab} className="text-xs gap-1">
            <Plus className="h-3.5 w-3.5" /> New Tab
          </Button>

          {/* Clear active tab */}
          {activeTab.sql.trim() && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => updateSql(activeTabId, "")}
              className="text-xs gap-1 text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="h-3.5 w-3.5" /> Clear
            </Button>
          )}

          {/* Run this tab */}
          <Button
            size="sm"
            variant="outline"
            onClick={handleRunActive}
            disabled={isRunning || !activeTab.sql.trim()}
            className="text-xs gap-1"
          >
            <Play className="h-3.5 w-3.5" />
            Run
          </Button>

          {/* Run all (only when multiple tabs) */}
          {tabs.length > 1 && (
            <Button
              size="sm"
              onClick={handleRun}
              disabled={isRunning || !canRun}
              className="glow-primary text-xs gap-1"
            >
              <Play className="h-3.5 w-3.5" />
              {isRunning ? "Running…" : "Run All"}
            </Button>
          )}
        </div>
      </div>

      {/* ── Query Builder ── */}
      <motion.div
        initial={false}
        animate={{ height: showBuilder ? "auto" : 0, opacity: showBuilder ? 1 : 0 }}
        transition={{ duration: 0.2, ease: "easeInOut" }}
        className="overflow-hidden"
      >
        <QueryBuilder
          key={builderKey}
          initialSql={activeTab.sql}
          onApply={(sql) => { updateSql(activeTabId, sql); setShowBuilder(false); }}
        />
      </motion.div>

      {/* ── Tab strip ── */}
      <div className="flex items-center gap-1 border-b border-border overflow-x-auto pb-px">
        {tabs.map((tab, tabIdx) => {
          const res = resultForTab(tabIdx);
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTabId(tab.id)}
              className={`group relative flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-t-md border border-b-0 transition-colors whitespace-nowrap ${
                tab.id === activeTabId
                  ? "bg-card border-border text-foreground"
                  : "bg-muted/40 border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab.label}
              {res && !res.error && (
                <span className="text-[9px] text-success font-mono">
                  {res.rowsReturned}r
                </span>
              )}
              {res?.error && (
                <span className="text-[9px] text-destructive font-mono">err</span>
              )}
              {tabs.length > 1 && (
                <span
                  role="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeTab(tab.id);
                  }}
                  className="ml-0.5 opacity-0 group-hover:opacity-100 hover:text-destructive transition-opacity"
                >
                  <X className="h-3 w-3" />
                </span>
              )}
            </button>
          );
        })}

      </div>

      {/* ── Editor area ── */}
      {tabs.map((tab, tabIdx) => {
        const res = resultForTab(tabIdx);
        return (
          <div
            key={tab.id}
            className={tab.id === activeTabId ? "space-y-3" : "hidden"}
          >
            {/* Collapsible SQL textarea */}
            <AnimatePresence initial={false}>
              {showSql && (
                <motion.div
                  key="sql-editor"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden space-y-2"
                >
                  <div className="relative">
                    <textarea
                      ref={tab.id === activeTabId ? textareaRef : undefined}
                      value={tab.sql}
                      onChange={(e) => updateSql(tab.id, e.target.value)}
                      rows={8}
                      spellCheck={false}
                      placeholder={`-- Write SQL here, e.g.:\nSELECT TOP 100 * FROM CallAnalysis ORDER BY SessionId DESC`}
                      onKeyDown={(e) => {
                        if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                          e.preventDefault();
                          handleRunActive();
                        }
                        if (e.key === "Tab") {
                          e.preventDefault();
                          const ta = e.currentTarget;
                          const start = ta.selectionStart;
                          const end = ta.selectionEnd;
                          const newVal = tab.sql.substring(0, start) + "  " + tab.sql.substring(end);
                          updateSql(tab.id, newVal);
                          requestAnimationFrame(() => {
                            ta.selectionStart = ta.selectionEnd = start + 2;
                          });
                        }
                      }}
                      className="w-full resize-y bg-[hsl(var(--muted))] border border-border rounded-md px-4 py-3 font-mono text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/60 transition-all placeholder:text-muted-foreground leading-relaxed"
                    />
                    <button
                      onClick={() => navigator.clipboard.writeText(tab.sql)}
                      title="Copy SQL"
                      className="absolute top-2 right-2 p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  <p className="text-[10px] text-muted-foreground">
                    <kbd className="px-1 py-0.5 rounded border border-border bg-muted font-mono">Ctrl+Enter</kbd>{" "}
                    to run ·{" "}
                    <kbd className="px-1 py-0.5 rounded border border-border bg-muted font-mono">Tab</kbd>{" "}
                    to indent
                  </p>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Results */}
            <AnimatePresence>
              {res && (
                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="space-y-2"
                >
                  {/* meta bar */}
                  <div className="flex items-center gap-3 text-[10px] text-muted-foreground flex-wrap">
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {res.executionTime} ms
                    </span>
                    <span className="flex items-center gap-1">
                      <Rows className="h-3 w-3" />
                      {res.rowsReturned} rows
                    </span>
                    <Badge variant="secondary" className="text-[9px] px-1.5">
                      {res.label}
                    </Badge>

                  </div>

                  <ResultGrid result={res} defaultChart={tab.defaultChart} />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}

      {/* Total time badge (all tabs ran) */}
      {results.length > 1 && totalTime > 0 && (
        <p className="text-[10px] text-muted-foreground text-right">
          All {results.length} queries completed in{" "}
          <span className="font-mono text-primary">{totalTime} ms</span>
        </p>
      )}
    </div>
  );
};

export default QueryEditor;
