Select Sessions.sessionID,
TestInfo.TestId,
TestInfo.StartNetworkID,
testFinishTime = DATEADD(ms,TestInfo.duration,TestInfo.startTime),
	TestInfo.NetworkId
  into	#tmptest4

-----------------------------------------------------------------------------------------------------------------------------------
from Sessions,
TestInfo,
ResultsHTTPTransferTest
---------------------------------------------------------------------------------------------------------------------------------------------------
where Sessions.Valid = 1 AND TestInfo.Valid = 1 AND
Sessions.sessionID = TestInfo.SessionID AND
TestInfo.TestId = ResultsHTTPTransferTest.TestId AND
ResultsHTTPTransferTest.errorCode<>1001
--AND TestInfo.TestId = '390842024445'
---------------------------------------------------------------------------------------------------------------------
group by Sessions.sessionID,
TestInfo.TestId,
TestInfo.StartNetworkID,
TestInfo.duration,
TestInfo.startTime,
TestInfo.NetworkId

Select	t.testId,
Count(Case when (ResultsHTTPTransferParameters.Operation = 'GET' or ResultsHTTPTransferParameters.operation = 'PUT') and ResultsHTTPTransferTest.throughput>=0 then 1 else NULL end) as 'NumThrp',
	Sum(Case when (ResultsHTTPTransferParameters.Operation = 'GET' or ResultsHTTPTransferParameters.operation = 'PUT') and ResultsHTTPTransferTest.throughput>=0 then 8*ResultsHTTPTransferTest.throughput else NULL end) as 'SumThrp'
	
	--Count(Case when ResultsHTTPTransferParameters.operation = 'PUT' and ResultsHTTPTransferTest.throughput>=0 then 1 else NULL end) as 'NumThrpUL',
	--Sum(Case when ResultsHTTPTransferParameters.operation = 'PUT' and ResultsHTTPTransferTest.throughput>=0 then 8*ResultsHTTPTransferTest.throughput else NULL end) as 'SumThrpUL'

into	#tmpThrp4
From 	#tmptest4 t, ResultsHTTPTransferTest, NetworkInfo, ResultsHTTPTransferParameters
Where	t.testId = ResultsHTTPTransferTest.testId AND
	ResultsHTTPTransferTest.NetworkID = NetworkInfo.NetworkID AND ResultsHTTPTransferParameters.testId=ResultsHTTPTransferTest.testId AND
	ResultsHTTPTransferTest.lastblock=1
Group by t.testId


--SELECT * FROM NetworkInfo
--WHERE NetworkInfo.NetworkId = '390842024520'

--SELECT * FROM NetworkIdRelation
--WHERE NetworkIdRelation.NetworkId = '390842024520'

Select	distinct t.testId,
	t.StartNetworkID,
	testStartMode = networkInfo.technology,
	testStartLat = Position.latitude,
	testStartLong = Position.longitude,
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
	testAvgRxlev = NULL,
	testAvgRxQual = NULL,
	testAvgRSCP = NULL,
	testAvgEcNo = NULL,
	testAvgRSRP = NULL,
	testAvgSINR = NULL
into    #tmptestStartMode4
from 	#tmptest4 t, networkInfo, networkIdRelation, Position
where 	t.StartNetworkID = networkInfo.networkId AND
		networkInfo.networkId = networkIdRelation.networkId AND
		networkIdRelation.PosId = Position.PosId AND
		networkIdRelation.MsgTime = (select min(nid.MsgTime) from networkIdRelation nid
			where nid.networkId = networkinfo.networkId)
		--and t.TestId = '390842024445'
		and NetworkIdRelation.TestId != 0

--drop table #tmptest4
--drop table #tmpThrp4

------------------------------------------------------------ lat lot for duplicate values-------
Update #tmptestStartMode4
Set #tmptestStartMode4.testStartLat = Position.latitude ,
	#tmptestStartMode4.testStartLong =Position.longitude
	
