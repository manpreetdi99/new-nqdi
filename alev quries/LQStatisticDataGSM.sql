-- ==================================================LQStatisticDataGSM=======================================================

WITH SessionCTE AS (
    SELECT
        Filelist.FileID,
        Sessions.SessionID,
        Networkinfo.NetworkID,
        Networkinfo.Operator,
        Networkinfo.Technology
    FROM
        Networkinfo,
        Filelist
        JOIN Sessions ON Filelist.FileID = Sessions.FileID
        JOIN Callsession ON Sessions.SessionID = Callsession.SessionID
    WHERE
        Sessions.Valid = 1
        AND Callsession.Callstatus NOT IN ('system release')
        AND Callsession.VoiceCallType IN ('Intrusive')
        AND Networkinfo.NetworkId = (
            SELECT MAX(nf.NetworkId)
            FROM Networkinfo nf
            WHERE Filelist.FileId = nf.FileId AND Sessions.StartTime > nf.Msgtime
        )
        AND ASideLocation LIKE '%GSM'
    GROUP BY
        Filelist.FileID,
        Sessions.SessionID,
        Networkinfo.NetworkID,
        Networkinfo.Operator,
        Networkinfo.Technology
),
LQSilenceCTE AS (
    SELECT
        SessionCTE.*,
        Testinfo.TestId,
        ResultsLQ08Avg.LQWB,
        ResultsLQ08Avg.OptionalWB,
        ResultsLQ08Avg.qualityCode,
        CASE
            WHEN SUBSTRING(REVERSE(ResultsLQ08Avg.QualityCode), 10, 1) LIKE '1' THEN 1
            ELSE NULL
        END AS Silence
    FROM
        SessionCTE
        JOIN Testinfo ON SessionCTE.SessionId = Testinfo.SessionId
        JOIN ResultsLQ08Avg ON Testinfo.TestID = ResultsLQ08Avg.TestID
    WHERE
        ResultsLQ08Avg.Appl % 10 <> 0
)

SELECT 
    FileList.ASideFileName, 
    FileList.TestDescription, 
    FileList.CollectionName,
    FileList.CampaignName,
    FileList.UserName,
    FileList.ASideLocation,
    FileList.ASideDevice,
    FileList.BSideDevice,
    FileList.ASideNumber,
    FileList.BSideNumber, 
    FileList.FileID,
    SessionCTE.SessionID,
    Callsession.Callstatus,
    Callsession.Callcause,
    Callsession.Calltype,
    Callsession.Calldir,
    Callsession.VoiceCalltype,
    SessionCTE.NetworkID,
    SessionCTE.Operator,
    SessionCTE.Technology,
    CASE WHEN vResultsKPI.ErrorCode = 0 THEN 1 ELSE 0 END AS Callconnected,

    CASE 
        WHEN SUM(CASE WHEN LQSilenceCTE.OptionalWB > 0 OR LQSilenceCTE.Silence > 0 THEN 1 ELSE 0 END) > 0
        THEN
            CASE 
                WHEN 15 < 
                    (CONVERT(REAL, SUM(CASE WHEN LQSilenceCTE.OptionalWB < 2.2 OR LQSilenceCTE.Silence > 0 THEN 1 ELSE 0 END)) * 100.0 /
                     CONVERT(REAL, SUM(CASE WHEN LQSilenceCTE.OptionalWB > 0 OR LQSilenceCTE.Silence > 0 THEN 1 ELSE 0 END)))
                THEN 1 ELSE 0 
            END
        ELSE NULL 
    END AS BadCall,

    CASE 
        WHEN SUM(CASE WHEN LQSilenceCTE.OptionalWB > 0 OR LQSilenceCTE.Silence > 0 THEN 1 ELSE 0 END) > 0
        THEN 
            (CONVERT(REAL, SUM(CASE WHEN LQSilenceCTE.OptionalWB < 2.2 OR LQSilenceCTE.Silence > 0 THEN 1 ELSE 0 END)) * 100.0 /
             CONVERT(REAL, SUM(CASE WHEN LQSilenceCTE.OptionalWB > 0 OR LQSilenceCTE.Silence > 0 THEN 1 ELSE 0 END)))
        ELSE NULL 
    END AS Percentage,

    SUM(CASE WHEN LQSilenceCTE.OptionalWB < 2.2 OR LQSilenceCTE.Silence > 0 THEN 1 ELSE 0 END) AS NumBadSample, 
    AVG(LQSilenceCTE.OptionalWB) * COUNT(LQSilenceCTE.OptionalWB) AS SumLQ,
    COUNT(LQSilenceCTE.OptionalWB) AS NumLQ,

    AVG(CASE WHEN Testinfo.direction = 'B->A' THEN LQSilenceCTE.OptionalWB ELSE NULL END) * 
    COUNT(CASE WHEN Testinfo.direction = 'B->A' THEN LQSilenceCTE.OptionalWB ELSE NULL END) AS SumLQDL,

    AVG(CASE WHEN Testinfo.direction = 'A->B' THEN LQSilenceCTE.OptionalWB ELSE NULL END) * 
    COUNT(CASE WHEN Testinfo.direction = 'A->B' THEN LQSilenceCTE.OptionalWB ELSE NULL END) AS SumLQUL,

    COUNT(CASE WHEN Testinfo.direction = 'B->A' THEN LQSilenceCTE.OptionalWB ELSE NULL END) AS NumLQDL,
    COUNT(CASE WHEN Testinfo.direction = 'A->B' THEN LQSilenceCTE.OptionalWB ELSE NULL END) AS NumLQUL,

    SUM(CASE WHEN LQSilenceCTE.Silence > 0 THEN 1 ELSE 0 END) AS NumSilenceSample

FROM
    FileList
    JOIN SessionCTE ON FileList.FileID = SessionCTE.FileID
    JOIN Callsession ON SessionCTE.SessionID = Callsession.SessionID
    LEFT JOIN Testinfo ON SessionCTE.SessionID = Testinfo.SessionID AND Testinfo.Valid = 1
    LEFT JOIN LQSilenceCTE ON Testinfo.TestID = LQSilenceCTE.TestID
    LEFT JOIN vResultsKPI ON SessionCTE.SessionID = vResultsKPI.SessionID AND vResultsKPI.KPIID = 10100

WHERE CollectionName like '%%' AND
    Callsession.Callstatus NOT IN ('system release')
GROUP BY
    FileList.ASideFileName, 
    FileList.TestDescription, 
    FileList.CollectionName,
    FileList.CampaignName,
    FileList.UserName,
    FileList.ASideLocation,
    FileList.ASideDevice,
    FileList.BSideDevice,
    FileList.ASideNumber,
    FileList.BSideNumber, 
    FileList.FileID,
    SessionCTE.SessionID,
    Callsession.Callstatus,
    Callsession.Callcause,
    Callsession.Calltype,
    Callsession.Calldir,
    Callsession.VoiceCalltype,
    SessionCTE.NetworkID,
    SessionCTE.Operator,
    SessionCTE.Technology,
    vResultsKPI.ErrorCode;
