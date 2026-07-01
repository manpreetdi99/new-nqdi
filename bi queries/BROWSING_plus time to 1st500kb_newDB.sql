Select Sessions.FileId,
Sessions.SessionId,
Testinfo.TestId,
TestInfo.StartNetworkID,
testFinishTime = DATEADD(ms,TestInfo.duration,TestInfo.startTime),
	TestInfo.NetworkId
Into #tmpSessions
---------------------------------------------------------------------------------------------------------------------
from Sessions Join Testinfo On(Sessions.SessionId=Testinfo.SessionId)

--------------------------------------------------------------------------------------------------------------------
where Sessions.Valid=1 And
TestInfo.Valid=1 And
TestInfo.TypeofTest like '%Browse%'
group by Sessions.FileId,
Sessions.SessionId,
Testinfo.TestId,
TestInfo.StartNetworkID,
TestInfo.duration,
TestInfo.startTime,
TestInfo.NetworkId
------------------------------------------------------------------------------------------------------------------------
select kpi.Duration, kpi.TestId, kpi.SessionId
into #tmpBrowsingDuration
from ResultsKPI kpi
where  kpi.KpiId = 20404 OR kpi.KpiId = 10410  --or kpi.KpiId = 20400 for HTTP replaced by 10410 etsi standarts
---------------------------------------------------------------------------------------------------------------------------------
Select	distinct t.testId,
	t.StartNetworkID,
	testStartMode = networkInfo.technology,
	testStartLat = 33.00000,
	testStartLong =33.00000,
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
	--#tmptestStartMode.testStartPCI=LTEServingCellInfo.PhyCellId,
	#tmptestStartMode.testStartBW=LTEServingCellInfo.DLBandwidth
