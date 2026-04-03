Select sessions.sessionId,
CallSession.Callstatus,
CallSession.CallType,
CallSession.calldir,
CallSession.callmode,
CallFinishTime = DATEADD(ms,Sessions.duration,Sessions.startTime)
	into  #tmpsession

-------------------------------------------------------------------------------------------
from Sessions,
CallSession

-----------------------------------------------------------------------
where sessions.valid = 1 AND
Sessions.sessionType = 'CALL' AND
sessions.SessionId = CallSession.SessionId AND
Callsession.Callstatus Not In('System Release') and
Callsession.VoiceCallType In('Intrusive') 

------------------------------------------------------------------------
group by sessions.sessionId,
CallSession.Callstatus,
CallSession.CallType,
CallSession.calldir,
CallSession.callmode,
Sessions.duration,
Sessions.startTime



Declare @sessions INT
set @sessions = (select count(*) from #tmpsession)
PRINT @sessions
IF @sessions > 0
BEGIN

select s.sessionId,
	
	Case when Sum(Case when TestInfo.Direction='B->A' and TestInfo.valid=1 and LQ08.OptionalWB>=1 then 1 else 0 end)>0 then Count(Case when TestInfo.Direction='B->A'and TestInfo.valid=1  and LQ08.OptionalWB>=1 then 1 else NULL end)else NULL end as 'NumPOLQAWBBA',
	Case when Sum(Case when TestInfo.Direction='B->A'and TestInfo.valid=1  and LQ08.OptionalWB>=1 then 1 else 0 end)>0 then Sum(Case when TestInfo.Direction='B->A'and TestInfo.valid=1  then LQ08.OptionalWB else NULL end)else NULL end as 'SumPOLQAWBBA',
	Case when Sum(Case when TestInfo.Direction='A->B'and TestInfo.valid=1  and LQ08.OptionalWB>=1 then 1 else 0 end)>0 then Count(Case when TestInfo.Direction='A->B'and TestInfo.valid=1  and LQ08.OptionalWB>=1 then 1 else NULL end)else NULL end as 'NumPOLQAWBAB',
	Case when Sum(Case when TestInfo.Direction='A->B'and TestInfo.valid=1  and LQ08.OptionalWB>=1 then 1 else 0 end)>0 then Sum(Case when TestInfo.Direction='A->B'and TestInfo.valid=1  then LQ08.OptionalWB else NULL end)else NULL end as 'SumPOLQAWBAB'
	
into	#tmpLQ08
From 	#tmpsession s, ResultsLq08Avg LQ08, TestInfo, NetworkInfo
Where	s.sessionId = LQ08.SessionId And
	LQ08.TestId = TestInfo.TestId And
	TestInfo.NetworkID = NetworkInfo.NetworkID
Group by s.sessionId



Select	s.sessionId,
	n.technology,
	c.calltype,
	k.kpiId,
	k.errorCode,
	k.duration,
	k.endTime,
	NULL as 'CSFBErrorcode',
	NULL as 'CSFBRadioRedirect10181',
	NULL as 'CSFBCallSetupErrorCode',
	NULL as 'CSFBCallSetupTime'
into	#tmpCallSetupTime
from 	#tmpsession s, callSession c, ResultsKPI k, NetworkInfo n
where	s.sessionId = c.SessionId AND
	c.SessionId = k.SessionId AND
	(k.KpiId = 10100 ) AND
	k.NetworkID = n.NetworkID
Group by s.sessionId,
	n.technology,
	c.calltype,
	k.kpiId,
	k.errorCode,
	k.duration,
	k.endTime

Select	s.sessionId,
	n.technology,
	c.calltype,
	k.kpiId,
	k.errorCode,
	k.duration,
	k.endTime
into	#tmp4UMTSMOKPI10100
from 	#tmpsession s, callSession c, ResultsKPI k, NetworkInfo n
where	s.sessionId = c.SessionId AND
	c.SessionId = k.SessionId AND
	k.KpiId = 10100 AND
	k.NetworkID = n.NetworkID
Group by s.sessionId,
	n.technology,
	c.calltype,
	k.kpiId,
	k.errorCode,
	k.duration,
	k.endTime



Select	s.sessionId,
	n.technology,
	c.calltype,
	k.kpiId,
	k.errorCode,
	k.duration,
	k.endTime
into	#tmp4KPI10178
from 	#tmpsession s, callSession c, ResultsKPI k, NetworkInfo n
where	s.sessionId = c.SessionId AND
	c.SessionId = k.SessionId AND
	k.KpiId = 10178 AND 
	k.NetworkID = n.NetworkID
Group by s.sessionId,
	n.technology,
	c.calltype,
	k.kpiId,
	k.errorCode,
	k.duration,
	k.endTime
	
Select	s.sessionId,
	n.technology,
	c.calltype,
	k.kpiId,
	k.errorCode,
	k.duration,
	k.endTime
into	#tmp4KPI10181
from 	#tmpsession s, callSession c, ResultsKPI k, NetworkInfo n
where	s.sessionId = c.SessionId AND
	c.SessionId = k.SessionId AND
	k.KpiId = 10181 AND 
	k.NetworkID = n.NetworkID
Group by s.sessionId,
	n.technology,
	c.calltype,
	k.kpiId,
	k.errorCode,
	k.duration,
	k.endTime

Update #tmpCallSetupTime
Set #tmpCallSetupTime.technology=#tmp4UMTSMOKPI10100.technology,
    #tmpCallSetupTime.calltype=#tmp4UMTSMOKPI10100.calltype,
    #tmpCallSetupTime.kpiId=#tmp4UMTSMOKPI10100.kpiId,
    #tmpCallSetupTime.errorCode=#tmp4UMTSMOKPI10100.errorCode,
    #tmpCallSetupTime.duration=#tmp4UMTSMOKPI10100.duration
	From 
#tmpCallSetupTime, #tmp4UMTSMOKPI10100 
Where 	#tmpCallSetupTime.sessionId=#tmp4UMTSMOKPI10100.sessionId AND
	#tmpCallSetupTime.endTime=#tmp4UMTSMOKPI10100.endTime

--Update #tmpCallSetupTime ---- Palio 10178--------------------------------------------------------------------------------------
--Set #tmpCallSetupTime.technology=#tmp4KPI10178.technology,
  --  #tmpCallSetupTime.calltype=#tmp4KPI10178.calltype,
    --#tmpCallSetupTime.kpiId=#tmp4KPI10178.kpiId,
    --#tmpCallSetupTime.errorCode=#tmp4KPI10178.errorCode,
    --#tmpCallSetupTime.duration=#tmp4KPI10178.duration
--From 
--#tmpCallSetupTime, #tmp4KPI10178 
--Where 	#tmpCallSetupTime.sessionId=#tmp4KPI10178.sessionId AND
	--#tmpCallSetupTime.endTime=#tmp4KPI10178.endTime
-------------------------------------------------------------------------------------------------------------------------------------	
Update #tmpCallSetupTime
Set #tmpCallSetupTime.CSFBErrorcode=#tmp4KPI10181.errorCode,
	#tmpCallSetupTime.CSFBRadioRedirect10181=#tmp4KPI10181.duration
From 
#tmpCallSetupTime, #tmp4KPI10181 
Where 	#tmpCallSetupTime.sessionId=#tmp4KPI10181.sessionId
------------------------------------------------------------------------new for CSFB CST------------------------------------------
Update #tmpCallSetupTime
Set-- #tmpCallSetupTime.CSFBErrorcode=#tmp4KPI10178.errorCode, thelei diko tou CSFB error code stin arxi tis loupa 
      #tmpCallSetupTime.CSFBCallSetupErrorCode=#tmp4KPI10178.errorCode,-----new need check if working---
	#tmpCallSetupTime.CSFBCallSetupTime=#tmp4KPI10178.duration
From 
#tmpCallSetupTime, #tmp4KPI10178
Where 	#tmpCallSetupTime.sessionId=#tmp4KPI10178.sessionId

---------------------------------------------------------------------- end of new for CSFB CST----------------------------------------------


Select	s.sessionId,
	k.kpiid,
	Case when Sum(Case when k.errorcode = 0 then 1 else 0 end)>0 then Sum(Case when (k.calltype = 'M->L' OR k.callType = 'L->M') and k.errorcode = 0 then k.duration else 0 end)else NULL end as 'Sum_MO_Duration',
	Case when Sum(Case when k.errorcode = 0 then 1 else 0 end)>0 then Count(Case when (k.calltype = 'M->L' OR k.callType = 'L->M') and k.errorcode = 0 then 1 else NULL end)else NULL end as 'Num_MO_OK',
	Case when Sum(Case when k.errorcode > 0 then 1 else 0 end)>0 then Count(Case when (k.calltype = 'M->L' OR k.callType = 'L->M') and k.errorcode > 0 then 1 else NULL end)else NULL end as 'Num_MO_FAIL',
	Case when Sum(Case when k.CSFBErrorcode = 0 then 1 else 0 end)>0 then Sum(Case when (k.calltype = 'M->L' OR k.callType = 'L->M') and k.CSFBErrorcode = 0 then k.CSFBRadioRedirect10181 else 0 end)else NULL end as 'Sum_CSFBRadioRedirect',
	Case when Sum(Case when k.CSFBCallSetupErrorCode = 0 then 1 else 0 end)>0 then Sum(Case when (k.calltype = 'M->L' OR k.callType = 'L->M') and k.CSFBCallSetupErrorCode = 0 then k.CSFBCallSetupTime else 0 end)else NULL end as 'Sum_CSFBCallSetupTime'
	
into	#tmpCallSetupResults
from 	#tmpsession s, #tmpCallSetupTime k
where	s.sessionId = k.SessionId
Group by s.sessionId,
	k.kpiid



Select	s.sessionId,
	Case when Sum(Case when k.errorcode>=0 then 1 else 0 end)>0 then Sum(Case when k.errorcode>=0 then k.duration else 0 end)else NULL end as 'Sum_Duration',
	Case when Sum(Case when k.errorcode=0 then 1 else 0 end)>0 then Count(Case when k.errorcode=0 then 1 else NULL end)else NULL end as 'Num_CallComplete',
	Case when Sum(Case when k.errorcode>0 then 1 else 0 end)>0 then Count(Case when k.errorcode>0 then 1 else NULL end)else NULL end as 'Num_CallDrop'
into	#tmpCallEndResults
from 	#tmpsession s, ResultsKPI k
where	s.sessionId = k.SessionId AND
	k.KpiId = 20102
Group by s.sessionId


Select	s.sessionId,
	StartNetworkID = networkInfo.networkId,
	testStartMode = networkInfo.technology,
	testStartLat = Position.Latitude,
	testStartLong = Position.Longitude,
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
	testStartGSM = NULL,
	testStartRxLev = NULL,
	testStartRxQual = NULL,
	testAvgRxlev = NULL,
	testAvgRxQual = NULL,
	testAvgRSCP = NULL,
	testAvgEcNo = NULL,
	testAvgRSRP = NULL,
	testAvgSINR = NULL
into    #tmpCallStartMode
from 	#tmpsession s, markers, networkInfo, networkIdRelation, Position
where 	s.SessionId = markers.SessionId AND
		markers.NetworkId = networkInfo.networkId AND
		markers.MarkerText = 'Dial' AND
		networkInfo.networkId = networkIdRelation.networkId AND
		networkIdRelation.PosId = Position.PosId AND
		networkIdRelation.MsgTime = (select min(nid.MsgTime) from networkIdRelation nid
			where nid.networkId = networkinfo.networkId)

Update #tmpCallStartMode
Set #tmpCallStartMode.testStartGSM=MsgGSMReport.BCCH,
	#tmpCallStartMode.testStartRxLev=MsgGSMReport.RxLev,
	#tmpCallStartMode.testStartRxQual= MsgGSMReport.RxQual
from #tmpCallStartMode, MsgGSMReport
where #tmpCallStartMode.sessionId = MsgGSMReport.sessionId AND
	MsgGSMReport.MsgId = (select min (gsm.msgId) + 4 from MsgGSMReport gsm
		where gsm.sessionId = #tmpCallStartMode.sessionId )

Update #tmpCallStartMode
Set #tmpCallStartMode.testStartFreq=WCDMAActiveSet.FreqDL,
	#tmpCallStartMode.testStartPSC=WCDMAActiveSet.PrimScCode,
	#tmpCallStartMode.testStartRSCP=WCDMAActiveSet.RSCP_PSC,
	#tmpCallStartMode.testStartEcNo=WCDMAActiveSet.AggrEcIo_PSC
from #tmpCallStartMode, WCDMAActiveSet
where #tmpCallStartMode.sessionId = WCDMAActiveSet.sessionId AND
	WCDMAActiveSet.MsgId = (select min(wcdma.msgId) + 1 from WCDMAActiveSet wcdma
		where wcdma.sessionId = #tmpCallStartMode.sessionId)
		
--Update #tmpCallStartMode
--Set #tmpCallStartMode.testStartEARFCN=LTEServingCellInfo.DL_EARFCN,
	--#tmpCallStartMode.testStartPCI=LTEServingCellInfo.PhyCellId
--from #tmpCallStartMode, LTEServingCellInfo
--where #tmpCallStartMode.sessionId = LTEServingCellInfo.sessionId AND
	--LTEServingCellInfo.LTEServingCellInfoId = (select min(lte.LTEServingCellInfoId)  from LTEServingCellInfo lte
		--where lte.sessionId = #tmpCallStartMode.sessionId)

------------------------------------------------- start for avg Radio---------------------------------------------------------------------
Update #tmpCallStartMode
Set #tmpCallStartMode.testAvgRSRP =LTEMeasurementReport.RSRP
	--#tmpCallStartMode.testStartSINR=LTEMeasurementReport.SINR0
from #tmpCallStartMode, LTEMeasurementReport 
--where #tmpCallStartMode.sessionId = AVG(LTEMeasurementReport.sessionId )AND 
	where LTEMeasurementReport.RSRP = (select cast(round(AVG(lte.RSRP),2) as bigint) from LTEMeasurementReport lte  where lte.SessionId=#tmpCallStartMode.sessionId ) 

Update #tmpCallStartMode
Set --#tmpCallStartModetest.testAvgRSRP=LTEMeasurementReport.RSRP
	#tmpCallStartMode.testAvgSINR=LTEMeasurementReport.SINR0
from #tmpCallStartMode, LTEMeasurementReport 
--where #tmpCallStartMode.sessionId = AVG(LTEMeasurementReport.sessionId )AND 
	where --(LTEMeasurementReport.RSRP = (select cast(round(AVG(lte.RSRP),2) as bigint) from LTEMeasurementReport lte  where lte.SessionId=#tmpCallStartModetest.sessionId  ) ) 
	        (LTEMeasurementReport.SINR0 = (select cast(round(AVG(lte.SINR0),2) as bigint) from LTEMeasurementReport lte  where lte.SessionId=#tmpCallStartMode.sessionId  ) )


Update #tmpCallStartMode
Set #tmpCallStartMode.testAvgRxlev=MsgGSMReport.RxLev
	--#tmpCallStartModetest.testStartRxQual=MsgGSMReport.RxQual
from #tmpCallStartMode, MsgGSMReport
where 
	MsgGSMReport.RxLev = (select cast(round(AVG(gsm.RxLev),2) as int)  from MsgGSMReport gsm
		where gsm.sessionId = #tmpCallStartMode.sessionId)

Update #tmpCallStartMode
Set --#tmpCallStartModetest.testAvgRxlev=MsgGSMReport.RxLev
	#tmpCallStartMode.testAvgRxQual=MsgGSMReport.RxQual
from #tmpCallStartMode, MsgGSMReport
where 
	MsgGSMReport.RxQual = (select cast(round(AVG(gsm.RxQual),2) as int)  from MsgGSMReport gsm
		where gsm.sessionId = #tmpCallStartMode.sessionId)

Update #tmpCallStartMode
Set #tmpCallStartMode.testAvgRSCP=WCDMAActiveSet.RSCP_PSC
	--#tmpCallStartMode.testStartEcNo=WCDMAActiveSet.AggrEcIo_PSC
from #tmpCallStartMode, WCDMAActiveSet
where 
	WCDMAActiveSet.RSCP_PSC = (select cast(round(AVG(wcdma.RSCP_PSC),2)as int) from WCDMAActiveSet wcdma
		where wcdma.sessionId = #tmpCallStartMode.sessionId)


Update #tmpCallStartMode
Set --#tmpCallStartModetest.testAvgRSCP=WCDMAActiveSet.RSCP_PSC
	#tmpCallStartMode.testAvgEcNo=WCDMAActiveSet.AggrEcIo_PSC
from #tmpCallStartMode, WCDMAActiveSet
where 
	WCDMAActiveSet.AggrEcIo_PSC = (select cast(round(AVG(wcdma.AggrEcIo_PSC),2)as int) from WCDMAActiveSet wcdma
		where wcdma.sessionId = #tmpCallStartMode.sessionId)


---------------------------------------------------end for avg RSRP--------------------------------------------------------------------			
		
Update #tmpCallStartMode
Set #tmpCallStartMode.testStartRSRP=LTEMeasurementReport.RSRP,
	#tmpCallStartMode.testStartSINR=LTEMeasurementReport.SINR0,
	#tmpCallstartMode.testStartEARFCN=LTEMeasurementReport.EARFCN,
	#tmpCallstartMode.testStartPCI=LTEMeasurementReport.PhyCellId
from #tmpCallStartMode, LTEMeasurementReport
where #tmpCallStartMode.sessionId = LTEMeasurementReport.sessionId AND
	LTEMeasurementReport.MsgId = (select min(lte.msgId)  from LTEMeasurementReport lte
		where lte.sessionId = #tmpCallStartMode.sessionId) --AND
	--lte.EARFCN = #tmpCallStartMode.testStartEARFCN AND
		--lte.PhyCellId = #tmpCallStartMode.testStartPCI)
		
Select 	Distinct
		s.sessionId,
		EndNetworkID = networkInfo.networkId,
		callEndMode = networkInfo.technology,
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
		testEndGSM = NULL,
		testEndRxLev = NULL,
		testEndRxQual = NULL
into 	#tmpCallEndMode
from   	#tmpsession s, markers, networkInfo, networkIdRelation, Position
where 	s.SessionId = markers.SessionId AND
		markers.NetworkId = networkInfo.networkId AND
		(markers.MarkerText='Disconnect' or markers.MarkerText ='Break'or markers.MarkerText ='ConnectFailed' or markers.MarkerText ='released' or markers.MarkerText = 'System Release') AND
		networkInfo.networkId = networkIdRelation.networkId AND
		networkIdRelation.sessionId = s.sessionId AND
		networkIdRelation.PosId = Position.PosId AND 
		networkIdRelation.MsgTime = (select max(nir.MsgTime) from networkIdRelation nir
				where nir.sessionId = s.sessionId AND
					nir.networkId = networkInfo.networkId AND
					 nir.MsgTime <= s.CallFinishTime)

Update #tmpCallEndMode
Set #tmpCallEndMode.testEndGSM=MsgGSMReport.BCCH,
	#tmpCallEndMode.testEndRxLev=MsgGSMReport.RxLev,
	#tmpCallEndMode.testEndRxQual=MsgGSMReport.RxQual
from #tmpCallEndMode, MsgGSMReport
where #tmpCallEndMode.sessionId = MsgGSMReport.sessionId AND
	MsgGSMReport.MsgId = (select max(gsm.msgId) - 7  from MsgGSMReport gsm
		where gsm.sessionId = #tmpCallEndMode.sessionId)
					 
Update #tmpCallEndMode
Set #tmpCallEndMode.testEndFreq=WCDMAActiveSet.FreqDL,
	#tmpCallEndMode.testEndPSC=WCDMAActiveSet.PrimScCode,
	#tmpCallEndMode.testEndRSCP=WCDMAActiveSet.RSCP_PSC,
	#tmpCallEndMode.testEndEcNo=WCDMAActiveSet.AggrEcIo_PSC
from #tmpCallEndMode, WCDMAActiveSet
where #tmpCallEndMode.sessionId = WCDMAActiveSet.sessionId AND
	WCDMAActiveSet.MsgId = (select max(wcdma.msgId) from WCDMAActiveSet wcdma
		where wcdma.sessionId = #tmpCallEndMode.sessionId)
		
--Update #tmpCallEndMode
--Set #tmpCallEndMode.testEndEARFCN=LTEServingCellInfo.DL_EARFCN,
	--#tmpCallEndMode.testEndPCI=LTEServingCellInfo.PhyCellId
--from #tmpCallEndMode, LTEServingCellInfo
--where #tmpCallEndMode.sessionId = LTEServingCellInfo.sessionId AND
	--LTEServingCellInfo.LTEServingCellInfoId = (select max(lte.LTEServingCellInfoId) from LTEServingCellInfo lte
		--where lte.sessionId = #tmpCallEndMode.sessionId)
		
Update #tmpCallEndMode
Set #tmpCallEndMode.testEndRSRP=LTEMeasurementReport.RSRP,
	#tmpCallEndMode.testEndSINR=LTEMeasurementReport.SINR0,
	#tmpCallEndMode.testEndEARFCN=LTEMeasurementReport.EARFCN,
	#tmpCallEndMode.testEndPCI=LTEMeasurementReport.PhyCellId
from #tmpCallEndMode, LTEMeasurementReport
where #tmpCallEndMode.sessionId = LTEMeasurementReport.sessionId AND
	LTEMeasurementReport.MsgId = (select max(lte.msgId) from LTEMeasurementReport lte
		where lte.sessionId = #tmpCallEndMode.sessionId) --AND
		--lte.EARFCN = #tmpCallEndMode.testEndEARFCN AND
		--lte.PhyCellId = #tmpCallEndMode.testEndPCI)



		----------- KT allagi tou codec rate se codecNmae apo VVoiceCodecsTEst--------------------------------------------------------------
select v.sessionid,
        v.CodecName
	--Case when Sum(Case when v.duration>0 then 1 else 0 end)>0 then sum(v.codecrate*v.duration)/sum(v.duration) else NULL end as codecrate
into	#tmpcodecrate_AB_DL
from Sessions s,
	TestInfo t,
	vVoiceCodecsTest v
where s.SessionId=v.SessionID AND
	t.testid=v.testid and
	s.valid = 1 AND
	t.typeoftest like '%POLQA%' AND
	v.direction = 'D' AND
	t.direction = 'A->B'
group by v.sessionid,v.CodecName
order by v.sessionid

select v.sessionid,
v.CodecName
	--Case when Sum(Case when v.duration>0 then 1 else 0 end)>0 then sum(v.codecrate*v.duration)/sum(v.duration) else NULL end as codecrate
into	#tmpcodecrate_AB_UL
from Sessions s,
	TestInfo t,
	vVoiceCodecsTest v
where s.SessionId=v.SessionID AND
	t.testid=v.testid and
	s.valid = 1 AND
	t.typeoftest like '%POLQA%' AND
	v.direction = 'U' AND
	t.direction = 'A->B'
group by v.sessionid,v.CodecName
order by v.sessionid

select v.sessionid,v.CodecName
	--Case when Sum(Case when v.duration>0 then 1 else 0 end)>0 then sum(v.codecrate*v.duration)/sum(v.duration) else NULL end as codecrate
into	#tmpcodecrate_BA_DL
from Sessions s,
	TestInfo t,
	vVoiceCodecsTest v
where s.SessionId=v.SessionID AND
	t.testid=v.testid and
	s.valid = 1 AND
	t.typeoftest like '%POLQA%' AND
	v.direction = 'D' AND
	t.direction = 'B->A'
group by v.sessionid,v.CodecName
order by v.sessionid

select v.sessionid,
v.CodecName
	--Case when Sum(Case when v.duration>0 then 1 else 0 end)>0 then sum(v.codecrate*v.duration)/sum(v.duration) else NULL end as codecrate
into	#tmpcodecrate_BA_UL
from Sessions s,
	TestInfo t,
	vVoiceCodecsTest v
where s.SessionId=v.SessionID AND
	t.testid=v.testid and
	s.valid = 1 AND
	t.typeoftest like '%POLQA%' AND
	v.direction = 'U' AND
	t.direction = 'B->A'
group by v.sessionid,v.CodecName
order by v.sessionid
--______________________________________________________________________End of CodeName_____________________________________________________

Select sessionsB.sessionId,
SessionsB.sessionIdA
into	#tmpBsession
from SessionsB
where sessionsB.valid = 1 AND
SessionsB.sessionType = 'CALL'
group by sessionsB.sessionId,
SessionsB.sessionIdA




Select	s.sessionId,
	'CS     ' as 'CallMode',
	k.kpiId,
	k.errorCode,
	k.duration,
	k.endTime,
	NULL as 'CSFBErrorcode',
	NULL as 'CSFBRadioRedirect'
into	#tmpBCallSetupTime
from 	#tmpBsession s, ResultsKPI k
where	s.SessionId = k.SessionId AND
	(k.KpiId = 10100)--unknown---
Group by s.sessionId,
	k.kpiId,
	k.errorCode,
	k.duration,
	k.endTime


Select	s.sessionId,
	'CS     ' as 'CallMode',
	k.kpiId,
	k.errorCode,
	k.duration,
	k.endTime
into	#tmpB4UMTSMOKPI10100
from 	#tmpBsession s, ResultsKPI k
where	s.SessionId = k.SessionId AND
	k.KpiId = 10100
Group by s.sessionId,
	k.kpiId,
	k.errorCode,
	k.duration,
	k.endTime



Select	s.sessionId,
	'CSFB' as 'CallMode',
	k.kpiId,
	k.errorCode,
	k.duration,
	k.endTime
into	#tmpB4KPI10178
from 	#tmpBsession s, ResultsKPI k
where	s.SessionId = k.SessionId AND
	k.KpiId = 10178 
Group by s.sessionId,
	k.kpiId,
	k.errorCode,
	k.duration,
	k.endTime
	
Select	s.sessionId,
	'CSFB' as 'CallMode',
	k.kpiId,
	k.errorCode,
	k.duration,
	k.endTime
into	#tmpB4KPI10181
from 	#tmpBsession s, ResultsKPI k
where	s.SessionId = k.SessionId AND
	k.KpiId = 10181 
Group by s.sessionId,
	k.kpiId,
	k.errorCode,
	k.duration,
	k.endTime

Update #tmpBCallSetupTime
Set #tmpBCallSetupTime.callmode=#tmpB4UMTSMOKPI10100.callmode,
    #tmpBCallSetupTime.kpiId=#tmpB4UMTSMOKPI10100.kpiId,
    #tmpBCallSetupTime.errorCode=#tmpB4UMTSMOKPI10100.errorCode,
    #tmpBCallSetupTime.duration=#tmpB4UMTSMOKPI10100.duration
From 
#tmpBCallSetupTime, #tmpB4UMTSMOKPI10100 
Where 	#tmpBCallSetupTime.sessionId=#tmpB4UMTSMOKPI10100.sessionId AND
	#tmpBCallSetupTime.endTime=#tmpB4UMTSMOKPI10100.endTime

Update #tmpBCallSetupTime
Set #tmpBCallSetupTime.callmode=#tmpB4KPI10178.callmode,
    #tmpBCallSetupTime.kpiId=#tmpB4KPI10178.kpiId,
    #tmpBCallSetupTime.errorCode=#tmpB4KPI10178.errorCode,
    #tmpBCallSetupTime.duration=#tmpB4KPI10178.duration
From 
#tmpBCallSetupTime, #tmpB4KPI10178 
Where 	#tmpBCallSetupTime.sessionId=#tmpB4KPI10178.sessionId AND
	#tmpBCallSetupTime.endTime=#tmpB4KPI10178.endTime
	
Update #tmpBCallSetupTime
Set #tmpBCallSetupTime.CSFBErrorcode=#tmpB4KPI10181.errorCode,
	#tmpBCallSetupTime.CSFBRadioRedirect=#tmpB4KPI10181.duration
From 
#tmpBCallSetupTime, #tmpB4KPI10181 
Where 	#tmpBCallSetupTime.sessionId=#tmpB4KPI10181.sessionId




Select	s.sessionId,
	s.sessionIdA,
	k.callmode,
	k.kpiid,
	Case when Sum(Case when k.errorcode = 0 then 1 else 0 end)>0 then Sum(Case when k.errorcode = 0 then k.duration else 0 end)else NULL end as 'Sum_MO_Duration',
	Case when Sum(Case when k.errorcode = 0 then 1 else 0 end)>0 then Count(Case when k.errorcode = 0 then 1 else NULL end)else NULL end as 'Num_MO_OK',
	Case when Sum(Case when k.errorcode > 0 then 1 else 0 end)>0 then Count(Case when k.errorcode > 0 then 1 else NULL end)else NULL end as 'Num_MO_FAIL',
	Case when Sum(Case when k.CSFBErrorcode = 0 then 1 else 0 end)>0 then Sum(Case when k.CSFBErrorcode = 0 then k.CSFBRadioRedirect else 0 end)else NULL end as 'Sum_CSFBRadioRedirect'
	
into	#tmpBCallSetupResults
from 	#tmpBsession s, #tmpBCallSetupTime k
where	s.sessionId = k.SessionId
Group by s.sessionId,
		s.sessionIdA,
		k.callmode,
		k.kpiid



Select	s.sessionId,
	s.sessionIdA,
	Case when Sum(Case when k.errorcode>=0 then 1 else 0 end)>0 then Sum(Case when k.errorcode>=0 then k.duration else 0 end)else NULL end as 'Sum_Duration',
	Case when Sum(Case when k.errorcode=0 then 1 else 0 end)>0 then Count(Case when k.errorcode=0 then 1 else NULL end)else NULL end as 'Num_CallComplete',
	Case when Sum(Case when k.errorcode>0 then 1 else 0 end)>0 then Count(Case when k.errorcode>0 then 1 else NULL end)else NULL end as 'Num_CallDrop'
into	#tmpBCallEndResults
from 	#tmpBsession s, ResultsKPI k
where	s.sessionId = k.SessionId AND
	k.KpiId = 20100
Group by s.sessionId,
	s.sessionIdA


select	DISTINCT #tmpBsession.SessionIdA,
	#tmpBsession.SessionId, 
	#tmpBCallSetupResults.callmode,
	#tmpBCallSetupResults.kpiid,
	#tmpBCallSetupResults.Sum_MO_Duration,
	#tmpBCallSetupResults.Num_MO_OK,
	#tmpBCallSetupResults.Num_MO_FAIL,
	#tmpBCallEndResults.Sum_Duration,
	#tmpBCallEndResults.Num_CallComplete,
	#tmpBCallEndResults.Num_CallDrop,
	#tmpBCallSetupResults.Sum_CSFBRadioRedirect
	
into #tmpBResults
from
#tmpBsession     Join sessionsB s On(#tmpBsession.sessionID = s.sessionID)
		Left Join #tmpBCallSetupResults On(s.sessionId = #tmpBCallSetupResults.sessionId)
		Left Join #tmpBCallEndResults On(s.sessionId = #tmpBCallEndResults.sessionId)

order by #tmpBsession.sessionId
----------------------------------------------------------BI STATS--------------------------




Select	s.sessionId,
	Case when Sum(Case when k.errorcode=0 then 1 else 0 end)>0 then Sum(Case when k.errorcode=0 then k.duration else 0 end)else NULL end as 'Sum_SRVCC_Duration',
	Case when Sum(Case when k.errorcode=0 then 1 else 0 end)>0 then Count(Case when k.errorcode=0 then 1 else NULL end)else NULL end as 'Num_SRVCC_OK',
	Case when Sum(Case when k.errorcode>0 then 1 else 0 end)>0 then Count(Case when k.errorcode>0 then 1 else NULL end)else NULL end as 'Num_SRVCC_Fail'
into	#tmpSRVCCResultsA
from 	#tmpsession s, ResultsKPI k
where	s.sessionId = k.SessionId AND
	(k.KpiId = 38040 OR k.KpiId = 38050)
Group by s.sessionId

Select	s.sessionId,
	s.sessionIdA,
	Case when Sum(Case when k.errorcode=0 then 1 else 0 end)>0 then Sum(Case when k.errorcode=0 then k.duration else 0 end)else NULL end as 'Sum_SRVCC_Duration',
	Case when Sum(Case when k.errorcode=0 then 1 else 0 end)>0 then Count(Case when k.errorcode=0 then 1 else NULL end)else NULL end as 'Num_SRVCC_OK',
	Case when Sum(Case when k.errorcode>0 then 1 else 0 end)>0 then Count(Case when k.errorcode>0 then 1 else NULL end)else NULL end as 'Num_SRVCC_Fail'
into	#tmpSRVCCResultsB
from 	#tmpBsession s, ResultsKPI k
where	s.sessionId = k.SessionId AND
	(k.KpiId = 38040 OR k.KpiId = 38050)
Group by s.sessionId,
	s.sessionIdA

Select	s.sessionId,
	k.errorcode,
	e.msg,
	Case when Sum(Case when k.errorcode=0 then 1 else 0 end)>0 then Count(Case when k.errorcode=0 then 1 else NULL end)else NULL end as 'Num_10101_OK',
	Case when Sum(Case when k.errorcode>0 then 1 else 0 end)>0 then Count(Case when k.errorcode>0 then 1 else NULL end)else NULL end as 'Num_10101_Fail'
into	#tmp10101A
from 	#tmpsession s, ResultsKPI k, errorcodes e
where	s.sessionId = k.SessionId AND
		k.KpiId = 10101 AND --until Connect--
		e.code = k.errorcode
Group by s.sessionId,
	k.errorcode,
	e.msg

Select	s.sessionId,
	s.sessionIdA,
	k.errorcode,
	e.msg,
	Case when Sum(Case when k.errorcode=0 then 1 else 0 end)>0 then Count(Case when k.errorcode=0 then 1 else NULL end)else NULL end as 'Num_10101_OK',
	Case when Sum(Case when k.errorcode>0 then 1 else 0 end)>0 then Count(Case when k.errorcode>0 then 1 else NULL end)else NULL end as 'Num_10101_Fail'
into	#tmp10101B
from 	#tmpBsession s, ResultsKPI k, errorcodes e
where	s.sessionId = k.SessionId AND
		k.KpiId = 10101 AND 
		e.code = k.errorcode
Group by s.sessionId,
	s.sessionIdA,
	k.errorcode,
	e.msg

select 	s.sessionId, 
	case when SUM(crcRec) > 0 THEN SUM(crcError)*100 / SUM(crcRec) else 0 end as BLER, NULL as lastBLER
into 	#tmpBLER
from 	#tmpsession s, wcdmaBLER
where 	s.sessionId = wcdmaBLER.sessionId
group by s.sessionId

select 	s.sessionId, avg(agc.TxPwr) as avgTxPwr
into 	#tmpAGC
from 	#tmpsession s, wcdmaAGC agc
where 	s.sessionId = agc.sessionId
group by s.sessionId

select 	s.sessionId, 
	SUM(case when k.KpiId = 35100 then 1 else 0 end) as numIntrHO
into 	#tmpINTRHO
from 	#tmpsession s,  ResultsKPI k
where s.sessionId = k.SessionId
group by s.sessionId

select 	s.sessionId, 
	SUM(case when k.KpiId = 35107 then 1 else 0 end) as numIntraHO
into 	#tmpINTRAHO
from 	#tmpsession s,  ResultsKPI k
where s.sessionId = k.SessionId
group by s.sessionId

select 	s.sessionId, 
	SUM(case when (k.KpiId = 35020 OR k.KpiId = 35030 OR k.KpiId = 35040 OR k.KpiId = 35050 OR k.KpiId = 35060 OR k.KpiId = 35070) then 1 else 0 end) as numIntrRATHO
into 	#tmpINTRATHO
from 	#tmpsession s,  ResultsKPI k
where s.sessionId = k.SessionId
group by s.sessionId
------------------------------------------------------------------------Low mos Column----------------------------------------------------------------------------------------
select 
	FileList.CollectionName as 'CollectionName',
	l1.sessionid as 'SessionID',
	TestInfo.valid,
	FileList.ASideLocation as 'ASideLocation',
	Filelist.FileId as 'FileID',
	l1.TESTid as 'TESTID_1',
	l2.TESTID as 'TESTID_2',
	l3.TESTID as 'TESTID_3',
	l1.optionalWB as 'MOS_1',
	l2.optionalWB as 'MOS_2',
	l3.optionalWB as 'MOS_3',
	l1.QualityCode as 'CODE1',
	l2.QualityCode as 'CODE2',
	l3.QualityCode as 'CODE3',
	l1.status as 'L1status',
	l2.status as 'L2status',
	l3.status as 'L3status'
INTO #TEMP
FROM ResultsLQ08Avg l1 
LEFT join Resultslq08Avg l2 on (l1.TestId+1=l2.TestId and l1.sessionid=l2.SessionId)
LEFT join Resultslq08Avg l3 on (l1.TestId+2=l3.TestId and l1.sessionid=l3.SessionId)
JOIN CallSession on (Callsession.SessionId = l1.SessionID and CallSession.callStatus = 'Completed') 
JOIN Sessions on (Callsession.SessionId = Sessions.SessionId)
JOIN FileList on (Filelist.FileId = Sessions.FileId)
Join TestInfo on (TestInfo.TestId=l1.TestId)
where TestInfo.valid=1


SELECT DISTINCT 
	CollectionName,
	SessionID,
	ASideLocation

into #templowmos

FROM #TEMP
WHERE 
(MOS_1<1.29 and MOS_1>1.01 or (L1status = 'Silence' and CODE1 = '0001000000000000'or CODE1 = '0000001000000000')) AND (MOS_2<1.29 and MOS_2>1.01 or (L2status = 'Silence' and CODE2 = '0001000000000000'or CODE2 = '0000001000000000'))
OR
(MOS_1<1.29 and MOS_1>1.01 or (L1status = 'Silence' and CODE1 = '0001000000000000'or CODE1 = '0000001000000000')) AND (MOS_3<1.29 and MOS_3>1.01 or (L3status = 'Silence' and CODE3 = '0001000000000000'or CODE3 = '0000001000000000'))

--select * from #templowmos
ORDER BY SessionID;

drop table #TEMP

-----------------------------------------------------------------------------------------------------------low mos end----------------------------------------------
select	DISTINCT n.Operator,
	n.HomeOperator,
	#tmpsession.SessionId, --C
	CAST(datepart(dd,s.startTime) as varchar)+'.'+CAST(datepart(mm,s.startTime) as varchar)+'.'+CAST(datepart(yy,s.startTime) as varchar) as StartDate,
        CAST(datepart(hh,s.startTime) as Varchar)+':'+CAST(datepart(mi,s.startTime) as varchar)+':'+CAST(datepart(ss,s.startTime) as varchar)+'.'+CAST(datepart(ms,s.startTime) as varchar) as StartTime,
	CAST(datepart(hh,#tmpsession.CallFinishTime) as Varchar)+':'+CAST(datepart(mi,#tmpsession.CallFinishTime) as varchar)+':'+
	CAST(datepart(ss,#tmpsession.CallFinishTime) as varchar)+'.'+CAST(datepart(ms,#tmpsession.CallFinishTime) as varchar) as CallFinishTime,
	f.ASideFileName,
    f.ASideLocation,	 
	f.IMEI,
	f.CollectionName, ---------------- instead of Aside device
	f.ASideNumber,
	f.BSideNumber,
	c.callType, -- 
        c.callDir, -- M
	c.callStatus, -- N
	c.callcause,  -- O
	c.callmode, -- P
	#tmpBResults.callmode as callmodeB,
	-- R
----------------------------------------------10178----------------------------------------------------
	case when c.callDir='A->B' or c.callDir='B->A' then 
	    case when c.callmode='CSFB' then 
				case when #tmpCallSetupResults.Sum_CSFBCallSetupTime!='' then 
					convert(varchar, #tmpCallSetupResults.Sum_CSFBCallSetupTime/1000.0)
				else '' end
		end
	else case when c.callDir='B->A' then
			 case when #tmpBResults.callmode='CSFB' then
				  case when #tmpCallSetupResults.Sum_MO_Duration!='' then 
					str(convert(real, #tmpBResults.Sum_MO_Duration/1000.0)) else '' 
-------------------------------------------mine------------------------------------------ 10181 sta L to M
					--case when c.callmode='CSFB' then 
				--case when #tmpCallSetupResults.Sum_CSFBCallSetupTime!='' then 
					--str(convert(real, #tmpCallSetupResults.Sum_CSFBCallSetupTime)) else '' 

				  end
			 else '' end
		  else '' end

	end as MO_CSFB_CallSetupTime,
	---------------------------------------End mine--------------------------------------------------------	
	-- S
	case when c.callDir='A->B' or c.callDir='B->A' then 
	    case when c.callmode='CSFB' then 
				case when #tmpCallSetupResults.Sum_CSFBRadioRedirect!='' then 
					convert(varchar, #tmpCallSetupResults.Sum_CSFBRadioRedirect/1000.0)
				else '' end
		end
	else case when c.callDir='B->A' then
			case when #tmpBResults.callmode='CSFB' then
				  case when #tmpBResults.Sum_CSFBRadioRedirect!='' then 
					str(convert(real, #tmpBResults.Sum_CSFBRadioRedirect/1000.0)) else '' 

		--mine--case when c.callmode='CSFB' then 
			--case when #tmpCallSetupResults.Sum_CSFBRadioRedirect!='' then 
			--	str(convert(real, #tmpCallSetupResults.Sum_CSFBRadioRedirect)) else ''

				  end
			 else '' end
		  else '' end
	
	end as MO_CSFB_Duration_Call_Procedure,
	-- T => depends on R and S

-----------------------------------------------------------------------------------------------------------------
	-- U
	case when c.callDir='A->B' or c.callDir='B->A' then 
	    case when c.callmode='CS' then 
				case when #tmpCallSetupResults.Sum_MO_Duration!='' then 
					convert(varchar, #tmpCallSetupResults.Sum_MO_Duration/1000.0)
				else '' end
		end
	else case when c.callDir='B->A' then
			 case when #tmpBResults.callmode='CS' then
				  case when #tmpBResults.Sum_MO_Duration!='' then 
					str(convert(real, #tmpBResults.Sum_MO_Duration)) else '' 
				  end
			 else '' end
		  else '' end
	
	end as No_MO_CSFB_CallSetupTime,
	-- V
-----------------------------------------------------------------------------------------------------------------------
	case when c.callDir='A->B' or c.callDir='B->A'  and c.callStatus in ('dropped','completed') then 
		case when #tmpCallSetupResults.Sum_MO_Duration!='' then 
			convert(varchar, #tmpCallSetupResults.Sum_MO_Duration/1000.0) 
		else '' end

	else case when c.callDir='B->A'  and c.callStatus in ('dropped','completed') then
    	case when #tmpBResults.Sum_MO_Duration!='' then 
			convert(varchar, #tmpBResults.Sum_MO_Duration/1000.0) else '' 
		end
		else '' end
	
	end as MO_CallSetupTime,
-----------------------------------------------------------------------------------------------------------------------------
	--W
	case when c.callDir='A->B' or c.callDir='B->A' then 
		case when #tmpCallSetupResults.kpiid!='' then 
			str(#tmpCallSetupResults.kpiid) 
		else '' end

	else case when c.callDir='B->A' then
    	case when #tmpBResults.kpiid!='' then 
			str(#tmpBResults.kpiid) else '' 
		end
		else '' end
	
	end as MO_Callsetup_KPIID,
	-----------------------------------------------------------------------------------------------------------------------------
	-- X
	case when c.callDir='A->B' or c.callDir='B->A' then 
		case when  #tmp10101A.Num_10101_OK=1 then 
			'OK' else case when #tmp10101A.Num_10101_Fail=1 then 'Fail' else '' end
		end
	else case when c.callDir='B->A' then
    	case when #tmp10101B.Num_10101_OK=1 then 
			'OK' else case when #tmp10101B.Num_10101_Fail=1 then 'Fail' else '' end
		end
		else '' end
	
	end as MO_10101_Status,
---------------------------------------------------------------------------------------------------------------------------------
	-- Y
	case when c.callDir='A->B' or c.callDir='B->A' then 
		case when #tmp10101A.errorcode!='' then 
			str(#tmp10101A.errorcode) 
		else '' end

	else case when c.callDir='B->A' then
    	case when #tmp10101B.errorcode!='' then 
			str(#tmp10101B.errorcode) else '' 
		end
		else '' end
	
	end as MO_10101_Error_Code,
--------------------------------------------------------------------------------------------------------------------------------------
	-- Z
	case when c.callDir='A->B' or c.callDir='B->A' then 
		case when #tmp10101A.msg!='' then 
			#tmp10101A.msg 
		else '' end

	else case when c.callDir='B->A' then
    	case when #tmp10101B.msg!='' then 
			#tmp10101B.msg else '' 
		end
		else '' end
	
	end as MO_10101_Error_Message,
-----------------------------------------------------------------------------------------------------------------------
	-- AA
	case when c.callDir='B->A' then 
	    case when c.callmode='CSFB' then 
				case when #tmpCallSetupResults.Sum_CSFBCallSetupTime!='' then 
					convert(varchar, #tmpCallSetupResults.Sum_CSFBCallSetupTime/1000.0)
				else '' end
		end
	else case when c.callDir='A->B' then
			 case when #tmpBResults.callmode='CSFB' then
				  case when #tmpCallSetupResults.Sum_MO_Duration!='' then 
					str(convert(real, #tmpBResults.Sum_MO_Duration/1000.0)) else '' 
				  end
			 else '' end
		  else '' end
	
	end as OVERALL_MO_CSFB_CallSetupTime,
--------------------------------------------------------------------------------------------------------------------
	-- AB
	case when c.callDir='B->A' then 
	    case when c.callmode='CSFB' then 
				case when #tmpCallSetupResults.Sum_CSFBRadioRedirect!='' then 
					convert(varchar, #tmpCallSetupResults.Sum_CSFBRadioRedirect/1000.0)
				else '' end
		end
	else case when c.callDir='A->B' then
			 case when #tmpBResults.callmode='CSFB' then
				  case when #tmpBResults.Sum_CSFBRadioRedirect!='' then 
					str(convert(real, #tmpBResults.Sum_CSFBRadioRedirect/1000.0)) else '' 
				  end
			 else '' end
		  else '' end
	
	end as OVERALL_MO_CSFB_Duration_Call_Procedure,
	-- AC
------------------------------------------------------------------------------------------------------------------------
	-- AD
	case when c.callDir='B->A' then 
	    case when c.callmode='CS' then 
				case when #tmpCallSetupResults.Sum_MO_Duration!='' then 
					convert(varchar, #tmpCallSetupResults.Sum_MO_Duration/1000.0)
				else '' end
		end
	else case when c.callDir='A->B' then
			 case when #tmpBResults.callmode='CS' then
				  case when #tmpBResults.Sum_MO_Duration!='' then 
					str(convert(real, #tmpBResults.Sum_MO_Duration/1000.0)) else '' 
				  end
			 else '' end
		  else '' end
	
	end as ThreeG_No_MO_CSFB_CallSetupTime,
--------------------------------------------------------------------------------------------------
	-- AE
	case when c.callDir='B->A' then 
		case when #tmpCallSetupResults.Sum_MO_Duration!='' then 
			convert(varchar, #tmpCallSetupResults.Sum_MO_Duration/1000.0) 
		else '' end

	else case when c.callDir='A->B' then
    	case when #tmpBResults.Sum_MO_Duration!='' then 
			convert(varchar, #tmpBResults.Sum_MO_Duration/1000.0) else '' 
		end
		else '' end
	
	end as MT_CallSetupTime,
---------------------------------------------------------------------------------------------
	-- AF
	case when c.callDir='B->A' then 
		case when #tmpCallSetupResults.kpiid!='' then 
			str(#tmpCallSetupResults.kpiid) 
		else '' end

	else case when c.callDir='A->B' then
    	case when #tmpBResults.kpiid!='' then 
			str(#tmpBResults.kpiid) else '' 
		end
		else '' end
	
	end as MT_Callsetup_KPIID,
------------------------------------------------------------------------------------------------
	-- AG
	case when c.callDir='B->A' then 
		case when  #tmp10101A.Num_10101_OK=1 then 
			'OK' else case when #tmp10101A.Num_10101_Fail=1 then 'Fail' else '' end
		end
	else case when c.callDir='A->B' then
    	case when #tmp10101B.Num_10101_OK=1 then 
			'OK' else case when #tmp10101B.Num_10101_Fail=1 then 'Fail' else '' end
		end
		else '' end
	
	end as MT_10101_Status,
---------------------------------------------------------------------------------------------
	-- AH
	case when c.callDir='B->A' then 
		case when #tmp10101A.errorcode!='' then 
			str(#tmp10101A.errorcode) 
		else '' end

	else case when c.callDir='A->B' then
    	case when #tmp10101B.errorcode!='' then 
			str(#tmp10101B.errorcode) else '' 
		end
		else '' end
	
	end as MT_10101_Error_Code,
-----------------------------------------------------------------------------------------------
	-- AI
	case when c.callDir='B->A' then 
		case when #tmp10101A.msg!='' then 
			#tmp10101A.msg 
		else '' end

	else case when c.callDir='A->B' then
    	case when #tmp10101B.msg!='' then 
			#tmp10101B.msg else '' 
		end
		else '' end
	
	end as MT_10101_Error_Message,
--------------------------------------------------------------------------------------------------------
	#tmpCallStartMode.testStartMode,
	#tmpCallStartMode.testStartLat,
	#tmpCallStartMode.testStartLong,
	#tmpCallStartMode.testStartLAC,
	#tmpCallStartMode.testStartCellId,
	#tmpCallStartMode.testStartBCCH,
	#tmpCallStartMode.testStartEARFCN,
	#tmpCallStartMode.testStartPCI,
	#tmpCallStartMode.testStartRSRP,
	#tmpCallStartMode.testStartSINR,
	#tmpCallStartMode.testStartFreq,
	#tmpCallStartMode.testStartPSC,
	#tmpCallStartMode.testStartRSCP,
	#tmpCallStartMode.testStartEcNo,
	#tmpCallEndMode.callEndMode,
		#tmpCallEndMode.testEndLat,
		#tmpCallEndMode.testEndLong,
		#tmpCallEndMode.testEndLAC,
		#tmpCallEndMode.testEndCellId,
		#tmpCallEndMode.testEndBCCH,
		#tmpCallEndMode.testEndEARFCN,
		#tmpCallEndMode.testEndPCI,
		#tmpCallEndMode.testEndRSRP,
		#tmpCallEndMode.testEndSINR,
		#tmpCallEndMode.testEndFreq,
		#tmpCallEndMode.testEndPSC,
		#tmpCallEndMode.testEndRSCP,
		#tmpCallEndMode.testEndEcNo,
		#tmpCallStartMode.testAvgRxlev, 
	    #tmpCallStartMode.testAvgRxQual, 
	    #tmpCallStartMode.testAvgRSCP ,
	    #tmpCallStartMode.testAvgEcNo ,
	    #tmpCallStartMode.testAvgRSRP ,
	    #tmpCallStartMode.testAvgSINR,
   ------------- BR
   case when n.Operator='' then '' else
        case when #tmpCallSetupResults.Num_MO_OK=1 then 'Success' else 
		                     case when #tmpCallSetupResults.Num_MO_FAIL=1 then 'Fail' else '' end
		end
   end as SetupStatus,
   -------------- BS
   case when #tmpCallEndResults.Sum_Duration='' then '' else str(convert(real, #tmpCallEndResults.Sum_Duration)/1000.0,8,3) end as Duration,
   -- ---------------BU
   case when (convert(real, #tmpLQ08.NumPOLQAWBBA) + convert(real, #tmpLQ08.NumPOLQAWBAB))=0 then '' else (convert(real, #tmpLQ08.SumPOLQAWBBA) + convert(real, #tmpLQ08.SumPOLQAWBAB))/ (convert(real, #tmpLQ08.NumPOLQAWBBA) + convert(real, #tmpLQ08.NumPOLQAWBAB)) end as MOSValue,
   case when convert(real, #tmpLQ08.NumPOLQAWBBA)=0 then '' else str(convert(real,#tmpLQ08.SumPOLQAWBBA)/convert(real, #tmpLQ08.NumPOLQAWBBA),5,3) end as DL_POLQA,
   case when convert(real, #tmpLQ08.NumPOLQAWBAB)=0 then '' else str(convert(real,#tmpLQ08.SumPOLQAWBAB)/convert(real, #tmpLQ08.NumPOLQAWBAB),5,3) end as U_POLQA,
   -- -------------CE
   case when #tmpSRVCCResultsA.Num_SRVCC_OK>0 then str(convert(real, #tmpSRVCCResultsA.Sum_SRVCC_Duration)/convert(real, #tmpSRVCCResultsA.Num_SRVCC_OK)) else '' end as ASideSRVCCDuration,
   -- CH
   case when #tmpSRVCCResultsB.Num_SRVCC_OK>0 then str(convert(real, #tmpSRVCCResultsB.Sum_SRVCC_Duration)/convert(real, #tmpSRVCCResultsB.Num_SRVCC_OK )) else '' end as BSideSRVCCDuration,

	#tmpCallSetupResults.Sum_MO_Duration,
	#tmpCallSetupResults.Num_MO_OK,
	#tmpCallSetupResults.Num_MO_FAIL,
	#tmpCallEndResults.Sum_Duration,
	#tmpCallEndResults.Num_CallComplete,
	#tmpCallEndResults.Num_CallDrop,
	#tmpLQ08.NumPOLQAWBBA,
	#tmpLQ08.SumPOLQAWBBA,
	#tmpLQ08.NumPOLQAWBAB,
	#tmpLQ08.SumPOLQAWBAB,
	#tmpcodecrate_AB_DL.CodecName as CodeRate_AB_DL,
	#tmpcodecrate_AB_UL.CodecName as CodeRate_AB_UL,
	#tmpcodecrate_BA_DL.CodecName as CodeRate_BA_DL,
	#tmpcodecrate_BA_UL.CodecName as CodeRate_BA_UL,
	#tmpCallSetupResults.Sum_CSFBRadioRedirect,
	#tmpBResults.SessionId as SessionIdB, 
	#tmpBResults.Sum_MO_Duration Sum_MO_DurationB,
	#tmpBResults.Num_MO_OK as Num_MO_OKB,
	#tmpBResults.Num_MO_FAIL as Num_MO_FAILB,
	#tmpBResults.Sum_Duration as Sum_DurationB,
	#tmpBResults.Num_CallComplete as Num_CallCompleteB,
	#tmpBResults.Num_CallDrop as Num_CallDropB,
	#tmpBResults.Sum_CSFBRadioRedirect as Sum_CSFBRadioRedirectB,
	#tmpSRVCCResultsA.Sum_SRVCC_Duration,
	#tmpSRVCCResultsA.Num_SRVCC_OK,
	#tmpSRVCCResultsA.Num_SRVCC_Fail,
	#tmpSRVCCResultsB.Sum_SRVCC_Duration as Sum_SRVCC_DurationB,
	#tmpSRVCCResultsB.Num_SRVCC_OK as Num_SRVCC_OKB,
	#tmpSRVCCResultsB.Num_SRVCC_Fail as Num_SRVCC_FailB,
	#tmpCallSetupResults.kpiid as KPI_IDA,
	#tmpBResults.kpiid as KPI_IDB,
	#tmp10101A.errorcode as ErrorCodeA,
	#tmp10101A.msg as MsgA,
	#tmp10101A.Num_10101_OK as Num_10101_OK_A,
	#tmp10101A.Num_10101_Fail as Num_10101_Fail_A,
	#tmp10101B.errorcode as ErrorCodeB,
	#tmp10101B.msg as MsgB,
	#tmp10101B.Num_10101_OK as Num_10101_OK_B,
	#tmp10101B.Num_10101_Fail as Num_10101_Fail_B,
	#tmpCallStartMode.testStartGSM,
	#tmpCallStartMode.testStartRxLev,
	#tmpCallStartMode.testStartRxQual,
	#tmpCallEndMode.testEndGSM,
	#tmpCallEndMode.testEndRxLev,
	#tmpCallEndMode.testEndRxQual,
	#tmpBLER.BLER,
	#tmpAGC.avgTxPwr,
	#tmpINTRHO.numIntrHo,
	#tmpINTRAHO.numIntraHO,
	#tmpINTRATHO.numIntrRATHO,
	#templowmos.SessionID as lowMOs

into #tmpresults2
from
#tmpsession     Join sessions s On(#tmpsession.sessionID = s.sessionID)
	        Join callSession c On(s.sessionID = c.sessionID)	
		Join fileList f On(s.FileId = f.FileId AND (f.ASideLocation like '%GSM%' or f.ASideLocation like '%Free' ))
		Left Join #tmpLQ08 On(s.sessionId = #tmpLQ08.sessionId)
		Left Join #tmpCallStartMode On(s.sessionId = #tmpCallStartMode.sessionId)
		Left Join #tmpCallEndMode On(s.sessionId = #tmpCallEndMode.SessionId)
		Left Join #tmpCallSetupResults On(s.sessionId = #tmpCallSetupResults.sessionId)
		Left Join #tmpCallEndResults On(s.sessionId = #tmpCallEndResults.sessionId)
		Left Join #tmpBResults On(s.sessionId = #tmpBResults.sessionIdA)
		Left Join #tmpSRVCCResultsA On(s.sessionId = #tmpSRVCCResultsA.sessionId)
		Left Join #tmpSRVCCResultsB On(s.sessionId = #tmpSRVCCResultsB.sessionIdA)
		Left Join #tmp10101A On(s.sessionId = #tmp10101A.sessionId)
		Left Join #tmp10101B On(s.sessionId = #tmp10101B.sessionIdA)
		Left Join #tmpcodecrate_AB_DL On(s.sessionId = #tmpcodecrate_AB_DL.sessionId)
		Left Join #tmpcodecrate_AB_UL On(s.sessionId = #tmpcodecrate_AB_UL.sessionId)
		Left Join #tmpcodecrate_BA_DL On(s.sessionId = #tmpcodecrate_BA_DL.sessionId)
		Left Join #tmpcodecrate_BA_UL On(s.sessionId = #tmpcodecrate_BA_UL.sessionId)
		Left Join #tmpBLER On(s.sessionId = #tmpBLER.sessionId)
		Left Join #tmpAGC On(s.sessionId = #tmpAGC.sessionId)
		Left Join #tmpINTRHO On(s.sessionId = #tmpINTRHO.sessionId)
		Left Join #tmpINTRAHO On(s.sessionId = #tmpINTRAHO.sessionId)
		Left Join #tmpINTRATHO On(s.sessionId = #tmpINTRATHO.sessionId)
		Left Join #templowmos On(s.sessionId = #templowmos.sessionId)
                Join networkInfo n On(s.networkID = n.networkID)
		
order by #tmpsession.sessionId

Delete  aliasName from (
Select  *,
        ROW_NUMBER() over (Partition by Operator, SessionId,StartDate,StartTime,CallFinishTime,ASideFileName,ASideLocation order by Operator) as rowNumber
From    #tmpresults2) aliasName 
Where   rowNumber > 1

select	DISTINCT Operator,
   HomeOperator,
	SessionId, 
	StartDate,
    StartTime,
    CallFinishTime,
	--ASideFileName,
    ASideLocation,	 
	--IMEI,
	CollectionName,
--	ASideNumber,
--	BSideNumber,
	callType, -- 
    callDir, -- M
	callStatus, -- N
	--callcause,  -- O
	callmode, -- P
	--callmodeB,
	-- R
    MO_CSFB_CallSetupTime,
	-- S
    MO_CSFB_Duration_Call_Procedure,
	-- T
	case when callDir='A->B' or callDir='B->A'  then 
	    case when callmode='CSFB' then 
				case when MO_CSFB_CallSetupTime!='' And MO_CSFB_Duration_Call_Procedure!='' then 
					(convert(real, MO_CSFB_CallSetupTime) - convert(real, MO_CSFB_Duration_Call_Procedure)) 
				else '' end
		end
	else case when callDir='B->A' then
			 case when callmodeB='CSFB' then
				  case when MO_CSFB_CallSetupTime!='' And MO_CSFB_Duration_Call_Procedure!='' then 
					str(convert(real, MO_CSFB_CallSetupTime) - convert(real, MO_CSFB_Duration_Call_Procedure))
				  end
			 else '' end
		  else '' end
	
	end as ThreeGMO,
	-- U
	---No_MO_CSFB_CallSetupTime,
	-- V
	MO_CallSetupTime,
	-- W
	MO_Callsetup_KPIID,
	-- X
	MO_10101_Status,
	-- Y
	--MO_10101_Error_Code,
	-- Z
   --MO_10101_Error_Message,
	-- AA
	--OVERALL_MO_CSFB_CallSetupTime,
	-- AB
	--OVERALL_MO_CSFB_Duration_Call_Procedure,

	-- AC
	--case when callDir='B->A' then 
	 --   case when callmode='CSFB' then 
			--	case when OVERALL_MO_CSFB_CallSetupTime!='' And OVERALL_MO_CSFB_Duration_Call_Procedure!='' then 
			--		(convert(real, OVERALL_MO_CSFB_CallSetupTime) - convert(real, OVERALL_MO_CSFB_Duration_Call_Procedure)) 
				--else '' end
	--	end
	--else case when callDir='A->B' then
			 --case when callmodeB='CSFB' then
				 -- case when OVERALL_MO_CSFB_CallSetupTime!='' And OVERALL_MO_CSFB_Duration_Call_Procedure!='' then 
				--	str(convert(real, OVERALL_MO_CSFB_CallSetupTime) - convert(real, OVERALL_MO_CSFB_Duration_Call_Procedure))
				--  end
			-- else '' end
		 -- else '' end
	
	--end as ThreeGMT,
	-- AD
--	ThreeG_No_MO_CSFB_CallSetupTime,
	-- AE
	--MT_CallSetupTime,
	-- AF
--	MT_Callsetup_KPIID,
	-- AG
--	MT_10101_Status,
	-- AH
--	MT_10101_Error_Code,
	-- AI
	--MT_10101_Error_Message,
	testStartMode, -- R
	testStartLat,
	testStartLong,
	testStartLAC,
	testStartCellId,
	testStartBCCH,
	testStartEARFCN,
	testStartPCI,
	testStartRSRP,
	testStartSINR,
	testStartFreq,
	testStartPSC,
	testStartRSCP,
	testStartEcNo,
	testStartGSM, -- CH
	testStartRxLev, -- CI
	testStartRxQual, -- CJ

	callEndMode, -- AF
	testEndLat,
	testEndLong,
	testEndLAC,
	testEndCellId,
	testEndBCCH,
	testEndEARFCN,
	testEndPCI,
	testEndRSRP, -- AN
	testEndSINR,
	testEndFreq,
	testEndPSC,
	testEndRSCP,
	testEndEcNo, -- AS
	testEndGSM,
	testEndRxLev,
	testEndRxQual,
	testAvgRxlev, 
	testAvgRxQual, 
	testAvgRSCP ,
    testAvgEcNo ,
	testAvgRSRP ,
	testAvgSINR,
	-- BR
	SetupStatus,
	-- BS
	Duration,
	case when Operator='' or SetupStatus='Fail' or SetupStatus='' then '' 
	     else case when Num_CallComplete=1 then 'Complete' else 'Drop' end
	end as RetentionStatus,
	MOSValue,
	DL_POLQA,
	U_POLQA,
	CodeRate_AB_UL,
	CodeRate_BA_DL,
	BLER,
	avgTxPwr,
	numIntrHo,
	numIntraHO,
	numIntrRATHO,
	lowMOs
	--ASideSRVCCDuration
	--Num_SRVCC_OK,
	--Num_SRVCC_Fail
	--BSideSRVCCDuration,
	--Num_SRVCC_OKB,
	--Num_SRVCC_FailB

into #tmpresults
from #tmpresults2
--where testStartCellId <= 2147483647 and testEndCellId <= 2147483647
order by sessionId




select * 

INTO BI_VOICE_MtoF

from #tmpresults


----------------------------------------------------------------------------------------{AVG RESULTS (ALL LINES VALID)]---------------------------------------------------------------------------------------

--select #tmpresults.ASideLocation as AsideLocation,
--#tmpresults.HomeOperator as Operator,
--#tmpresults.CollectionName as CollectionName,
--Avg(#tmpresults.MOSValue) as AvgMOS,
--AVG(case when TRY_CONVERT(real,#tmpresults.MO_CallSetupTime) >0.0 then (cast(#tmpresults.MO_CallSetupTime as real)) end) as avgcst,

--count(case when #tmpresults.callStatus='failed' then 1 end)*100.0/count(#tmpresults.callStatus)  as AFR,
--count(case when #tmpresults.callStatus='dropped' then 1 end)*100.0/count(#tmpresults.callStatus) as DCR ,
--dbo.PercentileInc(#tmpresults.MOSValue,0.90) as Prc90Mos,
--dbo.PercentileInc(#tmpresults.MOSValue,0.10)as Prc10Mos,
--dbo.PercentileInc(#tmpresults.MO_CallSetupTime,0.90) as Prc90,
--dbo.PercentileInc(#tmpresults.MO_CallSetupTime,0.10)as Prc10

--into TMPBIGSM
--from #tmpresults




--group by 
--#tmpresults.ASideLocation,
--#tmpresults.CollectionName,
--#tmpresults.HomeOperator 

--------------------------------drop--------------
--drop table TMPBIGSM
drop table #tmpsession
Drop Table #tmpLQ08
Drop Table #tmpCallSetupTime
drop table #tmp4UMTSMOKPI10100
drop table #tmp4KPI10178
drop table #tmp4KPI10181
drop table #tmpCallSetupResults 
drop table #tmpCallEndResults 
drop table #tmpCallStartMode
drop table #tmpCallEndMode
drop table #tmpcodecrate_AB_DL
drop table #tmpcodecrate_AB_UL
drop table #tmpcodecrate_BA_DL
drop table #tmpcodecrate_BA_UL
drop table #tmpBsession
Drop Table #tmpBCallSetupTime
drop table #tmpB4UMTSMOKPI10100
drop table #tmpB4KPI10178
drop table #tmpB4KPI10181
drop table #tmpBCallSetupResults 
drop table #tmpBCallEndResults 
drop table #tmpBResults
drop table #tmpSRVCCResultsA
drop table #tmpSRVCCResultsB
drop table #tmp10101A
drop table #tmp10101B
drop table #tmpresults
drop table #tmpresults2
drop table #tmpBLER
drop table #tmpAGC
drop table #tmpINTRHO
drop table #tmpINTRAHO
drop table #tmpINTRATHO
drop table #templowmos
--DROP TABLE BI_VOICE_MtoF

-----------------end drop----------------

End;
ELSE
BEGIN
select	
   '' as Operator,
   '' as HomeOperator,
	'' as SessionId, 
	'' as StartDate,
    '' as StartTime,
    '' as CallFinishTime,
	'' as ASideFileName,
    '' as ASideLocation,	 
	'' as IMEI,
	'' as CollectionName,
	'' as ASideNumber,
	'' as BSideNumber,
	'' as callType, -- 
    '' as callDir, -- M
	'' as callStatus, -- N
	'' as callcause,  -- O
	'' as callmode, -- P
	'' as callmodeB,
	-- R
    '' as MO_CSFB_CallSetupTime,
	-- S
    '' as MO_CSFB_Duration_Call_Procedure,
	-- T
	'' as ThreeGMO,
	-- U
	'' as No_MO_CSFB_CallSetupTime,
	-- V
	'' as MO_CallSetupTime,
	-- W
	'' as MO_Callsetup_KPIID,
	-- X
	'' as MO_10101_Status,
	-- Y
	'' as MO_10101_Error_Code,
	-- Z
	'' as MO_10101_Error_Message,
	-- AA
	'' as OVERALL_MO_CSFB_CallSetupTime,
	-- AB
	'' as OVERALL_MO_CSFB_Duration_Call_Procedure,

	-- AC
	'' as ThreeGMT,
	-- AD
	'' as ThreeG_No_MO_CSFB_CallSetupTime,
	-- AE
	'' as MT_CallSetupTime,
	-- AF
	'' as MT_Callsetup_KPIID,
	-- AG
	'' as MT_10101_Status,
	-- AH
	'' as MT_10101_Error_Code,
	-- AI
	'' as MT_10101_Error_Message,
	'' as testStartMode, -- R
	'' as testStartLat,
	'' as testStartLong,
	'' as testStartLAC,
	'' as testStartCellId,
	'' as testStartBCCH,
	'' as testStartEARFCN,
	'' as testStartPCI,
	'' as testStartRSRP,
	'' as testStartSINR,
	'' as testStartFreq,
	'' as testStartPSC,
	'' as testStartRSCP,
	'' as testStartEcNo,
	'' as testStartGSM, -- CH
	'' as testStartRxLev, -- CI
	'' as testStartRxQual, -- CJ

	'' as callEndMode, -- AF
	'' as testEndLat,
	'' as testEndLong,
	'' as testEndLAC,
	'' as testEndCellId,
	'' as testEndBCCH,
	'' as testEndEARFCN,
	'' as testEndPCI,
	'' as testEndRSRP, -- AN
	'' as testEndSINR,
	'' as testEndFreq,
	'' as testEndPSC,
	'' as testEndRSCP,
	'' as testEndEcNo, -- AS
	'' as testEndGSM,
	'' as testEndRxLev,
	'' as testEndRxQual,
	-- BR
	'' as SetupStatus,
	-- BS
	'' as Duration,
	'' as RetentionStatus,
	'' as MOSValue,
	'' as DL_POLQA,
	'' as U_POLQA,
	'' as CodeRate_AB_UL,
	'' as CodeRate_BA_DL,
	'' as BLER,
	'' as avgTxPwr,
	'' as numIntrHo,
	'' as numIntraHO,
	'' as numIntrRATHO,
	'' as ASideSRVCCDuration,
	'' as Num_SRVCC_OK,
	'' as Num_SRVCC_Fail,
	'' as BSideSRVCCDuration,
	'' as Num_SRVCC_OKB,
	'' as Num_SRVCC_FailB


INTO BI_VOICE_MtoF


drop table #tmpsession

END;