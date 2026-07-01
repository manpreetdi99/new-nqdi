Select Sessions.sessionID,
TestInfo.TestId,
TestInfo.StartNetworkID,
testFinishTime = DATEADD(ms,TestInfo.duration,TestInfo.startTime),
	TestInfo.NetworkId
into	#tmptest4

----------------------------------------------------------------------
from Sessions,
TestInfo,
ResultsCapacityTest
----------------------------------------------------------------------------------------
where Sessions.Valid = 1 AND TestInfo.Valid = 1 AND
Sessions.sessionID = TestInfo.SessionID AND
TestInfo.TestId = ResultsCapacityTest.TestId AND
ResultsCapacityTest.errorCode<>1001

group by 
------------------------------------------------------------------------------------------------
Sessions.sessionID,
TestInfo.TestId,
TestInfo.StartNetworkID,
TestInfo.duration,
TestInfo.startTime,
TestInfo.NetworkId

Select	t.testId,
	Count(Case when ResultsCapacityTest.ThroughputGet>=0 then 1 else NULL end) as 'NumThrpDL',
	Sum(Case when ResultsCapacityTest.ThroughputGet>=0 then 8*ResultsCapacityTest.ThroughputGet else NULL end) as 'SumThrpDL',
	Count(Case when ResultsCapacityTest.ThroughputPut>=0 then 1 else NULL end) as 'NumThrpUL',
	Sum(Case when ResultsCapacityTest.ThroughputPut>=0 then 8*ResultsCapacityTest.ThroughputPut else NULL end) as 'SumThrpUL'
into	#tmpThrp4
From 	#tmptest4 t, ResultsCapacityTest
Where	t.testId = ResultsCapacityTest.testId AND
	((ResultsCapacityTest.errorcode=0 AND ResultsCapacityTest.lastblock=1) or (ResultsCapacityTest.errorcode>0 and ResultsCapacityTest.errorcode <> 1002))
Group by t.testId





Select	distinct t.testId,
	t.StartNetworkID,
	testStartMode = networkInfo.technology,
	testStartLat = 33.33333,
	testStartLong = 33.33333,
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
	WCDMAActiveSet.MsgId = (select min(wcdma.msgId) + 1 from WCDMAActiveSet wcdma
		where wcdma.testId = #tmptestStartMode4.testId)
		
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
		testEndLat = Position.latitude,
		testEndLong = Position.longitude,
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
-------------------------------------------------------------------------------------------

Update #tmptestEndTime4
Set #tmptestEndTime4.testEndLat = Position.latitude ,
	#tmptestEndTime4.testEndLong =Position.longitude
	
from #tmptestEndTime4, Position
where #tmptestEndTime4.TestId = Position.TestId AND
	Position.MsgTime = (select min(pos.MsgTime)  from Position pos
		where pos.TestId = #tmptestEndTime4.TestId)
---------------------------------------------------------------------------
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
-----------------------------------------------------------------------------------------------------------------------------------------------------------


select  distinct l.testid, p.CarrierIndex,
	convert(varchar(100), l.EARFCN) as P_EARFCN,
	case when p.CarrierIndex=1 then convert(varchar(100), p.EARFCN) else null end as SCC1_EARFCN,
	case when p.CarrierIndex=2 then convert(varchar(100), p.EARFCN) else null end as SCC2_EARFCN,
	case when p.CarrierIndex=3 then convert(varchar(100), p.EARFCN) else null end as SCC3_EARFCN,  -----new for 4 ca
	case when p.CarrierIndex=4 then convert(varchar(100), p.EARFCN) else null end as SCC4_EARFCN  -----new for 5 ca
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
        ), 1, 4) [SCC2_EARFCN],
		substring(                                  -------------new 4 ca
        (
            Select t1.SCC3_EARFCN  AS [text()]
            From #tmpltemeas t1
            Where t1.testid = t2.testid
            ORDER BY t1.testid
            For XML PATH ('')
        ), 1, 4) [SCC3_EARFCN],
		substring(                                  -------------new 5 ca
        (
            Select t1.SCC4_EARFCN  AS [text()]
            From #tmpltemeas t1
            Where t1.testid = t2.testid
            ORDER BY t1.testid
            For XML PATH ('')
        ), 1, 4) [SCC4_EARFCN]

