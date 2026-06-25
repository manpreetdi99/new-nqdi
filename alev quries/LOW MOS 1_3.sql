-- ==================================================LOW MOS 1_3=======================================================
WITH TempCTE AS (
    SELECT
        FileList.CollectionName AS CollectionName,
        l1.sessionid AS SessionID,
        TestInfo.valid,
        FileList.ASideLocation AS ASideLocation,
        Filelist.FileId AS FileID,
        l1.TESTid AS TESTID_1,
        l2.TESTID AS TESTID_2,
        l3.TESTID AS TESTID_3,
        l1.optionalWB AS MOS_1,
        l2.optionalWB AS MOS_2,
        l3.optionalWB AS MOS_3,
        l1.QualityCode AS CODE1,
        l2.QualityCode AS CODE2,
        l3.QualityCode AS CODE3,
        l1.status AS L1status,
        l2.status AS L2status,
        l3.status AS L3status
    FROM
        ResultsLQ08Avg l1
        LEFT JOIN ResultsLQ08Avg l2 ON (l1.TestId + 1 = l2.TestId AND l1.sessionid = l2.SessionId)
        LEFT JOIN ResultsLQ08Avg l3 ON (l1.TestId + 2 = l3.TestId AND l1.sessionid = l3.SessionId)
        JOIN CallSession ON (CallSession.SessionId = l1.SessionID AND CallSession.callStatus = 'Completed') 
        JOIN Sessions ON (CallSession.SessionId = Sessions.SessionId)
        JOIN FileList ON (FileList.FileId = Sessions.FileId)
        JOIN TestInfo ON (TestInfo.TestId = l1.TestId)
    WHERE CollectionName like '%%' AND
        TestInfo.valid = 1
    GROUP BY
        l1.sessionid,
        FileList.CollectionName,
        TestInfo.valid,
        FileList.ASideLocation,
        Filelist.FileId,
        l1.TESTid,
        l2.TESTID,
        l3.TESTID,
        l1.optionalWB,
        l2.optionalWB,
        l3.optionalWB,
        l1.QualityCode,
        l2.QualityCode,
        l3.QualityCode,
        l1.status,
        l2.status,
        l3.status
)

SELECT DISTINCT 
    CollectionName,
    SessionID,
    ASideLocation
FROM TempCTE
WHERE CollectionName like '%%' AND
    (
        (MOS_1 < 1.29 AND MOS_1 > 1.01) 
        OR 
        (L1status = 'Silence' AND (CODE1 = '0001000000000000' OR CODE1 = '0000001000000000'))
    )
    AND 
    (
        (MOS_2 < 1.29 AND MOS_2 > 1.01) 
        OR 
        (L2status = 'Silence' AND (CODE2 = '0001000000000000' OR CODE2 = '0000001000000000'))
    )
    OR
    (
        (MOS_1 < 1.29 AND MOS_1 > 1.01) 
        OR 
        (L1status = 'Silence' AND (CODE1 = '0001000000000000' OR CODE1 = '0000001000000000'))
    )
    AND 
    (
        (MOS_3 < 1.29 AND MOS_3 > 1.01) 
        OR 
        (L3status = 'Silence' AND (CODE3 = '0001000000000000' OR CODE3 = '0000001000000000'))
    )
ORDER BY 
    SessionID;