from #tmptestStartMode, LTEServingCellInfo
where #tmptestStartMode.testId = LTEServingCellInfo.TestId AND
	LTEServingCellInfo.LTEServingCellInfoId = (select min(lte.LTEServingCellInfoId) from LTEServingCellInfo lte
		where lte.testId = #tmptestStartMode.testId)
------------------------------------------------- start for avg Radio---------------------------------------------------------------------
Update #tmptestStartMode
Set #tmptestStartMode.testAvgRSRP =LTEMeasurementReport.RSRP
	--###tmpCallStartMode.testStartSINR=LTEMeasurementReport.SINR0
from #tmptestStartMode, LTEMeasurementReport 
--where ###tmpCallStartMode.sessionId = AVG(LTEMeasurementReport.sessionId )AND 
	where LTEMeasurementReport.RSRP = (select cast(round(AVG(lte.RSRP),2) as bigint) from LTEMeasurementReport lte  where lte.TestId=#tmptestStartMode.TestId ) 


Update #tmptestStartMode
Set --###tmpCallStartModetest.testAvgRSRP=LTEMeasurementReport.RSRP
	#tmptestStartMode.testAvgSINR=LTEMeasurementReport.SINR0
from #tmptestStartMode, LTEMeasurementReport 
--where ###tmpCallStartMode.sessionId = AVG(LTEMeasurementReport.sessionId )AND 
	where --(LTEMeasurementReport.RSRP = (select cast(round(AVG(lte.RSRP),2) as bigint) from LTEMeasurementReport lte  where lte.SessionId=###tmpCallStartModetest.sessionId  ) ) 
	        (LTEMeasurementReport.SINR0 = (select cast(round(AVG(lte.SINR0),2) as bigint) from LTEMeasurementReport lte  where lte.TestId=#tmptestStartMode.TestId  ) )


Update #tmptestStartMode
Set #tmptestStartMode.testAvgRxlev=MsgGSMReport.RxLev
	--###tmpCallStartModetest.testStartRxQual=MsgGSMReport.RxQual
from #tmptestStartMode, MsgGSMReport
where 
	MsgGSMReport.RxLev = (select cast(round(AVG(gsm.RxLev),2) as int)  from MsgGSMReport gsm
		where gsm.TestId = #tmptestStartMode.TestId)

Update #tmptestStartMode
Set --###tmpCallStartModetest.testAvgRxlev=MsgGSMReport.RxLev
	#tmptestStartMode.testAvgRxQual=MsgGSMReport.RxQual
from #tmptestStartMode, MsgGSMReport
where 
	MsgGSMReport.RxQual = (select cast(round(AVG(gsm.RxQual),2) as int)  from MsgGSMReport gsm
		where gsm.TestId = #tmptestStartMode.TestId)

Update #tmptestStartMode
Set #tmptestStartMode.testAvgRSCP=WCDMAActiveSet.RSCP_PSC
	--###tmpCallStartMode.testStartEcNo=WCDMAActiveSet.AggrEcIo_PSC
from #tmptestStartMode, WCDMAActiveSet
where 
	WCDMAActiveSet.RSCP_PSC = (select cast(round(AVG(wcdma.RSCP_PSC),2)as int) from WCDMAActiveSet wcdma
		where wcdma.TestId = #tmptestStartMode.TestId)


Update #tmptestStartMode
Set --###tmpCallStartModetest.testAvgRSCP=WCDMAActiveSet.RSCP_PSC
	#tmptestStartMode.testAvgEcNo=WCDMAActiveSet.AggrEcIo_PSC
from #tmptestStartMode, WCDMAActiveSet
where 
	WCDMAActiveSet.AggrEcIo_PSC = (select cast(round(AVG(wcdma.AggrEcIo_PSC),2)as int) from WCDMAActiveSet wcdma
		where wcdma.TestId = #tmptestStartMode.TestId)
------------------------------------------------------------------------------------------------------------------------

		
Update #tmptestStartMode
Set #tmptestStartMode.testStartEARFCN=LTEMeasurementReport.EARFCN,
	#tmptestStartMode.testStartPCI=LTEMeasurementReport.PhyCellId,
	#tmptestStartMode.testStartRSRP=LTEMeasurementReport.RSRP,
	#tmptestStartMode.testStartSINR=LTEMeasurementReport.SINR0
from #tmptestStartMode, LTEMeasurementReport
where #tmptestStartMode.testId = LTEMeasurementReport.TestId AND
	LTEMeasurementReport.MsgId = (select min(lte.msgId) from LTEMeasurementReport lte
		where lte.testId = #tmptestStartMode.testId)
		
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
-------------------------------------------------------------------------------------
--Select	s.sessionId,
	--s.testid,
	--k.kpiId,
	--k.errorCode,
	--k.duration,
	--k.endTime
--into	#tmpkpi20400
--from 	#tmpSessions s, ResultsKPI k
--where	s.testid = k.testid AND
	--(k.KpiId = 10410 OR k.KpiId = 20404)
--Group by s.sessionId,
	--s.testid,
	--k.kpiId,
	--k.errorCode,
	--k.duration,
	--k.endTime

	Select	s.sessionId,
	s.testid,
	k.kpiId,
	k.errorCode,
	k.duration,
	Round(Convert(float, k.value1*0.008), 3) as 'Thrpt',
	k.endTime
into	#tmpkpi20400
from 	#tmpSessions s, ResultsKPI k
where	s.testid = k.testid AND
	(k.KpiId = 30404 OR k.KpiId = 30407)
Group by s.sessionId,
	s.testid,
	k.kpiId,
	k.errorCode,
	k.duration,
	k.Value1,
	k.endTime


------------------------------------------------------------allagi gia P,S1,S2---------------------
select  distinct l.testid, 
	convert(varchar(100), l.EARFCN) as P_EARFCN,
	convert(varchar(100), p.EARFCN ) as S_EARFCN 
	--S1_EARFCN=null,
	--S2_EARFCN=null,
	--CarrierIndex
into #tmpltemeas
from #tmpSessions	Join LTEMeasurementReport l on (#tmpSessions.TestId = l.TestId)
				Left Join LTEMeasurementReportCarrier p On(l.LTEMeasReportId = p.LTEMeasReportId)

order by l.testid

--Update #tmpltemeas
--Set #tmpltemeas.S_EARFCN='--'
--from #tmpltemeas 
--where #tmpltemeas.S_EARFCN is NULL

--update #tmpltemeas
--set #tmpltemeas.S2_EARFCN=#tmpltemeas.S_EARFCN
--from #tmpltemeas 
--where CarrierIndex = 2 	

--update #tmpltemeas
--set #tmpltemeas.S1_EARFCN=#tmpltemeas.S_EARFCN
--from #tmpltemeas 
--where CarrierIndex = 1 	

Select distinct t2.testid,

   substring(
        (
            Select t1.P_EARFCN  AS [text()]
            From #tmpltemeas t1
            Where t1.testid = t2.testid
            ORDER BY t1.testid
            For XML PATH ('')
        ), 1, 4) [P_EARFCN],
	substring(
        (
            Select t1.S_EARFCN  AS [text()]
            From #tmpltemeas t1
            Where t1.testid = t2.testid
            ORDER BY t1.testid
            For XML PATH ('')
        ), 1, 4) [S_EARFCN],
		substring(
        (
            Select t1.S_EARFCN  AS [text()]
            From #tmpltemeas t1
            Where t1.testid = t2.testid
            ORDER BY t1.testid
            For XML PATH ('')
        ), 5, 4) [S1_EARFCN]


		--t2.S1_EARFCN,
		--t2.S2_EARFCN
into #tmpltemeas_summary
From #tmpltemeas t2 
------------------------------------------------------------ end allagi gia P,S1,S2---------------------------------------------------------------------------------------------------------

select  l.testid, 

		Case when Sum(Case when p.CarrierIndex=0 and l.NetPDSCHThroughput >0  then 1 else 0 end)>0 then Sum(Case when p.CarrierIndex=0 and l.NetPDSCHThroughput >0  then l.NetPDSCHThroughput  else NULL end)else NULL end as 'Sum_Thrp', 
		Case when Sum(Case when p.CarrierIndex=0 and l.NetPDSCHThroughput >0 then 1 else 0 end)>0 then Count(Case when p.CarrierIndex=0 and l.NetPDSCHThroughput >0 then 1 else NULL end)else NULL end as 'Num_Thrp',
		Case when Sum(Case when p.CarrierIndex=0 And p.NetPDSCHThroughput>0 then 1 else 0 end)>0 then Sum(Case when p.CarrierIndex=0 And p.NetPDSCHThroughput>0 then p.NetPDSCHThroughput else NULL end)else NULL end as 'Sum_PCC_Thrp',
		Case when Sum(Case when p.CarrierIndex=0 And p.NetPDSCHThroughput>0  then 1 else 0 end)>0 then Count(Case when p.CarrierIndex=0 And p.NetPDSCHThroughput>0  then 1 else NULL end)else NULL end as 'Num_PCC_Thrp',
		Case when Sum(Case when p.CarrierIndex=1 And p.NetPDSCHThroughput>0 then 1 else 0 end)>0 then Sum(Case when p.CarrierIndex=1 And p.NetPDSCHThroughput>0 then p.NetPDSCHThroughput else NULL end)else NULL end as 'Sum_SCC_Thrp',
		Case when Sum(Case when p.CarrierIndex=1 And p.NetPDSCHThroughput>0  then 1 else 0 end)>0 then Count(Case when p.CarrierIndex=1 And p.NetPDSCHThroughput>0 then 1 else NULL end)else NULL end as 'Num_SCC_Thrp',
		Case when Sum(Case when p.CarrierIndex=2 And p.NetPDSCHThroughput>0 then 1 else 0 end)>0 then Sum(Case when p.CarrierIndex=2 And p.NetPDSCHThroughput>0 then p.NetPDSCHThroughput else NULL end)else NULL end as 'Sum_SCC1_Thrp',
		Case when Sum(Case when p.CarrierIndex=2 And p.NetPDSCHThroughput>0 then 1 else 0 end)>0 then Count(Case when p.CarrierIndex=2 And p.NetPDSCHThroughput>0 then 1 else NULL end)else NULL end as 'Num_SCC1_Thrp',
		Case when Sum(Case when p.CarrierIndex=0  then 1 else 0 end)>0 then sum(Case when  p.CarrierIndex=0  then l.NumRBs else NULL end)else NULL end as 'Sum_RB',
		Case when Sum(Case when p.CarrierIndex=0 then 1 else 0 end)>0 then Count(Case when p.CarrierIndex=0 then 1 else NULL end)else NULL end as 'Num_RB',
		Case when Sum(Case when p.CarrierIndex=0  then 1 else 0 end)>0 then avg(Case when  p.CarrierIndex=0  then l.AvgMCS else NULL end)else NULL end as 'avg_MCS'


into #tmpcathrp
from #tmpSessions	Join LTEPDSCHStatisticsInfo l on (#tmpSessions.TestId = l.TestId)
				Left Join LTEPDSCHStatisticsCarrier p On(l.LTEPDSCHInfoId = p.LTEPDSCHInfoId)
group by l.testid
order by l.testid
---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

Select distinct t.testId,
	l.MsgId,
	l.MsgTime as PrevMsgTime,
	l.MsgTIme as CurrMsgTime,
	l.NumCarriers
into #tmpcatime
from #tmpSessions t		 Join LTEPDSCHStatisticsInfo l On(t.testId = l.testId)
order by l.MsgId


Update	#tmpcatime
Set #tmpcatime.PrevMsgTime=l.MsgTime
From
#tmpcatime 	Join #tmpSessions t On(#tmpcatime.testId = t.testId)
			Join LTEPDSCHStatisticsInfo l On(#tmpcatime.MsgId=l.MsgId+1 AND t.testId=l.testId)

select TestId,
		Sum(DATEDIFF(ms, PrevMsgTime, CurrMsgTime)) as 'SumTotalTime',
		Sum(Case when NumCarriers = 2 then DATEDIFF(ms, PrevMsgTime, CurrMsgTime) else NULL end) as 'SumSCCTime'
into #tmpcatimesummary
from #tmpcatime
group by TestId
order by TestId
		
Select Sessions.FileId,
Sessions.SessionId,
Testinfo.TestId,
TestInfo.StartNetworkID,
testFinishTime = DATEADD(ms,TestInfo.duration,TestInfo.startTime),
	TestInfo.NetworkId
Into #tmpSessionsDNS
from Sessions Join Testinfo On(Sessions.SessionId=Testinfo.SessionId)
where Sessions.Valid=1 And
TestInfo.Valid=1 And
(TestInfo.TypeofTest like  '%Browse%')
group by Sessions.FileId,
Sessions.SessionId,
Testinfo.TestId,
TestInfo.StartNetworkID,
TestInfo.duration,
TestInfo.startTime,
TestInfo.NetworkId

Select	distinct t.testId,
	t.StartNetworkID,
	testStartMode = networkInfo.technology,
	testStartLat = 33.33,
	testStartLong = 33.33,
	testStartLAC = networkInfo.LAC,
	testStartCellId = networkInfo.CId
into    #tmptestStartModeDNS
from 	#tmpSessionsDNS t, networkInfo, networkIdRelation, Position
where 	t.StartNetworkID = networkInfo.networkId AND
		networkInfo.networkId = networkIdRelation.networkId AND
		networkIdRelation.PosId = Position.PosId AND
		networkIdRelation.MsgTime = (select min(nid.MsgTime) from networkIdRelation nid
			where nid.networkId = networkinfo.networkId)
			
Select  
	t.TestId,
	CAST(datepart(hh,ResultsKPI.startTime) as Varchar)+':'+CAST(datepart(mi,ResultsKPI.startTime) as varchar)+':'+CAST(datepart(ss,ResultsKPI.startTime) as varchar)+'.'+CAST(datepart(ms,ResultsKPI.startTime) as varchar) as CallStartTime,
	#tmptestStartModeDNS.TestStartLat,
	#tmptestStartModeDNS.TestStartLong,
	#tmptestStartModeDNS.TestStartLAC,
	#tmptestStartModeDNS.TestStartCellId,
	case when ResultsKPI.ErrorCode = 0 then 'Success' else 'Fail' end as DNS_Status,
	ResultsKPI.Duration as DNS_Duration,
ResultsKPI.startTime as DNS_startTime
into #tmp_DNS
From
#tmpSessionsDNS	Join	Filelist On(#tmpSessionsDNS.FileID=FileList.FileID)
		Join	Testinfo t On(#tmpSessionsDNS.TestId=t.TestId)
		Left Join	ResultsHTTPBrowserTest On(t.TestId=ResultsHTTPBrowserTest.TestId)
		Left Join	ResultsVideoStream On(t.TestId=ResultsVideoStream.TestId)
		Left Join	ISPConfig On(t.TestId=ISPConfig.TestId)
		Left Join	ResultsKPI On(t.TestId=ResultsKPI.TestId)
		Join Technology On(t.Testid=Technology.Testid and Technology.TriggerMsg like '%test end%')
                Left Join #tmptestStartModeDNS On(t.testId = #tmptestStartModeDNS.testId)
				Join networkInfo n On(t.networkID = n.networkID)
where ResultsKPI.KPIId = 31100 AND
	ResultsKPI.MsgId = (select min(k.msgid) from ResultsKPI k
			where k.TestId = t.TestId AND k.KPIId=31100)
---------------------------------------------------------------------------------
--Select sessionid, testid, MsgTime, FirstPayloadTime as TimetoFirstByte
--into #tmpTimetofirstbyte ----
--From MsgIpTimeToFirstPayload
-----------------------------------------------------------------------------------


Select sessionid, testid,TimetoFirstByte
into #tmpTimetofirstbyte ----
From [FactHttpBrowser]


--where info = 'Page loading... 10% completed'
Select sessionid, testid, MsgTime as first_paint
into #tmpResultsHTTPBrowserTrace ----
From ResultsHTTPBrowserTrace 
where info = 'Page loading... 10% completed' 
--------------------------------------------------------------------------------------
Select sessionid, testid, MsgTime, TotalBytesReceived, MsgId, ROW_NUMBER() OVER(PARTITION BY TestId ORDER BY MsgId) AS ID
into #tmpMsgIPRampUp
From MsgIPRampUp
select rmp.testid, MIN(rmp.MsgTime) AS fifty_percent_timestamp
into #tmpfifty_percent
from #tmpMsgIPRampUp rmp join ResultsHTTPBrowserTest hbt ON (rmp.testId = hbt.testId)
where rmp.TotalBytesReceived >= 0.50*hbt.size AND hbt.errorCode = 0
group by rmp.testid		

select sessionid,
TestId,
Duration 
into #tmpTimetoFisrt500
from ResultsKPI
where KPIId = '10419'




Select n.Operator, 
	n.HomeOperator ,
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
	--AccessPoints.APN as APN,
	#tmptestStartMode.TestStartMode,
	#tmptestStartMode.TestStartLat,
	#tmptestStartMode.TestStartLong,
	-- start insert dns data
	--dns.CallStartTime, dns.DNS_Status, dns.DNS_Duration, dns.testStartLat, dns.testStartLong, dns.testStartCellId, dns.testStartLAC,
	-- end   insert dns data
	case when ResultsKPI.ErrorCode = 0 then 'Success' else 'Fail' end as ServiceAccessStatus_10400_404,
	--CAST(datepart(hh,ResultsKPI.startTime) as Varchar)+':'+CAST(datepart(mi,ResultsKPI.startTime) as varchar)+':'+CAST(datepart(ss,ResultsKPI.startTime) as varchar)+'.'+CAST(datepart(ms,ResultsKPI.startTime) as varchar) as AccessStartTime,
	convert(real, ResultsKPI.Duration/1000.0) as ServiceAccessDuration,
	#tmptestStartMode.TestStartLAC,
	#tmptestStartMode.TestStartCellId,
	#tmptestStartMode.TestStartBCCH,
	#tmptestStartMode.TestStartEARFCN,
	#tmptestStartMode.testStartBW as StartLTEBW,
	#tmptestStartMode.TestStartPCI,
	--#tmptestStartMode.TestStartRSRP,
	--#tmptestStartMode.TestStartSINR,
	#tmptestStartMode.TestStartFreq,
	#tmptestStartMode.TestStartPSC,
	--#tmptestStartMode.TestStartRSCP,
	--#tmptestStartMode.TestStartEcNo,
	--#tmptestStartMode.testStartRxLev,
	--#tmptestStartMode.testStartRxQual,
	#tmptestStartMode.testAvgRxlev ,
	#tmptestStartMode.testAvgRxQual ,
	#tmptestStartMode.testAvgRSCP ,
	#tmptestStartMode.testAvgEcNo ,
	#tmptestStartMode.testAvgRSRP,
	#tmptestStartMode.testAvgSINR ,
	-- add computing fields
	--case 
	--when lcathrp.Num_RB/1000 <> null and CAST(datepart(hh,ResultsKPI.startTime) as Varchar)+':'+CAST(datepart(mi,ResultsKPI.startTime) as varchar)+':'+CAST(datepart(ss,ResultsKPI.startTime) as varchar)+'.'+CAST(datepart(ms,ResultsKPI.startTime) as varchar) <> null 
	 -- then dateadd(second, lcathrp.Num_RB/1000, CAST(datepart(hh,ResultsKPI.startTime) as Varchar)+':'+CAST(datepart(mi,ResultsKPI.startTime) as varchar)+':'+CAST(datepart(ss,ResultsKPI.startTime) as varchar)+'.'+CAST(datepart(ms,ResultsKPI.startTime) as varchar)) 
	-- else CAST(datepart(hh,ResultsKPI.startTime) as Varchar)+':'+CAST(datepart(mi,ResultsKPI.startTime) as varchar)+':'+CAST(datepart(ss,ResultsKPI.startTime) as varchar)+'.'+CAST(datepart(ms,ResultsKPI.startTime) as varchar) 
	--end as TransferStart,
	ErrorCodes.msg as TransferStatus,
	bd.Duration/1000.0 as TransferDuration,
	1.0*ResultsHTTPBrowserTest.Throughput / 1000.0 as TransferDataRate,
	1.0*ResultsHTTPBrowserTest.Size / 8000.0 as TransferredData,
	--1.0*t.Duration / 1000.0 as TestDuration,
	case when #tmpkpi20400.errorcode = 0 then 'OK' else 'Failed' end as kpi20400_20404_status,
	--1.0*#tmpkpi20400.duration / 1000.0 as kpi20400_20404_duration,
	#tmpkpi20400.Thrpt, --new
	-- end computing fields
   --technology.Summary,	-- isws thelei allagi gia na exxw mono LTE/LTE+/UMTS
   ----------------mine-----------------------------------------------------------------------------------------------------------------------------------------
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
				OR Technology.summary like 'edge/gprs/%' 
				OR ((technology.Summary like 'h%' OR technology.Summary like 'r%' ) and technology.Summary like '%lte%')) then 'Mixed' 
		end end end end end end end as DataTechnology,
		-----------------------------------------------------------------------------------------------------------------------------------------------------------------
	#tmptestEndTime.TestEndLat,
	#tmptestEndTime.TestEndLong,
	n.Technology,
	#tmptestEndTime.TestEndLAC,
	#tmptestEndTime.TestEndCellId,
	#tmptestEndTime.TestEndBCCH,
	#tmptestEndTime.TestEndEARFCN,
	#tmptestEndTime.testEndBW,
	#tmptestEndTime.TestEndPCI,
	--#tmptestEndTime.TestEndRSRP,
	--#tmptestEndTime.TestEndSINR,
	#tmptestEndTime.TestEndFreq,
	#tmptestEndTime.TestEndPSC,
	--#tmptestEndTime.TestEndRSCP,
	--#tmptestEndTime.TestEndEcNo,
	--#tmptestEndTime.testEndRxLev,
	--#tmptestEndTime.testEndRxQual,
ResultsHTTPBrowserTest.Host, 
--ISPConfig.IP as ClientIP,
--ISPConfig.IPResolved as DNSIP,
t.Duration, 
ResultsHTTPBrowserTest.Size, 
--ErrorCodes.msg As ErrorCode,
--ResultsHTTPBrowserTest.throughput * 8 *0.001 as Throughput,
--case when ResultsKPI.ErrorCode = 0 then 'Success' else 'Fail' end as Access,
--ResultsKPI.Duration as AccessTime,
-----------------------------------------------------------------------------------------------------
case when  technology.Summary like '%LTE CA%' then 'Yes' else 'No' end as ca_configured,
--case when lcathrp.Num_SCC_Thrp > 0 then '2CA-Yes' else 'No' end as ca_active,
--case when lcathrp.Num_SCC1_Thrp > 0 then '3CA-Yes' else 'No' end as ca3_active,
case when lcathrp.Num_SCC_Thrp > 0 And lcathrp.Num_SCC1_Thrp > 0 then '3CA' else case when  lcathrp.Num_SCC_Thrp > 0 then '2CA' else 'CA' end end as ca_active,
------------------------------------------------------------------------------------------
lmeas.P_EARFCN as PCC_EARFCNList,
lmeas.S_EARFCN as SCC_EARFCNList,
lmeas.S1_EARFCN as SC1_EARFCNList_NEW_Col,

--lcathrp.Sum_Thrp,--new
case when lcathrp.Num_Thrp <> 0 then str(lcathrp.Sum_Thrp*8.0/(lcathrp.Num_Thrp*1000.0)) else '' end as AvgTotalThrp,
case when lcathrp.Num_PCC_Thrp <> 0 then str(lcathrp.Sum_PCC_Thrp*8.0/(lcathrp.Num_PCC_Thrp*1000.0)) else '' end as AvgPCCThrp,
case when lcathrp.Num_SCC_Thrp <> 0 then str(lcathrp.Sum_SCC_Thrp*8.0/(lcathrp.Num_SCC_Thrp*1000.0)) else '' end as AvgSCCThrp,
case when lcathrp.Num_SCC1_Thrp <> 0 then str(lcathrp.Sum_SCC1_Thrp*8.0/(lcathrp.Num_SCC1_Thrp*1000.0)) else '' end as AvgSCC1Thrp,--new
case when lcathrp.Num_RB <> 0 then str(1.0*lcathrp.Sum_RB/lcathrp.Num_RB) else '' end as AvgRBs,
--case when lcatime.SumTotalTime <> 0 then str(1.0*lcatime.SumSCCTime/lcatime.SumTotalTime) else '' end as SCC1Usage,

-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
--datediff(ms,isnull(dns.DNS_startTime,ResultsKPI.startTime),hbt.first_paint) as first_paint_duration,
#tmpTimetofirstbyte.TimetoFirstByte,
#tmpTimetoFisrt500.Duration as TimetoFirst500b,




case when datediff(ms,isnull(dns.DNS_startTime,ResultsKPI.startTime),fifty.fifty_percent_timestamp) > 0 then datediff(ms,isnull(dns.DNS_startTime,ResultsKPI.startTime),fifty.fifty_percent_timestamp)
else datediff(ms,ResultsKPI.startTime,fifty.fifty_percent_timestamp) end as fifty_percent_duration	

into BI_BROWSING_500KB


From
#tmpSessions	Join	Filelist On(#tmpSessions.FileID=FileList.FileID)
		Join	Testinfo t On(#tmpSessions.TestId=t.TestId)
		Left Join	ResultsHTTPBrowserTest On(t.TestId=ResultsHTTPBrowserTest.TestId)
		Left Join	ISPConfig On(t.TestId=ISPConfig.TestId)
		Left Join	ResultsKPI On(t.TestId=ResultsKPI.TestId)
		Left Join AccessPoints On(t.TestId=AccessPoints.TestId)
		Join Technology On(t.Testid=Technology.Testid and Technology.TriggerMsg like '%test end%')
		JOIN ErrorCodes ON(ResultsHTTPBrowserTest.ErrorCode=ErrorCodes.Code)
                Left Join #tmptestStartMode On(t.testId = #tmptestStartMode.testId)
				Left Join #tmptestEndTime On(t.testId = #tmptestEndTime.TestId)
				Left Join #tmpltemeas_summary lmeas On(t.testId = lmeas.testId)
				Left Join #tmpcathrp lcathrp On(t.testId = lcathrp.testId)
				Left Join #tmpcatimesummary lcatime On(t.testId = lcatime.testId)
				Join networkInfo n On(#tmptestEndTime.networkID = n.networkID)
				Left Join #tmpkpi20400 on (t.testid = #tmpkpi20400.testid)
				Left Join #tmp_DNS dns on (dns.TestId = t.testid)
				Left join #tmpBrowsingDuration bd on (bd.TestId=#tmpSessions.TestId)
				left join #tmpTimetoFisrt500  on (#tmpTimetoFisrt500.TestId=#tmpSessions.TestId)

Left join #tmpResultsHTTPBrowserTrace hbt on (hbt.TestId=#tmpSessions.TestId)
Left join #tmpfifty_percent fifty on (fifty.TestId=#tmpSessions.TestId)
Left join #tmpTimetofirstbyte  on (#tmpTimetofirstbyte.TestId=#tmpSessions.TestId)	

where ResultsKPI.KPIId IN (10400, 10404) AND (([#tmptestStartMode].[testStartCellId] < 2147483647 OR [#tmptestStartMode].[testStartCellId] IS NULL) AND ([#tmptestEndTime].[testEndCellId] < 2147483647 OR [#tmptestEndTime].[testEndCellId] IS NULL))
--AND (CollectionName LIKE 'THR%' OR
--CollectionName LIKE 'EMA%' OR
--CollectionName LIKE 'CMA%' OR
--CollectionName LIKE 'WMA%' OR
--CollectionName LIKE 'ATH%' OR
--CollectionName LIKE 'STR%') 
order by t.testid
-------------------------------------------------------------------drop tables start---------------------------------
Drop Table #tmpSessions
Drop table #tmptestStartMode
Drop table #tmptestEndTime
drop table #tmpkpi20400
drop table #tmpltemeas
drop table #tmpltemeas_summary
drop table #tmpcathrp
drop table #tmpcatime
drop table #tmpcatimesummary

Drop Table #tmp_DNS
Drop Table #tmpSessionsDNS

Drop table #tmptestStartModeDNS
Drop table #tmpBrowsingDuration

Drop table #tmpResultsHTTPBrowserTrace

Drop table #tmpMsgIPRampUp

Drop table #tmpfifty_percent
Drop table #tmpTimetofirstbyte
drop table #tmpTimetoFisrt500
--drop table BI_Browsing_500kb

-------------------------------------------------------------------drop tables end---------------------------------