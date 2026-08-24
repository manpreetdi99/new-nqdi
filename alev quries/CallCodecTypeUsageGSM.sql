-- ==================================================CallCodecTypeUsageGSM=======================================================
-- Codec Type Usage % (GSM): FR AMR WB / AMR HR / AMR / EFR / FR / HR / no codec rate
-- Ίδιο session/technology φιλτράρισμα με το CallCodecRateDataGSM.sql (Attachment C, A-LEVEL).
-- Το CodecType buckets εδώ πρέπει να μείνουν συγχρονισμένα με το bucketCodec() στο src/lib/attachmentC.ts.


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
),

-- Bucket κάθε test στον codec type του, με τα ίδια κανόνες με το bucketCodec()
-- (src/lib/attachmentC.ts): AMR+WB -> 'FR AMR WB', AMR+HR -> 'AMR HR', AMR -> 'AMR',
-- *EFR* -> 'EFR', ξεκινάει με HR -> 'HR', ξεκινάει με FR -> 'FR', αλλιώς raw name,
-- NULL/'-' -> 'no codec rate'.
BucketedCTE AS (
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
            WHEN vvct.CodecName IS NULL OR vvct.CodecName = '-' THEN 'no codec rate'
            WHEN CHARINDEX('AMR', UPPER(vvct.CodecName)) > 0 AND CHARINDEX('WB', UPPER(vvct.CodecName)) > 0 THEN 'FR AMR WB'
            WHEN CHARINDEX('AMR', UPPER(vvct.CodecName)) > 0 AND CHARINDEX('HR', UPPER(vvct.CodecName)) > 0 THEN 'AMR HR'
            WHEN CHARINDEX('AMR', UPPER(vvct.CodecName)) > 0 THEN 'AMR'
            WHEN CHARINDEX('EFR', UPPER(vvct.CodecName)) > 0 THEN 'EFR'
            WHEN UPPER(vvct.CodecName) LIKE 'HR%' THEN 'HR'
            WHEN UPPER(vvct.CodecName) LIKE 'FR%' THEN 'FR'
            ELSE vvct.CodecName
        END AS CodecType,
        Testinfo.duration * 0.001 AS TestDurationSec,
        Testinfo.testid AS TestId
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
)

SELECT
    ASideFileName,
    TestDescription,
    CollectionName,
    CampaignName,
    UserName,
    ASideLocation,
    ASideDevice,
    BSideDevice,
    ASideNumber,
    BSideNumber,
    FileID,
    SessionID,
    NetworkID,
    Operator,
    Technology,
    CodecType,
    SUM(TestDurationSec) AS TestDuration,
    COUNT(TestId) AS TestCount,
    -- % των tests αυτού του codec type μέσα στο session (FR AMR WB / AMR HR / AMR / EFR / FR / HR / no codec rate αθροίζουν σε 100%)
    CAST(
        COUNT(TestId) * 100.0 /
        SUM(COUNT(TestId)) OVER (PARTITION BY FileID, SessionID)
        AS DECIMAL(5, 2)
    ) AS UsagePercent
FROM
    BucketedCTE
GROUP BY
    ASideFileName,
    TestDescription,
    CollectionName,
    CampaignName,
    UserName,
    ASideLocation,
    ASideDevice,
    BSideDevice,
    ASideNumber,
    BSideNumber,
    FileID,
    SessionID,
    NetworkID,
    Operator,
    Technology,
    CodecType
ORDER BY
    FileID,
    SessionID,
    CASE CodecType
        WHEN 'FR AMR WB' THEN 1
        WHEN 'AMR HR' THEN 2
        WHEN 'AMR' THEN 3
        WHEN 'EFR' THEN 4
        WHEN 'FR' THEN 5
        WHEN 'HR' THEN 6
        WHEN 'no codec rate' THEN 8
        ELSE 7
    END;