into #tmpltemeas_summary
From #tmpltemeas t2

select  l.testid, 
				Case when Sum(Case when p.CarrierIndex=0 and l.NetPDSCHThroughput >0  then 1 else 0 end)>0 then Sum(Case when p.CarrierIndex=0 and l.NetPDSCHThroughput >0  then l.NetPDSCHThroughput  else NULL end)else NULL end as 'Sum_Thrp', --
		Case when Sum(Case when p.CarrierIndex=0 and l.NetPDSCHThroughput >0 then 1 else 0 end)>0 then Count(Case when p.CarrierIndex=0 and l.NetPDSCHThroughput >0 then 1 else NULL end)else NULL end as 'Num_Thrp',--
		Case when Sum(Case when p.CarrierIndex=0 And p.NetPDSCHThroughput>0 then 1 else 0 end)>0 then Sum(Case when p.CarrierIndex=0 And p.NetPDSCHThroughput>0 then p.NetPDSCHThroughput else NULL end)else NULL end as 'Sum_PCC_Thrp',--
		Case when Sum(Case when p.CarrierIndex=0 And p.NetPDSCHThroughput>0  then 1 else 0 end)>0 then Count(Case when p.CarrierIndex=0 And p.NetPDSCHThroughput>0  then 1 else NULL end)else NULL end as 'Num_PCC_Thrp',--
		Case when Sum(Case when p.CarrierIndex=1 And p.NetPDSCHThroughput>0 then 1 else 0 end)>0 then Sum(Case when p.CarrierIndex=1 And p.NetPDSCHThroughput>0 then p.NetPDSCHThroughput else NULL end)else NULL end as 'Sum_SCC1_Thrp',--
		Case when Sum(Case when p.CarrierIndex=1 And p.NetPDSCHThroughput>0  then 1 else 0 end)>0 then Count(Case when p.CarrierIndex=1 And p.NetPDSCHThroughput>0 then 1 else NULL end)else NULL end as 'Num_SCC1_Thrp',--
		Case when Sum(Case when p.CarrierIndex=2 And p.NetPDSCHThroughput>0 then 1 else 0 end)>0 then Sum(Case when p.CarrierIndex=2 And p.NetPDSCHThroughput>0 then p.NetPDSCHThroughput else NULL end)else NULL end as 'Sum_SCC2_Thrp',--
		Case when Sum(Case when p.CarrierIndex=2 And p.NetPDSCHThroughput>0 then 1 else 0 end)>0 then Count(Case when p.CarrierIndex=2 And p.NetPDSCHThroughput>0 then 1 else NULL end)else NULL end as 'Num_SCC2_Thrp',--
		Case when Sum(Case when p.CarrierIndex=3 And p.NetPDSCHThroughput>0 then 1 else 0 end)>0 then Sum(Case when p.CarrierIndex=3 And p.NetPDSCHThroughput>0 then p.NetPDSCHThroughput else NULL end)else NULL end as 'Sum_SCC3_Thrp',---------------new 4ca
		Case when Sum(Case when p.CarrierIndex=3 And p.NetPDSCHThroughput>0 then 1 else 0 end)>0 then Count(Case when p.CarrierIndex=3 And p.NetPDSCHThroughput>0 then 1 else NULL end)else NULL end as 'Num_SCC3_Thrp',---------------new 4ca
		Case when Sum(Case when p.CarrierIndex=4 And p.NetPDSCHThroughput>0 then 1 else 0 end)>0 then Sum(Case when p.CarrierIndex=4 And p.NetPDSCHThroughput>0 then p.NetPDSCHThroughput else NULL end)else NULL end as 'Sum_SCC4_Thrp',---------------new 5ca
		Case when Sum(Case when p.CarrierIndex=4 And p.NetPDSCHThroughput>0 then 1 else 0 end)>0 then Count(Case when p.CarrierIndex=4 And p.NetPDSCHThroughput>0 then 1 else NULL end)else NULL end as 'Num_SCC4_Thrp',---------------new 5ca
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
		Case when Sum(Case when p.CarrierIndex=2  then 1 else 0 end)>0 then avg(Case when  p.CarrierIndex=2  then p.AvgMCS else NULL end)else NULL end as 'avg_MCS_SCC2',
		Case when Sum(Case when p.CarrierIndex=3 then 1 else 0 end)>0 then Count(Case when p.CarrierIndex=3 then 1 else NULL end)else NULL end as 'Num_RB_SCC3', -------------new 4ca
		Case when Sum(Case when p.CarrierIndex=3  then 1 else 0 end)>0 then avg(Case when  p.CarrierIndex=3  then p.AvgMCS else NULL end)else NULL end as 'avg_MCS_SCC3',-------------new 4ca
		Case when Sum(Case when p.CarrierIndex=3  then 1 else 0 end)>0 then sum(Case when  p.CarrierIndex=3 then p.NumRBs else NULL end)else NULL end as 'Sum_RB_SCC3',-------------new 4ca
		Case when Sum(Case when p.CarrierIndex=4 then 1 else 0 end)>0 then Count(Case when p.CarrierIndex=4 then 1 else NULL end)else NULL end as 'Num_RB_SCC4', -------------new 5ca
		Case when Sum(Case when p.CarrierIndex=4  then 1 else 0 end)>0 then avg(Case when  p.CarrierIndex=4  then p.AvgMCS else NULL end)else NULL end as 'avg_MCS_SCC4',-------------new 5ca
		Case when Sum(Case when p.CarrierIndex=4  then 1 else 0 end)>0 then sum(Case when  p.CarrierIndex=4 then p.NumRBs else NULL end)else NULL end as 'Sum_RB_SCC4'-------------new 5ca
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
		Sum(case when CarrierIndex=1 or CarrierIndex=2 or CarrierIndex=3 then DATEDIFF(ms, PrevMsgTime, CurrMsgTime) else null end) as 'SumTotalTime',
		Sum(case when CarrierIndex=1 then DATEDIFF(ms, PrevMsgTime, CurrMsgTime) else null end) as 'SumSCC1_Time',
		Sum(case when CarrierIndex=2 then DATEDIFF(ms, PrevMsgTime, CurrMsgTime) else null end) as 'SumSCC2_Time',
		Sum(case when CarrierIndex=3 then DATEDIFF(ms, PrevMsgTime, CurrMsgTime) else null end) as 'SumSCC3_Time',-------------new 4ca
		Sum(case when CarrierIndex=4 then DATEDIFF(ms, PrevMsgTime, CurrMsgTime) else null end) as 'SumSCC4_Time'-------------new 5ca

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


