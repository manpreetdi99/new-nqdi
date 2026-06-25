-- ======================= OOKLA RAW (CTE-Compatible) =======================

WITH SessionsCTE AS (
    SELECT
        SessionId,
        FileId,
        info
    FROM Sessions
    WHERE valid = 1
    GROUP BY SessionId, FileId, info
),
MinDurCTE AS (
    SELECT
        raam.TestId,
        raam.SessionId,
        s.FileId,
        MinDuration = COALESCE(MIN(k1.Duration), MIN(k2.Duration), MIN(k3.Duration), 100)
    FROM SessionsCTE s
    INNER JOIN ResultsAppActionMessaging raam ON raam.SessionId = s.SessionId
    LEFT JOIN ResultsKPI k1 ON k1.SessionId = s.SessionId AND k1.KPIId = 31000 AND k1.TestId = raam.TestId
    LEFT JOIN ResultsKPI k2 ON k2.SessionId = raam.SessionId AND k2.KPIId = 31000
    LEFT JOIN Sessions sss ON sss.FileId = s.FileId
    INNER JOIN ResultsKPI k3 ON k3.SessionId = sss.SessionId AND k3.KPIId = 31000
    GROUP BY raam.TestId, raam.SessionId, s.FileId
),
MinDelDurCTE AS (
    SELECT
        s.FileId,
        MinDeliveryTime = ISNULL(MIN(DATEDIFF(ms, aab.StartTime, aa.LogTime)), 0)
    FROM ResultsAppActionMessaging aa
    LEFT JOIN ResultsAppActionMessaging aab ON aab.Identifier = aa.Identifier
        AND aab.ActionId = aa.ActionId
        AND aab.Direction = 0
        AND aa.Direction = 1
        AND aab.TestId <> aa.TestId
    INNER JOIN SessionsCTE s ON s.SessionId = aa.SessionId
    GROUP BY s.FileId
)

SELECT
    ti.SessionId,
    ti.TestId,
    fl.CollectionName,
    fl.ASideDevice,
    fl.ASideFileName,
    fl.TestDescription,
    fl.ASideNumber,
    s.info AS Session_Info,
    ti.TestName,
    ti.TypeOfTest,
    fl.ASideLocation,
    ni.HomeOperator,
    ni.Technology,
    t.PrevTechnology as 'Data_Technology', 
    CONVERT(VARCHAR, COALESCE(aa.MsgTime, aaf.MsgTime, aam.MsgTime, sm.MsgTime), 121) AS EndTime,
    atp.ServiceProvider AS App,
    atp.ServiceProfileName AS ProfileName,
    COALESCE(aa.ActionId, aaf.ActionId, aam.ActionId, sm.ActionId) AS ActionId,
    COALESCE(aa.Duration, aaf.Duration, aam.Duration, sm.CoreDuration) AS 'Duration[ms]',
    CASE ISNULL(CAST(aa.Throughput AS REAL), aaf.Thp) * 8 / 1000
        WHEN 0 THEN NULL
        ELSE ISNULL(CAST(aa.Throughput AS REAL), aaf.Thp) * 8 / 1000
    END AS Throughput,
    CASE COALESCE(aa.ErrorCode, aaf.ErrorCode, aam.ErrorCode, sm.ErrorCode)
        WHEN 0 THEN 'Success'
        ELSE 'Failed'
    END AS ActionStatus,
    CASE 
        WHEN aap.ActionName = 'Ohome' THEN 'Open Home'
        WHEN aap.ActionName = 'Dp' THEN 'Delete Post'
        WHEN aap.ActionName = 'Cp' THEN 'Create Post'
        WHEN aap.ActionName = 'Lp' THEN 'Like Post'
        WHEN aap.ActionName = 'Cpicture' THEN 'Comment Post'
        WHEN aap.ActionName = 'Opost' THEN 'Open Post'
        WHEN aap.ActionName = 'Oprofile' THEN 'Open Profile'
        ELSE COALESCE(aap.ActionName, aad.ActionName, aau.ActionName, aaf.ActionName, aam.ActionName)
    END AS ActionName,
    aaf.Latency AS 'Latency[ms]',
    aaf.PacketLossPercent  AS 'PacketLoss[%]',
    ni.CGI,
    DATEADD(MS, -1 * COALESCE(aa.Duration, aaf.Duration, aam.Duration, sm.CoreDuration), 
        COALESCE(aa.MsgTime, aaf.MsgTime, aam.MsgTime, sm.MsgTime)) AS StartTime
