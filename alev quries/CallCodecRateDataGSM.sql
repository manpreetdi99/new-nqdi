-- ==================================================CallCodecRateGSM=======================================================


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
        Sessions.Valid = 1 AND
        Callsession.Callstatus NOT IN ('System Release') AND
        Callsession.VoiceCallType IN ('Intrusive') AND
        Networkinfo.NetworkId = (
            SELECT MAX(nf.NetworkId)
            FROM Networkinfo nf
            WHERE Filelist.FileId = nf.FileId AND Sessions.StartTime > nf.Msgtime
        ) AND
        ASideLocation LIKE '%GSM'
    GROUP BY
        Filelist.FileID,
        Sessions.SessionID,
        Networkinfo.NetworkID,
        Networkinfo.Operator,
        Networkinfo.Technology
)

SELECT 
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
    SessionCTE.SessionID,
    SessionCTE.NetworkID,
    SessionCTE.Operator,
    SessionCTE.Technology,
    CASE 
        WHEN vvct.CodecName IS NULL THEN 'no codec rate'
        WHEN vvct.CodecName = '-' THEN 'no codec rate'
        ELSE vvct.CodecName 
    END AS CodecRate,
    SUM(Testinfo.duration * 0.001) AS Testduration,
    COUNT(Testinfo.testid) AS TestCount
FROM
    Filelist
    JOIN SessionCTE ON Filelist.FileID = SessionCTE.FileID
    JOIN Testinfo ON SessionCTE.SessionID = Testinfo.SessionID AND Testinfo.Valid = 1
    JOIN ResultsLQ08Avg ON Testinfo.TestId = ResultsLQ08Avg.TestId AND ResultsLq08Avg.Appl % 10 <> 0
    LEFT JOIN vVoiceCodecTest vvct ON Testinfo.TestID = vvct.TestID AND (
        (TestInfo.direction = 'A->B' AND vvct.Direction = 'U') OR
        (TestInfo.direction = 'B->A' AND vvct.Direction = 'D')
    )
WHERE CollectionName like '%%' AND
    ASideFileName IS NOT NULL
GROUP BY
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
    SessionCTE.SessionID,
    SessionCTE.NetworkID,
    SessionCTE.Operator,
    SessionCTE.Technology,
    vvct.CodecName;