--------------------------------------------------------------------------------------------------------
select  l.testid, avg(p.NumRecords)  as 'avgULFrameUsage', avg(p.AvgMCS) as 'avgMCSUL'
into #tmpULFrameUsage
from #tmptest4	Join LTEPUSCHStatisticsInfo l on (#tmptest4.TestId = l.TestId)
				Left Join LTEPUSCHStatisticsCarrier p On(l.LTEPUSCHInfoId = p.LTEPUSCHInfoId)
group by l.testid
order by l.testid

select	DISTINCT n.Operator, -- A
	n.HomeOperator,
	s.SessionId, 
	t.TestId,
	CAST(datepart(dd,t.startTime) as varchar)+'.'+CAST(datepart(mm,t.startTime) as varchar)+'.'+CAST(datepart(yy,t.startTime) as varchar) as CallDate,
        CAST(datepart(hh,t.startTime) as Varchar)+':'+CAST(datepart(mi,t.startTime) as varchar)+':'+CAST(datepart(ss,t.startTime) as varchar)+'.'+CAST(datepart(ms,t.startTime) as varchar) as CallStartTime,
	CAST(datepart(hh,#tmptestEndTime4.testFinishTime) as Varchar)+':'+CAST(datepart(mi,#tmptestEndTime4.testFinishTime) as varchar)+':'+
	CAST(datepart(ss,#tmptestEndTime4.testFinishTime) as varchar)+'.'+CAST(datepart(ms,#tmptestEndTime4.testFinishTime) as varchar) as CallFinishTime,
	f.CollectionName,
    f.ASideLocation, -- H	 
	t.TestName, -- I
	--f.IMEI,
	--f.IMSI,
	--ap.APN as APN,
	#tmptestStartMode4.TestStartMode, -- M
	#tmptestStartMode4.TestStartLat,
	#tmptestStartMode4.TestStartLong,
	#tmptestStartMode4.TestStartLAC,
	#tmptestStartMode4.TestStartCellId,
	#tmptestStartMode4.TestStartBCCH,
	#tmptestStartMode4.TestStartEARFCN, -- S
	#tmptestStartMode4.testStartBW, -- T
	#tmptestStartMode4.TestStartPCI, -- U
	--#tmptestStartMode4.TestStartRSRP,
	--#tmptestStartMode4.TestStartSINR,
	#tmptestStartMode4.TestStartFreq,
	#tmptestStartMode4.TestStartPSC,
	--#tmptestStartMode4.TestStartRSCP, -- Z
	--#tmptestStartMode4.TestStartEcNo, -- AA
	--#tmptestStartMode4.testAvgRxlev ,
	--#tmptestStartMode4.testAvgRxQual ,
	case when (technology.Summary not like 'LTE/LTE CA' and technology.Summary not like 'LTE CA' and technology.Summary not like 'LTE') or Technology.summary is null   then #tmptestStartMode4.testAvgRxlev else null end as testAvgRxlev ,
	case when (technology.Summary not like 'LTE/LTE CA' and technology.Summary not like 'LTE CA' and technology.Summary not like 'LTE') or Technology.summary is null then #tmptestStartMode4.testAvgRxQual else null end as testAvgRxQual ,
	--#tmptestStartMode4.testAvgRSCP ,
	case when (technology.Summary not like 'LTE/LTE CA' and technology.Summary not like 'LTE CA' and technology.Summary not like 'LTE') or Technology.summary is null   then #tmptestStartMode4.testAvgRSCP else null end as testAvgRSCP ,
	case when (technology.Summary not like 'LTE/LTE CA' and technology.Summary not like 'LTE CA' and technology.Summary not like 'LTE') or Technology.summary is null then #tmptestStartMode4.testAvgEcNo else null end as testAvgEcNo ,
	--#tmptestStartMode4.testAvgEcNo ,
	#tmptestStartMode4.testAvgRSRP ,
	#tmptestStartMode4.testAvgSINR,
	--case when technology.TriggerMsg='Test end' and Technology.summary is not null then
	case when testStartMode like 'GSM%' and n.Technology like 'GSM%' and technology.Summary not like 'LTE/LTE CA' then 'GSM' else 
	case when  Technology.summary IN ('gprs','edge','edge/gprs') then 'GSM' else
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
				OR Technology.summary like 'LTE/LTE CA/R99(CELL_FACH)'
				OR Technology.summary like 'LTE/LTE CA/R99'
				OR Technology.summary like 'LTE CA/R99'
				OR ((technology.Summary like 'h%' OR technology.Summary like 'r%'OR technology.Summary like 'LTE/R%' ) and technology.Summary like '%lte%' )) then 'Mixed' 
				
		end end end end end end end end  as DataTechnology,
     --technology.Summary ,	
	#tmptestEndTime4.TestEndLat,
	#tmptestEndTime4.TestEndLong, -- AD
	n.Technology, -- AE
	#tmptestEndTime4.TestEndLAC,
	#tmptestEndTime4.TestEndCellId,
	#tmptestEndTime4.TestEndBCCH,
	#tmptestEndTime4.TestEndEARFCN, -- AI
	#tmptestEndTime4.testEndBW, -- AJ
	#tmptestEndTime4.TestEndPCI, -- AK
	--#tmptestEndTime4.TestEndRSRP,
	--#tmptestEndTime4.TestEndSINR, -- AM
	#tmptestEndTime4.TestEndFreq,
	#tmptestEndTime4.TestEndPSC,
	--#tmptestEndTime4.TestEndRSCP, -- AP
	--#tmptestEndTime4.TestEndEcNo, -- AQ

	case when #tmpThrp4.NumThrpDL=0 or #tmpThrp4.NumThrpDL is null or #tmpThrp4.SumThrpDL=0 then null else convert(real,#tmpThrp4.SumThrpDL)/(1000.0*convert(real,#tmpThrp4.NumThrpDL)) end as AvgThrpDL,
	case when #tmpThrp4.NumThrpUL=0 or #tmpThrp4.NumThrpUL is null or #tmpThrp4.SumThrpUL=0 then null else convert(real,#tmpThrp4.SumThrpUL)/(1000.0*convert(real,#tmpThrp4.NumThrpUL)) end as AvgThrpUL,


	ftpt.Duration, -- AS
	ftpt.Errorcode,
	e.MSG,
	ftptp.URIList, -- AV
	--ftptp.URICount, -- AV
	--ISPConfig.IP as Client_IP, -- AW
	--ISPConfig.IPResolved as DNS_IP, --AX
	--ftptp.LocalFileName,
	--ftptp.URIList,
	--ftptp.BufferSize,
	--ftptp.Protocol,
	ftpt.BytesTransferredGet, -- BC
	case when ftpt.Errorcode=0 then 'Success' else 'Fail' end as TaskStatus, -- BD

	--case when patindex('%LTE CA%', technology.Summary)>=0 then 'Yes' else 'No' end as CAConfigured, -- BE
	case when  technology.Summary like '%LTE CA%' then 'Yes' else 'No' end as CA_configured,

	--case when (lcathrp.Sum_SCC1_Thrp is null or lcathrp.Sum_SCC1_Thrp=0 or lcathrp.Num_SCC1_Thrp is null or lcathrp.Num_SCC1_Thrp=0)
	--	And (lcathrp.Sum_SCC2_Thrp is null or lcathrp.Sum_SCC2_Thrp=0 or lcathrp.Num_SCC2_Thrp is null or lcathrp.Num_SCC2_Thrp=0) then 'No'
		--else case when ((lcathrp.Sum_SCC1_Thrp is not null and lcathrp.Sum_SCC1_Thrp!=0 and lcathrp.Num_SCC1_Thrp is not null and lcathrp.Num_SCC1_Thrp!=0) and (convert(real, lcathrp.Sum_SCC1_Thrp)*8.0/(1000.0*convert(real, lcathrp.Num_SCC1_Thrp)))>0 ) or 
		---			   (lcathrp.Sum_SCC2_Thrp is not null and lcathrp.Sum_SCC2_Thrp!=0 and lcathrp.Num_SCC2_Thrp is not null and lcathrp.Num_SCC2_Thrp!=0) and (convert(real, lcathrp.Sum_SCC2_Thrp)*8.0/(1000.0*convert(real, lcathrp.Num_SCC2_Thrp)))>0 
		  --   then 'Yes' else 'No' end end as CAActive, -- BF

		  case when lcathrp.Num_SCC1_Thrp > 0 And lcathrp.Num_SCC2_Thrp > 0 And lcathrp.Num_SCC3_Thrp > 0 And lcathrp.Num_SCC4_Thrp > 0 then 'LTE 5CA' else -------------new 5ca
		    case when lcathrp.Num_SCC1_Thrp > 0 And lcathrp.Num_SCC2_Thrp > 0 And lcathrp.Num_SCC3_Thrp > 0 then 'LTE 4CA' else -------------new 4ca
		    case when lcathrp.Num_SCC1_Thrp > 0 And lcathrp.Num_SCC2_Thrp > 0 then 'LTE 3CA' else 
			 case when  lcathrp.Num_SCC1_Thrp > 0 then 'LTE 2CA' else --'CA' 
			 case when  lcathrp.Num_PCC_Thrp > 0 then 'LTE' else 'Non LTE'
			 end end end end end as ca_active,



	lmeas.P_EARFCN as P_EARFCN, -- BG
	lmeas.SCC1_EARFCN as SCC1_EARFCN, -- BH
	lmeas.SCC2_EARFCN as SCC2_EARFCN, -- new
	lmeas.SCC3_EARFCN as SCC3_EARFCN,-------------new 4ca
	lmeas.SCC4_EARFCN as SCC4_EARFCN,-------------new 5ca



	case when lcathrp.Sum_Thrp is null or lcathrp.Num_Thrp is null or lcathrp.Num_Thrp=0 then ''
		else str(convert(real, lcathrp.Sum_Thrp)*8.0/(1000.0*convert(real, lcathrp.Num_Thrp))) end as AvgTotalThrp, -- BI

	case when lcathrp.Sum_PCC_Thrp is null or lcathrp.Num_PCC_Thrp is null or lcathrp.Num_PCC_Thrp=0 then ''
		else str(convert(real, lcathrp.Sum_PCC_Thrp)*8.0/(1000.0*convert(real, lcathrp.Num_Thrp))) end as AvgPCCThrp, -- BJ

	case when lcathrp.Sum_SCC1_Thrp is null or lcathrp.Num_SCC1_Thrp is null or lcathrp.Num_SCC1_Thrp=0 then ''
		else str(convert(real, lcathrp.Sum_SCC1_Thrp)*8.0/(1000.0*convert(real, lcathrp.Num_Thrp))) end as AvgSCC1Thrp, -- BK

	case when lcathrp.Sum_SCC2_Thrp is null or lcathrp.Num_SCC2_Thrp is null or lcathrp.Num_SCC2_Thrp=0 then ''
		else str(convert(real, lcathrp.Sum_SCC2_Thrp)*8.0/(1000.0*convert(real, lcathrp.Num_Thrp))) end as AvgSCC2Thrp, -- new

		case when lcathrp.Sum_SCC3_Thrp is null or lcathrp.Num_SCC3_Thrp is null or lcathrp.Num_SCC3_Thrp=0 then ''
		else str(convert(real, lcathrp.Sum_SCC3_Thrp)*8.0/(1000.0*convert(real, lcathrp.Num_Thrp))) end as AvgSCC3Thrp, -------------new 4ca

		case when lcathrp.Sum_SCC4_Thrp is null or lcathrp.Num_SCC4_Thrp is null or lcathrp.Num_SCC4_Thrp=0 then ''
		else str(convert(real, lcathrp.Sum_SCC4_Thrp)*8.0/(1000.0*convert(real, lcathrp.Num_Thrp))) end as AvgSCC4Thrp, -------------new 5ca

	case when lcathrp.Sum_RB is null or lcathrp.Num_RB is null or lcathrp.Num_RB=0 then ''
		else str(convert(real, lcathrp.Sum_RB)*1.0/(1.0*convert(real, lcathrp.Num_RB))) end as AvgRB, -- BL

		case when lcathrp.Sum_RB_PCC is null or lcathrp.Num_RB_PCC is null or lcathrp.Num_RB_PCC=0 then ''
		else str(convert(real, lcathrp.Sum_RB_PCC)*1.0/(1.0*convert(real, lcathrp.Num_RB))) end as AvgRB_PCC, -- new

	case when lcathrp.Sum_RB_SCC1 is null or lcathrp.Num_RB_SCC1 is null or lcathrp.Num_RB_SCC1=0 then ''
		else str(convert(real, lcathrp.Sum_RB_SCC1)*1.0/(1.0*convert(real, lcathrp.Num_RB))) end as AvgRB_SCC1, -- new

	case when lcathrp.Sum_RB_SCC2 is null or lcathrp.Num_RB_SCC2 is null or lcathrp.Num_RB_SCC2=0 then ''
		else str(convert(real, lcathrp.Sum_RB_SCC2)*1.0/(1.0*convert(real, lcathrp.Num_RB))) end as AvgRB_SCC2, -- new

			case when lcathrp.Sum_RB_SCC3 is null or lcathrp.Num_RB_SCC3 is null or lcathrp.Num_RB_SCC3=0 then ''
		else str(convert(real, lcathrp.Sum_RB_SCC3)*1.0/(1.0*convert(real, lcathrp.Num_RB))) end as AvgRB_SCC3, -------------new 4ca

			case when lcathrp.Sum_RB_SCC4 is null or lcathrp.Num_RB_SCC4 is null or lcathrp.Num_RB_SCC4=0 then ''
		else str(convert(real, lcathrp.Sum_RB_SCC4)*1.0/(1.0*convert(real, lcathrp.Num_RB))) end as AvgRB_SCC4, -------------new 5ca

	--case when lcatime.SumSCC1_Time is null or lcatime.SumTotalTime is null or lcatime.SumTotalTime=0 then 0.0
		--else convert(real, lcatime.SumSCC1_Time)*1.0/(1.0*convert(real, lcatime.SumTotalTime)) end as SCC1Usage, -- BM

	--case when lcatime.SumSCC2_Time is null or lcatime.SumTotalTime is null or lcatime.SumTotalTime=0 then 0.0
		--else convert(real, lcatime.SumSCC2_Time)*1.0/(1.0*convert(real, lcatime.SumTotalTime)) end as SCC2Usage -- new

lDLFrameUsage.avgDLFrameUsage, -- BN
	--lRBFrame.avgNumRBFrame,
case when ftptp.Direction='GET' then lDLFrameUsage.avgMCS else null end as AvgMCSDL,
case when ftptp.Direction='PUT' then lULFrameUsage.avgMCSUL else null end as AvgMCSUL -- BP

	--lIntraRatHO.numIntraRATHO,
	--lURIReest.sumURIReest,
	--lMeasGap.sumMeasGap,
	--lInterRATHO.numInterRATHO -- BT

	into BI_Capacity

from
#tmptest4	Join Sessions s on (#tmptest4.sessionId = s.sessionId)
		Join TestInfo t On(s.sessionId = t.sessionID)
	       		
		Join fileList f On(s.FileId = f.FileId)
		Join datasession d On(s.sessionId = d.sessionId)
		Join ResultsCapacityTest ftpt On(t.testId = ftpt.testId AND ftpt.errorCode<>1001)
		Join ResultsCapacityTestParameters ftptp On(t.testId = ftptp.testId)
		Left Join ISPConfig On(t.TestId=ISPConfig.TestId)
		Join AccessPoints ap On(t.testId = ap.testId)
		Left Join #tmptestStartMode4 On(t.testId = #tmptestStartMode4.testId)
		Left Join #tmptestEndTime4 On(t.testId = #tmptestEndTime4.TestId)
		Left Join #tmpThrp4 On(t.testId = #tmpThrp4.testId)
		Left Join #tmpltemeas_summary lmeas On(t.testId = lmeas.testId)
		Left Join #tmpcathrp lcathrp On(t.testId = lcathrp.testId)
		Left Join #tmpcatimesummary lcatime On(t.testId = lcatime.testId)
		Left Join #tmpDLFrameUsage lDLFrameUsage On(t.testId = lDLFrameUsage.testId)
		Left Join #tmpULFrameUsage lULFrameUsage On(t.testId = lULFrameUsage.testId)
		Join networkInfo n On(#tmptestEndTime4.networkID = n.networkID)
		Join errorCodes e On(ftpt.errorcode = e.code)
		Join technology On(t.testId = technology.testId AND #tmptestEndTime4.testFinishTime = technology.MsgTime)


where (ftptp.Direction='GET' or ftptp.Direction='PUT')AND ((ftpt.errorcode=0 AND ftpt.lastblock=1) or (ftpt.errorcode>0 and ftpt.errorcode <> 1002)) AND (patindex('%_4G%', f.TaskName)>0 OR patindex('%4G_date%', f.ASideLocation)>0 OR patindex('%4Gdate%', f.ASideLocation)>0 OR patindex('%Data%', f.ASideLocation)>0 OR patindex('%4gdate%', f.ASideLocation)>0) AND (([#tmptestStartMode4].[testStartCellId] < 2147483647 OR [#tmptestStartMode4].[testStartCellId] IS NULL) AND ([#tmptestEndTime4].[testEndCellId] < 2147483647 OR [#tmptestEndTime4].[testEndCellId] IS NULL))

--AND (CollectionName LIKE 'THR%' OR
--CollectionName LIKE 'EMA%' OR
--CollectionName LIKE 'CMA%' OR
--CollectionName LIKE 'WMA%' OR
--CollectionName LIKE 'ATH%' OR
--CollectionName LIKE 'STR%' )

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
drop table #tmpULFrameUsage
--drop table BI_Capacity