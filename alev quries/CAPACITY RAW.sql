Select FileList.ASideFileName AS 'A Side File Name', 
FileList.TestDescription AS 'Test Description', 
FileList.CollectionName AS 'Collection Name', 
FileList.CampaignName AS 'Campaign Name',
FileList.CallingModule AS 'Calling Module',
FileList.UserName AS 'User Name',
FileList.ASideDevice AS 'A Device',
FileList.BSideDevice AS 'B Device', 
FileList.ASideNumber AS 'A Side Number',
FileList.BSideNumber AS 'B Side Number',
FileList.ASideLocation AS 'A Side Location',
FileList.BSideLocation AS 'B Side Location',
DataSession.JobName AS 'Job Name',
TestInfo.TestName AS 'Test Name',
convert(varchar,TestInfo.StartTime,104) as 'Date',
convert(varchar,TestInfo.StartTime,108) as 'Time', 
NetworkInfo.Cid, 
NetworkInfo.LAC, 
NetworkInfo.Operator AS 'A Side Location',
NetworkInfo.Technology,
Sessions.SessionId AS 'Session ID',
TestInfo.TestId AS 'Test ID',


Case when capa.ErrorCode = 0 and  para.Direction like '%get%' and capa.ThroughputGet <> 0 then convert(float,capa.ThroughputGet)*0.008 else NULL end as 'DLThrptkbps',
Case when capa.ErrorCode = 0 and  para.Direction like '%put%' and capa.ThroughputPut <> 0 then convert(float,capa.ThroughputPut)*0.008 else NULL end as 'ULThrptkbps',

capa.lastBlock AS 'last block',
Case capa.duration when 0 then null else capa.duration*0.001 end as 'Duration',

Case when para.Direction like '%get%' then capa.bytesTransferredget*0.001 else NULL end as 'DLTranskbyte',
Case when para.Direction like '%put%' then capa.bytesTransferredput*0.001 else NULL end as 'ULTranskbyte',


Case when  para.Direction like 'get' then 'Downlink'
	when para.Direction like 'put' then 'Uplink'
	when para.Direction like 'getandput' then 'Downlink/Uplink'
	else '--' end as 'Direction',
para.URICount As 'Number of URIs',
para.URIList As 'List of URIs',
para.LocalFilename As 'Local Filename',
para.Protocol As 'Protocol',
capa.ErrorCode AS 'Error Code',
Errorcodes.msg AS 'Error msg',
Case When capa.ErrorCode=0 Then 'successful' Else 'failed' End as 'Error Status',
Case When capa.ErrorCode=0 Then 1 Else 0 End as 'Complete',
Case When capa.ErrorCode<>0 Then 1 Else 0 End as 'Failed',
Technology.summary AS 'all Technologies',
AccessPoints.Name AS 'AP Name',
AccessPoints.APN AS 'AP APN',
AccessPoints.APType AS 'AP Type',
ISPConfig.IP as 'Client IP',
ISPConfig.IPREsolved as 'Server IP' 

from Sessions	Join FileList On(Sessions.FileId=FileList.FileId)
		Join DataSession On(Sessions.SessionId=DataSession.SessionId)
		Join TestInfo On(Sessions.SessionId=TestInfo.SessionId)
		Join NetworkInfo On(TestInfo.NetworkId=NetworkInfo.NetworkId)
		Join ResultsCapacityTest capa On(TestInfo.TestId=capa.TestId)
		Join ResultsCapacityTestParameters para On(capa.TestId=para.TestId)
		Join ErrorCodes On(capa.errorcode=ErrorCodes.Code)
		Left Join AccessPoints On(TestInfo.TestId=AccessPoints.TestId)
		Join Technology On(Testinfo.Testid=Technology.Testid and Technology.TriggerMsg like '%test end%')
		Left Join ISPConfig On(TestInfo.TestId=ISPConfig.TestId) 
where CollectionName like '%%' AND Sessions.Valid=1 And
TestInfo.Valid=1 And
capa.lastblock=1