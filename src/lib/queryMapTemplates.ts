/**
 * Έτοιμα queries του Query Map. Κάθε template δηλώνει τι στήλες περιμένει ο
 * χάρτης (lat/lng, τιμή, label) και ποια χρωματική κλίμακα ταιριάζει.
 * Τα {collection} / {location} αντικαθίστανται από τα φίλτρα του panel.
 */

export type MapMode = "bubble" | "points";

export interface QueryTemplate {
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
  linkCol?: string;
}

export const TEMPLATES: QueryTemplate[] = [

  {
    label: "R24 Voice - MOS/SQ",
    category: "SmartAnalytics R24",
    mode: "points",
    valueCol: "LQ",
    colorScheme: "mos_lq",
    labelCol: "Location",
    requiresFilters: true,
    sql: `SELECT
  CAST(FCV.LatitudeA AS FLOAT) AS latitude,
  CAST(FCV.LongitudeA AS FLOAT) AS longitude,
  FCV.AvgSQ AS LQ,
  FCV.CallStatus,
  FCV.CallSetupTime_s,
  FCV.CallDuration_s,
  FCV.CallTechnologyA,
  DF.Location,
  DF.CollectionName
FROM FactCDRVoice FCV
LEFT JOIN DmnFile DF ON DF.DmnId = FCV.DmnIdFile
WHERE FCV.LatitudeA IS NOT NULL
  AND FCV.LongitudeA IS NOT NULL
  AND FCV.AvgSQ IS NOT NULL
  AND DF.CollectionName = '{collection}'
  AND DF.Location = '{location}'
ORDER BY FCV.CallSessionStartTS`,
  },
  {
    label: "R24 LTE Scanner - top RSRP",
    category: "SmartAnalytics R24",
    mode: "points",
    valueCol: "RSRP",
    colorScheme: "rsrp_data",
    labelCol: "Location",
    requiresFilters: true,
    sql: `SELECT
  CAST(POS.Latitude  AS FLOAT) AS latitude,
  CAST(POS.Longitude AS FLOAT) AS longitude,
  LS.RSRP,
  LS.RSRQ,
  LS.SINR,
  LS.EARFCN,
  LS.PCI,
  LS.CGI,
  DF.Location,
  DF.CollectionName
FROM FactLTEScanner LS
LEFT JOIN DmnPosition POS ON POS.DmnId = LS.DmnIdPosition
LEFT JOIN DmnFile DF ON DF.DmnId = LS.DmnIdFile
WHERE LS.DmnIdTopN_RSRP = 1
  AND POS.Latitude IS NOT NULL
  AND POS.Longitude IS NOT NULL
  AND DF.CollectionName = '{collection}'
  AND DF.Location = '{location}'
ORDER BY LS.FullDate`,
  },
  {
    label: "R24 5G Phone - SS-RSRP",
    category: "SmartAnalytics R24",
    mode: "points",
    valueCol: "SS-RSRP",
    colorScheme: "nr5g_ssrsrp",
    labelCol: "Location",
    requiresFilters: true,
    nrarfcnCol: "NRARFCN",
    sql: `SELECT
  CAST(POS.Latitude  AS FLOAT) AS latitude,
  CAST(POS.Longitude AS FLOAT) AS longitude,
  NR.RSRP AS [SS-RSRP],
  NR.RSRQ AS [SS-RSRQ],
  NR.SINR AS [SS-SINR],
  NR.NRARFCN,
  NR.PCI,
  DF.Location,
  DF.CollectionName
FROM FactNR5GRadio NR
LEFT JOIN DmnPosition POS ON POS.DmnId = NR.DmnIdPosition
LEFT JOIN DmnFile DF ON DF.DmnId = NR.DmnIdFile
WHERE POS.Latitude IS NOT NULL
  AND POS.Longitude IS NOT NULL
  AND NR.RSRP IS NOT NULL
  AND DF.CollectionName = '{collection}'
  AND DF.Location = '{location}'
ORDER BY NR.FullDate`,
  },
  // ── Individual GPS Points ───────────────────────────────────────────────
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
    label: "OOKLA DL Throughput (Mbps)",
    category: "Throughput",
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
    category: "Throughput",
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
    label: "CAPACITY – DL Throughput (grx+akamai+ookla)",
    category: "Throughput",
    mode: "points",
    valueCol: "dl_mbps",
    colorScheme: "ookla_dl",
    labelCol: "Location",
    linkCol: "link",
    sql: `/* ============================================================
   ΚΟΙΝΟ QUERY — App tests + Capacity tests
   Μία στήλη [link]: ServiceProvider για τα APP,
   σύντομο alias του URIList (akamai / grx) για τα CAPACITY
   ============================================================ */

/* --------- APP TESTS --------- */
/* --------- APP TESTS --------- */
SELECT
    'APP'                                  AS TestType,
    CAST(p.Latitude  AS FLOAT)             AS latitude,
    CAST(p.Longitude AS FLOAT)             AS longitude,
    ISNULL(CAST(raap.DLThroughput AS FLOAT) * 8.0 / 1000000.0, 0) AS dl_mbps,
    fl.ASideLocation                       AS Location,
    fl.CollectionName,
    CAST(atp.ServiceProvider AS NVARCHAR(MAX)) AS link,
    CASE COALESCE(aa.ErrorCode, raap.ErrorCode)
         WHEN 0 THEN 'Success' ELSE 'Failed'
    END                                    AS ActionStatus,
    COALESCE(aa.MsgTime, raap.MsgTime)     AS MsgTime
FROM Sessions s
INNER JOIN FileList                    fl   ON fl.FileId    = s.FileId
INNER JOIN TestInfo                    ti   ON ti.SessionId = s.SessionId AND ti.Valid = 1
INNER JOIN ResultsAppTestParameters    atp  ON atp.TestId   = ti.TestId
INNER JOIN Position                    p    ON p.PosId      = ti.PosId
                                           AND p.Latitude  IS NOT NULL
                                           AND p.Longitude IS NOT NULL
INNER JOIN ResultsAppActionPerformance raap ON raap.TestId  = ti.TestId
LEFT  JOIN ResultsAppAction            aa   ON aa.TestId    = ti.TestId AND aa.LastBlock = 1
WHERE s.Valid = 1
  AND fl.CollectionName = '{collection}'
  AND fl.ASideLocation  = '{location}'

UNION ALL

/* --------- CAPACITY TESTS --------- */
SELECT
    'CAPACITY',
    CAST(p.Latitude  AS FLOAT),
    CAST(p.Longitude AS FLOAT),
    ISNULL(CONVERT(FLOAT, rct.ThroughputGet) * 8.0 / 1000000.0, 0),
    fl.ASideLocation,
    fl.CollectionName,
    CAST(CASE
        WHEN rctp.URIList LIKE '%akamai-bench.commsquare.com%' THEN 'akamai'
        WHEN rctp.URIList LIKE '%grx-bench.commsquare.com%'    THEN 'grx'
        ELSE LEFT(rctp.URIList, CHARINDEX(';', rctp.URIList + ';') - 1)
    END AS NVARCHAR(MAX)),                          -- link
    CASE rct.ErrorCode WHEN 0 THEN 'Success' ELSE 'Failed' END,
    rct.MsgTime
FROM Sessions s
INNER JOIN FileList                      fl   ON fl.FileId     = s.FileId
INNER JOIN ResultsCapacityTest           rct  ON rct.SessionId = s.SessionId
INNER JOIN Position                      p    ON p.PosId       = rct.PosId
INNER JOIN ResultsCapacityTestParameters rctp ON rctp.TestId   = rct.TestId
WHERE s.Valid = 1
  AND rct.LastBlock = 1
  AND rctp.Direction LIKE 'get%'
  AND fl.CollectionName = '{collection}'
  AND fl.ASideLocation  = '{location}'

ORDER BY dl_mbps;   -- ή: Location, CollectionName, MsgTime`,
  },
  {
    label: "CAPACITY – UL Throughput (grx+akamai+ookla)",
    category: "Throughput",
    mode: "points",
    valueCol: "ul_mbps",
    colorScheme: "ookla_ul",
    labelCol: "Location",
    linkCol: "link",
    sql: `/* ============================================================
   ΚΟΙΝΟ QUERY — App tests + Capacity tests
   Μία στήλη [link]: ServiceProvider για τα APP,
   σύντομο alias του URIList (akamai / grx) για τα CAPACITY
   ============================================================ */
   
  SELECT
    'APP'                                  AS TestType,
    CAST(p.Latitude  AS FLOAT)             AS latitude,
    CAST(p.Longitude AS FLOAT)             AS longitude,
    ISNULL(CAST(raap.ULThroughput AS FLOAT) * 8.0 / 1000000.0, 0) AS ul_mbps,
    fl.ASideLocation                       AS Location,
    fl.CollectionName,
    CAST(atp.ServiceProvider AS NVARCHAR(MAX)) AS link,
    CASE COALESCE(aa.ErrorCode, raap.ErrorCode)
         WHEN 0 THEN 'Success' ELSE 'Failed'
    END                                    AS ActionStatus,
    COALESCE(aa.MsgTime, raap.MsgTime)     AS MsgTime
FROM Sessions s
INNER JOIN FileList                    fl   ON fl.FileId    = s.FileId
INNER JOIN TestInfo                    ti   ON ti.SessionId = s.SessionId AND ti.Valid = 1
INNER JOIN ResultsAppTestParameters    atp  ON atp.TestId   = ti.TestId
INNER JOIN Position                    p    ON p.PosId      = ti.PosId
                                           AND p.Latitude  IS NOT NULL
                                           AND p.Longitude IS NOT NULL
INNER JOIN ResultsAppActionPerformance raap ON raap.TestId  = ti.TestId
LEFT  JOIN ResultsAppAction            aa   ON aa.TestId    = ti.TestId AND aa.LastBlock = 1
WHERE s.Valid = 1
  AND fl.CollectionName = '{collection}'
  AND fl.ASideLocation  = '{location}'

UNION ALL

/* --------- CAPACITY TESTS --------- */
SELECT
    'CAPACITY',
    CAST(p.Latitude  AS FLOAT),
    CAST(p.Longitude AS FLOAT),
    ISNULL(CONVERT(FLOAT, rct.ThroughputPut) * 8.0 / 1000000.0, 0),
    fl.ASideLocation,
    fl.CollectionName,
    CAST(CASE
        WHEN rctp.URIList LIKE '%akamai-bench.commsquare.com%' THEN 'akamai'
        WHEN rctp.URIList LIKE '%grx-bench.commsquare.com%'    THEN 'grx'
        ELSE LEFT(rctp.URIList, CHARINDEX(';', rctp.URIList + ';') - 1)
    END AS NVARCHAR(MAX)),                          -- link
    CASE rct.ErrorCode WHEN 0 THEN 'Success' ELSE 'Failed' END,
    rct.MsgTime
FROM Sessions s
INNER JOIN FileList                      fl   ON fl.FileId     = s.FileId
INNER JOIN ResultsCapacityTest           rct  ON rct.SessionId = s.SessionId
INNER JOIN Position                      p    ON p.PosId       = rct.PosId
INNER JOIN ResultsCapacityTestParameters rctp ON rctp.TestId   = rct.TestId
WHERE s.Valid = 1
  AND rct.LastBlock = 1
  AND rctp.Direction LIKE 'put%'
  AND fl.CollectionName = '{collection}'
  AND fl.ASideLocation  = '{location}'

ORDER BY ul_mbps;   -- ή: Location, CollectionName, MsgTime`,
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
  CAST(POS.Latitude  AS FLOAT) AS latitude,
  CAST(POS.Longitude AS FLOAT) AS longitude,
  GR.RxLevSub,
  GR.RxQualSub,
  GR.BCCH,
  GR.BSIC,
  DF.Location,
  DF.CollectionName
FROM FactGSMRadio GR
LEFT JOIN DmnPosition POS ON POS.DmnId = GR.DmnIdPosition
LEFT JOIN DmnFile DF ON DF.DmnId = GR.DmnIdFile
WHERE POS.Latitude IS NOT NULL
  AND POS.Longitude IS NOT NULL
  AND GR.RxLevSub IS NOT NULL
  AND DF.CollectionName = '{collection}'
  AND DF.Location = '{location}'
ORDER BY GR.FullDate`,
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
    label: "ALL CALLS",
    category: "Calls",
    mode: "points",
    valueCol: "callStatus",
    colorScheme: "call_status",
    labelCol: "Location",
    requiresFilters: true,
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
  FL.ASideLocation AS Location,
  CAST(P.Latitude  AS FLOAT) AS latitude,
  CAST(P.Longitude AS FLOAT) AS longitude
FROM CallAnalysis CA
LEFT JOIN FileList FL ON CA.FileId = FL.FileId
LEFT JOIN Sessions S  ON S.SessionId = CA.SessionId
LEFT JOIN Position P  ON P.PosId = CA.PosId
WHERE S.Valid IN (0, 1)
  AND FL.CollectionName = '{collection}'
  AND FL.ASideLocation  = '{location}'
ORDER BY CA.SessionId DESC`,
  },
  {
    label: "Problem Calls (Drop / Fail)",
    category: "Calls",
    mode: "points",
    valueCol: "status",
    colorScheme: "call_fail_drop",
    labelCol: "Location",
    requiresFilters: true,
    sql: `SELECT
  CASE
    WHEN CA.callStatus LIKE '%drop%' THEN 'Dropped'
    WHEN CA.callStatus LIKE '%fail%' THEN 'Failed'
    ELSE CA.callStatus
  END                          AS status,
  CA.callStatus                AS callStatus_raw,
  CA.SessionId,
  CA.technology,
  CA.callMode,
  CA.callType,
  CA.callDir,
  ROUND(CA.setupTime, 2)       AS setupTime,
  (CA.callDuration / 1000)     AS callDuration_s,
  DF.CollectionName,
  DF.ASideLocation             AS Location,
  CAST(POS.Latitude  AS FLOAT) AS latitude,
  CAST(POS.Longitude AS FLOAT) AS longitude
FROM CallAnalysis CA
LEFT JOIN FileList DF ON CA.FileId    = DF.FileId
LEFT JOIN Position POS ON CA.PosId    = POS.PosId
LEFT JOIN Sessions S   ON S.SessionId = CA.SessionId
WHERE S.Valid = 1
  AND CA.callStatus NOT IN ('completed', 'System Release')
  AND POS.Latitude  IS NOT NULL
  AND POS.Longitude IS NOT NULL
  AND DF.CollectionName = '{collection}'
  AND DF.ASideLocation  = '{location}'
ORDER BY CA.SessionId DESC`,
  },
  {
    label: "Radio Technology",
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
    label: "Data Technology",
    category: "Technology",
    mode: "points",
    valueCol: "technology_data",
    colorScheme: "technology_data",
    labelCol: "Location",
    sql: `SELECT
  p.Latitude   AS latitude,
  p.Longitude  AS longitude,
  t.CurrTechnology AS technology_data,
  fl.ASideLocation AS Location,
  p.MsgTime
FROM Sessions AS s
JOIN FileList AS fl ON fl.FileId    = s.FileId
JOIN TestInfo AS ti ON ti.SessionId = s.SessionId
JOIN Position AS p  ON p.TestId     = ti.TestId
OUTER APPLY (
    SELECT TOP 1 t2.CurrTechnology
    FROM Technology AS t2
    WHERE t2.TestId  = p.TestId
      AND t2.MsgTime < p.MsgTime
      AND t2.CurrTechnology IS NOT NULL
    ORDER BY t2.MsgTime DESC
) AS t
WHERE s.Valid = 1 AND ti.Valid = 1
  AND fl.CollectionName = '{collection}'
  AND fl.ASideLocation  = '{location}'
  --AND ti.TestName IN ('Capacity DL','FTP DL','HTTP TRANSFER (DL)')   -- <<< Test Data Server DL
  AND p.Latitude  IS NOT NULL AND p.Latitude  <> 0
  AND p.Longitude IS NOT NULL AND p.Longitude <> 0
ORDER BY p.MsgTime`,
  },
  {
    label: "PCI – LTE Measurement Report",
    category: "Technology",
    mode: "points",
    valueCol: "PCI",
    colorScheme: "pci_lte",
    labelCol: "Location",
    sql: `SELECT
  F.CollectionName,
  F.ASideLocation      AS Location,
  POS.PosId,
  CAST(POS.Latitude  AS FLOAT) AS latitude,
  CAST(POS.Longitude AS FLOAT) AS longitude,
  LMR.PhyCellId        AS PCI
FROM LTEMeasurementReport AS LMR
JOIN Position POS ON LMR.PosId     = POS.PosId
JOIN Sessions S    ON LMR.SessionId = S.SessionId
JOIN Filelist F    ON S.FileId      = F.FileId
WHERE POS.Latitude    IS NOT NULL
  AND POS.Longitude   IS NOT NULL
  AND LMR.PhyCellId    IS NOT NULL
  AND F.CollectionName = '{collection}'
  AND F.ASideLocation  = '{location}'
ORDER BY LMR.MsgTime`,
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
    category: "Scanner",
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
    category: "Scanner",
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
    label: "LTE Scanner – RSRP",
    category: "Scanner",
    mode: "points",
    valueCol: "RSRP",
    colorScheme: "rsrp_data",
    labelCol: "Location",
    requiresFilters: true,
    sql: `SELECT
  ls.RSRP,
  ls.RSRQ,
  ls.SINR,
  ls.RSSI,
  ls.EARFCN,
  ls.PCI,
  ls.CGI,
  fl.ASideLocation    AS Location,
  fl.CollectionName,
  CAST(pos.Latitude  AS FLOAT) AS latitude,
  CAST(pos.Longitude AS FLOAT) AS longitude
FROM [dbo].[FactLTEScanner] ls
LEFT JOIN [dbo].[FileList] fl  ON fl.[FileId]  = ls.[FileId]
LEFT JOIN [dbo].[Position] pos ON pos.[PosId]  = ls.[PosId]
WHERE ls.[DmnIdTopN_RSRP] = 1
  AND fl.CollectionName = '{collection}'
  AND fl.ASideLocation  = '{location}'
ORDER BY latitude, longitude`,
  },
  {
    label: "LTE Scanner – SINR",
    category: "Scanner",
    mode: "points",
    valueCol: "SINR",
    colorScheme: "nr5g_sssinr",
    labelCol: "Location",
    requiresFilters: true,
    sql: `SELECT
  ls.SINR,
  ls.RSRP,
  ls.RSRQ,
  ls.RSSI,
  ls.EARFCN,
  ls.PCI,
  ls.CGI,
  fl.ASideLocation    AS Location,
  fl.CollectionName,
  CAST(pos.Latitude  AS FLOAT) AS latitude,
  CAST(pos.Longitude AS FLOAT) AS longitude
FROM [dbo].[FactLTEScanner] ls
LEFT JOIN [dbo].[FileList] fl  ON fl.[FileId]  = ls.[FileId]
LEFT JOIN [dbo].[Position] pos ON pos.[PosId]  = ls.[PosId]
WHERE ls.[DmnIdTopN_SINR] = 1
  AND fl.CollectionName = '{collection}'
  AND fl.ASideLocation  = '{location}'
ORDER BY latitude, longitude`,
  },
  {
    label: "LTE Scanner – RSRQ",
    category: "Scanner",
    mode: "points",
    valueCol: "RSRQ",
    colorScheme: "lte_rsrq",
    labelCol: "Location",
    requiresFilters: true,
    sql: `SELECT
  ls.RSRQ,
  ls.RSRP,
  ls.SINR,
  ls.RSSI,
  ls.EARFCN,
  ls.PCI,
  ls.CGI,
  fl.ASideLocation    AS Location,
  fl.CollectionName,
  CAST(pos.Latitude  AS FLOAT) AS latitude,
  CAST(pos.Longitude AS FLOAT) AS longitude
FROM [dbo].[FactLTEScanner] ls
LEFT JOIN [dbo].[FileList] fl  ON fl.[FileId]  = ls.[FileId]
LEFT JOIN [dbo].[Position] pos ON pos.[PosId]  = ls.[PosId]
WHERE ls.[DmnIdTopN_RSRQ] = 1
  AND fl.CollectionName = '{collection}'
  AND fl.ASideLocation  = '{location}'
ORDER BY latitude, longitude`,
  },
  {
    label: "GSM Scanner – RxLev",
    category: "Scanner",
    mode: "points",
    valueCol: "RxLev",
    colorScheme: "rxlev_scanner_gsm",
    labelCol: "Location",
    requiresFilters: true,
    sql: `SELECT
  gs.RxLev,
  gs.BCCH,
  gs.BSIC,
  gs.LAC,
  gs.CId,
  gs.CGI,
  fl.ASideLocation    AS Location,
  fl.CollectionName,
  CAST(pos.Latitude  AS FLOAT) AS latitude,
  CAST(pos.Longitude AS FLOAT) AS longitude
FROM [dbo].[FactGSMScanner] gs
LEFT JOIN [dbo].[FileList] fl  ON fl.[FileId]  = gs.[FileId]
LEFT JOIN [dbo].[Position] pos ON pos.[PosId]  = gs.[PosId]
WHERE gs.[DmnIdTopN_RxLev] = 1
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
