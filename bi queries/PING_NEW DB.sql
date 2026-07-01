Select 

Sessions.FileId,
Sessions.SessionId,
Testinfo.TestId,
TestInfo.StartNetworkID,
testFinishTime = DATEADD(ms,TestInfo.duration,TestInfo.startTime),
	TestInfo.NetworkId
Into #tmpSessions
-------------------------------------------------------------------------------------------------------
from 

Sessions Join Testinfo On(Sessions.SessionId=Testinfo.SessionId)

-------------------------------------------------------------------------------
where 
Sessions.Valid=1 And
TestInfo.Valid=1 And
TestInfo.TypeofTest like '%Ping%'
----------------------------------------------------------------------
group by

Sessions.FileId,
Sessions.SessionId,
Testinfo.TestId,
TestInfo.StartNetworkID,
TestInfo.duration,
TestInfo.startTime,
TestInfo.NetworkId

Select	distinct t.testId,
	t.StartNetworkID,
	testStartMode = networkInfo.technology,
	testStartLat = 33.333,
	testStartLong = 33.333,
	testStartLAC = networkInfo.LAC,
	testStartCellId = networkInfo.CId,
	testStartBCCH = networkInfo.BCCH,
	testStartFreq = NULL,
	testStartPSC = NULL,
	testStartRSCP = NULL,
	testStartEcNo = NULL,
	testStartEARFCN = NULL,
	testStartPCI = NULL,
	testStartRSRP = NULL,
	testStartSINR = NULL,
	testStartBW = NULL,
	testStartGSM = NULL,
	testStartRxLev = NULL,
	testStartRxQual = NULL,
	testAvgRxlev = NULL,
	testAvgRxQual = NULL,
	testAvgRSCP = NULL,
	testAvgEcNo = NULL,
	testAvgRSRP = NULL,
	testAvgSINR = NULL
into    #tmptestStartMode
from 	#tmpSessions t, networkInfo, networkIdRelation, Position
where 	t.StartNetworkID = networkInfo.networkId AND
		networkInfo.networkId = networkIdRelation.networkId AND
		networkIdRelation.PosId = Position.PosId AND
		networkIdRelation.MsgTime = (select min(nid.MsgTime) from networkIdRelation nid
			where nid.networkId = networkinfo.networkId)

Update #tmptestStartMode
Set #tmptestStartMode.testStartGSM=MsgGSMReport.BCCH,
	#tmptestStartMode.testStartRxLev=MsgGSMReport.RxLev,
	#tmptestStartMode.testStartRxQual=MsgGSMReport.RxQual
