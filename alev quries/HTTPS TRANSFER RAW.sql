Select FileList.ASideFileName as 'A Side File Name', 
FileList.TestDescription As 'Test Description', 
FileList.CollectionName As 'Collection Name',
FileList.CampaignName As 'Campaign Name',
FileList.CallingModule As 'Calling Module',
FileList.UserName As 'User Name',
FileList.ASideDevice As 'A Device',
FileList.BSideDevice As 'B Device', 
FileList.ASideNumber As 'A Side Number', 
FileList.BSideNumber As 'B Side Number',
FileList.ASideLocation As 'A Side Location', 
FileList.BSideLocation As 'B Side Location', 
DataSession.JobName As 'Job Name', 
TestInfo.TestName As 'Test Name',
convert(varchar,TestInfo.StartTime,104) as 'Date',
convert(varchar,TestInfo.StartTime,108) as 'Time', 
NetworkInfo.Cid, 
NetworkInfo.LAC, 
NetworkInfo.Operator,
NetworkInfo.Technology,
Sessions.SessionId As 'Session ID', 
TestInfo.TestId As 'Test ID', 
case when http.ErrorCode = 0 then convert(float,http.Throughput)*0.008 else NULL end as 'Throughput',
http.lastBlock As 'last block', 
case when http.ErrorCode = 0 then http.duration*0.001 else NULL end as Duration,
http.bytesTransferred*0.001 As 'bytes transferred', 
Case	when para.operation ='get' then 'Downlink'
	when para.operation ='put' then 'Uplink'
	else '--' end as Direction,
para.host As 'Host', 
para.LocalFilename As 'local Filename', 
para.RemoteFilename As 'remote Filename',
Case When para.FixedDuration=1 then 'Yes' else 'Non' end as 'Fixed Duration',
http.ErrorCode As 'Error Code',
Errorcodes.msg As 'Error msg',
Case When http.ErrorCode = 0 Then 'successful' Else 'failed' End as 'Error Status',
Case When http.ErrorCode = 0 Then 1 Else 0 End as 'Complete',
Case When http.ErrorCode <>0 Then 1 Else 0 End as 'Failed',
Technology.summary As 'all Technologies',
AccessPoints.Name As 'AP Name',
AccessPoints.APN As 'AP APN',
AccessPoints.APType As 'AP Type',
ISPConfig.IP as 'Client IP',
ISPConfig.IPREsolved as 'Server IP' 

from Sessions	Join FileList On(Sessions.FileId=FileList.FileId)
		Join DataSession On(Sessions.SessionId=DataSession.SessionId)
		Join TestInfo On(Sessions.SessionId=TestInfo.SessionId)
		Join NetworkInfo On(TestInfo.NetworkId=NetworkInfo.NetworkId)
		Join ResultsHTTPTransferTest http On(TestInfo.TestId=http.TestId)
		Join ResultsHTTPTransferParameters para On(http.TestId=para.TestId)
		Join ErrorCodes On(http.errorcode=ErrorCodes.Code)
		Left Join AccessPoints On(TestInfo.TestId=AccessPoints.TestId)
		Join Technology On(Testinfo.Testid=Technology.Testid and Technology.TriggerMsg like '%test end%')
		Left Join ISPConfig On(TestInfo.TestId=ISPConfig.TestId)
where CollectionName like '%%' AND Sessions.Valid=1 And
TestInfo.Valid=1 And
http.lastblock=1