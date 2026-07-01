/* SQL Query for presenting the Data Transferred // Minutes of Logs // KMs driven Per CollectionName */

/* KMs */

SELECT distinct
	CollectionName,
	ASideFileName,
	MsgTime,
	latitude,
	longitude
    numSat,
    navMode,
    speed,
    speedUnits,
    ageData,
    pidx,
    Location,
    altitude,
    altitudeUnit,
    Direction,
    Distance
	--Filelist.FileId
into #TempKMs
FROM Position, 
	 Filelist
where Position.FileId=FileList.FileId and 
	  ASideLocation='Cosmote data'
order by MsgTime


select #TempKMs.CollectionName,
	   ROUND(SUM(distance)/1000,3) AS 'KMs'
into #KMs
from #TempKMs
group by #TempKMs.CollectionName


 /* HOURS */

select	Sessions.startTime, 
		Sessions.duration,
		dateadd(ms, duration, Sessions.startTime) as endTime,
		Filelist.CollectionName,
		ASideFileName,
		filelist.ASideLocation
into #tempHOURS
from Sessions, 
	 Filelist
where Sessions.FileId = Filelist.FileId and 
	  ASideLocation IN ('Cosmote Data')


select #tempHOURS.CollectionName,
	   MIN(#tempHOURS.startTime) as 'Start', 
	   MAX(#tempHOURS.endTime) as 'End', 
	   datediff(mi, MIN(#tempHOURS.startTime), MAX(#tempHOURS.endTime)) as 'Minutes',
	   ASideLocation,
	   ASideFileName
into #tempHOURS2
from #tempHOURS
group by #tempHOURS.CollectionName, ASideLocation, ASideFileName


select #tempHOURS2.CollectionName,
	   SUM(#tempHOURS2.Minutes) AS 'Minutes'
into #Hours
from #tempHOURS2
group by #tempHOURS2.CollectionName



 /* DATA TRANSFERRED */

Select	Filelist.CampaignName,
		Filelist.ASideDevice,
		Filelist.BSideDevice,
		Networkinfo.Operator,
		Networkinfo.HomeOperator,
		Testinfo.TypeofTest,
		Testinfo.Direction,
		Testinfo.TestId,
		Sessions.SessionId,
		FileList.CollectionName,
		Sessions.Fileid,
		SUM(CASE
		       WHEN ResultsFTPTest.Errorcode = 0 THEN 1
               WHEN ResultsHTTPBrowserTest.Errorcode = 0 THEN 1
               WHEN ResultsEmailRecvTest.Errorcode = 0 THEN 1
               WHEN ResultsEmailSendTest.Errorcode = 0 THEN 1
               WHEN ResultsHTTPTransferTest.Errorcode = 0 THEN 1
               WHEN ResultsCapacityTest.ErrorCode = 0 THEN 1
               WHEN ResultsAppTest.ErrorCode = 0 THEN 1
               WHEN ResultsPingTest.ErrorCode = 0 THEN 1
               WHEN ResultsVideoStream.State = 'Completed' THEN 1
               ELSE 0
           END) AS TestOK,
		SUM(CASE
               WHEN ResultsFTPTest.Errorcode <> 0 THEN 1
               WHEN ResultsHTTPBrowserTest.Errorcode <> 0 THEN 1
               WHEN ResultsEmailRecvTest.Errorcode <> 0 THEN 1
               WHEN ResultsEmailSendTest.Errorcode <> 0 THEN 1
               WHEN ResultsHTTPTransferTest.Errorcode <> 0 THEN 1
               WHEN ResultsCapacityTest.ErrorCode <> 0 THEN 1
               WHEN ResultsAppTest.ErrorCode <> 0 THEN 1
               WHEN ResultsPingTest.ErrorCode <> 0 THEN 1
               WHEN ResultsVideoStream.State <> 'Completed' THEN 1
               ELSE 0
           END) AS TestFailed
INTO #Tests
from Filelist
     JOIN Sessions ON Filelist.FileId = Sessions.FileID
     JOIN DataSession AS ds ON ds.SessionId = Sessions.SessionId
     JOIN Networkinfo ON Sessions.NetworkId = Networkinfo.NetworkId
     LEFT JOIN Testinfo ON Sessions.SessionId = Testinfo.SessionId
                           AND Testinfo.Valid = 1
                           AND Testinfo.Typeoftest IN ('App', 'App - Cloud Storage Service', 'App - Messaging',
                           'App - Network Performance', 'App - Social media', 'DirecTv Now App No Reference Smartphone',
                           'Netflix App No Reference Smartphone', 'Network Performance', 'YouTube Video Streaming',
                           'Ping', 'FTP', 'HTTPBrowser', 'EMailSend', 'EMailReceive', 'HTTPTransfer', 'Capacity')
     LEFT JOIN ResultsAppTest ON Testinfo.TestId = ResultsAppTest.TestId
     LEFT JOIN ResultsPingTest ON Testinfo.TestId = ResultsPingTest.TestId
                                  AND ResultsPingTest.seqNumber =
     (
      SELECT MAX(pt.seqNumber)
      FROM ResultsPingTest pt
      WHERE pt.TestId = ResultsPingTest.TestId
     )
     LEFT JOIN ResultsFTPTest ON Testinfo.TestId = ResultsFTPTest.TestId
                                 AND ResultsFTPTest.LastBlock = 1
     LEFT JOIN ResultsHTTPBrowserTest ON Testinfo.TestId = ResultsHTTPBrowserTest.TestId
     LEFT JOIN ResultsEmailRecvTest ON Testinfo.TestId = ResultsEmailRecvTest.TestId
     LEFT JOIN ResultsEmailSendTest ON Testinfo.TestId = ResultsEmailSendTest.TestId
     LEFT JOIN ResultsHTTPTransferTest ON Testinfo.TestId = ResultsHTTPTransferTest.TestId
                                          AND ResultsHTTPTransferTest.LastBlock = 1
     LEFT JOIN ResultsCapacityTest ON Testinfo.TestId = ResultsCapacityTest.TestId
                                      AND ResultsCapacityTest.LastBlock = 1
     LEFT JOIN ResultsVideoStream ON ResultsVideoStream.TestId = TestInfo.TestId
	 
where Sessions.Valid = 1 AND ASideLocation like 'Cosmote Data'
group by Filelist.CampaignName,
       Filelist.ASideDevice,
       Filelist.BSideDevice,
       Networkinfo.Operator,
       Networkinfo.HomeOperator,
       Testinfo.TypeofTest,
       Testinfo.Direction,
       Testinfo.TestId,
       Sessions.SessionId,
       Sessions.Fileid,
	   FileList.CollectionName



SELECT vResultsKPI.SessionId,
       vResultsKPI.TestId,
       vResultsKPI.StartTime AS StartTime,
       vResultsKPI.EndTime AS EndTime,
       vResultsKPI.value1 * 0.008 * vResultsKPI.duration * 0.001 AS APSumkByte,
       vResultsKPI.value1 * 0.008 AS APThrpt
	   --#Tests.CollectionName
INTO #APThroughput
FROM vResultsKPI
     JOIN #Tests t ON t.TestId = vResultsKPI.TestId
	 --FileList
WHERE vResultsKPI.KPIID IN (20621, 30200, 30201, 30300, 30301, 30310, 30311, 30400, 30401, 30402, 30411, 30412, 30461, 30462, 30470)
      AND vResultsKPI.ErrorCode = 0


SELECT FileList.CollectionName,
	   SUM(#APThroughput.APSumkByte) / 8000 AS 'Data_Transferred_MBs'
into #DataTransferred
FROM #APThroughput
		LEFT JOIN Sessions ON #APThroughput.SessionId = Sessions.SessionId
		LEFT JOIN FileList ON Sessions.FileId = FileList.FileId
group by FileList.CollectionName


/* na simplirothei to into gia ton parakato pinaka otan einai na mpei sto BI */

select  #KMs.CollectionName, 
		#DataTransferred.[Data_Transferred_MBs],
		#Hours.Minutes,
		#KMs.KMs
into BI_KMS_DATA_HOURS

from #KMs
	 JOIN #Hours ON #Hours.CollectionName = #KMs.CollectionName
	 JOIN #DataTransferred ON #DataTransferred.CollectionName = #KMs.CollectionName

group by #KMs.CollectionName,
		#DataTransferred.[Data_Transferred_MBs],
		#Hours.Minutes,
		#KMs.KMs



DROP TABLE #Tests
DROP TABLE #APThroughput
DROP TABLE #TempKMs
DROP TABLE #tempHOURS
DROP TABLE #tempHOURS2
DROP TABLE #DataTransferred
DROP TABLE #Hours
DROP TABLE #KMs
--DROP TABLE BI_KMS_DATA_HOURS