from #tmptestStartMode, MsgGSMReport
where #tmptestStartMode.TestId = MsgGSMReport.TestId AND
	MsgGSMReport.MsgId = (select min(gsm.msgId) + 4 from MsgGSMReport gsm
		where gsm.TestId = #tmptestStartMode.TestId)
		------------------------------------------------------------ lat lot for duplicate values-------
Update #tmptestStartMode
Set #tmptestStartMode.testStartLat = Position.latitude ,
	#tmptestStartMode.testStartLong =Position.longitude
	
from #tmptestStartMode, Position
where #tmptestStartMode.TestId = Position.TestId AND
	Position.MsgTime = (select min(pos.MsgTime)  from Position pos
		where pos.TestId = #tmptestStartMode.TestId)
-------------------------------------------------------------------------------------------------
Update #tmptestStartMode
Set #tmptestStartMode.testStartFreq=WCDMAActiveSet.FreqDL,
	#tmptestStartMode.testStartPSC=WCDMAActiveSet.PrimScCode,
	#tmptestStartMode.testStartRSCP=WCDMAActiveSet.RSCP_PSC,
	#tmptestStartMode.testStartEcNo=WCDMAActiveSet.AggrEcIo_PSC
from #tmptestStartMode, WCDMAActiveSet
where #tmptestStartMode.testId = WCDMAActiveSet.TestId AND
	WCDMAActiveSet.MsgId = (select min(wcdma.msgId) + 1 from WCDMAActiveSet wcdma
		where wcdma.testId = #tmptestStartMode.testId)
		
Update #tmptestStartMode
Set --#tmptestStartMode.testStartEARFCN=LTEServingCellInfo.DL_EARFCN,
	--#tmptestStartMode.testStartPCI=LTEServingCellInfo.PhyCellId
	#tmptestStartMode.testStartBW=LTEServingCellInfo.DLBandwidth
from #tmptestStartMode, LTEServingCellInfo
where #tmptestStartMode.testId = LTEServingCellInfo.TestId AND
	LTEServingCellInfo.LTEServingCellInfoId = (select min(lte.LTEServingCellInfoId) from LTEServingCellInfo lte
	where lte.testId = #tmptestStartMode.testId)
------------------------------------------------- start for avg Radio---------------------------------------------------------------------
Update #tmptestStartMode
Set #tmptestStartMode.testAvgRSRP =LTEMeasurementReport.RSRP
	--##tmpCallStartMode.testStartSINR=LTEMeasurementReport.SINR0
from #tmptestStartMode, LTEMeasurementReport 
--where ##tmpCallStartMode.sessionId = AVG(LTEMeasurementReport.sessionId )AND 
	where LTEMeasurementReport.RSRP = (select cast(round(AVG(lte.RSRP),2) as bigint) from LTEMeasurementReport lte  where lte.TestId=#tmptestStartMode.TestId ) 

Update #tmptestStartMode
Set --##tmpCallStartModetest.testAvgRSRP=LTEMeasurementReport.RSRP
	#tmptestStartMode.testAvgSINR=LTEMeasurementReport.SINR0
from #tmptestStartMode, LTEMeasurementReport 
--where ##tmpCallStartMode.sessionId = AVG(LTEMeasurementReport.sessionId )AND 
	where --(LTEMeasurementReport.RSRP = (select cast(round(AVG(lte.RSRP),2) as bigint) from LTEMeasurementReport lte  where lte.SessionId=##tmpCallStartModetest.sessionId  ) ) 
	        (LTEMeasurementReport.SINR0 = (select cast(round(AVG(lte.SINR0),2) as bigint) from LTEMeasurementReport lte  where lte.TestId=#tmptestStartMode.TestId  ) )


Update #tmptestStartMode
Set #tmptestStartMode.testAvgRxlev=MsgGSMReport.RxLev
	--##tmpCallStartModetest.testStartRxQual=MsgGSMReport.RxQual
from #tmptestStartMode, MsgGSMReport
where 
	MsgGSMReport.RxLev = (select cast(round(AVG(gsm.RxLev),2) as int)  from MsgGSMReport gsm
		where gsm.TestId = #tmptestStartMode.TestId)

Update #tmptestStartMode
Set --##tmpCallStartModetest.testAvgRxlev=MsgGSMReport.RxLev
	#tmptestStartMode.testAvgRxQual=MsgGSMReport.RxQual
from #tmptestStartMode, MsgGSMReport
where 
	MsgGSMReport.RxQual = (select cast(round(AVG(gsm.RxQual),2) as int)  from MsgGSMReport gsm
		where gsm.TestId = #tmptestStartMode.TestId)

Update #tmptestStartMode
Set #tmptestStartMode.testAvgRSCP=WCDMAActiveSet.RSCP_PSC
	--##tmpCallStartMode.testStartEcNo=WCDMAActiveSet.AggrEcIo_PSC
from #tmptestStartMode, WCDMAActiveSet
where 
	WCDMAActiveSet.RSCP_PSC = (select cast(round(AVG(wcdma.RSCP_PSC),2)as int) from WCDMAActiveSet wcdma
		where wcdma.TestId = #tmptestStartMode.TestId)


Update #tmptestStartMode
Set --##tmpCallStartModetest.testAvgRSCP=WCDMAActiveSet.RSCP_PSC
	#tmptestStartMode.testAvgEcNo=WCDMAActiveSet.AggrEcIo_PSC
from #tmptestStartMode, WCDMAActiveSet
where 
	WCDMAActiveSet.AggrEcIo_PSC = (select cast(round(AVG(wcdma.AggrEcIo_PSC),2)as int) from WCDMAActiveSet wcdma
		where wcdma.TestId = #tmptestStartMode.TestId)


---------------------------------------------------end for avg RSRP-------------------------------------
		
Update #tmptestStartMode
Set #tmptestStartMode.testStartRSRP=LTEMeasurementReport.RSRP,
	#tmptestStartMode.testStartSINR=LTEMeasurementReport.SINR0,
	#tmptestStartMode.testStartEARFCN=LTEMeasurementReport.EARFCN,
	#tmptestStartMode.testStartPCI=LTEMeasurementReport.PhyCellId
from #tmptestStartMode, LTEMeasurementReport
where #tmptestStartMode.TestId = LTEMeasurementReport.TestId AND
	LTEMeasurementReport.MsgId = (select min(lte.msgId)  from LTEMeasurementReport lte
		where lte.TestId = #tmptestStartMode.TestId) --AND
	--lte.EARFCN = ##tmpCallStartMode.testStartEARFCN AND
		--lte.PhyCellId = ##tmpCallStartMode.testStartPCI)
		
Select 	t.testId,
    	t.testFinishTime,
		t.NetworkId,
		testEndLat = Position.Latitude,
		testEndLong = Position.Longitude,
		testEndLAC = networkInfo.LAC,
		testEndCellId = networkInfo.CId,
		testEndBCCH = networkInfo.BCCH,
		testEndFreq = NULL,
		testEndPSC = NULL,
		testEndRSCP = NULL,
		testEndEcNo = NULL,
		testEndEARFCN = NULL,
		testEndPCI = NULL,
		testEndRSRP = NULL,
		testEndSINR = NULL,
		testEndBW = NULL,
		testEndGSM = NULL,
		testEndRxLev = NULL,
		testEndRxQual = NULL
into 	#tmptestEndTime
from   	#tmpSessions t, networkInfo, networkIdRelation, Position
where 	t.NetworkId = networkInfo.networkId AND
		networkInfo.networkId = networkIdRelation.networkId AND
		networkIdRelation.TestId = t.TestId AND
		networkIdRelation.PosId = Position.PosId AND 
		networkIdRelation.MsgTime = (select max(nir.MsgTime) from networkIdRelation nir
				where nir.TestId = t.TestId AND
					nir.networkId = networkInfo.networkId AND
					 nir.MsgTime <= t.testFinishTime)

Update #tmptestEndTime
Set #tmptestEndTime.testEndGSM=MsgGSMReport.BCCH,
	#tmptestEndTime.testEndRxLev=MsgGSMReport.RxLev,
	#tmptestEndTime.testEndRxQual=MsgGSMReport.RxQual
from #tmptestEndTime, MsgGSMReport
where #tmptestEndTime.TestId = MsgGSMReport.TestId AND
	MsgGSMReport.MsgId = (select max(gsm.msgId) from MsgGSMReport gsm
		where gsm.TestId = #tmptestEndTime.TestId)

Update #tmptestEndTime
Set #tmptestEndTime.testEndFreq=WCDMAActiveSet.FreqDL,
	#tmptestEndTime.testEndPSC=WCDMAActiveSet.PrimScCode,
	#tmptestEndTime.testEndRSCP=WCDMAActiveSet.RSCP_PSC,
	#tmptestEndTime.testEndEcNo=WCDMAActiveSet.AggrEcIo_PSC
from #tmptestEndTime, WCDMAActiveSet
where #tmptestEndTime.testId = WCDMAActiveSet.TestId AND
	WCDMAActiveSet.MsgId = (select max(wcdma.msgId) from WCDMAActiveSet wcdma
		where wcdma.testId = #tmptestEndTime.testId)
		
Update #tmptestEndTime
Set --#tmptestEndTime.testEndEARFCN=LTEServingCellInfo.DL_EARFCN,
	--#tmptestEndTime.testEndPCI=LTEServingCellInfo.PhyCellId,
	#tmptestEndTime.testEndBW=LTEServingCellInfo.DLBandwidth
from #tmptestEndTime, LTEServingCellInfo
where #tmptestEndTime.testId = LTEServingCellInfo.TestId AND
	LTEServingCellInfo.LTEServingCellInfoId = (select max(lte.LTEServingCellInfoId) from LTEServingCellInfo lte
		where lte.testId = #tmptestEndTime.testId)
		
Update #tmptestEndTime
Set #tmptestEndTime.testEndEARFCN=LTEMeasurementReport.EARFCN,
	#tmptestEndTime.testEndPCI=LTEMeasurementReport.PhyCellId,
	#tmptestEndTime.testEndRSRP=LTEMeasurementReport.RSRP,
	#tmptestEndTime.testEndSINR=LTEMeasurementReport.SINR0
from #tmptestEndTime, LTEMeasurementReport
where #tmptestEndTime.testId = LTEMeasurementReport.TestId AND
	LTEMeasurementReport.MsgId = (select max(lte.msgId) from LTEMeasurementReport lte
		where lte.testId = #tmptestEndTime.testId)

Select n.Operator,
    n.HomeOperator,
	#tmpSessions.SessionId, 
	t.TestId,
	CAST(datepart(dd,t.startTime) as varchar)+'.'+CAST(datepart(mm,t.startTime) as varchar)+'.'+CAST(datepart(yy,t.startTime) as varchar) as CallDate,
        CAST(datepart(hh,t.startTime) as Varchar)+':'+CAST(datepart(mi,t.startTime) as varchar)+':'+CAST(datepart(ss,t.startTime) as varchar)+'.'+CAST(datepart(ms,t.startTime) as varchar) as CallStartTime,
	CAST(datepart(hh,#tmptestEndTime.testFinishTime) as Varchar)+':'+CAST(datepart(mi,#tmptestEndTime.testFinishTime) as varchar)+':'+
	CAST(datepart(ss,#tmptestEndTime.testFinishTime) as varchar)+'.'+CAST(datepart(ms,#tmptestEndTime.testFinishTime) as varchar) as CallFinishTime,
	FileList.CollectionName,
    FileList.ASideLocation,	 
	t.TestName,
	--FileList.IMEI,
	#tmptestStartMode.TestStartMode,
	#tmptestStartMode.TestStartLat,
	#tmptestStartMode.TestStartLong,
	#tmptestStartMode.TestStartLAC,
	#tmptestStartMode.TestStartCellId,
	#tmptestStartMode.TestStartBCCH,
	#tmptestStartMode.TestStartEARFCN,
	#tmptestStartMode.TestStartPCI,
	--#tmptestStartMode.TestStartRSRP,
	--#tmptestStartMode.TestStartSINR,
	#tmptestStartMode.testStartBW,
	#tmptestStartMode.TestStartFreq,
	#tmptestStartMode.TestStartPSC,
	--#tmptestStartMode.TestStartRSCP,
	--#tmptestStartMode.TestStartEcNo,
	--#tmptestStartMode.testStartRxLev,
	--#tmptestStartMode.testStartRxQual,
	case when Technology.summary IN ('gprs','edge','edge/gprs') then 'GSM' else
		case when Technology.summary IN ('lte') then 'LTE' else
		case when Technology.summary IN ('LTE CA') then 'LTE CA' else
		case when Technology.summary IN ('LTE/LTE CA') then 'LTE/LTE CA' else
		case when Technology.summary like '%LTE-5G NR%' then 'LTE-5GNR' else
		case when ((technology.Summary like 'h%' OR technology.Summary like 'r%' ) and technology.Summary not like '%lte%') then 'UMTS' else
		case when (Technology.summary like 'edge/h%' 
				OR Technology.summary like 'edge/r%' 
				OR Technology.summary like 'edge/l%' 
				OR Technology.summary like 'gprs/%' 
				OR Technology.summary is null
				OR Technology.summary like 'edge/gprs/%' 
				OR ((technology.Summary like 'h%' OR technology.Summary like 'r%'OR technology.Summary like 'LTE/R%' ) and technology.Summary like '%lte%')) then 'Mixed' 
					end end end end end end end as DataTechnology,
    technology.Summary,	
	--#tmptestEndTime.TestEndLat,
	--#tmptestEndTime.TestEndLong,
	n.Technology,
	--#tmptestEndTime.TestEndLAC,
	--#tmptestEndTime.TestEndCellId,
	--#tmptestEndTime.TestEndBCCH,
	--#tmptestEndTime.TestEndEARFCN,
	--#tmptestEndTime.testEndBW,
	--#tmptestEndTime.TestEndPCI,
	--#tmptestEndTime.TestEndRSRP,
	--#tmptestEndTime.TestEndSINR,
	--#tmptestEndTime.TestEndFreq,
	--#tmptestEndTime.TestEndPSC,
	--#tmptestEndTime.TestEndRSCP,
	--#tmptestEndTime.TestEndEcNo,
	--#tmptestEndTime.testEndRxLev,
	--#tmptestEndTime.testEndRxQual,
	#tmptestStartMode.testAvgRxlev ,
	#tmptestStartMode.testAvgRxQual ,
	#tmptestStartMode.testAvgRSCP ,
	#tmptestStartMode.testAvgEcNo ,
	#tmptestStartMode.testAvgRSRP ,
	#tmptestStartMode.testAvgSINR,
ResultsPingTest.Host, 
case when (ResultsPingTest.ErrorCode=0) then ResultsPingTest.RTT else NULL end as RTT, 
ResultsPingTest.PacketSize, 


ErrorCodes.msg As Code,
ResultsPingTest.seqNumber,
AccessPoints.Name,
AccessPoints.APN,
AccessPoints.APType

into #tmp_BI_PING
--into BI_PING

From
#tmpSessions	Join	Filelist On(#tmpSessions.FileID=FileList.FileID AND (FileList.ASideLocation like '%Data%'))
		Join	Testinfo t On(#tmpSessions.TestId=t.TestId)
		Left Join	ResultsPingTest On(t.TestId=ResultsPingTest.TestId)
		Left Join AccessPoints On(t.TestId=AccessPoints.TestId)
		Join Technology On(t.Testid=Technology.Testid and Technology.TriggerMsg like '%test end%')
		JOIN ErrorCodes ON(ResultsPingTest.ErrorCode=ErrorCodes.Code)
                Left Join #tmptestStartMode On(t.testId = #tmptestStartMode.testId)
				Left Join #tmptestEndTime On(t.testId = #tmptestEndTime.TestId)
				Join networkInfo n On(#tmptestEndTime.networkID = n.networkID)

-- VGAZEI APO TOUS PINAKES TIS TIMES TOU START_CELL_ID POU EINAI MEGALYTERES APO INT
WHERE [#tmptestStartMode].[testStartCellId] < 2147483647 OR [#tmptestStartMode].[testStartCellId] IS NULL
--where CollectionName LIKE 'THR%' OR
--CollectionName LIKE 'EMA%' OR
--CollectionName LIKE 'CMA%' OR
--CollectionName LIKE 'WMA%' OR
--CollectionName LIKE 'ATH%' OR
--CollectionName LIKE 'STR%' 



SELECT 
	Operator,
	HomeOperator,
    CollectionName,
    host,
	ASideLocation,
	TestName,
    PacketSize,
	
	
    COUNT(Code) AS TotalPingAttempts,
    SUM(CASE WHEN Code = 'ok' THEN 1 ELSE 0 END) AS SuccessTests,
    AVG(CASE WHEN DataTechnology = 'LTE-5GNR' OR DataTechnology = 'LTE' OR DataTechnology = 'LTE CA' OR DataTechnology = 'LTE/LTE CA' THEN CAST(RTT AS FLOAT)END) AS AvgRTT,
    AVG(CASE WHEN DataTechnology = 'LTE-5GNR' THEN CAST(RTT AS FLOAT) END) AS '1.LTE-5GNR', 
    AVG(CASE WHEN DataTechnology = 'LTE' OR DataTechnology = 'LTE CA' OR DataTechnology = 'LTE/LTE CA' THEN CAST(RTT AS FLOAT) END) AS '2.LTE',
	--AVG(CASE WHEN DataTechnology = 'UMTS' THEN CAST(RTT AS FLOAT) END) AS '3.UMTS', 
    --AVG(CASE WHEN DataTechnology = 'Mixed' THEN CAST(RTT AS FLOAT) END) AS '4.Mixed',
	COUNT(CASE WHEN DataTechnology = 'LTE-5GNR' AND Code = 'ok' THEN 1 END) AS '1.Count_LTE_5GNR_Success', -- Count of successful LTE-5GNR samples
  COUNT(CASE WHEN DataTechnology IN ('LTE', 'LTE CA', 'LTE/LTE CA') AND Code = 'ok' THEN 1 END) AS '2.Count_LTE_Success' -- Count of successful LTE/LTE CA samples

INTO BI_PING_NEW   
FROM 
    #tmp_BI_PING
GROUP BY 
    CollectionName,
    PacketSize,
	host,
	Operator,
	HomeOperator,
	TestName,
	ASideLocation


Drop Table #tmpSessions
Drop table #tmptestStartMode
Drop table #tmptestEndTime
Drop table #tmp_BI_PING
--dROP TABLE BI_PING_NEW  