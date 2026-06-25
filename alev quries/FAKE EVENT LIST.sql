-- ==================================================FAKE EVENT LIST=======================================================


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
dbo.AnalysisComment.Comment AS UserComment,
dbo.CallAnalysis.codeDescription AS DiversityComment,
dbo.FileList.ASideFileName,
dbo.FileList.BSideFileName,
dbo.Sessions.valid as SessionValidity
FROM
dbo.Sessions
INNER JOIN dbo.CallAnalysis ON dbo.Sessions.SessionId = dbo.CallAnalysis.SessionId
INNER JOIN dbo.AnalysisCommentSessionsBridge ON dbo.AnalysisCommentSessionsBridge.sessionID = dbo.Sessions.SessionId
INNER JOIN dbo.AnalysisComment ON dbo.AnalysisCommentSessionsBridge.commentId = dbo.AnalysisComment.commentID
INNER JOIN dbo.FileList ON dbo.FileList.FileId = dbo.Sessions.FileId
Where CollectionName like '%%' AND
dbo.Sessions.sessionType = 'CALL'  and 
dbo.Sessions.valid = '0'