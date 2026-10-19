-- ==================================================MOS_RSRP_CODEC=======================================================
-- Μία γραμμή ανά MOS sample (TestId): ASideLocation, MOS, MOS bin (0.5), codec, avg RSRP του test,
-- και δίπλα τα σύνολα ανά ASideLocation + MOS bin (πλήθος, avg RSRP) και ανά codec μέσα στο bin (count + %).
-- Κάθε MOS sample (ResultsLQ08Avg) έχει δικό του TestId -> το RSRP μετριέται μόνο μέσα σε αυτό το test
-- (LTEMeasurementReport.TestId = MOS TestId) και ο codec είναι ο direction-matched codec του ίδιου test.
-- DlCodec / UlCodec: ο codec του ίδιου test στο Direction 'D' και 'U' αντίστοιχα, ανεξάρτητα από το direction του MOS.
-- Το RSRP βγαίνει πρώτα avg ανά test και μετά avg ανά bin, ώστε κάθε MOS sample να μετράει το ίδιο.
-- Tests χωρίς LTE δείγματα (2G/3G) έχουν RSRP NULL: μετράνε στο codec %, όχι στο avg RSRP (βλ. BinTestsWithRSRP).
-- Οι στήλες Bin*/Codec* επαναλαμβάνονται σε κάθε γραμμή του bin: σε pivot πάρε τες με MAX/AVG, όχι SUM.

WITH SessionCTE AS (
    SELECT
        Sessions.SessionID,
        Filelist.ASideLocation
    FROM
        Filelist
        JOIN Sessions ON Filelist.FileID = Sessions.FileID
        JOIN Callsession ON Sessions.SessionID = Callsession.SessionID
    WHERE CollectionName like '%%' AND
        Sessions.Valid = 1 AND
        Callsession.Callstatus NOT IN ('System Release') AND
        Callsession.VoiceCallType IN ('Intrusive') AND
        ASideLocation LIKE '%Free A%'
),

MosTest AS (
    SELECT
        SessionCTE.ASideLocation,
        Testinfo.SessionID,
        Testinfo.TestId,
        Testinfo.direction,
        ResultsLQ08Avg.OptionalWB AS MOS,
        CASE
            WHEN ResultsLQ08Avg.OptionalWB >= 4.5 THEN 4.5
            ELSE FLOOR(ResultsLQ08Avg.OptionalWB * 2) / 2.0
        END AS MosBin,
        CASE
            WHEN vvct.CodecName IS NULL THEN 'no codec rate'
            WHEN vvct.CodecName = '-' THEN 'no codec rate'
            ELSE vvct.CodecName
        END AS CodecRate,
        CASE
            WHEN vvct_dl.CodecName IS NULL THEN 'no codec rate'
            WHEN vvct_dl.CodecName = '-' THEN 'no codec rate'
            ELSE vvct_dl.CodecName
        END AS DlCodec,
        CASE
            WHEN vvct_ul.CodecName IS NULL THEN 'no codec rate'
            WHEN vvct_ul.CodecName = '-' THEN 'no codec rate'
            ELSE vvct_ul.CodecName
        END AS UlCodec,
        (SELECT AVG(CAST(lte.RSRP AS float))
           FROM LTEMeasurementReport lte
          WHERE lte.TestId = Testinfo.TestId) AS TestAvgRSRP
    FROM
        SessionCTE
        JOIN Testinfo ON SessionCTE.SessionID = Testinfo.SessionID AND Testinfo.Valid = 1
        JOIN ResultsLQ08Avg ON Testinfo.TestId = ResultsLQ08Avg.TestId AND ResultsLQ08Avg.Appl % 10 <> 0
        LEFT JOIN vVoiceCodecTest vvct ON Testinfo.TestID = vvct.TestID AND (
            (TestInfo.direction = 'A->B' AND vvct.Direction = 'U') OR
            (TestInfo.direction = 'B->A' AND vvct.Direction = 'D')
        )
        LEFT JOIN vVoiceCodecTest vvct_dl ON Testinfo.TestID = vvct_dl.TestID AND vvct_dl.Direction = 'D'
        LEFT JOIN vVoiceCodecTest vvct_ul ON Testinfo.TestID = vvct_ul.TestID AND vvct_ul.Direction = 'U'
    WHERE
        ResultsLQ08Avg.OptionalWB BETWEEN 1 AND 5
)

SELECT
    ASideLocation,
    SessionID,
    TestId,
    direction,
    ROUND(MOS, 2)                                                             AS MOS,
    CAST(MosBin AS decimal(3,1))                                              AS MosFrom,
    CAST(CASE WHEN MosBin = 4.5 THEN 5.0 ELSE MosBin + 0.5 END AS decimal(3,1)) AS MosTo,
    CodecRate,
    DlCodec,
    UlCodec,
    ROUND(TestAvgRSRP, 2)                                                   AS TestAvgRSRP,
    -- σύνολα του MOS bin ανά ASideLocation
    COUNT(*) OVER (PARTITION BY ASideLocation, MosBin)                        AS BinMosSamples,
    ROUND(100.0 * COUNT(*) OVER (PARTITION BY ASideLocation, MosBin)
                / COUNT(*) OVER (PARTITION BY ASideLocation), 2)              AS BinPctOfLocation,
    COUNT(TestAvgRSRP) OVER (PARTITION BY ASideLocation, MosBin)              AS BinTestsWithRSRP,
    ROUND(AVG(TestAvgRSRP) OVER (PARTITION BY ASideLocation, MosBin), 2)      AS BinAvgRSRP,
    -- ανάλυση ανά codec μέσα στο bin
    COUNT(*) OVER (PARTITION BY ASideLocation, MosBin, CodecRate)             AS CodecTests,
    ROUND(100.0 * COUNT(*) OVER (PARTITION BY ASideLocation, MosBin, CodecRate)
                / COUNT(*) OVER (PARTITION BY ASideLocation, MosBin), 2)      AS CodecPctOfBin,
    ROUND(AVG(TestAvgRSRP) OVER (PARTITION BY ASideLocation, MosBin, CodecRate), 2) AS CodecAvgRSRP,
    -- ίδια ανάλυση για τον DL και τον UL codec του test (ανεξάρτητα από το direction του MOS)
    COUNT(*) OVER (PARTITION BY ASideLocation, MosBin, DlCodec)               AS DlCodecTests,
    ROUND(100.0 * COUNT(*) OVER (PARTITION BY ASideLocation, MosBin, DlCodec)
                / COUNT(*) OVER (PARTITION BY ASideLocation, MosBin), 2)      AS DlCodecPctOfBin,
    COUNT(*) OVER (PARTITION BY ASideLocation, MosBin, UlCodec)               AS UlCodecTests,
    ROUND(100.0 * COUNT(*) OVER (PARTITION BY ASideLocation, MosBin, UlCodec)
                / COUNT(*) OVER (PARTITION BY ASideLocation, MosBin), 2)      AS UlCodecPctOfBin
FROM MosTest
ORDER BY ASideLocation, MosBin, CodecRate, SessionID, TestId;
