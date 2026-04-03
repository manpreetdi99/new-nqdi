Select sessions.sessionId,
CallSession.Callstatus,
CallSession.CallType,
CallSession.calldir,
CallSession.callmode,
CallFinishTime = DATEADD(ms,Sessions.duration,Sessions.startTime),
Sessions.NetworkId
into	#tmpsession 
------------------------------------------------------------------------------------------------------------------------
from Sessions,
CallSession

---------------------------------------------------------------------------------------------------------------
where sessions.valid = 1 AND
Sessions.sessionType = 'CALL' AND
sessions.SessionId = CallSession.SessionId AND
Callsession.Callstatus Not In('System Release') and
Callsession.VoiceCallType In('Intrusive') 

------------------------------------------------------------------------------------------------------------------------
group by sessions.sessionId,
CallSession.Callstatus,
CallSession.CallType,
CallSession.calldir,
CallSession.callmode,
Sessions.duration,
Sessions.startTime,
Sessions.NetworkId

Declare @sessions INT
set @sessions = (select count(*) from #tmpsession)
PRINT @sessions
IF @sessions > 0
BEGIN

Select sessions.sessionId, sessions.sessionIdA,
CallSession.Callstatus,
CallSession.CallType,
CallSession.calldir,
CallSession.callmode,
CallFinishTime = DATEADD(ms,Sessions.duration,Sessions.startTime)
into	#tmpsessionB
from SessionsB Sessions,
CallSession
where sessions.valid = 1 AND
Sessions.sessionType = 'CALL' AND
sessions.SessionId = CallSession.SessionId AND
Callsession.Callstatus Not In('System Release') and
Callsession.VoiceCallType In('Intrusive') 
group by sessions.sessionId,
sessions.sessionIdA,
CallSession.Callstatus,
CallSession.CallType,
CallSession.calldir,
CallSession.callmode,
Sessions.duration,
Sessions.startTime



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

-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
SELECT
    s.sessionId,
    MIN(n.technology) AS 'technology',
    c.calltype,

    -- durations per KPI
    Duration11013 = MAX(CASE WHEN k.kpiId = 11013 THEN k.duration END),
	Duration10108 = MAX(CASE WHEN k.kpiId = 10108 THEN k.duration END),
    Duration11000 = MAX(CASE WHEN k.kpiId = 11000 THEN k.duration END),

    -- error codes per KPI (optional but usually needed)
    ErrorCode11013 = MAX(CASE WHEN k.kpiId = 11013 THEN k.errorCode END),
	ErrorCode10108 = MAX(CASE WHEN k.kpiId = 10108 THEN k.errorCode END),
    ErrorCode11000 = MAX(CASE WHEN k.kpiId = 11000 THEN k.errorCode END),

    -- end time per KPI (also optional)
    EndTime11013   = MAX(CASE WHEN k.kpiId = 11013 THEN k.endTime END),
	EndTime10108   = MAX(CASE WHEN k.kpiId = 10108 THEN k.endTime END),
    EndTime11000   = MAX(CASE WHEN k.kpiId = 11000 THEN k.endTime END),

    NULL AS CSFBErrorcode,
    NULL AS CSFBRadioRedirect,
    NULL AS CS10184,
    NULL AS CS10184Errorcode,
	NULL AS UMTSkpiID,
	NULL AS UMTSerrorCode,
	NULL AS UMTSduration
    INTO #tmpCallSetupTime
FROM
    #tmpsession     s
    JOIN callSession c ON s.sessionId = c.SessionId
    JOIN ResultsKPI  k ON c.SessionId = k.SessionId
    JOIN NetworkInfo n ON k.NetworkID = n.NetworkID
WHERE
    k.kpiId IN (11013, 11000, 10108)
GROUP BY
    s.sessionId,
    n.technology,
    c.calltype;

	-----------------------------------------------------------------

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
	k.KpiId = 11013 AND------------------------
	k.NetworkID = n.NetworkID
Group by s.sessionId,
	n.technology,
	c.calltype,
	k.kpiId,
	k.errorCode,
	k.duration,
	k.endTime

	----------------------------------------------------------------------

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
	k.KpiId = 10184 AND----------------------------CSFB
	k.NetworkID = n.NetworkID
Group by s.sessionId,
	n.technology,
	c.calltype,
	k.kpiId,
	k.errorCode,
	k.duration,
	k.endTime
-----------------------------------------------------------------------------	
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
	k.KpiId = 10106 AND---- 10106 connect instead of 10181
	k.NetworkID = n.NetworkID
Group by s.sessionId,
	n.technology,
	c.calltype,
	k.kpiId,
	k.errorCode,
	k.duration,
	k.endTime
------------------------------------------------------------------------------------
Select	t1.sessionId,
	DATEDIFF(ms,t2.StartTime,t1.StartTime) as duration
into	#tmp4KPI11012Minus11010
from 	(Select	s.sessionId,
			k.kpiId,
			k.StartTime
		from 	#tmpsession s, callSession c, ResultsKPI k
		where	s.sessionId = c.SessionId AND
				c.SessionId = k.SessionId AND
				k.KpiId = 11010 AND
				k.ErrorCode = 0) t1, 
		(Select	s.sessionId,
				k.kpiId,
				k.StartTime
		from 	#tmpsession s, callSession c, ResultsKPI k
		where	s.sessionId = c.SessionId AND
				c.SessionId = k.SessionId AND
				k.KpiId = 11013 AND
				k.ErrorCode = 0) t2
where	t1.sessionId = t2.SessionId
-------------------------------------------------------------------------------
Select	t1.sessionId,
	DATEDIFF(ms,t2.StartTime,t1.StartTime) as duration
into	#tmp4KPI11012Minus11010B
from 	(Select	s.sessionId,
			k.kpiId,
			k.StartTime
		from 	#tmpsessionB s, callSession c, ResultsKPI k
		where	s.sessionIdA = c.SessionId AND
				c.callDir like '%A->B%' AND
				c.SessionId = k.SessionId AND
				k.KpiId = 11010 AND
				k.ErrorCode = 0) t1, 
		(Select	s.sessionId,
				k.kpiId,
				k.StartTime
		from 	#tmpsessionB s, callSession c, ResultsKPI k
		where	s.sessionIdA = c.SessionId AND
				c.callDir like '%A->B%' AND
				c.SessionId = k.SessionId AND
				k.KpiId = 11013 AND-----11012 itan
				k.ErrorCode = 0) t2
where	t1.sessionId = t2.SessionId

union

Select	t1.sessionId,
	DATEDIFF(ms,t2.StartTime,t1.StartTime) as duration
from 	(Select	s.sessionId,
			k.kpiId,
			k.StartTime
		from 	#tmpsession s, callSession c, ResultsKPI k
		where	s.sessionId = c.SessionId AND
				c.callDir like '%B->A%' AND
				c.SessionId = k.SessionId AND
				k.KpiId = 11010 AND
				k.ErrorCode = 0) t1, 
		(Select	s.sessionId,
				k.kpiId,
				k.StartTime
		from 	#tmpsession s, callSession c, ResultsKPI k
		where	s.sessionId = c.SessionId AND
				c.callDir like '%B->A%' AND
				c.SessionId = k.SessionId AND
				k.KpiId = 11013 AND
				k.ErrorCode = 0) t2
where	t1.sessionId = t2.SessionId
---------------------------------------------------------------------
Select	s.sessionId,
	k.kpiId,
	k.duration,
	k.StartTime
into	#tmp4KPI11001
from 	#tmpsession s, callSession c, ResultsKPI k
where	s.sessionId = c.SessionId AND
	c.SessionId = k.SessionId AND
	k.KpiId = 11001 AND
	k.ErrorCode = 0
Group by s.sessionId,
	k.kpiId,
	k.duration,
	k.StartTime
----------------------------------------------------------------------
Select	s.sessionId,
	k.kpiId,
	k.duration,
	k.StartTime
into	#tmp4KPI11001B
from 	#tmpsessionB s, callSession c, ResultsKPI k
where	s.sessionIdA = c.SessionId AND
   -- c.callDir like '%A->B%' AND
	c.SessionId = k.SessionId AND
	k.KpiId = 11001 AND
	k.ErrorCode = 0
Group by s.sessionId,
	k.kpiId,
	k.duration,
	k.StartTime

union

Select	s.sessionId,
	k.kpiId,
	k.duration,
	k.StartTime
from 	#tmpsession s, callSession c, ResultsKPI k
where	s.sessionId = c.SessionId AND
	--c.callDir like '%A->B%' AND --- why need?
	c.SessionId = k.SessionId AND 
	k.KpiId = 11001 AND
	k.ErrorCode = 0
Group by s.sessionId,
	k.kpiId,
	k.duration,
	k.StartTime
-----------------------------------------------------------------------------------------------------------

Select	t1.sessionId,
	duration=t2.duration-t1.duration
into	#tmp4KPI11000Minus11001
from 	#tmp4KPI11001 t1, 
		(Select	s.sessionId,
				k.kpiId,
				k.duration,
				k.StartTime
		from 	#tmpsession s, callSession c, ResultsKPI k
		where	s.sessionId = c.SessionId AND
				c.SessionId = k.SessionId AND
				k.KpiId = 11000 AND
				k.ErrorCode = 0
		Group by s.sessionId,
				k.kpiId,
				k.duration,
				k.StartTime) t2
where	t1.sessionId = t2.SessionId and t1.StartTime = t2.StartTime

Select	t1.sessionId,
	duration=t2.duration-t1.duration
into	#tmp4KPI11000Minus11001B
from 	#tmp4KPI11001B t1, 
		(Select	s.sessionId,
				k.kpiId,
				k.duration,
				k.StartTime
		from 	#tmpsessionB s, callSession c, ResultsKPI k
		where	s.sessionIdA = c.SessionId AND
				c.callDir like '%A->B%' AND
				c.SessionId = k.SessionId AND
				k.KpiId = 11000 AND
				k.ErrorCode = 0
		Group by s.sessionId,
				k.kpiId,
				k.duration,
				k.StartTime) t2
where	t1.sessionId = t2.SessionId and t1.StartTime = t2.StartTime

union

Select	t1.sessionId,
	duration=t2.duration-t1.duration
from 	#tmp4KPI11001B t1, 
		(Select	s.sessionId,
				k.kpiId,
				k.duration,
				k.StartTime
		from 	#tmpsession s, callSession c, ResultsKPI k
		where	s.sessionId = c.SessionId AND
				c.callDir like '%B->A%' AND
				c.SessionId = k.SessionId AND
				k.KpiId = 11000 AND
				k.ErrorCode = 0
		Group by s.sessionId,
				k.kpiId,
				k.duration,
				k.StartTime) t2
where	t1.sessionId = t2.SessionId and t1.StartTime = t2.StartTime
-------------------------------------------------------------------------------------------------------------------------

Update #tmpCallSetupTime
Set #tmpCallSetupTime.technology=#tmp4UMTSMOKPI10100.technology,
    #tmpCallSetupTime.calltype=#tmp4UMTSMOKPI10100.calltype,
    #tmpCallSetupTime.UMTSkpiID=#tmp4UMTSMOKPI10100.kpiId,
    #tmpCallSetupTime.UMTSerrorCode=#tmp4UMTSMOKPI10100.errorCode,
    #tmpCallSetupTime.UMTSduration=#tmp4UMTSMOKPI10100.duration
From 
#tmpCallSetupTime, #tmp4UMTSMOKPI10100 
Where 	#tmpCallSetupTime.sessionId=#tmp4UMTSMOKPI10100.sessionId --AND
	--#tmpCallSetupTime.endTime=#tmp4UMTSMOKPI10100.endTime
--------------------------------------------
--Update #tmpCallSetupTime
--Set #tmpCallSetupTime.technology=#tmp4KPI10178.technology,
 --   #tmpCallSetupTime.calltype=#tmp4KPI10178.calltype,
  --  #tmpCallSetupTime.kpiId=#tmp4KPI10178.kpiId,
   -- #tmpCallSetupTime.errorCode=#tmp4KPI10178.errorCode,
    --#tmpCallSetupTime.duration=#tmp4KPI10178.duration
--From 
--#tmpCallSetupTime, #tmp4KPI10178 
--Where 	#tmpCallSetupTime.sessionId=#tmp4KPI10178.sessionId AND
---	#tmpCallSetupTime.endTime=#tmp4KPI10178.endTime
------------------------------------------------------------------------	
Update #tmpCallSetupTime
Set #tmpCallSetupTime.CSFBErrorcode=#tmp4KPI10181.errorCode,
	#tmpCallSetupTime.CSFBRadioRedirect=#tmp4KPI10181.duration
From 
#tmpCallSetupTime, #tmp4KPI10181 
Where 	#tmpCallSetupTime.sessionId=#tmp4KPI10181.sessionId

------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
Update #tmpCallSetupTime
Set-- ##tmpCallSetupTime.CSFBErrorcode=##tmp4KPI10178.errorCode, thelei diko tou CSFB error code stin arxi tis loupa 
     -- ##tmpCallSetupTime.CSFBCallSetupErrorCode=##tmp4KPI10178.errorCode,-----new need check if working---
	#tmpCallSetupTime.CS10184=#tmp4KPI10178.duration,
	#tmpCallSetupTime.CS10184Errorcode=#tmp4KPI10178.duration
From 
#tmpCallSetupTime, #tmp4KPI10178
Where 	#tmpCallSetupTime.sessionId=#tmp4KPI10178.sessionId
-------------------------------------------------------------------------------------------------------------
SELECT
    s.sessionId,

    -- Sum MO duration for KPI 11000
    CASE 
        WHEN SUM(CASE WHEN k.ErrorCode11000 = 0 THEN 1 ELSE 0 END) > 0
             THEN SUM(CASE WHEN k.calltype = 'M->M' AND k.ErrorCode11000 = 0 
                           THEN k.Duration11000 ELSE 0 END)
        ELSE NULL
    END AS Sum_MO_Duration_11000,

    -- Sum MO duration for KPI 11013
    CASE 
        WHEN SUM(CASE WHEN k.ErrorCode11013 = 0 THEN 1 ELSE 0 END) > 0
             THEN SUM(CASE WHEN k.calltype = 'M->M' AND k.ErrorCode11013 = 0 
                           THEN k.Duration11013 ELSE 0 END)
        ELSE NULL
    END AS Sum_MO_Duration_11013,

    -- Sum MO duration for KPI 10108
    CASE 
        WHEN SUM(CASE WHEN k.ErrorCode10108 = 0 THEN 1 ELSE 0 END) > 0
             THEN SUM(CASE WHEN k.calltype = 'M->M' AND k.ErrorCode10108 = 0 
                           THEN k.Duration10108 ELSE 0 END)
        ELSE NULL
    END AS Sum_MO_Duration_10108,

    -- (if you still want the CSFB metrics, keep them as-is)
    CASE 
        WHEN SUM(CASE WHEN k.CSFBErrorcode = 0 THEN 1 ELSE 0 END) > 0 
             THEN SUM(CASE WHEN k.calltype = 'M->M' AND k.CSFBErrorcode = 0 
                           THEN k.CSFBRadioRedirect ELSE 0 END)
        ELSE NULL 
    END AS Sum_CSFBRadioRedirect,

    CASE 
        WHEN SUM(CASE WHEN k.CSFBErrorcode = 0 THEN 1 ELSE 0 END) > 0 
             THEN SUM(CASE WHEN k.calltype = 'M->M' AND k.CSFBErrorcode = 0 
                           THEN k.CS10184 ELSE 0 END)
        ELSE NULL 
    END AS Sum_CSFBCallSetupTime

INTO #tmpCallSetupResults
FROM
    #tmpsession      s
    JOIN #tmpCallSetupTime k ON s.sessionId = k.sessionId
GROUP BY
    s.sessionId;



Select	s.sessionId,
	Case when Sum(Case when k.errorcode>=0 then 1 else 0 end)>0 then Sum(Case when k.errorcode>=0 then k.duration else 0 end)else NULL end as 'Sum_Duration',
	Case when Sum(Case when k.errorcode=0 then 1 else 0 end)>0 then Count(Case when k.errorcode=0 then 1 else NULL end)else NULL end as 'Num_CallComplete',
	Case when Sum(Case when k.errorcode>0 then 1 else 0 end)>0 then Count(Case when k.errorcode>0 then 1 else NULL end)else NULL end as 'Num_CallDrop'
into	#tmpCallEndResults
from 	#tmpsession s, ResultsKPI k
where	s.sessionId = k.SessionId AND
	k.KpiId = 20106 --- or 20102 or 20106 old 21010
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
from 	#tmpsession s, networkInfo, networkIdRelation, Position
where	s.NetworkId = networkInfo.networkId AND
		--to bgazo se sxolio auto gia na bgazei test start lat & lon akoma kai otan FAIL ena call
		--markers.MarkerText = 'Dial' AND
		networkInfo.networkId = networkIdRelation.networkId AND
		networkIdRelation.sessionId = s.sessionId AND
		networkIdRelation.PosId = Position.PosId and
		--s.SessionId = Position.SessionId AND
		networkIdRelation.MsgTime = (select min(nir.MsgTime)  from networkIdRelation nir
			where nir.sessionId = s.sessionId AND
					nir.networkId = networkInfo.networkId)

Update #tmpCallStartMode
Set #tmpCallStartMode.testStartGSM=MsgGSMReport.BCCH,
	#tmpCallStartMode.testStartRxLev=MsgGSMReport.RxLev,
	#tmpCallStartMode.testStartRxQual=MsgGSMReport.RxQual
from #tmpCallStartMode, MsgGSMReport
where #tmpCallStartMode.sessionId = MsgGSMReport.sessionId AND
	MsgGSMReport.MsgId = (select min(gsm.msgId)+ 4  from MsgGSMReport gsm
		where gsm.sessionId = #tmpCallStartMode.sessionId)

Update #tmpCallStartMode
Set #tmpCallStartMode.testStartFreq=WCDMAActiveSet.FreqDL,
	#tmpCallStartMode.testStartPSC=WCDMAActiveSet.PrimScCode,
	#tmpCallStartMode.testStartRSCP=WCDMAActiveSet.RSCP_PSC,
	#tmpCallStartMode.testStartEcNo=WCDMAActiveSet.AggrEcIo_PSC
from #tmpCallStartMode, WCDMAActiveSet
where #tmpCallStartMode.sessionId = WCDMAActiveSet.sessionId AND
	WCDMAActiveSet.MsgId = (select min(wcdma.msgId)+ 1 from WCDMAActiveSet wcdma
		where wcdma.sessionId = #tmpCallStartMode.sessionId)
		
--Update #tmpCallStartMode
--Set #tmpCallStartMode.testStartEARFCN=LTEServingCellInfo.DL_EARFCN,
	--#tmpCallStartMode.testStartPCI=LTEServingCellInfo.PhyCellId
--from #tmpCallStartMode, LTEServingCellInfo
--where #tmpCallStartMode.sessionId = LTEServingCellInfo.sessionId AND
	--LTEServingCellInfo.LTEServingCellInfoId = (select min(lte.LTEServingCellInfoId) from LTEServingCellInfo lte
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
	----------------------------------------------------------------------------------------	
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
where 	--s.SessionId = markers.SessionId AND
		s.NetworkId = networkInfo.networkId AND
		--(markers.MarkerText='Disconnect' or markers.MarkerText ='Break' or markers.MarkerText ='ConnectFailed'or markers.MarkerText = 'System Release' or markers.MarkerText ='released') AND
		networkInfo.networkId = networkIdRelation.networkId AND
		networkIdRelation.sessionId = s.sessionId AND
		networkIdRelation.PosId = Position.PosId AND 
		networkIdRelation.MsgTime = (select max(nir.MsgTime) from networkIdRelation nir
				where nir.sessionId = s.sessionId AND
					nir.networkId = networkInfo.networkId AND
					 nir.MsgTime <= s.CallFinishTime)
		--AND s.SessionId in ('901943132232','266287972436')

Update #tmpCallEndMode
Set #tmpCallEndMode.testEndGSM=MsgGSMReport.BCCH,
	#tmpCallEndMode.testEndRxLev=MsgGSMReport.RxLev,
	#tmpCallEndMode.testEndRxQual=MsgGSMReport.RxQual
from #tmpCallEndMode, MsgGSMReport
where #tmpCallEndMode.sessionId = MsgGSMReport.sessionId AND
	MsgGSMReport.MsgId = (select max(gsm.msgId) from MsgGSMReport gsm
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

-------------------------------------------------------------------------------------------------------------------------------------------------


select v.sessionid,
v.CodecName
	--Case when Sum(Case when v.duration>0 then 1 else 0 end)>0 then sum(v.codecrate*v.duration)/sum(v.duration) else NULL end as codecrate
into	#tmpcodecrate_AB_DL
from Sessions s,
	TestInfo t,
	vVoiceCodecTest v
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
	vVoiceCodecTest v
where s.SessionId=v.SessionID AND
	t.testid=v.testid and
	s.valid = 1 AND
	t.typeoftest like '%POLQA%' AND
	v.direction = 'U' AND
	t.direction = 'A->B'
group by v.sessionid,v.CodecName
order by v.sessionid

-------------------


select v.sessionid,
v.CodecName
	--Case when Sum(Case when v.duration>0 then 1 else 0 end)>0 then sum(v.codecrate*v.duration)/sum(v.duration) else NULL end as codecrate
into	#tmpcodecrate_BA_DL
from Sessions s,
	TestInfo t,
	vVoiceCodecTest v
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
	vVoiceCodecTest v
where s.SessionId=v.SessionID AND
	t.testid=v.testid and
	s.valid = 1 AND
	t.typeoftest like '%POLQA%' AND
	v.direction = 'U' AND
	t.direction = 'B->A'
group by v.sessionid,v.CodecName
order by v.sessionid
-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------
Select sessionsB.sessionId,
SessionsB.sessionIdA
into	#tmpBsession
from SessionsB
where sessionsB.valid = 1 AND
SessionsB.sessionType = 'CALL'
group by sessionsB.sessionId,
SessionsB.sessionIdA

----------------------------------------------------------------------------------------------------

Select	s.sessionId,
	'VoLTE' as 'CallMode',
	k.kpiId,
	k.errorCode,
	k.duration,
	k.endTime,
	NULL as 'CSFBErrorcode',
	NULL as 'CSFBRadioRedirect',
	NULL as 'CSB10184',
	NULL as 'CSB10184Errorcode'
into	#tmpBCallSetupTime
from 	#tmpBsession s, ResultsKPI k
where	s.SessionId = k.SessionId AND
--(k.KpiId = 10106 ) and	
(k.KpiId = 11000 or k.KpiId = 10100 or k.KpiId = 10181 or k.KpiId = 10102) AND
	k.EndTime = k.TriggerTime
Group by s.sessionId,
	k.kpiId,
	k.errorCode,
	k.duration,
	k.endTime



Select	s.sessionId,
	'CS' as 'CallMode',
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
	k.KpiId = 10106
Group by s.sessionId,
	k.kpiId,
	k.errorCode,
	k.duration,
	k.endTime
----------------------------------------------------------------------------------------------------
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
	k.KpiId = 21010
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
-------------------------------------------------------------------------------------------------------------------------------------------------------------
Select	s.sessionId,
	k.errorcode,
	--e.msg,
	Case when Sum(Case when k.errorcode=0 then 1 else 0 end)>0 then Count(Case when k.errorcode=0 then 1 else NULL end)else NULL end as 'Num_10101_OK',
	Case when Sum(Case when k.errorcode>0 then 1 else 0 end)>0 then Count(Case when k.errorcode>0 then 1 else NULL end)else NULL end as 'Num_10101_Fail'
into	#tmp10101A
from 	#tmpsession s, ResultsKPI k
where	s.sessionId = k.SessionId AND
	k.KpiId = 11013 --AND 
		--e.code = k.errorcode
Group by s.sessionId,
	k.errorcode
--	e.msg

	

---------------------------------------------------------------------------------------------------------------------------------------------------------------
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
	SUM(case when k.KpiId = 38100 then 1 else 0 end) as numIntrHO,
	SUM(case when (k.KpiId = 38100  and k.errorcode = 0 )then 1 else 0 end) as sucIntrHO
into 	#tmpINTRHO
from 	#tmpsession s,  ResultsKPI k
where s.sessionId = k.SessionId
group by s.sessionId

select 	s.sessionId, 
	SUM(case when k.KpiId = 38107 then 1 else 0 end) as numIntraHO,
	SUM(case when (k.KpiId = 38107  and k.errorcode = 0 )then 1 else 0 end) as sucIntraHO
into 	#tmpINTRAHO
from 	#tmpsession s,  ResultsKPI k
where s.sessionId = k.SessionId
group by s.sessionId

select 	s.sessionId, 
	SUM(case when (k.KpiId = 38020 OR k.KpiId = 38030 OR k.KpiId = 38040 OR k.KpiId = 38050 OR k.KpiId = 38060 OR k.KpiId = 38070) then 1 else 0 end) as numIntrRATHO
into 	#tmpINTRATHO
from 	#tmpsession s,  ResultsKPI k
where s.sessionId = k.SessionId
group by s.sessionId

-------------------------------------------------------------low mos column free --------------------------------------------------------------------------------------------------------------------------

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
--SELECT * FROM #TEMP 

ORDER BY SessionID,TESTID_1 

SELECT DISTINCT 
	CollectionName,
	SessionID,
	ASideLocation

into #tmplowmosfree

FROM #TEMP
WHERE 
(MOS_1<1.29 and MOS_1>1.01 or (L1status = 'Silence' and CODE1 = '0001000000000000'or CODE1 = '0000001000000000')) AND (MOS_2<1.29 and MOS_2>1.01 or (L2status = 'Silence' and CODE2 = '0001000000000000'or CODE2 = '0000001000000000'))
OR
(MOS_1<1.29 and MOS_1>1.01 or (L1status = 'Silence' and CODE1 = '0001000000000000'or CODE1 = '0000001000000000')) AND (MOS_3<1.29 and MOS_3>1.01 or (L3status = 'Silence' and CODE3 = '0001000000000000'or CODE3 = '0000001000000000'))


ORDER BY SessionID;

DROP TABLE #TEMP


-----------------------------------------------------------------------------------------------------------end low mos free--------------------------------------------------------











select	DISTINCT n.Operator,--A
	n.HomeOperator,--B
	#tmpsession.SessionId, --C
	CAST(datepart(dd,s.startTime) as varchar)+'.'+CAST(datepart(mm,s.startTime) as varchar)+'.'+CAST(datepart(yy,s.startTime) as varchar) as StartDate,--D
        CAST(datepart(hh,s.startTime) as Varchar)+':'+CAST(datepart(mi,s.startTime) as varchar)+':'+CAST(datepart(ss,s.startTime) as varchar)+'.'+CAST(datepart(ms,s.startTime) as varchar) as StartTime,--E
	CAST(datepart(hh,#tmpsession.CallFinishTime) as Varchar)+':'+CAST(datepart(mi,#tmpsession.CallFinishTime) as varchar)+':'+
	CAST(datepart(ss,#tmpsession.CallFinishTime) as varchar)+'.'+CAST(datepart(ms,#tmpsession.CallFinishTime) as varchar) as CallFinishTime,--F
	--f.ASideFileName,--G
    f.ASideLocation,	--H 
	--f.IMEI,--I
	f.CollectionName,--J
	--f.ASideNumber,--K
	--f.BSideNumber,--L
	c.callType, -- M
        c.callDir, -- N
	c.callStatus, -- O
	--c.callcause,  -- P
	c.callmode, -- Q
	--#tmpBResults.callmode as callmodeBfake,--R
	c.CallModeB,--s
	--------------------------------------------------------------------------------------------------
	case when c.callDir='A->B'   then 
	  --  case when c.callmode='CSFB' then 
				case when #tmpCallSetupResults.Sum_CSFBRadioRedirect!='' then 
					convert(real, #tmpCallSetupResults.Sum_CSFBRadioRedirect/1000.0)
				else '' end
		--end
	else case when c.callDir='B->A' then
			-- case when #tmpBResults.callmode='CSFB' then
				  case when #tmpCallSetupResults.Sum_CSFBRadioRedirect!='' then 
					(convert(real, #tmpBResults.Sum_CSFBRadioRedirect/1000.0)) else '' 
		    end
		--	else '' end
		  else '' end
	
	end as CallSetupTime10106,---------T
------------------------------------------------------------------------------------------------------------------------


	case when c.callDir='A->B' then 
	 --   case when c.callmode='CSFB' then 
				case when #tmpCallSetupResults.Sum_CSFBRadioRedirect!='' then 
					str(convert(real, #tmpCallSetupResults.Sum_CSFBCallSetupTime)/1000.0) 
				else '' end
		--end
	else case when c.callDir='B->A' then
			-- case when #tmpBResults.callmode='CSFB' then
				  case when #tmpCallSetupResults.Sum_CSFBRadioRedirect!='' then 
					str(convert(real, #tmpCallSetupResults.Sum_CSFBCallSetupTime)/1000.0) else '' 
				  end
			-- else '' end
		  else '' end
	
	end as CSFB10184,----Q
----------------------------------------------------------------------------------------------------------------
	-- T => depends on R and S
	-- U
	case when c.callDir='A->B' then 
	    case when c.callmode='CS' then 
				case when #tmpCallSetupResults.Sum_MO_Duration_10108!=''  then 
					str(convert(real, #tmpCallSetupResults.Sum_MO_Duration_10108)/1000.0) 
				else '' end
		end
	else case when c.callDir='B->A' then
			 case when #tmpBResults.callmode='CS' then
				  case when #tmpBResults.Sum_MO_Duration!='' then 
					str(convert(real, #tmpBResults.Sum_MO_Duration/1000.0)) else '' 
				  end
			 else '' end
		  else '' end
	
	end as No_MO_CSFB_CallSetupTime,
--------------------------------------------------------------------------------------------------------------

	-- V
	case when(c.callDir='A->B' or c.callDir='B->A') and c.callStatus in ('dropped','completed')  then 
		case when #tmpCallSetupResults.Sum_MO_Duration_11013!='' then 
			convert(varchar, #tmpCallSetupResults.Sum_MO_Duration_11013/1000.0) 
		else '' end

	--else case when c.callDir='B->A' then
    	--case when #tmpBResults.Sum_MO_Duration!='' then 
		--	convert(varchar, #tmpBResults.Sum_MO_Duration/1000.0) else '' 
		--end
		--else '' end
	
	end as MO_CallSetupTime,

	-----------------------------

	-- V
	case when(c.callDir='A->B' or c.callDir='B->A') and c.callStatus in ('dropped','completed')  then 
		case when #tmpCallSetupResults.Sum_MO_Duration_11000!='' then 
			convert(varchar, #tmpCallSetupResults.Sum_MO_Duration_11000/1000.0) 
		else '' end
	
	end as MO_CallSetupTime_11000,

	------------------------------------------------------------------------------------------
	----W
	--case when c.callDir='A->B'or c.callDir='B->A'then 
	--	case when #tmpCallSetupResults.kpiid!='' then 
	--		str(#tmpCallSetupResults.kpiid) 
	--	else '' end

	----else case when c.callDir='B->A' then
 --   --	case when #tmpBResults.kpiid!='' then 
	--	--	str(#tmpBResults.kpiid) else '' 
	--	--end
	--	--else '' end
	
	--end as MO_Callsetup_KPIID,
----------------------------------------------------------------------------------------------------------------
	-- X
	case when c.callDir='A->B' or c.callDir='B->A' then 
		case when  #tmp10101A.Num_10101_OK=1 then 
			'OK' else case when #tmp10101A.Num_10101_Fail=1 then 'Fail' else '' end
		end
	--else case when c.callDir='B->A' then
    	--case when #tmp10101B.Num_10101_OK=1 then 
		--	'OK' else case when #tmp10101B.Num_10101_Fail=1 then 'Fail' else '' end
	--	end
	--	else '' end
	
	end as MO_10101_Status,
-------------------------------------------------------------------------------------------------------------------
	-- Y
	case when c.callDir='A->B' or c.callDir='B->A' then 
		case when #tmp10101A.errorcode!='' then 
			str(#tmp10101A.errorcode) 
		else '' end

	--else case when c.callDir='B->A' then
    --	case when #tmp10101B.errorcode!='' then 
		--	str(#tmp10101B.errorcode) else '' 
		--end
	--	else '' end
	
	end as MO_10101_Error_Code,
----------------------------------------------------------------------------------------------------------------------
	-- Z
	--case when c.callDir='A->B' or c.callDir='B->A' then 
		--case when #tmp10101A.msg!='' then 
		--	#tmp10101A.msg 
		--else '' end

	--else case when c.callDir='B->A' then
    	--case when #tmp10101B.msg!='' then 
		--	#tmp10101B.msg else '' 
		--end
	--	else '' end
	
	--end as MO_10101_Error_Message,
	---------------------------------------------------------------------------
	-- AA
	case when c.callDir='B->A' then 
	    case when c.callmode='CSFB' then 
				case when #tmpCallSetupResults.Sum_CSFBRadioRedirect!='' then 
					str(convert(real, #tmpCallSetupResults.Sum_CSFBRadioRedirect)/1000.0) 
				else '' end
		end
	else case when c.callDir='A->B' then
			 case when #tmpBResults.callmode='CSFB' then
				  case when #tmpCallSetupResults.Sum_CSFBCallSetupTime!='' then 
					str(convert(real, #tmpBResults.Sum_MO_Duration/1000.0)) else '' 
				  end
			 else '' end
		  else '' end
	
	end as OVERALL_MO_CSFB_CallSetupTime,
--------------------------------------------------------------------------------------
	-- AB
	case when c.callDir='B->A' then 
	    case when c.callmode='CSFB' then 
				case when #tmpCallSetupResults.Sum_CSFBRadioRedirect!='' then 
					str(convert(real, #tmpCallSetupResults.Sum_CSFBRadioRedirect)/1000.0) 
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
	--------------------------------------------------------------------------------
	-- AC
	-- AD
	case when c.callDir='B->A' then 
	    case when c.callmode='CS' then 
				case when #tmpCallSetupResults.Sum_MO_Duration_10108!='' then 
					str(convert(real, #tmpCallSetupResults.Sum_MO_Duration_10108)/1000.0) 
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
	----------------------------------------------------------------------------------
	-- AE
	case when c.callDir='B->A' then 
		case when #tmpCallSetupResults.Sum_MO_Duration_11013!='' then 
			convert(real, #tmpCallSetupResults.Sum_MO_Duration_11013/1000.0) 
		else '' end

	else case when c.callDir='A->B' then
    	case when #tmpBResults.Sum_MO_Duration!='' then 
			convert(real, #tmpBResults.Sum_MO_Duration/1000.0) else '' 
		end
		else '' end
	
	end as MT_CallSetupTime,

	------------------------------

	-- AE
	case when c.callDir='B->A' or c.callDir='A->B' then 
		case when #tmpCallSetupResults.Sum_MO_Duration_11000!='' then 
			convert(real, #tmpCallSetupResults.Sum_MO_Duration_11000/1000.0) 
		else '' end

	end as MT_CallSetupTime_11000,


	-------------------------------------------------------------------------------
	---- AF
	--case when c.callDir='B->A' then 
	--	case when #tmpCallSetupResults.kpiid!='' then 
	--		str(#tmpCallSetupResults.kpiid) 
	--	else '' end

	--else case when c.callDir='A->B' then
 --   	case when #tmpBResults.kpiid!='' then 
	--		str(#tmpBResults.kpiid) else '' 
	--	end
	--	else '' end
	
	--end as MT_Callsetup_KPIID,
------------------------------------------------------------------------------------
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
	---------------------------------------------------------------------------------------
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
------------------------------------------------------------
	-- AI
	--case when c.callDir='B->A' then 
		--case when #tmp10101A.msg!='' then 
	--		#tmp10101A.msg 
		--else '' end

	--else case when c.callDir='A->B' then
    --	case when #tmp10101B.msg!='' then 
		--	#tmp10101B.msg else '' 
		--end
	--	else '' end
	
	--end as MT_10101_Error_Message,
---------------------------------------------------------------------------------

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

----------------------------------------------------------------------------------------------------------------------------
  -- -- BR
  -- case when n.Operator='' then '' else
  --      case when #tmpCallSetupResults.Num_MO_OK=1 then 'Success' else 
		--                     case when #tmpCallSetupResults.Num_MO_FAIL=1 then 'Fail' else '' end
		--end
  -- end as SetupStatus,
	NULL as SetupStatus,
-------------------------------------------------------------------------------------------------------------------------------
   -- BS
   case when #tmpCallEndResults.Sum_Duration='' then '' else str(convert(real, #tmpCallEndResults.Sum_Duration)/1000.0,8,3) end as Duration,
----------------------------------------------------------------------------------------------------------------------------------------------
   -- BU
   case when (convert(real, #tmpLQ08.NumPOLQAWBBA) + convert(real, #tmpLQ08.NumPOLQAWBAB))=0 then '' else (convert(real, #tmpLQ08.SumPOLQAWBBA) + convert(real, #tmpLQ08.SumPOLQAWBAB))/ (convert(real, #tmpLQ08.NumPOLQAWBBA) + convert(real, #tmpLQ08.NumPOLQAWBAB)) end as MOSValue,
   case when convert(real, #tmpLQ08.NumPOLQAWBBA)=0 then '' else str(convert(real,#tmpLQ08.SumPOLQAWBBA)/convert(real, #tmpLQ08.NumPOLQAWBBA),5,3) end as DL_POLQA,
   case when convert(real, #tmpLQ08.NumPOLQAWBAB)=0 then '' else str(convert(real,#tmpLQ08.SumPOLQAWBAB)/convert(real, #tmpLQ08.NumPOLQAWBAB),5,3) end as U_POLQA,
   -- CE
   case when #tmpSRVCCResultsA.Num_SRVCC_OK>0 then str(convert(real, #tmpSRVCCResultsA.Sum_SRVCC_Duration)/convert(real, #tmpSRVCCResultsA.Num_SRVCC_OK)) else '' end as ASideSRVCCDuration,
   -- CH
   case when #tmpSRVCCResultsB.Num_SRVCC_OK>0 then str(convert(real, #tmpSRVCCResultsB.Sum_SRVCC_Duration)/convert(real, #tmpSRVCCResultsB.Num_SRVCC_OK )) else '' end as BSideSRVCCDuration,

	#tmpCallSetupResults.Sum_MO_Duration_11000,
	#tmpCallSetupResults.Sum_MO_Duration_11013,
	#tmpCallSetupResults.Sum_MO_Duration_10108,
	--#tmpCallSetupResults.Num_MO_OK,
	--#tmpCallSetupResults.Num_MO_FAIL,
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
	#tmpBResults.Sum_MO_Duration as Sum_MO_DurationB,
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
	--#tmpCallSetupResults.kpiid as KPI_IDA,
	#tmpBResults.kpiid as KPI_IDB,
	#tmp10101A.errorcode as ErrorCodeA,
	--#tmp10101A.msg as MsgA,
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
	#tmpINTRHO.sucIntrHO,
	#tmpINTRAHO.numIntraHO,
	#tmpINTRAHO.sucIntraHO,
	#tmpINTRATHO.numIntrRATHO,
	#tmp4KPI11012Minus11010.duration as DialRequestTimeCallingSide,
	#tmp4KPI11001.duration as RequestTryingTimeCallingSide,
	#tmp4KPI11000Minus11001.duration as TryingRingingTimeCallingSide,
	#tmp4KPI11012Minus11010B.duration as DialRequestTimeCalledSide,
	#tmp4KPI11001B.duration as RequestTryingTimeCalledSide,
	#tmp4KPI11000Minus11001B.duration as TryingRingingTimeCalledSide,
	#tmplowmosfree.SessionID as lowmosfree

into #tmpresults2
from
#tmpsession     Join sessions s On(#tmpsession.sessionID = s.sessionID)
	        Join callSession c On(s.sessionID = c.sessionID)	
		Join fileList f On(s.FileId = f.FileId AND (f.ASideLocation like '%VOLTE%' or f.ASideLocation like '%Free A%'))
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
		Left Join #tmp4KPI11012Minus11010 On(s.sessionId = #tmp4KPI11012Minus11010.sessionId)
		Left Join #tmp4KPI11001 On(s.sessionId = #tmp4KPI11001.sessionId)
		Left Join #tmp4KPI11000Minus11001 On(s.sessionId = #tmp4KPI11000Minus11001.sessionId)
		Left Join #tmp4KPI11012Minus11010B On(s.sessionId = #tmp4KPI11012Minus11010B.SessionId)
		Left Join #tmp4KPI11001B On(s.sessionId = #tmp4KPI11001B.sessionId)
		Left Join #tmp4KPI11000Minus11001B On(s.sessionId = #tmp4KPI11000Minus11001B.sessionId)
		left join #tmplowmosfree on (s.SessionId = #tmplowmosfree.SessionID)
                Join networkInfo n On(s.networkID = n.networkID)
		

order by #tmpsession.sessionId

Delete  aliasName from (
Select  *,
        ROW_NUMBER() over (Partition by Operator, SessionId,StartDate,StartTime,CallFinishTime,ASideLocation order by Operator) as rowNumber
From    #tmpresults2) aliasName 
Where   rowNumber > 1

select	DISTINCT Operator, -- A
	HomeOperator,
	SessionId, 
	StartDate,
    StartTime,
    CallFinishTime, -- F
	--ASideFileName,
    ASideLocation,	 
	--IMEI,
	CollectionName, -- J
	--ASideNumber,
	--BSideNumber,
	callType, -- 
    callDir, -- N
	callStatus, -- O
--	callcause,  -- P
	callmode, -- Q
	--callmodeBfake,
	CallModeB,
	-- S
    CallSetupTime10106,
	-- T
    CSFB10184,
	-- U
	--case when callDir='A->B' then 
	 --   case when callmode='CSFB' then 
			--	case when CallSetupTime10106!='' And CSFB10184!='' then 
				--	str(convert(real, CallSetupTime10106) - convert(real, CSFB10184)) 
				--else '' end
		--end
	--else case when callDir='B->A' then
			-- case when callmodeB='CSFB' then
				 -- case when CallSetupTime10106!='' And CSFB10184!='' then  
					--str(convert(real, CallSetupTime10106) - convert(real, CSFB10184))
				 -- end
			-- else '' end
		--  else '' end
	
	--end as ThreeGMO,
	-- V
	--No_MO_CSFB_CallSetupTime,
	-- W
	MO_CallSetupTime,
	MO_CallSetupTime_11000,
	-- X
	cast(NULL AS varchar) AS 'MO_Callsetup_KPIID',
	-- Y
	MO_10101_Status,
	-- Z
--	MO_10101_Error_Code,
	-- AA
--	MO_10101_Error_Message,
	-- AB
	--OVERALL_MO_CSFB_CallSetupTime,
	-- AC
	--OVERALL_MO_CSFB_Duration_Call_Procedure,

	-- AD
	--case when callDir='B->A' then 
	   -- case when callmode='CSFB' then 
				--case when OVERALL_MO_CSFB_CallSetupTime!='' And OVERALL_MO_CSFB_Duration_Call_Procedure!='' then 
					--str(convert(real, OVERALL_MO_CSFB_CallSetupTime) - convert(real, OVERALL_MO_CSFB_Duration_Call_Procedure)) 
				--else '' end
		--end
--	else case when callDir='A->B' then
			 --case when callmodeB='CSFB' then
				 -- case when OVERALL_MO_CSFB_CallSetupTime!='' And OVERALL_MO_CSFB_Duration_Call_Procedure!='' then 
					--str(convert(real, OVERALL_MO_CSFB_CallSetupTime) - convert(real, OVERALL_MO_CSFB_Duration_Call_Procedure))
				--  end
			-- else '' end
		 -- else '' end
	
	--end as ThreeGMT,
	-- AE
	--ThreeG_No_MO_CSFB_CallSetupTime,
	-- AF
	--MT_CallSetupTime,
	-- AG
	--MT_Callsetup_KPIID,
	-- AH
	--MT_10101_Status,
	-- AI
	--MT_10101_Error_Code,
	-- AJ
	--MT_10101_Error_Message,
	testStartMode, -- AK
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
	testStartGSM, -- AY
	testStartRxLev, -- AZ
	testStartRxQual, -- BA

	callEndMode, -- BB
	testEndLat,
	testEndLong,
	testEndLAC,
	testEndCellId, -- BF
	testEndBCCH,
	testEndEARFCN,
	testEndPCI,
	testEndRSRP, -- BJ
	testEndSINR,
	testEndFreq,
	testEndPSC,
	testEndRSCP,
	testEndEcNo, -- BO
	testEndGSM,
	testEndRxLev,
	testEndRxQual,
	testAvgRxlev, 
	testAvgRxQual, 
	testAvgRSCP ,
    testAvgEcNo ,
	testAvgRSRP ,
	testAvgSINR,
	-- BS
	'n/a' AS 'SetupStatus',
	-- BT
	Duration,
	'n/a' AS 'RetentionStatus',
	MOSValue,
	DL_POLQA,
	U_POLQA,
	CodeRate_AB_UL, -- BY
	CodeRate_BA_DL, -- BZ
	BLER, -- CA
	avgTxPwr,
	numIntrHo,
	numIntraHO,
	sucIntrHo,
	sucIntraHO,
	numIntrRATHO,
	ASideSRVCCDuration,
	Num_SRVCC_OK, -- CG
	Num_SRVCC_Fail,
	BSideSRVCCDuration,
	Num_SRVCC_OKB,
	Num_SRVCC_FailB,
	lowmosfree,
	-- CK
	--str(convert(real, DialRequestTimeCallingSide/1000.0), 8, 2) as DialRequestTimeCallingSide, 
	--str(convert(real, RequestTryingTimeCallingSide/1000.0), 8, 2)  as RequestTryingTimeCallingSide,
	--str(convert(real, TryingRingingTimeCallingSide/1000.0), 8, 2) as TryingRingingTimeCallingSide, -- CN
	--str(convert(real, DialRequestTimeCalledSide/1000.0), 8, 2) as DialRequestTimeCalledSide, 
	--str(convert(real, RequestTryingTimeCalledSide/1000.0), 8, 2)  as RequestTryingTimeCalledSide,
	--str(convert(real, TryingRingingTimeCalledSide/1000.0), 8, 2) as TryingRingingTimeCalledSide -- CN

---------------------------------------------------------------------------------------------------------------[ Custom call mode VOLTE/CS]---------------------------------------------------------------------------------

--	case  when callDir like 'A->B' and CallMode in ('VoLTE','SRVCC') then 'VoLTE Call'
	--      when callDir like 'A->B' and CallMode in ('CSFB','CS') then 'CS call'          
	--	  when callDir like 'B->A' and CallModeB in ('VoLTE','SRVCC') then 'VoLTE Call'
	--     when callDir like 'B->A' and CallModeB in ('CSFB','CS') then 'CS call'


	--	  when callDir like 'A->B' and CallMode in ('-') and testStartMode like ('%lte%') then 'VoLTE Call'
	--	  when callDir like 'A->B' and CallMode in ('-') and testStartMode like ('%UMTS%') then 'CS Call'
	--	  when callDir like 'A->B' and CallMode in ('-') and testStartMode like ('%GSM%') then 'CS Call'

	--	  when callDir like 'B->A' and CallModeB in ('-') and testStartMode like ('%lte%') then 'VoLTE Call'
	--	  when callDir like 'B->A' and CallModeB in ('-') and testStartMode like ('%UMTS%') then 'CS Call'
	--	  when callDir like 'B->A' and CallModeB in ('-') and testStartMode like ('%GSM%') then 'CS Call'
	--	  else NULL end as 'CustomCallMode'

---------------------------------------------------------------------------------------------------------------------[ALL CALL MODES WITH DIRECTION]---------------------------------------------------------------------------
case  when callDir like 'A->B' and CallMode in ('VoLTE') then 'VoLTE'
	  when callDir like 'A->B' and CallMode in ('SRVCC') then 'SRVCC'
	  when callDir like 'A->B' and CallMode in ('CS') then 'CS' 
	  when callDir like 'A->B' and CallMode in ('CSFB') then 'CSFB'
	  
	  when callDir like 'B->A' and CallModeB in ('VoLTE') then 'VoLTE'
	  when callDir like 'B->A' and CallModeB in ('SRVCC') then 'SRVCC'
	  when callDir like 'B->A' and CallModeB in ('CS') then 'CS' 
	  when callDir like 'B->A' and CallModeB in ('CSFB') then 'CSFB'

	  when callDir like 'A->B' and CallMode in ('-') and testStartMode like ('%lte%') then 'VoLTE'
	  when callDir like 'A->B' and CallMode in ('-') and testStartMode like ('%UMTS%') then 'CS'
      when callDir like 'A->B' and CallMode in ('-') and testStartMode like ('%GSM%') then 'CS'

	  when callDir like 'B->A' and CallModeB in ('-') and testStartMode like ('%lte%') then 'VoLTE'
	  when callDir like 'B->A' and CallModeB in ('-') and testStartMode like ('%UMTS%') then 'CS'
	  when callDir like 'B->A' and CallModeB in ('-') and testStartMode like ('%GSM%') then 'CS'

else NULL end as 'CustomCallMode'




into #tmpresults
from #tmpresults2
order by sessionId

select * 

--INTO BI_VOICE_MtoM

from #tmpresults
WHERE ([#tmpresults].[testStartCellId] < 2147483647 OR [#tmpresults].[testStartCellId] IS NULL) AND ([#tmpresults].[testEndCellId] < 2147483647 OR [#tmpresults].[testEndCellId] IS NULL) 
--AND SessionId in ('901943132232','266287972436')
order by #tmpresults.SessionId



-----------------------------------------------------------------------------------------------------------[AVG TABLE FOR SCORES(ALL LINES VALID)]-----------------------------------------------------------------------------

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

--into TMPBIFREE
--from #tmpresults



--group by 
--#tmpresults.ASideLocation,
--#tmpresults.CollectionName,
--#tmpresults.HomeOperator 


----------------------------------------------start drop----------------------------------

--DROP TABLE TMPBIFREE
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
drop table #tmp4KPI11012Minus11010
drop table #tmp4KPI11001
drop table #tmp4KPI11000Minus11001

drop table #tmpsessionB
drop table #tmp4KPI11012Minus11010B
drop table #tmp4KPI11001B
drop table #tmp4KPI11000Minus11001B
drop table #tmplowmosfree
--DROP TABLE BI_VOICE_MtoM
-----------------------------------------------end drop----------------------------------
End;
ELSE
BEGIN
select	
    '' as Operator, -- A
	'' as HomeOperator,
	'' as SessionId, 
	'' as StartDate,
    '' as StartTime,
    '' as CallFinishTime, -- F
	--'' as ASideFileName,
    '' as ASideLocation,	 
	--'' as IMEI,
	'' as CollectionName, -- J
	--'' as ASideNumber,
	--'' as BSideNumber,
	'' as callType, -- M
    '' as callDir, -- N
	'' as callStatus, -- O
	--'' as callcause,  -- P
	'' as callmode, -- Q
	'' as callmodeB,--R
	-- S
    '' as MO_CSFB_CallSetupTime,
	-- T
    '' as CSFB10184,
	-- U
	'' as ThreeGMO,
	-- V
	'' as No_MO_CSFB_CallSetupTime,
	-- W
	'' as MO_CallSetupTime,
	-- X
	'' as MO_Callsetup_KPIID,
	-- Y
	'' as MO_10101_Status,
	-- Z
	'' as MO_10101_Error_Code,
	-- AA
	'' as MO_10101_Error_Message,
	-- AB
	'' as OVERALL_MO_CSFB_CallSetupTime,
	-- AC
	'' as OVERALL_MO_CSFB_Duration_Call_Procedure,

	-- AD
	'' as ThreeGMT,
	-- AE
	'' as ThreeG_No_MO_CSFB_CallSetupTime,
	-- AF
	'' as MT_CallSetupTime,
	-- AG
	'' as MT_Callsetup_KPIID,
	-- AH
	'' as MT_10101_Status,
	-- AI
	'' as MT_10101_Error_Code,
	-- AJ
	'' as MT_10101_Error_Message,
	'' as testStartMode, -- AK
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
	'' as testStartGSM, -- AY
	'' as testStartRxLev, -- AZ
	'' as testStartRxQual, -- BA

	'' as callEndMode, -- BB
	'' as testEndLat,
	'' as testEndLong,
	'' as testEndLAC,
	'' as testEndCellId, -- BF
	'' as testEndBCCH,
	'' as testEndEARFCN,
	'' as testEndPCI,
	'' as testEndRSRP, -- BJ
	'' as testEndSINR,
	'' as testEndFreq,
	'' as testEndPSC,
	'' as testEndRSCP,
	'' as testEndEcNo, -- BO
	'' as testEndGSM,
	'' as testEndRxLev,
	'' as testEndRxQual,
	-- BS
	'' as SetupStatus,
	-- BT
	'' as Duration,
	'' as RetentionStatus,
	'' as MOSValue,
	'' as DL_POLQA,
	'' as U_POLQA,
	'' as CodeRate_AB_UL, -- BY
	'' as CodeRate_BA_DL, -- BZ
	'' as BLER, -- CA
	'' as avgTxPwr,
	'' as numIntrHo,
	'' as numIntraHO,
	'' as numIntrRATHO,
	'' as ASideSRVCCDuration,
	'' as Num_SRVCC_OK, -- CG
	'' as Num_SRVCC_Fail,
	'' as BSideSRVCCDuration,
	'' as Num_SRVCC_OKB,
	'' as Num_SRVCC_FailB, -- CK
	'' as DialRequestTimeCallingSide, 
	'' as RequestTryingTimeCallingSide,
	'' as TryingRingingTimeCallingSide, -- CN
	'' as DialRequestTimeCalledSide, 
	'' as RequestTryingTimeCalledSide,
	'' as TryingRingingTimeCalledSide -- CN


	

 drop table #tmpsession
 
END;