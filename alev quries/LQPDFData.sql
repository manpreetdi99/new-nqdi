-- ==================================================LQPDFData=======================================================
WITH SessionCTE AS (
    SELECT
        Filelist.FileID,
        'CM ' + Filelist.CallingModule AS CallingModule,
        Sessions.SessionID,
        Networkinfo.NetworkID,
        Networkinfo.Operator,
        Networkinfo.Technology
    FROM
        Networkinfo,
        Filelist
        JOIN Sessions ON Filelist.FileID = Sessions.FileID
        JOIN Callsession ON Sessions.SessionID = Callsession.SessionID WHERE CollectionName like '%%' AND Sessions.Valid = 1 AND Callsession.Callstatus NOT IN ('System Release') AND Callsession.VoiceCallType IN ('Intrusive')
        AND Networkinfo.NetworkId = (
            SELECT MAX(nf.NetworkId)
            FROM Networkinfo nf
            WHERE Filelist.FileId = nf.FileId AND Sessions.StartTime > nf.Msgtime
        )
    GROUP BY
        Filelist.FileID,
        Filelist.CallingModule,
        Sessions.SessionID,
        Networkinfo.NetworkID,
        Networkinfo.Operator,
        Networkinfo.Technology
)

SELECT
    SessionCTE.FileID,
    SessionCTE.CallingModule,
    SessionCTE.Operator,
    CASE 
        WHEN Testinfo.direction = 'B->A' THEN 'downlink'
        WHEN Testinfo.direction = 'A->B' THEN 'uplink'
        ELSE '--' 
    END AS Direction,
    SessionCTE.Technology,
    CASE 
        WHEN vvct.CodecName IS NULL THEN 'no codec rate'
        WHEN vvct.CodecName = '-' THEN 'no codec rate'
        ELSE vvct.CodecName 
    END AS CodecRate,
    'PDF' AS PDFCDF,
    ROUND(AVG(ResultsLQ08Avg.OptionalWB), 2),
    ROUND(MIN(ResultsLQ08Avg.OptionalWB), 2),
    ROUND(MAX(ResultsLQ08Avg.OptionalWB), 2),
    ROUND(STDEV(ResultsLQ08Avg.OptionalWB), 2),
    SUM(CASE WHEN ResultsLQ08Avg.OptionalWB >= 1   AND ResultsLQ08Avg.OptionalWB < 1.1 THEN 1 ELSE NULL END),
    SUM(CASE WHEN ResultsLQ08Avg.OptionalWB >= 1.1 AND ResultsLQ08Avg.OptionalWB < 1.2 THEN 1 ELSE NULL END),
    SUM(CASE WHEN ResultsLQ08Avg.OptionalWB >= 1.2 AND ResultsLQ08Avg.OptionalWB < 1.3 THEN 1 ELSE NULL END),
    SUM(CASE WHEN ResultsLQ08Avg.OptionalWB >= 1.3 AND ResultsLQ08Avg.OptionalWB < 1.4 THEN 1 ELSE NULL END),
    SUM(CASE WHEN ResultsLQ08Avg.OptionalWB >= 1.4 AND ResultsLQ08Avg.OptionalWB < 1.5 THEN 1 ELSE NULL END),
    SUM(CASE WHEN ResultsLQ08Avg.OptionalWB >= 1.5 AND ResultsLQ08Avg.OptionalWB < 1.6 THEN 1 ELSE NULL END),
    SUM(CASE WHEN ResultsLQ08Avg.OptionalWB >= 1.6 AND ResultsLQ08Avg.OptionalWB < 1.7 THEN 1 ELSE NULL END),
    SUM(CASE WHEN ResultsLQ08Avg.OptionalWB >= 1.7 AND ResultsLQ08Avg.OptionalWB < 1.8 THEN 1 ELSE NULL END),
    SUM(CASE WHEN ResultsLQ08Avg.OptionalWB >= 1.8 AND ResultsLQ08Avg.OptionalWB < 1.9 THEN 1 ELSE NULL END),
    SUM(CASE WHEN ResultsLQ08Avg.OptionalWB >= 1.9 AND ResultsLQ08Avg.OptionalWB < 2 THEN 1 ELSE NULL END),
    SUM(CASE WHEN ResultsLQ08Avg.OptionalWB >= 2   AND ResultsLQ08Avg.OptionalWB < 2.1 THEN 1 ELSE NULL END),
    SUM(CASE WHEN ResultsLQ08Avg.OptionalWB >= 2.1 AND ResultsLQ08Avg.OptionalWB < 2.2 THEN 1 ELSE NULL END),
    SUM(CASE WHEN ResultsLQ08Avg.OptionalWB >= 2.2 AND ResultsLQ08Avg.OptionalWB < 2.3 THEN 1 ELSE NULL END),
    SUM(CASE WHEN ResultsLQ08Avg.OptionalWB >= 2.3 AND ResultsLQ08Avg.OptionalWB < 2.4 THEN 1 ELSE NULL END),
    SUM(CASE WHEN ResultsLQ08Avg.OptionalWB >= 2.4 AND ResultsLQ08Avg.OptionalWB < 2.5 THEN 1 ELSE NULL END),
    SUM(CASE WHEN ResultsLQ08Avg.OptionalWB >= 2.5 AND ResultsLQ08Avg.OptionalWB < 2.6 THEN 1 ELSE NULL END),
    SUM(CASE WHEN ResultsLQ08Avg.OptionalWB >= 2.6 AND ResultsLQ08Avg.OptionalWB < 2.7 THEN 1 ELSE NULL END),
    SUM(CASE WHEN ResultsLQ08Avg.OptionalWB >= 2.7 AND ResultsLQ08Avg.OptionalWB < 2.8 THEN 1 ELSE NULL END),
    SUM(CASE WHEN ResultsLQ08Avg.OptionalWB >= 2.8 AND ResultsLQ08Avg.OptionalWB < 2.9 THEN 1 ELSE NULL END),
    SUM(CASE WHEN ResultsLQ08Avg.OptionalWB >= 2.9 AND ResultsLQ08Avg.OptionalWB < 3 THEN 1 ELSE NULL END),
    SUM(CASE WHEN ResultsLQ08Avg.OptionalWB >= 3   AND ResultsLQ08Avg.OptionalWB < 3.1 THEN 1 ELSE NULL END),
    SUM(CASE WHEN ResultsLQ08Avg.OptionalWB >= 3.1 AND ResultsLQ08Avg.OptionalWB < 3.2 THEN 1 ELSE NULL END),
    SUM(CASE WHEN ResultsLQ08Avg.OptionalWB >= 3.2 AND ResultsLQ08Avg.OptionalWB < 3.3 THEN 1 ELSE NULL END),
    SUM(CASE WHEN ResultsLQ08Avg.OptionalWB >= 3.3 AND ResultsLQ08Avg.OptionalWB < 3.4 THEN 1 ELSE NULL END),
    SUM(CASE WHEN ResultsLQ08Avg.OptionalWB >= 3.4 AND ResultsLQ08Avg.OptionalWB < 3.5 THEN 1 ELSE NULL END),
    SUM(CASE WHEN ResultsLQ08Avg.OptionalWB >= 3.5 AND ResultsLQ08Avg.OptionalWB < 3.6 THEN 1 ELSE NULL END),
    SUM(CASE WHEN ResultsLQ08Avg.OptionalWB >= 3.6 AND ResultsLQ08Avg.OptionalWB < 3.7 THEN 1 ELSE NULL END),
    SUM(CASE WHEN ResultsLQ08Avg.OptionalWB >= 3.7 AND ResultsLQ08Avg.OptionalWB < 3.8 THEN 1 ELSE NULL END),
    SUM(CASE WHEN ResultsLQ08Avg.OptionalWB >= 3.8 AND ResultsLQ08Avg.OptionalWB < 3.9 THEN 1 ELSE NULL END),
    SUM(CASE WHEN ResultsLQ08Avg.OptionalWB >= 3.9 AND ResultsLQ08Avg.OptionalWB < 4 THEN 1 ELSE NULL END),
    SUM(CASE WHEN ResultsLQ08Avg.OptionalWB >= 4   AND ResultsLQ08Avg.OptionalWB < 4.1 THEN 1 ELSE NULL END),
    SUM(CASE WHEN ResultsLQ08Avg.OptionalWB >= 4.1 AND ResultsLQ08Avg.OptionalWB < 4.2 THEN 1 ELSE NULL END),
    SUM(CASE WHEN ResultsLQ08Avg.OptionalWB >= 4.2 AND ResultsLQ08Avg.OptionalWB < 4.3 THEN 1 ELSE NULL END),
    SUM(CASE WHEN ResultsLQ08Avg.OptionalWB >= 4.3 AND ResultsLQ08Avg.OptionalWB < 4.4 THEN 1 ELSE NULL END),
    SUM(CASE WHEN ResultsLQ08Avg.OptionalWB >= 4.4 AND ResultsLQ08Avg.OptionalWB < 4.5 THEN 1 ELSE NULL END),
    SUM(CASE WHEN ResultsLQ08Avg.OptionalWB >= 4.5 AND ResultsLQ08Avg.OptionalWB < 4.6 THEN 1 ELSE NULL END),
    SUM(CASE WHEN ResultsLQ08Avg.OptionalWB >= 4.6 AND ResultsLQ08Avg.OptionalWB < 4.7 THEN 1 ELSE NULL END),
    SUM(CASE WHEN ResultsLQ08Avg.OptionalWB >= 4.7 AND ResultsLQ08Avg.OptionalWB < 4.8 THEN 1 ELSE NULL END),
    SUM(CASE WHEN ResultsLQ08Avg.OptionalWB >= 4.8 AND ResultsLQ08Avg.OptionalWB < 4.9 THEN 1 ELSE NULL END),
    SUM(CASE WHEN ResultsLQ08Avg.OptionalWB >= 4.9 AND ResultsLQ08Avg.OptionalWB <= 5 THEN 1 ELSE NULL END),
    COUNT(ResultsLQ08Avg.OptionalWB) AS CountLQ
FROM
    SessionCTE
    JOIN Testinfo ON SessionCTE.SessionID = Testinfo.SessionId
    JOIN ResultsLQ08Avg ON Testinfo.TestId = ResultsLQ08Avg.TestId
    LEFT JOIN vVoiceCodecTest vvct ON Testinfo.TestID = vvct.TestID AND (
        (TestInfo.direction = 'A->B' AND vvct.Direction = 'U') OR
        (TestInfo.direction = 'B->A' AND vvct.Direction = 'D')
    )
WHERE Testinfo.Valid = 1 AND ResultsLQ08Avg.OptionalWB >= 1 AND ResultsLQ08Avg.OptionalWB <= 5
GROUP BY
    SessionCTE.FileID,
    SessionCTE.CallingModule,
    SessionCTE.Operator,
    Testinfo.direction,
    SessionCTE.Technology,
    vvct.CodecName;
