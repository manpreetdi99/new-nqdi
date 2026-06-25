Select FileList.ASideFileName, 
FileList.TestDescription, 
FileList.CollectionName, 
FileList.ASideDevice as 'A Device', 
Sessions.SessionId, 
TestInfo.TestId, 
TestInfo.StartDate as 'Date', 
TestInfo.StartTime as 'Time', 
NetworkInfo.Cid, 
NetworkInfo.LAC, 
FileList.ASideLocation,
ResultsPingTest.Host, 
case when (ResultsPingTest.ErrorCode=0) then ResultsPingTest.RTT else NULL end as RTT, 
ResultsPingTest.PacketSize, 
ErrorCodes.msg As ErrorCode,
case when (ResultsPingTest.ErrorCode=0) then 1 else 0 end as Success,
case when (ResultsPingTest.ErrorCode=0) then 0 else 1 end as Failed,
ResultsPingTest.seqNumber as 'Sequence Number'
from FileList, Sessions, TestInfo, NetworkInfo, ResultsPingTest, ErrorCodes
where CollectionName like '%%' AND Sessions.Valid = 1 AND TestInfo.Valid = 1 AND
FileList.FileId = Sessions.FileId AND 
TestInfo.SessionId = Sessions.SessionId AND 
ResultsPingTest.TestId = TestInfo.TestId AND 
ResultsPingTest.ErrorCode = ErrorCodes.Code AND 
TestInfo.NetworkId = NetworkInfo.NetworkId