FROM SessionsCTE s
INNER JOIN FileList fl ON fl.FileId = s.FileId
INNER JOIN TestInfo ti ON s.SessionId = ti.SessionId AND ti.Valid = 1
INNER JOIN ResultsAppTestParameters atp ON ti.TestId = atp.TestId
LEFT JOIN ResultsAppActionSocialMedia sm ON sm.TestId = ti.TestId
LEFT JOIN ResultsAppAction aa ON ti.TestId = aa.TestId AND aa.LastBlock = 1
LEFT JOIN ResultsAppActionParams aap ON (aap.TestId = aa.TestId OR aap.TestId = sm.TestId)
    AND (aap.ActionId = aa.ActionId OR aap.ActionId = sm.ActionId)
LEFT JOIN ResultsAppActionDownloadFileParams aad ON ti.TestId = aad.TestId AND aad.ActionId = aa.ActionId
LEFT JOIN ResultsAppActionUploadFileParams aau ON ti.TestId = aau.TestId AND aau.ActionId = aa.ActionId
LEFT JOIN (
    SELECT 
        TestId,
        ActionId,
        MsgTime,
        ErrorCode,
        NetworkId,
        Duration = 1000 * CAST(DLSize AS REAL) / NULLIF(DLThroughput, 0),
        TransSize = DLSize,
        Thp = DLThroughput,
        ActionName = 'Downlink Performance',
        Latency = ISNULL(Ping, Latency),
        PacketLossPercent
    FROM ResultsAppActionPerformance
    UNION ALL
    SELECT 
        TestId,
        ActionId,
        MsgTime,
        ErrorCode,
        NetworkId,
        Duration = 1000 * CAST(ULSize AS REAL) / NULLIF(ULThroughput, 0),
        TransSize = ULSize,
        Thp = ULThroughput,
        ActionName = 'Uplink Performance',
        Latency = ISNULL(Ping, Latency),
        PacketLossPercent
    FROM ResultsAppActionPerformance
) aaf ON ti.TestId = aaf.TestId
LEFT JOIN (
    SELECT  
        r.TestId,
        r.ActionId,
        r.MsgTime,
        r.ErrorCode,
        r.NetworkId,
        r.Direction,
        CASE r.MessagingType
            WHEN 1 THEN 'Text'
            WHEN 2 THEN 'Sticker'
            WHEN 3 THEN 'Photo'
            WHEN 4 THEN 'Audio'
            WHEN 5 THEN 'Video'
            ELSE NULL
        END AS ActionName,
        CASE r.Direction
            WHEN 0 THEN r.Duration
            WHEN 1 THEN DATEDIFF(ms, ref.StartTime, r.LogTime)
                       - ISNULL(mdd.MinDeliveryTime, 0)
                       + ISNULL(md.MinDuration, 100)
            ELSE NULL
        END AS Duration
    FROM ResultsAppActionMessaging r
    INNER JOIN SessionsCTE s2 ON s2.SessionId = r.SessionId
    LEFT JOIN MinDurCTE md ON r.TestId = md.TestId
    INNER JOIN MinDelDurCTE mdd ON s2.FileId = mdd.FileId
    LEFT JOIN ResultsAppActionMessaging ref ON ref.Identifier = r.Identifier
        AND ref.ActionId = r.ActionId
        AND ref.Direction = 0 AND r.Direction = 1
) aam ON ti.TestId = aam.TestId
INNER JOIN NetworkInfo ni ON ni.NetworkId = ISNULL(ISNULL(ISNULL(aa.NetworkId, aaf.NetworkId), aam.NetworkId), ti.NetworkId)
LEFT JOIN Technology t ON t.PrevTechnology IS NOT NULL AND (
    (t.TestId = sm.TestId AND sm.MsgTime BETWEEN DATEADD(ms, -1 * t.Duration, t.MsgTime) AND t.MsgTime) OR
    (t.TestId = aam.TestId AND aam.MsgTime BETWEEN DATEADD(ms, -1 * t.Duration, t.MsgTime) AND t.MsgTime) OR
    (t.TestId = aaf.TestId AND aaf.MsgTime BETWEEN DATEADD(ms, -1 * t.Duration, t.MsgTime) AND t.MsgTime) OR
    (t.TestId = aa.TestId AND aa.MsgTime BETWEEN DATEADD(ms, -1 * t.Duration, t.MsgTime) AND t.MsgTime)
)
Where CollectionName like '%%' AND s.SessionId is not null
ORDER BY ti.TestId, ISNULL(aa.ActionId, aaf.ActionId);