from #tmptestStartMode4, Position
where #tmptestStartMode4.TestId = Position.TestId AND
	Position.MsgTime = (select min(pos.MsgTime)  from Position pos
		where pos.TestId = #tmptestStartMode4.TestId)
-------------------------------------------------------------------------------------------------
		
Update #tmptestStartMode4
Set #tmptestStartMode4.testStartFreq=WCDMAActiveSet.FreqDL,
	#tmptestStartMode4.testStartPSC=WCDMAActiveSet.PrimScCode,
	#tmptestStartMode4.testStartRSCP=WCDMAActiveSet.RSCP_PSC,
	#tmptestStartMode4.testStartEcNo=WCDMAActiveSet.AggrEcIo_PSC
from #tmptestStartMode4, WCDMAActiveSet
where #tmptestStartMode4.testId = WCDMAActiveSet.TestId AND
	WCDMAActiveSet.MsgId = (select min(wcdma.msgId) +1 from WCDMAActiveSet wcdma
		where wcdma.testId = #tmptestStartMode4.testId)
------------------------------------------------------------------------------------------		
Update #tmptestStartMode4
Set --#tmptestStartMode4.testStartEARFCN=LTEServingCellInfo.DL_EARFCN,
	--#tmptestStartMode4.testStartPCI=LTEServingCellInfo.PhyCellId,
	#tmptestStartMode4.testStartBW=LTEServingCellInfo.DLBandwidth
from #tmptestStartMode4, LTEServingCellInfo
where #tmptestStartMode4.testId = LTEServingCellInfo.TestId AND
	LTEServingCellInfo.LTEServingCellInfoId = (select min(lte.LTEServingCellInfoId) from LTEServingCellInfo lte
		where lte.testId = #tmptestStartMode4.testId)
------------------------------------------------- start for avg Radio---------------------------------------------------------------------

Update #tmptestStartMode4
Set #tmptestStartMode4.testAvgRSRP =LTEMeasurementReport.RSRP
from #tmptestStartMode4, LTEMeasurementReport 
	where LTEMeasurementReport.RSRP = (select cast(round(AVG(lte.RSRP),2) as bigint) from LTEMeasurementReport lte  where lte.TestId=#tmptestStartMode4.TestId ) 


Update #tmptestStartMode4
Set #tmptestStartMode4.testAvgSINR=LTEMeasurementReport.SINR0
from #tmptestStartMode4, LTEMeasurementReport 
where (LTEMeasurementReport.SINR0 = (select cast(round(AVG(lte.SINR0),2) as bigint) from LTEMeasurementReport lte  where lte.TestId=#tmptestStartMode4.TestId  ) )


Update #tmptestStartMode4
Set #tmptestStartMode4.testAvgRxlev=MsgGSMReport.RxLev
	
from #tmptestStartMode4, MsgGSMReport
where MsgGSMReport.RxLev = (select cast(round(AVG(gsm.RxLev),2) as int)  from MsgGSMReport gsm
		where gsm.TestId = #tmptestStartMode4.TestId)

Update #tmptestStartMode4
Set #tmptestStartMode4.testAvgRxQual=MsgGSMReport.RxQual
from #tmptestStartMode4, MsgGSMReport
where MsgGSMReport.RxQual = (select cast(round(AVG(gsm.RxQual),2) as int)  from MsgGSMReport gsm
		where gsm.TestId = #tmptestStartMode4.TestId)

Update #tmptestStartMode4
Set #tmptestStartMode4.testAvgRSCP=WCDMAActiveSet.RSCP_PSC
from #tmptestStartMode4, WCDMAActiveSet
where WCDMAActiveSet.RSCP_PSC = (select cast(round(AVG(wcdma.RSCP_PSC),2)as int) from WCDMAActiveSet wcdma
		where wcdma.TestId = #tmptestStartMode4.TestId)


Update #tmptestStartMode4
Set #tmptestStartMode4.testAvgEcNo=WCDMAActiveSet.AggrEcIo_PSC
from #tmptestStartMode4, WCDMAActiveSet
where 
	WCDMAActiveSet.AggrEcIo_PSC = (select cast(round(AVG(wcdma.AggrEcIo_PSC),2)as int) from WCDMAActiveSet wcdma
		where wcdma.TestId = #tmptestStartMode4.TestId)
		
---------------------------------------------------------------------------------------------------------------------------------				
Update #tmptestStartMode4
Set #tmptestStartMode4.testStartEARFCN=LTEMeasurementReport.EARFCN,
	#tmptestStartMode4.testStartPCI=LTEMeasurementReport.PhyCellId,
	#tmptestStartMode4.testStartRSRP=LTEMeasurementReport.RSRP,
	#tmptestStartMode4.testStartSINR=LTEMeasurementReport.SINR0
from #tmptestStartMode4, LTEMeasurementReport
where #tmptestStartMode4.testId = LTEMeasurementReport.TestId AND
	LTEMeasurementReport.MsgId = (select min(lte.msgId) from LTEMeasurementReport lte
		where lte.testId = #tmptestStartMode4.testId)


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
		testEndBW = NULL
into 	#tmptestEndTime4
from   	#tmptest4 t, networkInfo, networkIdRelation, Position
where 	t.NetworkId = networkInfo.networkId AND
		networkInfo.networkId = networkIdRelation.networkId AND
		networkIdRelation.TestId = t.TestId AND
		networkIdRelation.PosId = Position.PosId AND 
		networkIdRelation.MsgTime = (select max(nir.MsgTime) from networkIdRelation nir
				where nir.TestId = t.TestId AND
					nir.networkId = networkInfo.networkId AND
					 nir.MsgTime <= t.testFinishTime)

Update #tmptestEndTime4
Set #tmptestEndTime4.testEndFreq=WCDMAActiveSet.FreqDL,
	#tmptestEndTime4.testEndPSC=WCDMAActiveSet.PrimScCode,
	#tmptestEndTime4.testEndRSCP=WCDMAActiveSet.RSCP_PSC,
	#tmptestEndTime4.testEndEcNo=WCDMAActiveSet.AggrEcIo_PSC
from #tmptestEndTime4, WCDMAActiveSet
where #tmptestEndTime4.testId = WCDMAActiveSet.TestId AND
	WCDMAActiveSet.MsgId = (select max(wcdma.msgId) from WCDMAActiveSet wcdma
		where wcdma.testId = #tmptestEndTime4.testId)
		
Update #tmptestEndTime4
Set --#tmptestEndTime4.testEndEARFCN=LTEServingCellInfo.DL_EARFCN,
	--#tmptestEndTime4.testEndPCI=LTEServingCellInfo.PhyCellId,
	#tmptestEndTime4.testEndBW=LTEServingCellInfo.DLBandwidth
from #tmptestEndTime4, LTEServingCellInfo
where #tmptestEndTime4.testId = LTEServingCellInfo.TestId AND
	LTEServingCellInfo.LTEServingCellInfoId = (select max(lte.LTEServingCellInfoId) from LTEServingCellInfo lte
		where lte.testId = #tmptestEndTime4.testId)
		
Update #tmptestEndTime4
Set #tmptestEndTime4.testEndEARFCN=LTEMeasurementReport.EARFCN,
	#tmptestEndTime4.testEndPCI=LTEMeasurementReport.PhyCellId,
	#tmptestEndTime4.testEndRSRP=LTEMeasurementReport.RSRP,
	#tmptestEndTime4.testEndSINR=LTEMeasurementReport.SINR0
from #tmptestEndTime4, LTEMeasurementReport
where #tmptestEndTime4.testId = LTEMeasurementReport.TestId AND
	LTEMeasurementReport.MsgId = (select max(lte.msgId) from LTEMeasurementReport lte
		where lte.testId = #tmptestEndTime4.testId)


-------------------------------------------------------------------------------------------------------------------------------
select  distinct l.testid, p.CarrierIndex,
	convert(varchar(100), l.EARFCN) as P_EARFCN,
	case when p.CarrierIndex=1 then convert(varchar(100), p.EARFCN) else null end as SCC1_EARFCN,
	case when p.CarrierIndex=2 then convert(varchar(100), p.EARFCN) else null end as SCC2_EARFCN
into #tmpltemeas
from #tmptest4	Join LTEMeasurementReport l on (#tmptest4.TestId = l.TestId)
				Left Join LTEMeasurementReportCarrier p On(l.LTEMeasReportId = p.LTEMeasReportId)
order by l.testid

--Update #tmpltemeas
--Set #tmpltemeas.SCC1_EARFCN='--'
--from #tmpltemeas
--where #tmpltemeas.SCC1_EARFCN is NULL

--Update #tmpltemeas
--Set #tmpltemeas.SCC2_EARFCN='--'
--from #tmpltemeas
--where #tmpltemeas.SCC2_EARFCN is NULL

Update l
Set l.SCC2_EARFCN=r.SCC2_EARFCN
from #tmpltemeas l, #tmpltemeas r
where l.TestId=r.TestId and l.CarrierIndex=1 and r.CarrierIndex=2

Update r
Set r.CarrierIndex=-1
from #tmpltemeas l, #tmpltemeas r
where l.TestId=r.TestId and l.CarrierIndex=1 and r.CarrierIndex=2

delete from #tmpltemeas where #tmpltemeas.CarrierIndex=-1
-------------------------------------------------------------------------------------------
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
            Select t1.SCC1_EARFCN  AS [text()]
            From #tmpltemeas t1
            Where t1.testid = t2.testid
            ORDER BY t1.testid
            For XML PATH ('')
        ), 1, 4) [SCC1_EARFCN],
	substring(
        (
            Select t1.SCC2_EARFCN  AS [text()]
            From #tmpltemeas t1
            Where t1.testid = t2.testid
            ORDER BY t1.testid
            For XML PATH ('')
        ), 1, 4) [SCC2_EARFCN]
into #tmpltemeas_summary
From #tmpltemeas t2
--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
select  l.testid, 
				Case when Sum(Case when p.CarrierIndex=0 and l.NetPDSCHThroughput >0  then 1 else 0 end)>0 then Sum(Case when p.CarrierIndex=0 and l.NetPDSCHThroughput >0  then l.NetPDSCHThroughput  else NULL end)else NULL end as 'Sum_Thrp', --
		Case when Sum(Case when p.CarrierIndex=0 and l.NetPDSCHThroughput >0 then 1 else 0 end)>0 then Count(Case when p.CarrierIndex=0 and l.NetPDSCHThroughput >0 then 1 else NULL end)else NULL end as 'Num_Thrp',--
		Case when Sum(Case when p.CarrierIndex=0 And p.NetPDSCHThroughput>0 then 1 else 0 end)>0 then Sum(Case when p.CarrierIndex=0 And p.NetPDSCHThroughput>0 then p.NetPDSCHThroughput else NULL end)else NULL end as 'Sum_PCC_Thrp',--
		Case when Sum(Case when p.CarrierIndex=0 And p.NetPDSCHThroughput>0  then 1 else 0 end)>0 then Count(Case when p.CarrierIndex=0 And p.NetPDSCHThroughput>0  then 1 else NULL end)else NULL end as 'Num_PCC_Thrp',--
		Case when Sum(Case when p.CarrierIndex=1 And p.NetPDSCHThroughput>0 then 1 else 0 end)>0 then Sum(Case when p.CarrierIndex=1 And p.NetPDSCHThroughput>0 then p.NetPDSCHThroughput else NULL end)else NULL end as 'Sum_SCC1_Thrp',--
		Case when Sum(Case when p.CarrierIndex=1 And p.NetPDSCHThroughput>0  then 1 else 0 end)>0 then Count(Case when p.CarrierIndex=1 And p.NetPDSCHThroughput>0 then 1 else NULL end)else NULL end as 'Num_SCC1_Thrp',--
		Case when Sum(Case when p.CarrierIndex=2 And p.NetPDSCHThroughput>0 then 1 else 0 end)>0 then Sum(Case when p.CarrierIndex=2 And p.NetPDSCHThroughput>0 then p.NetPDSCHThroughput else NULL end)else NULL end as 'Sum_SCC2_Thrp',--
		Case when Sum(Case when p.CarrierIndex=2 And p.NetPDSCHThroughput>0 then 1 else 0 end)>0 then Count(Case when p.CarrierIndex=2 And p.NetPDSCHThroughput>0 then 1 else NULL end)else NULL end as 'Num_SCC2_Thrp',--
		Case when Sum(Case when p.CarrierIndex=0  then 1 else 0 end)>0 then sum(Case when  p.CarrierIndex=0  then l.NumRBs else NULL end)else NULL end as 'Sum_RB',
		Case when Sum(Case when p.CarrierIndex=0 then 1 else 0 end)>0 then Count(Case when p.CarrierIndex=0 then 1 else NULL end)else NULL end as 'Num_RB',
		Case when Sum(Case when p.CarrierIndex=0  then 1 else 0 end)>0 then avg(Case when  p.CarrierIndex=0  then l.AvgMCS else NULL end)else NULL end as 'avg_MCS',
		Case when Sum(Case when p.CarrierIndex=0  then 1 else 0 end)>0 then sum(Case when  p.CarrierIndex=0  then p.NumRBs else NULL end)else NULL end as 'Sum_RB_PCC',
		Case when Sum(Case when p.CarrierIndex=0 then 1 else 0 end)>0 then Count(Case when p.CarrierIndex=0 then 1 else NULL end)else NULL end as 'Num_RB_PCC',
		Case when Sum(Case when p.CarrierIndex=0  then 1 else 0 end)>0 then avg(Case when  p.CarrierIndex=0  then p.AvgMCS else NULL end)else NULL end as 'avg_MCS_PCC',
		Case when Sum(Case when p.CarrierIndex=1  then 1 else 0 end)>0 then sum(Case when  p.CarrierIndex=1 then p.NumRBs else NULL end)else NULL end as 'Sum_RB_SCC1',
		Case when Sum(Case when p.CarrierIndex=1 then 1 else 0 end)>0 then Count(Case when p.CarrierIndex=1 then 1 else NULL end)else NULL end as 'Num_RB_SCC1',
		Case when Sum(Case when p.CarrierIndex=1  then 1 else 0 end)>0 then avg(Case when  p.CarrierIndex=1  then p.AvgMCS else NULL end)else NULL end as 'avg_MCS_SCC1',
		Case when Sum(Case when p.CarrierIndex=2  then 1 else 0 end)>0 then sum(Case when  p.CarrierIndex=2 then p.NumRBs else NULL end)else NULL end as 'Sum_RB_SCC2',
		Case when Sum(Case when p.CarrierIndex=2 then 1 else 0 end)>0 then Count(Case when p.CarrierIndex=2 then 1 else NULL end)else NULL end as 'Num_RB_SCC2',
		Case when Sum(Case when p.CarrierIndex=2  then 1 else 0 end)>0 then avg(Case when  p.CarrierIndex=2  then p.AvgMCS else NULL end)else NULL end as 'avg_MCS_SCC2'

into #tmpcathrp
from #tmptest4	Join LTEPDSCHStatisticsInfo l on (#tmptest4.TestId = l.TestId)
				Left Join LTEPDSCHStatisticsCarrier p On(l.LTEPDSCHInfoId = p.LTEPDSCHInfoId)
group by l.testid
order by l.testid

Select distinct t.testId,
	l.MsgId,
	l.MsgTime as PrevMsgTime,
	l.MsgTIme as CurrMsgTime,
	l.NumCarriers,
	lc.CarrierIndex
into #tmpcatime
from #tmptest4 t		 Join LTEPDSCHStatisticsInfo l On(t.testId = l.testId)
						 join LTEPDSCHStatisticsCarrier lc On(lc.LTEPDSCHInfoId = l.LTEPDSCHInfoId)
order by l.MsgId


Update	#tmpcatime
Set #tmpcatime.PrevMsgTime=l.MsgTime
From
#tmpcatime 	Join #tmptest4 t On(#tmpcatime.testId = t.testId)
			Join LTEPDSCHStatisticsInfo l On(#tmpcatime.MsgId=l.MsgId+1 AND t.testId=l.testId)

Update	#tmpcatime
Set #tmpcatime.CurrMsgTime=l.MsgTime
From
#tmpcatime 	Join #tmptest4 t On(#tmpcatime.testId = t.testId)
			Join LTEPDSCHStatisticsInfo l On(#tmpcatime.MsgId+1=l.MsgId AND t.testId=l.testId)
where #tmpcatime.PrevMsgTime=#tmpcatime.CurrMsgTime

select TestId, 
		Sum(case when CarrierIndex=1 or CarrierIndex=2 then DATEDIFF(ms, PrevMsgTime, CurrMsgTime) else null end) as 'SumTotalTime',
		Sum(case when CarrierIndex=1 then DATEDIFF(ms, PrevMsgTime, CurrMsgTime) else null end) as 'SumSCC1_Time',
		Sum(case when CarrierIndex=2 then DATEDIFF(ms, PrevMsgTime, CurrMsgTime) else null end) as 'SumSCC2_Time'
into #tmpcatimesummary
from #tmpcatime
group by TestId
order by TestId

select  l.testid, avg(p.NumRecords)  as 'avgDLFrameUsage', avg(p.AvgMCS) as 'avgMCS'
into #tmpDLFrameUsage
from #tmptest4	Join LTEPDSCHStatisticsInfo l on (#tmptest4.TestId = l.TestId)
				Left Join LTEPDSCHStatisticsCarrier p On(l.LTEPDSCHInfoId = p.LTEPDSCHInfoId)
group by l.testid
order by l.testid

Select t.testId,
	avg(rb.NumRBs) as avgNumRBFrame
into #tmpRBFrame
from #tmptest4 t, vLTESINRCorrelation rb	 
where t.testId = rb.testId
group by t.TestId

select 	t.testId, 
	SUM(case when (k.KpiId = 38100) then 1 else 0 end) as numIntraRATHO
into 	#tmpINTRARATHO
from 	#tmptest4 t,  ResultsKPI k
where	t.testId = k.testId
group by t.testId

Select t.testId,
	sum(Case when re.EventName='Reestablishment URI' then 1 else 0 end) as sumURIReest
into #tmpURIReest
from  #tmptest4 t, ResultsEvents re
where t.testId = re.testId
group by t.TestId

Select t.testId,
	sum(Case when re.EventName='measGapConfig' then 1 else 0 end) as sumMeasGap
into #tmpMeasGap
from  #tmptest4 t, ResultsEvents re
where t.testId = re.testId
group by t.TestId

select 	t.testId, 
	SUM(case when (k.KpiId = 38021 OR k.KpiId = 38022 OR k.KpiId = 38030 OR k.KpiId = 38031 OR k.KpiId = 38040) then 1 else 0 end) as numInterRATHO
into 	#tmpINTERRATHO
from 	#tmptest4 t,  ResultsKPI k
where	t.testId = k.testId
group by t.testId

--select * from #tmptestStartMode4 
--where TestId = '390842024445'

select	DISTINCT n.Operator, -- A
	n.HomeOperator,
	s.SessionId, -- B
	t.TestId,
	CAST(datepart(dd,t.startTime) as varchar)+'.'+CAST(datepart(mm,t.startTime) as varchar)+'.'+CAST(datepart(yy,t.startTime) as varchar) as CallDate,
        CAST(datepart(hh,t.startTime) as Varchar)+':'+CAST(datepart(mi,t.startTime) as varchar)+':'+CAST(datepart(ss,t.startTime) as varchar)+'.'+CAST(datepart(ms,t.startTime) as varchar) as CallStartTime,
	CAST(datepart(hh,#tmptestEndTime4.testFinishTime) as Varchar)+':'+CAST(datepart(mi,#tmptestEndTime4.testFinishTime) as varchar)+':'+
	CAST(datepart(ss,#tmptestEndTime4.testFinishTime) as varchar)+'.'+CAST(datepart(ms,#tmptestEndTime4.testFinishTime) as varchar) as CallFinishTime,
	f.CollectionName, -- G
    f.ASideLocation,	-- H
	 
	t.TestName, -- I
	--f.IMEI,
	--f.IMSI,
	--ap.APN as APN, -- L
	#tmptestStartMode4.StartNetworkId,
	#tmptestStartMode4.TestStartMode, -- M
	#tmptestStartMode4.TestStartLat,
	#tmptestStartMode4.TestStartLong,
	#tmptestStartMode4.TestStartLAC,
	#tmptestStartMode4.TestStartCellId, -- Q
	#tmptestStartMode4.TestStartBCCH,
	#tmptestStartMode4.TestStartEARFCN, -- S
	#tmptestStartMode4.testStartBW, -- T
	#tmptestStartMode4.TestStartPCI,
	--#tmptestStartMode4.TestStartRSRP,
	--#tmptestStartMode4.TestStartSINR,
	#tmptestStartMode4.TestStartFreq,
	#tmptestStartMode4.TestStartPSC,
	--#tmptestStartMode4.TestStartRSCP, -- Z
	--#tmptestStartMode4.TestStartEcNo, -- AA
	#tmptestStartMode4.testAvgRxlev ,
	#tmptestStartMode4.testAvgRxQual ,
	#tmptestStartMode4.testAvgRSCP ,
	#tmptestStartMode4.testAvgEcNo ,
	#tmptestStartMode4.testAvgRSRP ,
	#tmptestStartMode4.testAvgSINR ,
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
   -- technology.Summary,	
	#tmptestEndTime4.TestEndLat,
	#tmptestEndTime4.TestEndLong, -- AD
	
	n.Technology,
	#tmptestEndTime4.TestEndLAC,
	#tmptestEndTime4.TestEndCellId,
	#tmptestEndTime4.TestEndBCCH, -- AH
	#tmptestEndTime4.TestEndEARFCN, -- AI
	#tmptestEndTime4.testEndBW, -- AJ
	#tmptestEndTime4.TestEndPCI,
	--#tmptestEndTime4.TestEndRSRP, -- AL
	--#tmptestEndTime4.TestEndSINR, -- AM
	#tmptestEndTime4.TestEndFreq,
	#tmptestEndTime4.TestEndPSC,
	--#tmptestEndTime4.TestEndRSCP, -- AP
	--#tmptestEndTime4.TestEndEcNo, -- AQ

	case when #tmpThrp4.NumThrp is null or #tmpThrp4.NumThrp=0 or #tmpThrp4.SumThrp=0  then '' else
		str(convert(real, #tmpThrp4.SumThrp)/(1000.000*convert(real, #tmpThrp4.NumThrp))) end as AvgThrp, -- AR

	ftpt.Duration* 0.001 as Duration, -- AS,
	ftpt.Errorcode, -- AT
	e.MSG, -- AU
	ftptp.Host, -- AV
	--ISPConfig.IP as Client_IP, -- AW
	--ISPConfig.IPResolved as DNS_IP, -- AX
	ftptp.LocalFileName,
	t.Direction,
	ftptp.RemoteFileName, -- AZ
	ftptp.BufferSize, -- BA
	ftptp.FixedDuration, -- BB
	ftpt.BytesTransferred, -- BC
	case when ftpt.Errorcode=0 then 'Success' else 'Fail' end as TaskStatus, -- BD


	case when  technology.Summary like '%LTE CA%' then 'Yes' else 'No' end as CA_configured, -- BE


	--case when (lcathrp.Sum_SCC1_Thrp is null or lcathrp.Sum_SCC1_Thrp=0 or lcathrp.Num_SCC1_Thrp is null or lcathrp.Num_SCC1_Thrp=0)
		--And (lcathrp.Sum_SCC2_Thrp is null or lcathrp.Sum_SCC2_Thrp=0 or lcathrp.Num_SCC2_Thrp is null or lcathrp.Num_SCC2_Thrp=0) then 'No'
		--else case when ((lcathrp.Sum_SCC1_Thrp is not null and lcathrp.Sum_SCC1_Thrp!=0 and lcathrp.Num_SCC1_Thrp is not null and lcathrp.Num_SCC1_Thrp!=0) and (convert(real, lcathrp.Sum_SCC1_Thrp)*8.0/(1000.0*convert(real, lcathrp.Num_SCC1_Thrp)))>0 ) or 
			--		   (lcathrp.Sum_SCC2_Thrp is not null and lcathrp.Sum_SCC2_Thrp!=0 and lcathrp.Num_SCC2_Thrp is not null and lcathrp.Num_SCC2_Thrp!=0) and (convert(real, lcathrp.Sum_SCC2_Thrp)*8.0/(1000.0*convert(real, lcathrp.Num_SCC2_Thrp)))>0 
		  --   then 'Yes' else 'No' end end as CAActive, -- BF

			 case when lcathrp.Num_SCC1_Thrp > 0 And lcathrp.Num_SCC2_Thrp > 0 then '3CA' else case when  lcathrp.Num_SCC1_Thrp > 0 then '2CA' else 'CA' end end as ca_active,

	lmeas.P_EARFCN as P_EARFCN, -- BG
	lmeas.SCC1_EARFCN as SCC1_EARFCN, -- BH
	lmeas.SCC2_EARFCN as SCC2_EARFCN, -- new

	case when lcathrp.Sum_Thrp is null or lcathrp.Num_Thrp is null or lcathrp.Num_Thrp=0 then '' 
		else str(convert(real, lcathrp.Sum_Thrp)*8.0/(1000.0)) end as AvgTotalThrp, -- BI

	case when lcathrp.Sum_PCC_Thrp is null or lcathrp.Num_PCC_Thrp is null or lcathrp.Num_PCC_Thrp=0 then ''
		else str(convert(real, lcathrp.Sum_PCC_Thrp)*8.0/(1000.0)) end as AvgPCCThrp, -- BJ

	case when lcathrp.Sum_SCC1_Thrp is null or lcathrp.Num_SCC1_Thrp is null or lcathrp.Num_SCC1_Thrp=0 then ''
		else str(convert(real, lcathrp.Sum_SCC1_Thrp)*8.0/(1000.0)) end as AvgSCC1Thrp, -- BK

	case when lcathrp.Sum_SCC2_Thrp is null or lcathrp.Num_SCC2_Thrp is null or lcathrp.Num_SCC2_Thrp=0 then ''
		else str(convert(real, lcathrp.Sum_SCC2_Thrp)*8.0/(1000.0)) end as AvgSCC2Thrp, -- new

	case when lcathrp.Sum_RB is null or lcathrp.Num_RB is null or lcathrp.Num_RB=0 then ''
		else str(convert(real, lcathrp.Sum_RB)*1.0/(1.0*convert(real, lcathrp.Num_RB))) end as AvgRB, -- BL

		case when lcathrp.Sum_RB_PCC is null or lcathrp.Num_RB_PCC is null or lcathrp.Num_RB_PCC=0 then ''
		else str(convert(real, lcathrp.Sum_RB_PCC)*1.0/(1.0*convert(real, lcathrp.Num_RB))) end as AvgRB_PCC, -- new

	case when lcathrp.Sum_RB_SCC1 is null or lcathrp.Num_RB_SCC1 is null or lcathrp.Num_RB_SCC1=0 then ''
		else str(convert(real, lcathrp.Sum_RB_SCC1)*1.0/(1.0*convert(real, lcathrp.Num_RB))) end as AvgRB_SCC1, -- new

	case when lcathrp.Sum_RB_SCC2 is null or lcathrp.Num_RB_SCC2 is null or lcathrp.Num_RB_SCC2=0 then ''
		else str(convert(real, lcathrp.Sum_RB_SCC2)*1.0/(1.0*convert(real, lcathrp.Num_RB))) end as AvgRB_SCC2, -- new

	--case when lcatime.SumSCC1_Time is null or lcatime.SumTotalTime is null or lcatime.SumTotalTime=0 then 0.0
		--else convert(real, lcatime.SumSCC1_Time)*1.0/(1.0*convert(real, lcatime.SumTotalTime)) end as SCC1Usage, -- BM

	--case when lcatime.SumSCC2_Time is null or lcatime.SumTotalTime is null or lcatime.SumTotalTime=0 then 0.0
		--else convert(real, lcatime.SumSCC2_Time)*1.0/(1.0*convert(real, lcatime.SumTotalTime)) end as SCC2Usage, -- new

	lDLFrameUsage.avgDLFrameUsage, -- BN
	lRBFrame.avgNumRBFrame,
	lDLFrameUsage.avgMCS, -- BP
	lIntraRatHO.numIntraRATHO,
	lURIReest.sumURIReest,
	lMeasGap.sumMeasGap,
	lInterRATHO.numInterRATHO -- BT

into BI_HTTP

from
#tmptest4	Join Sessions s on (#tmptest4.sessionId = s.sessionId)
		Join TestInfo t On(s.sessionId = t.sessionID)
	       		
		Join fileList f On(s.FileId = f.FileId)
		Join datasession d On(s.sessionId = d.sessionId)
		Join ResultsHTTPTransferTest ftpt On(t.testId = ftpt.testId AND ftpt.errorCode<>1001)
		Join ResultsHTTPTransferParameters ftptp On(t.testId = ftptp.testId)
                Left Join	ISPConfig On(t.TestId=ISPConfig.TestId)
		Join AccessPoints ap On(t.testId = ap.testId)
		Left Join #tmptestStartMode4 On(t.testId = #tmptestStartMode4.testId)
		Left Join #tmptestEndTime4 On(t.testId = #tmptestEndTime4.TestId)
		Left Join #tmpThrp4 On(t.testId = #tmpThrp4.testId)
		Left Join #tmpltemeas_summary lmeas On(t.testId = lmeas.testId)
		Left Join #tmpcathrp lcathrp On(t.testId = lcathrp.testId)
		Left Join #tmpcatimesummary lcatime On(t.testId = lcatime.testId)
		Left Join #tmpDLFrameUsage lDLFrameUsage On(t.testId = lDLFrameUsage.testId)
		Left Join #tmpRBFrame lRBFrame On(t.testId = lRBFrame.testId)
		Left Join #tmpINTRARATHO lIntraRatHO On(t.testId = lIntraRatHO.testId)
		Left Join #tmpMeasGap lMeasGap On(t.testId = lMeasGap.testId)
		Left Join #tmpURIReest lURIReest On(t.testId = lURIReest.testId)
		Left Join #tmpINTERRATHO lInterRATHO On(t.testId = lInterRATHO.testId)
		Join networkInfo n On(#tmptestEndTime4.networkID = n.networkID)
		Join errorCodes e On(ftpt.errorcode = e.code)
		Join technology On(t.testId = technology.testId AND #tmptestEndTime4.testFinishTime = technology.MsgTime)


where ftpt.lastblock=1 and (t.Direction='Downlink' or t.Direction='Uplink') and (patindex('%10%', ftptp.RemoteFileName)>0 OR (patindex('%5%', ftptp.LocalFilename)>0)) and f.ASideLocation like '%Data%' -- AND (([#tmptestStartMode4].[testStartCellId] < 2147483647 OR [#tmptestStartMode4].[testStartCellId] IS NULL) AND ([#tmptestEndTime4].[testEndCellId] < 2147483647 OR [#tmptestEndTime4].[testEndCellId] IS NULL)) --and  patindex('%Data%', f.ASideLocation)>0) 

--and s.SessionId = 390842024014
--AND (CollectionName LIKE 'THR%' OR
--CollectionName LIKE 'EMA%' OR
--CollectionName LIKE 'CMA%' OR
--CollectionName LIKE 'WMA%' OR
--CollectionName LIKE 'ATH%' OR
--CollectionName LIKE 'STR%') 

order by s.SessionId,t.TestId

drop table #tmptest4
drop table #tmpThrp4
drop table #tmptestStartMode4
drop table #tmptestEndTime4
drop table #tmpltemeas
drop table #tmpltemeas_summary
drop table #tmpcathrp
drop table #tmpcatime
drop table #tmpcatimesummary
drop table #tmpDLFrameUsage
drop table #tmpRBFrame
drop table #tmpINTRARATHO
drop table #tmpMeasGap
drop table #tmpURIReest
drop table #tmpINTERRATHO
--drop table BI_HTTP
