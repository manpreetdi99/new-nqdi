SELECT
    DF.ASideLocation AS Location,
    CA.SessionId,
    CONCAT(CA.technology,' -- ',CA.callmode) as technology,
    CA.callType,
    CA.callDir,
    CA.callStatus AS status,
    DF.CollectionName,
    COALESCE(S.startTime, SB.startTime) AS callStartTimeStamp,
    ROUND(CA.setupTime, 2) AS setupTime,
    POS.Latitude AS latitude,
    POS.Longitude AS longitude,
    -- Εδώ προσθέτουμε τον μέσο όρο
    (SELECT ROUND(AVG(OptionalWB),2) AS MOS
     FROM ResultsLQ08Avg 
     WHERE SessionId = CA.SessionId) AS AvgOptionalWB,


	
	 (ca.callDuration/1000) as callDuration,
	 DF.ASideFileName,
	 COALESCE (AC.Comment, s.InvalidReason) AS Comment
FROM CallAnalysis CA
LEFT JOIN FileList DF ON CA.FileId = DF.FileId
LEFT JOIN Position POS ON CA.PosId = POS.PosId
LEFT JOIN Sessions S ON S.SessionId = CA.SessionId
LEFT JOIN SessionsB SB ON SB.SessionId = CA.SessionId
LEFT JOIN AnalysisCommentSessionsBridge ACSB ON ACSB.sessionID = CA.SessionId
LEFT JOIN AnalysisComment AC ON ACSB.commentId = AC.commentID
WHERE DF.CollectionName = 'STR_NAFPAKTOS_MAJOR TOWNS_2026H1'
  AND (S.Valid = 1 OR S.Valid = 0)
ORDER BY callStartTimeStamp



