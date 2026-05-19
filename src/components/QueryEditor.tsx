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
import ResultCharts from "@/components/ResultCharts";

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────
interface QueryTab {
  id: string;
  label: string;
  sql: string;
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
  "General", "KPI", "MOS", "Signal", "Data",
  "LQ Voice", "LQ Stats", "Codec", "SRVCC", "Events", "Cell ID",
  "Data Tests", "Browsing", "Multimedia",
] as const;

const TEMPLATES: { label: string; category: string; sql: string }[] = [
  {
    label: "All calls",
    category: "General",
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
    sql: `SELECT
  CA.callStatus,
  CA.callType,
  CA.technology,
  COUNT(*) AS total
FROM CallAnalysis CA
LEFT JOIN Sessions S ON S.SessionId = CA.SessionId
WHERE S.Valid IN (0, 1)
  AND (CA.callStatus LIKE '%Drop%' OR CA.callStatus LIKE '%Fail%')
GROUP BY CA.callStatus, CA.callType, CA.technology
ORDER BY total DESC`,
  },
  {
    label: "Collections in filelist",
    category: "General",
    sql: `SELECT
  CollectionName,
  COUNT(*) AS files,
  MIN(StartTime) AS first_file,
  MAX(StartTime) AS last_file
FROM FileList
WHERE CollectionName IS NOT NULL
GROUP BY CollectionName
ORDER BY last_file DESC`,
  },
  // ── KPI ──
  {
    label: "Avg setup time per technology",
    category: "KPI",
    sql: `SELECT
  CA.technology,
  COUNT(*)              AS calls,
  ROUND(AVG(CA.setupTime), 2) AS avg_setup_ms,
  ROUND(MIN(CA.setupTime), 2) AS min_setup_ms,
  ROUND(MAX(CA.setupTime), 2) AS max_setup_ms
FROM CallAnalysis CA
LEFT JOIN Sessions S ON S.SessionId = CA.SessionId
WHERE S.Valid IN (0, 1)
GROUP BY CA.technology
ORDER BY avg_setup_ms`,
  },
  {
    label: "KPIs ανά operator (calls)",
    category: "KPI",
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
    label: "Drop/Fail rate ανά operator",
    category: "KPI",
    sql: `SELECT
  FL.ASideLocation                            AS Location,
  CA.technology,
  COUNT(*)                                    AS total,
  SUM(CASE WHEN CA.callStatus LIKE '%Drop%'  THEN 1 ELSE 0 END) AS dropped,
  SUM(CASE WHEN CA.callStatus LIKE '%Fail%'  THEN 1 ELSE 0 END) AS failed,
  ROUND(
    100.0 * SUM(CASE WHEN CA.callStatus LIKE '%Drop%' OR CA.callStatus LIKE '%Fail%'
                     THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0), 2) AS drop_fail_pct
FROM CallAnalysis CA
LEFT JOIN FileList FL ON CA.FileId   = FL.FileId
LEFT JOIN Sessions S  ON S.SessionId = CA.SessionId
WHERE S.Valid IN (0, 1)
GROUP BY FL.ASideLocation, CA.technology
ORDER BY FL.ASideLocation, total DESC`,
  },
  {
    label: "Setup time ανά callType & technology",
    category: "KPI",
    sql: `SELECT
  CA.callType,
  CA.technology,
  COUNT(*)                          AS calls,
  ROUND(AVG(CA.setupTime), 2)       AS avg_setup_ms,
  ROUND(MIN(CA.setupTime), 2)       AS min_setup_ms,
  ROUND(MAX(CA.setupTime), 2)       AS max_setup_ms,
  ROUND(STDEV(CA.setupTime), 2)     AS stdev_setup_ms
FROM CallAnalysis CA
LEFT JOIN Sessions S ON S.SessionId = CA.SessionId
WHERE S.Valid IN (0, 1)
  AND CA.setupTime IS NOT NULL
GROUP BY CA.callType, CA.technology
ORDER BY CA.callType, avg_setup_ms`,
  },
  // ── MOS ──
  {
    label: "Avg MOS per collection",
    category: "MOS",
    sql: `SELECT
  FL.CollectionName,
  COUNT(*)                  AS calls,
  ROUND(AVG(LQ.OptionalWB), 3) AS avg_mos,
  ROUND(MIN(LQ.OptionalWB), 3) AS min_mos,
  ROUND(MAX(LQ.OptionalWB), 3) AS max_mos
FROM CallAnalysis CA
LEFT JOIN FileList FL ON CA.FileId = FL.FileId
LEFT JOIN ResultsLQ08Avg LQ ON LQ.SessionId = CA.SessionId
WHERE LQ.OptionalWB IS NOT NULL
GROUP BY FL.CollectionName
ORDER BY avg_mos DESC`,
  },
  {
    label: "MOS ανά operator & collection",
    category: "MOS",
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
    sql: `SELECT TOP 2000
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
  // ── Signal ──
  {
    label: "LTE signal per session",
    category: "Signal",
    sql: `SELECT TOP 500
  LM.SessionId,
  LM.MsgTime,
  ROUND(LM.RSRP,  2) AS RSRP,
  ROUND(LM.RSRQ,  2) AS RSRQ,
  ROUND(LM.SINR0, 2) AS SINR0
FROM LTEMeasurementReport LM
ORDER BY LM.SessionId, LM.MsgTime`,
  },
  {
    label: "Avg RSRP ανά operator",
    category: "Signal",
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
    label: "LTE μετρήσεις raw (για γράφημα)",
    category: "Signal",
    sql: `SELECT TOP 2000
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
    label: "LQ Call Data (Free A)",
    category: "LQ Voice",
    sql: `SELECT
  FileList.ASideFileName,
  FileList.CollectionName,
  FileList.CampaignName,
  FileList.UserName,
  FileList.ASideLocation,
  Filelist.ASideDevice,
  Filelist.BSideDevice,
  Filelist.ASideNumber,
  FileList.BSideNumber,
  Filelist.FileID,
  CallSession.SessionId AS 'SessionId',
  CallSession.callStatus AS 'CallStatus',
  Callsession.Callcause,
  Callsession.Calltype,
  Callsession.Calldir,
  Case when Callsession.callDir like 'A->B' then 'MOC'
       when Callsession.callDir like 'B->A' then 'MTC' else NULL end as 'MOCMTC',
  Callsession.VoiceCalltype,
  CallSession.CallTechnology AS 'Technology',
  Networkinfo.Operator,
  Networkinfo.Technology,
  case when Callsession.callDir like 'A->B' and CallSession.CallMode in ('VoLTE','SRVCC') then 'VoLTE Call'
       when Callsession.callDir like 'A->B' and CallSession.CallMode in ('CSFB','CS') then 'CS call'
       when Callsession.callDir like 'B->A' and CallSession.CallModeB in ('VoLTE','SRVCC') then 'VoLTE Call'
       when Callsession.callDir like 'B->A' and CallSession.CallModeB in ('CSFB','CS') then 'CS call'
       when callDir like 'A->B' and CallMode in ('-') and CallSession.CallTechnology like ('%lte%') then 'VoLTE Call'
       when callDir like 'A->B' and CallMode in ('-') and CallSession.CallTechnology like ('%UMTS%') then 'CS call'
       when callDir like 'A->B' and CallMode in ('-') and CallSession.CallTechnology like ('%GSM%') then 'CS call'
       when callDir like 'A->B' and CallMode like ('%Unknown%') and CallSession.CallTechnology like ('%5G%') then 'VoLTE Call'
       when callDir like 'B->A' and CallModeB in ('-') and CallSession.CallTechnologyB like ('%lte%') then 'VoLTE Call'
       when callDir like 'B->A' and CallModeB in ('-') and CallSession.CallTechnologyB like ('%UMTS%') then 'CS call'
       when callDir like 'B->A' and CallModeB in ('-') and CallSession.CallTechnologyB like ('%GSM%') then 'CS call'
       when callDir like 'B->A' and CallModeB like ('%Unknown%') and CallSession.CallTechnologyB like ('%5G%') then 'VoLTE Call'
       else NULL end as 'CustomCallMode',
  Sessions.startTime,
  sessions.duration,
  min(CASE WHEN vResultsKPI.KPIId = 11013 and vResultsKPI.ErrorCode=0
       and (Callsession.callDir like 'A->B' and CallSession.CallMode in ('VoLTE','SRVCC')
        or  Callsession.callDir like 'B->A' and CallSession.CallModeB in ('VoLTE','SRVCC'))
       and Callsession.Callstatus in ('Completed','Dropped')
       THEN vResultsKPI.Duration*0.001 else NULL END) AS 'CallSetupTimeVoLTE',
  min(CASE WHEN vResultsKPI.KPIId = 10108 and vResultsKPI.ErrorCode=0
       and (Callsession.callDir like 'A->B' and CallSession.CallMode in ('CSFB','CS')
        or  Callsession.callDir like 'B->A' and CallSession.CallModeB in ('CSFB','CS'))
       and Callsession.Callstatus in ('Completed','Dropped')
       THEN vResultsKPI.Duration*0.001
       WHEN vResultsKPI.KPIId = 11013 and vResultsKPI.ErrorCode=0
       and (Callsession.callDir like 'A->B' and CallSession.CallMode in ('CSFB','CS')
        or  Callsession.callDir like 'B->A' and CallSession.CallModeB in ('CSFB','CS'))
       and Callsession.Callstatus in ('Completed','Dropped')
       THEN vResultsKPI.Duration*0.001 else NULL END) AS 'CallSetupTimeCS',
  Case When Callsession.Callstatus in ('Completed','Dropped','Failed') then 1 else 0 end as 'CallAttemps',
  Case When Callsession.Callstatus in ('Failed') then 0 else 1 end as 'Callconnected',
  Case When Callsession.Callstatus in ('Completed') then 1 else 0 end as 'CallCompleted',
  Case When Callsession.Callstatus in ('Dropped') then 1 else 0 end as 'CallDropped',
  Case When Callsession.Callstatus in ('Failed') then 1 else 0 end as 'CallFailed'
FROM NetworkInfo, CallSession
  JOIN Sessions ON CallSession.SessionId = Sessions.SessionId
  JOIN FileList ON FileList.FileId = Sessions.FileId
  LEFT JOIN vResultsLQAvg ON CallSession.SessionId = vResultsLQAvg.SessionId
  LEFT JOIN TestInfo ON TestInfo.TestId = vResultsLQAvg.TestId
  LEFT JOIN vResultsKPI ON CallSession.SessionId = vResultsKPI.SessionId
WHERE CollectionName like '%%' AND
  Sessions.valid = 1 AND
  callStatus IN ('Completed','Failed','Dropped') AND
  ASideLocation like '%Free A%' AND
  Callsession.VoiceCallType In('Intrusive') AND
  Networkinfo.NetworkId=(Select max(nf.NetworkId) From Networkinfo nf Where Filelist.FileId = nf.FileId And Sessions.StartTime > nf.Msgtime)
GROUP BY
  FileList.ASideFileName, FileList.TestDescription, FileList.CollectionName, FileList.CampaignName,
  FileList.UserName, FileList.ASideLocation, Filelist.ASideDevice, Filelist.BSideDevice,
  Filelist.ASideNumber, FileList.BSideNumber, Filelist.FileID, sessions.duration,
  Callsession.Callcause, CallSession.SessionId, Callsession.Calltype, Callsession.Calldir,
  FileList.TaskName, CallSession.CallTechnology, CallSession.CallTechnologyB, Networkinfo.Technology,
  CallSession.CallMode, CallSession.CallModeB, callStatus, Networkinfo.Operator,
  Callsession.VoiceCalltype, Sessions.startTime
ORDER BY SessionId`,
  },
  {
    label: "LQ Call Data (GSM)",
    category: "LQ Voice",
    sql: `SELECT
  FileList.ASideFileName,
  FileList.TestDescription,
  FileList.CollectionName,
  FileList.CampaignName,
  FileList.UserName,
  Filelist.ASideLocation,
  Filelist.ASideDevice,
  Filelist.BSideDevice,
  Filelist.ASideNumber,
  FileList.BSideNumber,
  Filelist.FileID,
  Sessions.SessionID,
  Callsession.Callstatus,
  Callsession.Callcause,
  Callsession.Calltype,
  Callsession.Calldir,
  Case when Callsession.callDir like 'A->B' then 'MOC'
       when Callsession.callDir like 'B->A' then 'MTC' else NULL end as 'MOCMTC',
  Callsession.VoiceCalltype,
  Networkinfo.NetworkID,
  Networkinfo.Operator,
  Networkinfo.Technology,
  vResultsKPI.KPIID,
  vResultsKPI.StartTime,
  vResultsKPI.EndTime,
  vResultsKPI.Duration*0.001,
  Case When Callsession.callDir like 'A->B' and vResultsKPI.ErrorCode=0
       and Callsession.Callstatus in ('Completed','Dropped')
       And Networkinfo.Technology in ('UMTS 2100','UMTS 900','GSM 900','GSM 1800')
       then vResultsKPI.Duration*0.001 else NULL end as 'MOCSetupTime',
  Case When Callsession.callDir like 'B->A' and vResultsKPI.ErrorCode=0
       and Callsession.Callstatus in ('Completed','Dropped')
       And Networkinfo.Technology in ('UMTS 2100','UMTS 900','GSM 900','GSM 1800')
       then vResultsKPI.Duration*0.001 else NULL end as 'MTCSetupTime',
  vResultsKPI.ErrorCode,
  Case When Callsession.Callstatus in ('Completed','Dropped','Failed') then 1 else 0 end as 'CallAttemps',
  Case When vResultsKPI.ErrorCode=0 then 1 else 0 end as 'Callconnected',
  Case When Callsession.Callstatus in ('Completed') then 1 else 0 end as 'CallCompleted',
  Case When Callsession.Callstatus in ('Dropped') then 1 else 0 end as 'CallDropped',
  Case When Callsession.Callstatus in ('Failed') then 1 else 0 end as 'CallFailed'
FROM Networkinfo,
  Filelist
  Join Sessions On(Filelist.FileID=Sessions.FileID)
  Join Callsession On(Sessions.SessionID=Callsession.SessionID)
  Left Join vResultsKPI On(Sessions.SessionID=vResultsKPI.SessionID and vResultsKPI.KPIID=10100)
WHERE CollectionName like '%%' AND
  Sessions.Valid=1 AND
  Callsession.Callstatus Not In('System Release') AND
  Callsession.VoiceCallType In('Intrusive') AND
  Networkinfo.NetworkId=(Select max(nf.NetworkId) From Networkinfo nf Where Filelist.FileId = nf.FileId And Sessions.StartTime > nf.Msgtime) AND
  ASideLocation Like '%GSM'`,
  },
  {
    label: "LQ UMTS/GSM Data (Free A)",
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
    label: "LQ Statistic Data (Free A)",
    category: "LQ Stats",
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
  GROUP BY Filelist.FileID, Sessions.SessionID, Networkinfo.NetworkID, Networkinfo.Operator, Networkinfo.Technology
),
LQSilenceCTE AS (
  SELECT SessionCTE.*, Testinfo.TestId, ResultsLQ08Avg.LQWB, ResultsLQ08Avg.OptionalWB,
    ResultsLQ08Avg.qualityCode,
    CASE WHEN SUBSTRING(REVERSE(ResultsLQ08Avg.QualityCode), 10, 1) LIKE '1' THEN 1 ELSE NULL END AS Silence
  FROM SessionCTE
    JOIN Testinfo ON SessionCTE.SessionId = Testinfo.SessionId
    JOIN ResultsLQ08Avg ON Testinfo.TestID = ResultsLQ08Avg.TestID
  WHERE ResultsLQ08Avg.Appl % 10 <> 0
)
SELECT
  FileList.ASideFileName, FileList.TestDescription, FileList.CollectionName,
  FileList.CampaignName, FileList.UserName, FileList.ASideLocation,
  FileList.ASideDevice, FileList.BSideDevice, FileList.ASideNumber, FileList.BSideNumber,
  FileList.FileID, SessionCTE.SessionID,
  Callsession.Callstatus, Callsession.Callcause, Callsession.Calltype,
  Callsession.Calldir, Callsession.VoiceCalltype,
  SessionCTE.NetworkID, SessionCTE.Operator,
  CASE WHEN SessionCTE.Technology LIKE '%LTE%' THEN 'VoLTE'
       WHEN SessionCTE.Technology LIKE '%UMTS%' OR SessionCTE.Technology LIKE '%GSM%' THEN 'CS'
       ELSE NULL END AS Technology,
  CASE WHEN vResultsKPI.ErrorCode = 0 THEN 1 ELSE 0 END AS Callconnected,
  CASE WHEN SUM(CASE WHEN LQSilenceCTE.OptionalWB > 0 OR LQSilenceCTE.Silence > 0 THEN 1 ELSE 0 END) > 0
    THEN CASE WHEN 15 < (CONVERT(REAL, SUM(CASE WHEN LQSilenceCTE.OptionalWB < 2.2 OR LQSilenceCTE.Silence > 0 THEN 1 ELSE 0 END)) * 100.0 /
              CONVERT(REAL, SUM(CASE WHEN LQSilenceCTE.OptionalWB > 0 OR LQSilenceCTE.Silence > 0 THEN 1 ELSE 0 END)))
         THEN 1 ELSE 0 END
    ELSE NULL END AS BadCall,
  CASE WHEN SUM(CASE WHEN LQSilenceCTE.OptionalWB > 0 OR LQSilenceCTE.Silence > 0 THEN 1 ELSE 0 END) > 0
    THEN (CONVERT(REAL, SUM(CASE WHEN LQSilenceCTE.OptionalWB < 2.2 OR LQSilenceCTE.Silence > 0 THEN 1 ELSE 0 END)) * 100.0 /
          CONVERT(REAL, SUM(CASE WHEN LQSilenceCTE.OptionalWB > 0 OR LQSilenceCTE.Silence > 0 THEN 1 ELSE 0 END)))
    ELSE NULL END AS Percentage,
  SUM(CASE WHEN LQSilenceCTE.OptionalWB < 2.2 OR LQSilenceCTE.Silence > 0 THEN 1 ELSE 0 END) AS NumBadSample,
  AVG(LQSilenceCTE.OptionalWB) * COUNT(LQSilenceCTE.OptionalWB) AS SumLQ,
  COUNT(LQSilenceCTE.OptionalWB) AS NumLQ,
  COUNT(CASE WHEN Testinfo.direction = 'B->A' THEN LQSilenceCTE.OptionalWB ELSE NULL END) AS NumLQDL,
  COUNT(CASE WHEN Testinfo.direction = 'A->B' THEN LQSilenceCTE.OptionalWB ELSE NULL END) AS NumLQUL,
  SUM(CASE WHEN LQSilenceCTE.Silence > 0 THEN 1 ELSE 0 END) AS NumSilenceSample
FROM FileList
  JOIN SessionCTE ON FileList.FileID = SessionCTE.FileID
  JOIN Callsession ON SessionCTE.SessionID = Callsession.SessionID
  LEFT JOIN Testinfo ON SessionCTE.SessionID = Testinfo.SessionID AND Testinfo.Valid = 1
  LEFT JOIN LQSilenceCTE ON Testinfo.TestID = LQSilenceCTE.TestID
  JOIN vResultsKPI ON SessionCTE.SessionID = vResultsKPI.SessionID
WHERE CollectionName like '%%' AND vResultsKPI.KPIId IN (11012, 10108)
GROUP BY
  FileList.ASideFileName, FileList.TestDescription, FileList.CollectionName, FileList.CampaignName,
  FileList.UserName, FileList.ASideLocation, FileList.ASideDevice, FileList.BSideDevice,
  FileList.ASideNumber, FileList.BSideNumber, FileList.FileID, SessionCTE.SessionID,
  Callsession.Callstatus, Callsession.Callcause, Callsession.Calltype, Callsession.Calldir,
  Callsession.VoiceCalltype, SessionCTE.NetworkID, SessionCTE.Operator, SessionCTE.Technology,
  vResultsKPI.ErrorCode`,
  },
  {
    label: "LQ Statistic Data (GSM)",
    category: "LQ Stats",
    sql: `WITH SessionCTE AS (
  SELECT
    Filelist.FileID, Sessions.SessionID,
    Networkinfo.NetworkID, Networkinfo.Operator, Networkinfo.Technology
  FROM Networkinfo, Filelist
    JOIN Sessions ON Filelist.FileID = Sessions.FileID
    JOIN Callsession ON Sessions.SessionID = Callsession.SessionID
  WHERE Sessions.Valid = 1
    AND Callsession.Callstatus NOT IN ('system release')
    AND Callsession.VoiceCallType IN ('Intrusive')
    AND Networkinfo.NetworkId = (
      SELECT MAX(nf.NetworkId) FROM Networkinfo nf
      WHERE Filelist.FileId = nf.FileId AND Sessions.StartTime > nf.Msgtime)
    AND ASideLocation LIKE '%GSM'
  GROUP BY Filelist.FileID, Sessions.SessionID, Networkinfo.NetworkID, Networkinfo.Operator, Networkinfo.Technology
),
LQSilenceCTE AS (
  SELECT SessionCTE.*, Testinfo.TestId, ResultsLQ08Avg.LQWB, ResultsLQ08Avg.OptionalWB,
    ResultsLQ08Avg.qualityCode,
    CASE WHEN SUBSTRING(REVERSE(ResultsLQ08Avg.QualityCode), 10, 1) LIKE '1' THEN 1 ELSE NULL END AS Silence
  FROM SessionCTE
    JOIN Testinfo ON SessionCTE.SessionId = Testinfo.SessionId
    JOIN ResultsLQ08Avg ON Testinfo.TestID = ResultsLQ08Avg.TestID
  WHERE ResultsLQ08Avg.Appl % 10 <> 0
)
SELECT
  FileList.ASideFileName, FileList.TestDescription, FileList.CollectionName,
  FileList.CampaignName, FileList.UserName, FileList.ASideLocation,
  FileList.ASideDevice, FileList.BSideDevice, FileList.ASideNumber, FileList.BSideNumber,
  FileList.FileID, SessionCTE.SessionID,
  Callsession.Callstatus, Callsession.Callcause, Callsession.Calltype,
  Callsession.Calldir, Callsession.VoiceCalltype,
  SessionCTE.NetworkID, SessionCTE.Operator, SessionCTE.Technology,
  CASE WHEN vResultsKPI.ErrorCode = 0 THEN 1 ELSE 0 END AS Callconnected,
  CASE WHEN SUM(CASE WHEN LQSilenceCTE.OptionalWB > 0 OR LQSilenceCTE.Silence > 0 THEN 1 ELSE 0 END) > 0
    THEN CASE WHEN 15 < (CONVERT(REAL, SUM(CASE WHEN LQSilenceCTE.OptionalWB < 2.2 OR LQSilenceCTE.Silence > 0 THEN 1 ELSE 0 END)) * 100.0 /
              CONVERT(REAL, SUM(CASE WHEN LQSilenceCTE.OptionalWB > 0 OR LQSilenceCTE.Silence > 0 THEN 1 ELSE 0 END)))
         THEN 1 ELSE 0 END
    ELSE NULL END AS BadCall,
  CASE WHEN SUM(CASE WHEN LQSilenceCTE.OptionalWB > 0 OR LQSilenceCTE.Silence > 0 THEN 1 ELSE 0 END) > 0
    THEN (CONVERT(REAL, SUM(CASE WHEN LQSilenceCTE.OptionalWB < 2.2 OR LQSilenceCTE.Silence > 0 THEN 1 ELSE 0 END)) * 100.0 /
          CONVERT(REAL, SUM(CASE WHEN LQSilenceCTE.OptionalWB > 0 OR LQSilenceCTE.Silence > 0 THEN 1 ELSE 0 END)))
    ELSE NULL END AS Percentage,
  SUM(CASE WHEN LQSilenceCTE.OptionalWB < 2.2 OR LQSilenceCTE.Silence > 0 THEN 1 ELSE 0 END) AS NumBadSample,
  AVG(LQSilenceCTE.OptionalWB) * COUNT(LQSilenceCTE.OptionalWB) AS SumLQ,
  COUNT(LQSilenceCTE.OptionalWB) AS NumLQ,
  COUNT(CASE WHEN Testinfo.direction = 'B->A' THEN LQSilenceCTE.OptionalWB ELSE NULL END) AS NumLQDL,
  COUNT(CASE WHEN Testinfo.direction = 'A->B' THEN LQSilenceCTE.OptionalWB ELSE NULL END) AS NumLQUL,
  SUM(CASE WHEN LQSilenceCTE.Silence > 0 THEN 1 ELSE 0 END) AS NumSilenceSample
FROM FileList
  JOIN SessionCTE ON FileList.FileID = SessionCTE.FileID
  JOIN Callsession ON SessionCTE.SessionID = Callsession.SessionID
  LEFT JOIN Testinfo ON SessionCTE.SessionID = Testinfo.SessionID AND Testinfo.Valid = 1
  LEFT JOIN LQSilenceCTE ON Testinfo.TestID = LQSilenceCTE.TestID
  LEFT JOIN vResultsKPI ON SessionCTE.SessionID = vResultsKPI.SessionID AND vResultsKPI.KPIID = 10100
WHERE CollectionName like '%%' AND Callsession.Callstatus NOT IN ('system release')
GROUP BY
  FileList.ASideFileName, FileList.TestDescription, FileList.CollectionName, FileList.CampaignName,
  FileList.UserName, FileList.ASideLocation, FileList.ASideDevice, FileList.BSideDevice,
  FileList.ASideNumber, FileList.BSideNumber, FileList.FileID, SessionCTE.SessionID,
  Callsession.Callstatus, Callsession.Callcause, Callsession.Calltype, Callsession.Calldir,
  Callsession.VoiceCalltype, SessionCTE.NetworkID, SessionCTE.Operator, SessionCTE.Technology,
  vResultsKPI.ErrorCode`,
  },
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
  LEFT JOIN vVoiceCodecTest vvct ON Testinfo.TestID = vvct.TestID AND (
    (TestInfo.direction = 'A->B' AND vvct.Direction = 'U') OR
    (TestInfo.direction = 'B->A' AND vvct.Direction = 'D'))
WHERE Testinfo.Valid = 1 AND ResultsLQ08Avg.OptionalWB >= 1 AND ResultsLQ08Avg.OptionalWB <= 5
GROUP BY SessionCTE.FileID, SessionCTE.CallingModule, SessionCTE.Operator,
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
  // ── Cell ID ──
  {
    label: "Cell ID — Cosmote Free A",
    category: "Cell ID",
    sql: `SELECT
  NetworkInfo.CID, NetworkInfo.LAC, NetworkInfo.MCC, NetworkInfo.MNC,
  NetworkInfo.CGI, NetworkInfo.CGI2, NetworkInfo.CGI3, NetworkInfo.Technology,
  NetworkInfo.BCCH as NI_BCCH, NetworkInfo.SC1 as NI_SC1, NetworkInfo.SC2 as NI_SC2, NetworkInfo.SC3 as NI_SC3,
  vBTSList.BTSName, vBTSList.CellName as BTSCellName, vBTSList.Direction as BTSDirection,
  vBTSList.BCCH as BTSBCCH, vBTSList.BSIC as BTSBSIC,
  Position.Latitude, Position.Longitude, Position.PosId, Position.Level as FloorPlanLevel,
  dbo.GetFloorPlanId(FileList.FileId, Position.FloorPlanId) as FloorPlanId,
  Position.Direction + 90 - 360 * FLOOR(((Position.Direction + 90) / 360)) as PositionDirection,
  Sessions.FileId, Sessions.SessionId, FileList.CallingModule, FileList.ASideDevice,
  FileList.ASideLocation, FileList.Zone, FileList.CollectionName,
  SubString(FileList.ASideFileName, 1, 41) as Logname,
  NULL as IndoorMap, NetworkInfo.NetworkId, NetworkInfo.MsgTime
FROM Sessions as Sessions, Position, FileList,
  NetworkIdRelation nr1, NetworkIdRelation nr2,
  NetworkInfo
  LEFT JOIN vBTSList ON vBTSList.CGI = NetworkInfo.CGI
  LEFT JOIN vBTSList as bts2 ON bts2.CGI = NetworkInfo.CGI2
  LEFT JOIN vBTSList as bts3 ON bts3.CGI = NetworkInfo.CGI3
WHERE CollectionName like '%%' AND
  Sessions.FileId = FileList.FileId AND Sessions.Valid = 1 AND
  Sessions.SessionId = Position.SessionId AND FileList.FileId = NetworkInfo.FileId AND
  NetworkInfo.FileId = Position.FileId AND
  (NetworkInfo.NetworkId = nr1.NetworkId and Position.PosId > nr1.PosId) AND
  (NetworkInfo.NetworkId + 1 = nr2.NetworkId and Position.PosId <= nr2.PosId) AND
  nr2.type = 'NetworkId' AND nr1.type = 'NetworkId' AND NetworkInfo.CId > 0 AND
  ASideLocation = 'Cosmote Free A'`,
  },
  {
    label: "Cell ID — Cosmote GSM",
    category: "Cell ID",
    sql: `SELECT
  NetworkInfo.CID, NetworkInfo.LAC, NetworkInfo.MCC, NetworkInfo.MNC,
  NetworkInfo.CGI, NetworkInfo.CGI2, NetworkInfo.CGI3, NetworkInfo.Technology,
  NetworkInfo.BCCH as NI_BCCH, NetworkInfo.SC1 as NI_SC1, NetworkInfo.SC2 as NI_SC2, NetworkInfo.SC3 as NI_SC3,
  vBTSList.BTSName, vBTSList.CellName as BTSCellName, vBTSList.Direction as BTSDirection,
  vBTSList.BCCH as BTSBCCH, vBTSList.BSIC as BTSBSIC,
  Position.Latitude, Position.Longitude, Position.PosId, Position.Level as FloorPlanLevel,
  dbo.GetFloorPlanId(FileList.FileId, Position.FloorPlanId) as FloorPlanId,
  Position.Direction + 90 - 360 * FLOOR(((Position.Direction + 90) / 360)) as PositionDirection,
  Sessions.FileId, Sessions.SessionId, FileList.CallingModule, FileList.ASideDevice,
  FileList.ASideLocation, FileList.Zone, FileList.CollectionName,
  SubString(FileList.ASideFileName, 1, 41) as Logname,
  NULL as IndoorMap, NetworkInfo.NetworkId, NetworkInfo.MsgTime
FROM Sessions as Sessions, Position, FileList,
  NetworkIdRelation nr1, NetworkIdRelation nr2,
  NetworkInfo
  LEFT JOIN vBTSList ON vBTSList.CGI = NetworkInfo.CGI
  LEFT JOIN vBTSList as bts2 ON bts2.CGI = NetworkInfo.CGI2
  LEFT JOIN vBTSList as bts3 ON bts3.CGI = NetworkInfo.CGI3
WHERE CollectionName like '%%' AND
  Sessions.FileId = FileList.FileId AND Sessions.Valid = 1 AND
  Sessions.SessionId = Position.SessionId AND FileList.FileId = NetworkInfo.FileId AND
  NetworkInfo.FileId = Position.FileId AND
  (NetworkInfo.NetworkId = nr1.NetworkId and Position.PosId > nr1.PosId) AND
  (NetworkInfo.NetworkId + 1 = nr2.NetworkId and Position.PosId <= nr2.PosId) AND
  nr2.type = 'NetworkId' AND nr1.type = 'NetworkId' AND NetworkInfo.CId > 0 AND
  ASideLocation = 'Cosmote GSM'`,
  },
  {
    label: "Cell ID — Vodafone Free A",
    category: "Cell ID",
    sql: `SELECT
  NetworkInfo.CID, NetworkInfo.LAC, NetworkInfo.MCC, NetworkInfo.MNC,
  NetworkInfo.CGI, NetworkInfo.CGI2, NetworkInfo.CGI3, NetworkInfo.Technology,
  NetworkInfo.BCCH as NI_BCCH, NetworkInfo.SC1 as NI_SC1, NetworkInfo.SC2 as NI_SC2, NetworkInfo.SC3 as NI_SC3,
  vBTSList.BTSName, vBTSList.CellName as BTSCellName, vBTSList.Direction as BTSDirection,
  vBTSList.BCCH as BTSBCCH, vBTSList.BSIC as BTSBSIC,
  Position.Latitude, Position.Longitude, Position.PosId, Position.Level as FloorPlanLevel,
  dbo.GetFloorPlanId(FileList.FileId, Position.FloorPlanId) as FloorPlanId,
  Position.Direction + 90 - 360 * FLOOR(((Position.Direction + 90) / 360)) as PositionDirection,
  Sessions.FileId, Sessions.SessionId, FileList.CallingModule, FileList.ASideDevice,
  FileList.ASideLocation, FileList.Zone, FileList.CollectionName,
  SubString(FileList.ASideFileName, 1, 41) as Logname,
  NULL as IndoorMap, NetworkInfo.NetworkId, NetworkInfo.MsgTime
FROM Sessions as Sessions, Position, FileList,
  NetworkIdRelation nr1, NetworkIdRelation nr2,
  NetworkInfo
  LEFT JOIN vBTSList ON vBTSList.CGI = NetworkInfo.CGI
  LEFT JOIN vBTSList as bts2 ON bts2.CGI = NetworkInfo.CGI2
  LEFT JOIN vBTSList as bts3 ON bts3.CGI = NetworkInfo.CGI3
WHERE CollectionName like '%%' AND
  Sessions.FileId = FileList.FileId AND Sessions.Valid = 1 AND
  Sessions.SessionId = Position.SessionId AND FileList.FileId = NetworkInfo.FileId AND
  NetworkInfo.FileId = Position.FileId AND
  (NetworkInfo.NetworkId = nr1.NetworkId and Position.PosId > nr1.PosId) AND
  (NetworkInfo.NetworkId + 1 = nr2.NetworkId and Position.PosId <= nr2.PosId) AND
  nr2.type = 'NetworkId' AND nr1.type = 'NetworkId' AND NetworkInfo.CId > 0 AND
  ASideLocation = 'Vodafone Free A'`,
  },
  {
    label: "Cell ID — Vodafone GSM",
    category: "Cell ID",
    sql: `SELECT
  NetworkInfo.CID, NetworkInfo.LAC, NetworkInfo.MCC, NetworkInfo.MNC,
  NetworkInfo.CGI, NetworkInfo.CGI2, NetworkInfo.CGI3, NetworkInfo.Technology,
  NetworkInfo.BCCH as NI_BCCH, NetworkInfo.SC1 as NI_SC1, NetworkInfo.SC2 as NI_SC2, NetworkInfo.SC3 as NI_SC3,
  vBTSList.BTSName, vBTSList.CellName as BTSCellName, vBTSList.Direction as BTSDirection,
  vBTSList.BCCH as BTSBCCH, vBTSList.BSIC as BTSBSIC,
  Position.Latitude, Position.Longitude, Position.PosId, Position.Level as FloorPlanLevel,
  dbo.GetFloorPlanId(FileList.FileId, Position.FloorPlanId) as FloorPlanId,
  Position.Direction + 90 - 360 * FLOOR(((Position.Direction + 90) / 360)) as PositionDirection,
  Sessions.FileId, Sessions.SessionId, FileList.CallingModule, FileList.ASideDevice,
  FileList.ASideLocation, FileList.Zone, FileList.CollectionName,
  SubString(FileList.ASideFileName, 1, 41) as Logname,
  NULL as IndoorMap, NetworkInfo.NetworkId, NetworkInfo.MsgTime
FROM Sessions as Sessions, Position, FileList,
  NetworkIdRelation nr1, NetworkIdRelation nr2,
  NetworkInfo
  LEFT JOIN vBTSList ON vBTSList.CGI = NetworkInfo.CGI
  LEFT JOIN vBTSList as bts2 ON bts2.CGI = NetworkInfo.CGI2
  LEFT JOIN vBTSList as bts3 ON bts3.CGI = NetworkInfo.CGI3
WHERE CollectionName like '%%' AND
  Sessions.FileId = FileList.FileId AND Sessions.Valid = 1 AND
  Sessions.SessionId = Position.SessionId AND FileList.FileId = NetworkInfo.FileId AND
  NetworkInfo.FileId = Position.FileId AND
  (NetworkInfo.NetworkId = nr1.NetworkId and Position.PosId > nr1.PosId) AND
  (NetworkInfo.NetworkId + 1 = nr2.NetworkId and Position.PosId <= nr2.PosId) AND
  nr2.type = 'NetworkId' AND nr1.type = 'NetworkId' AND NetworkInfo.CId > 0 AND
  ASideLocation = 'Vodafone GSM'`,
  },
  {
    label: "Cell ID — Nova Free A",
    category: "Cell ID",
    sql: `SELECT
  NetworkInfo.CID, NetworkInfo.LAC, NetworkInfo.MCC, NetworkInfo.MNC,
  NetworkInfo.CGI, NetworkInfo.CGI2, NetworkInfo.CGI3, NetworkInfo.Technology,
  NetworkInfo.BCCH as NI_BCCH, NetworkInfo.SC1 as NI_SC1, NetworkInfo.SC2 as NI_SC2, NetworkInfo.SC3 as NI_SC3,
  vBTSList.BTSName, vBTSList.CellName as BTSCellName, vBTSList.Direction as BTSDirection,
  vBTSList.BCCH as BTSBCCH, vBTSList.BSIC as BTSBSIC,
  Position.Latitude, Position.Longitude, Position.PosId, Position.Level as FloorPlanLevel,
  dbo.GetFloorPlanId(FileList.FileId, Position.FloorPlanId) as FloorPlanId,
  Position.Direction + 90 - 360 * FLOOR(((Position.Direction + 90) / 360)) as PositionDirection,
  Sessions.FileId, Sessions.SessionId, FileList.CallingModule, FileList.ASideDevice,
  FileList.ASideLocation, FileList.Zone, FileList.CollectionName,
  SubString(FileList.ASideFileName, 1, 41) as Logname,
  NULL as IndoorMap, NetworkInfo.NetworkId, NetworkInfo.MsgTime
FROM Sessions as Sessions, Position, FileList,
  NetworkIdRelation nr1, NetworkIdRelation nr2,
  NetworkInfo
  LEFT JOIN vBTSList ON vBTSList.CGI = NetworkInfo.CGI
  LEFT JOIN vBTSList as bts2 ON bts2.CGI = NetworkInfo.CGI2
  LEFT JOIN vBTSList as bts3 ON bts3.CGI = NetworkInfo.CGI3
WHERE CollectionName like '%%' AND
  Sessions.FileId = FileList.FileId AND Sessions.Valid = 1 AND
  Sessions.SessionId = Position.SessionId AND FileList.FileId = NetworkInfo.FileId AND
  NetworkInfo.FileId = Position.FileId AND
  (NetworkInfo.NetworkId = nr1.NetworkId and Position.PosId > nr1.PosId) AND
  (NetworkInfo.NetworkId + 1 = nr2.NetworkId and Position.PosId <= nr2.PosId) AND
  nr2.type = 'NetworkId' AND nr1.type = 'NetworkId' AND NetworkInfo.CId > 0 AND
  ASideLocation = 'Nova Free A'`,
  },
  {
    label: "Cell ID — Nova GSM",
    category: "Cell ID",
    sql: `SELECT
  NetworkInfo.CID, NetworkInfo.LAC, NetworkInfo.MCC, NetworkInfo.MNC,
  NetworkInfo.CGI, NetworkInfo.CGI2, NetworkInfo.CGI3, NetworkInfo.Technology,
  NetworkInfo.BCCH as NI_BCCH, NetworkInfo.SC1 as NI_SC1, NetworkInfo.SC2 as NI_SC2, NetworkInfo.SC3 as NI_SC3,
  vBTSList.BTSName, vBTSList.CellName as BTSCellName, vBTSList.Direction as BTSDirection,
  vBTSList.BCCH as BTSBCCH, vBTSList.BSIC as BTSBSIC,
  Position.Latitude, Position.Longitude, Position.PosId, Position.Level as FloorPlanLevel,
  dbo.GetFloorPlanId(FileList.FileId, Position.FloorPlanId) as FloorPlanId,
  Position.Direction + 90 - 360 * FLOOR(((Position.Direction + 90) / 360)) as PositionDirection,
  Sessions.FileId, Sessions.SessionId, FileList.CallingModule, FileList.ASideDevice,
  FileList.ASideLocation, FileList.Zone, FileList.CollectionName,
  SubString(FileList.ASideFileName, 1, 41) as Logname,
  NULL as IndoorMap, NetworkInfo.NetworkId, NetworkInfo.MsgTime
FROM Sessions as Sessions, Position, FileList,
  NetworkIdRelation nr1, NetworkIdRelation nr2,
  NetworkInfo
  LEFT JOIN vBTSList ON vBTSList.CGI = NetworkInfo.CGI
  LEFT JOIN vBTSList as bts2 ON bts2.CGI = NetworkInfo.CGI2
  LEFT JOIN vBTSList as bts3 ON bts3.CGI = NetworkInfo.CGI3
WHERE CollectionName like '%%' AND
  Sessions.FileId = FileList.FileId AND Sessions.Valid = 1 AND
  Sessions.SessionId = Position.SessionId AND FileList.FileId = NetworkInfo.FileId AND
  NetworkInfo.FileId = Position.FileId AND
  (NetworkInfo.NetworkId = nr1.NetworkId and Position.PosId > nr1.PosId) AND
  (NetworkInfo.NetworkId + 1 = nr2.NetworkId and Position.PosId <= nr2.PosId) AND
  nr2.type = 'NetworkId' AND nr1.type = 'NetworkId' AND NetworkInfo.CId > 0 AND
  ASideLocation = 'Nova GSM'`,
  },
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
    label: "OOKLA Speed Test RAW",
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
WHERE CollectionName like '%%' AND s.SessionId IS NOT NULL
ORDER BY ti.TestId, ISNULL(aa.ActionId, aaf.ActionId)`,
  },
  {
    label: "OOKLA Speed Test DL/UL Split",
    category: "Data Tests",
    sql: `SELECT
    dir,
    COUNT(*)                                              AS total_tests,
    SUM(CASE WHEN ErrorCode = 0 THEN 1 ELSE 0 END)       AS success_count,
    AVG(CASE WHEN ErrorCode = 0 THEN thp END)             AS mean_mbps,
    AVG(CASE WHEN ErrorCode = 0 THEN ping_s END)          AS mean_ping_s
FROM (
    SELECT 'DL' AS dir, raap.ErrorCode,
           CAST(raap.DLThroughput AS FLOAT) * 8.0 / 1000000.0      AS thp,
           CAST(ISNULL(raap.Ping, raap.Latency) AS FLOAT) / 1000.0 AS ping_s
    FROM ResultsAppActionPerformance raap
    INNER JOIN TestInfo ti ON raap.TestId  = ti.TestId  AND ti.Valid = 1
    INNER JOIN Sessions  s  ON ti.SessionId = s.SessionId AND s.Valid  = 1
    INNER JOIN FileList  fl ON s.FileId     = fl.FileId
    WHERE fl.CollectionName LIKE '%%' AND fl.ASideLocation LIKE '%%'
    UNION ALL
    SELECT 'UL', raap.ErrorCode,
           CAST(raap.ULThroughput AS FLOAT) * 8.0 / 1000000.0,
           CAST(ISNULL(raap.Ping, raap.Latency) AS FLOAT) / 1000.0
    FROM ResultsAppActionPerformance raap
    INNER JOIN TestInfo ti ON raap.TestId  = ti.TestId  AND ti.Valid = 1
    INNER JOIN Sessions  s  ON ti.SessionId = s.SessionId AND s.Valid  = 1
    INNER JOIN FileList  fl ON s.FileId     = fl.FileId
    WHERE fl.CollectionName LIKE '%%' AND fl.ASideLocation LIKE '%%'
) combined
GROUP BY dir
ORDER BY dir DESC`,
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
  DataSession.JobName as 'Job Name',
  TestInfo.TestName as 'Test Name',
  SessionsCTE.SessionId as 'Session ID',
  TestInfo.TestId as 'Test ID',
  CONVERT(VARCHAR, TestInfo.StartTime, 104) AS 'Date',
  CONVERT(VARCHAR, TestInfo.StartTime, 108) AS 'Time',
  NetworkInfo.Operator,
  NetworkInfo.Technology,
  ResultsVideoStream.Player,
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
  ResultsVQ08StreamAvg.Blurring,
  ResultsVQ08StreamAvg.Tiling
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
  NetworkInfo.CGI, NetworkInfo.Technology,
  Position.Latitude, Position.Longitude, Position.PosId,
  dbo.GetFloorPlanId(FileList.FileId, Position.FloorPlanId) as FloorPlanId,
  Sessions.FileId, Sessions.SessionId,
  FileList.ASideDevice, FileList.ASideLocation, FileList.CollectionName,
  TestInfo.TestName,
  SubString(FileList.ASideFileName, 1, 41) as Logname,
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
function ResultGrid({ result }: { result: QueryResult }) {
  const [page, setPage] = useState(0);
  const [showChart, setShowChart] = useState(false);
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
    <div className="space-y-2">
      {/* View toggle */}
      <div className="flex items-center gap-1">
        <button
          onClick={() => setShowChart(false)}
          className={`flex items-center gap-1 px-2 py-1 rounded border text-[10px] transition-colors ${
            !showChart
              ? "bg-primary/20 border-primary/50 text-primary font-semibold"
              : "bg-muted/40 border-border text-muted-foreground hover:text-foreground"
          }`}
        >
          <Table2 className="h-3 w-3" /> Table
        </button>
        <button
          onClick={() => setShowChart(true)}
          className={`flex items-center gap-1 px-2 py-1 rounded border text-[10px] transition-colors ${
            showChart
              ? "bg-primary/20 border-primary/50 text-primary font-semibold"
              : "bg-muted/40 border-border text-muted-foreground hover:text-foreground"
          }`}
        >
          <BarChart2 className="h-3 w-3" /> Chart
        </button>
      </div>

      {/* Chart view */}
      {showChart && (
        <ResultCharts columns={result.columns} data={result.data} />
      )}

      {/* Table view */}
      {!showChart && (
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

          {/* pagination */}
          {totalPages > 1 && (
            <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
              <button
                disabled={page === 0}
                onClick={() => setPage((p) => p - 1)}
                className="px-2 py-0.5 rounded border border-border bg-muted disabled:opacity-40 hover:bg-muted/70"
              >
                ‹ Prev
              </button>
              <span>
                Page {page + 1} / {totalPages}
              </span>
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

  const applyTemplate = (sql: string) => {
    updateSql(activeTabId, sql);
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
            onClick={() => setShowBuilder((v) => !v)}
            className="text-xs gap-1"
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            Builder
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
                                onClick={() => applyTemplate(tpl.sql)}
                                className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-muted/60 border-b border-border/50 last:border-0 transition-colors"
                              >
                                <ChevronRight className="h-3 w-3 text-primary shrink-0" />
                                {tpl.label}
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
      <AnimatePresence>
        {showBuilder && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <QueryBuilder onApply={(sql) => { updateSql(activeTabId, sql); setShowBuilder(false); }} />
          </motion.div>
        )}
      </AnimatePresence>

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

        {/* Show/hide SQL editor toggle */}
        <button
          onClick={() => setShowSql((v) => !v)}
          className={`ml-auto flex items-center gap-1 px-2.5 py-1 rounded-t-md border border-b-0 text-[11px] transition-colors whitespace-nowrap ${
            showSql
              ? "bg-card border-border text-foreground"
              : "bg-muted/40 border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <Code2 className="h-3 w-3" />
          {showSql ? "Hide Query" : "Show Query"}
        </button>
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

                    {!res.error && res.data.length > 0 && (
                      <button
                        onClick={() =>
                          exportCsv(res.columns, res.data, `${res.label.replace(/\s+/g, "_")}.csv`)
                        }
                        className="ml-auto flex items-center gap-1 px-2 py-0.5 rounded border border-border bg-muted hover:bg-muted/70 transition-colors"
                      >
                        <Download className="h-3 w-3" /> Export CSV
                      </button>
                    )}
                  </div>

                  <ResultGrid result={res} />
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
