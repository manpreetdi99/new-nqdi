-- ==================================================EVENT LIST=======================================================

SELECT
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
    COALESCE(dbo.AnalysisComment.Comment,
             dbo.DwAnalysisCommentToSessionMapping.Comment) AS UserComment,
    dbo.CallAnalysis.codeDescription AS DiversityComment,
    dbo.FileList.ASideFileName,
    dbo.FileList.BSideFileName,
    dbo.Sessions.valid AS SessionValidity
FROM
    dbo.Sessions
    INNER JOIN dbo.CallAnalysis
        ON dbo.Sessions.SessionId = dbo.CallAnalysis.SessionId
    INNER JOIN dbo.FileList
        ON dbo.FileList.FileId = dbo.Sessions.FileId
    LEFT JOIN dbo.AnalysisCommentSessionsBridge
        ON dbo.AnalysisCommentSessionsBridge.SessionId = dbo.Sessions.SessionId
    LEFT JOIN dbo.AnalysisComment
        ON dbo.AnalysisCommentSessionsBridge.CommentId = dbo.AnalysisComment.CommentId
    LEFT JOIN dbo.DwAnalysisCommentToSessionMapping
        ON dbo.DwAnalysisCommentToSessionMapping.SessionId = dbo.Sessions.SessionId
WHERE
    dbo.FileList.CollectionName LIKE '%%'
    AND dbo.Sessions.sessionType = 'CALL'
    AND dbo.Sessions.valid = '1'
	and dbo.CallAnalysis.callStatus not like '%comple%'