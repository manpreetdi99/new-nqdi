Select 

Sessions.FileId,
Sessions.SessionId,
Testinfo.TestId,
TestInfo.StartNetworkID,
testFinishTime = DATEADD(ms,TestInfo.duration,TestInfo.startTime),
	TestInfo.NetworkId
Into #tmpSessions

------------------------------------------------------------------------------------------
from Sessions Join Testinfo On(Sessions.SessionId=Testinfo.SessionId)
-------------------------------------------------------------------------------------------
where Sessions.Valid=1 And
TestInfo.Valid=1 And
Sessions.jtId in (4,5,7) And
TestInfo.TypeofTest like '%YouTube%'
----------------------------------------------------------------------------------------------
group by
------------------------------------------------------------------------------------------------
Sessions.FileId,
Sessions.SessionId,
Testinfo.TestId,
TestInfo.StartNetworkID,
TestInfo.duration,
TestInfo.startTime,
TestInfo.NetworkId

Select	s.sessionId,
		s.testid,
	NULL as 'KPI20621_errorCode',
	NULL as 'KPI20621_duration',
	v.[IPAccess] as 'KPI10625_errorCode',
	v.[IPAccessDuration] as 'KPI10625_duration',
	v.[PlayerSession]  as 'KPI20625_errorCode',
	v.[PlayerSessionDuration] as 'KPI20625_duration',
	v.[Reproduction]  as 'KPI30621_errorCode',
	v.[ReproductionDelay] as 'KPI30621_duration',
	v.[PlayoutAccess] 'KPI10620_errorCode',
	v.[PlayoutAccessDuration] as 'KPI10620_duration',
	NULL as 'KPI10620_startTime'
into	#tmpKPIResults2
from 	#tmpSessions s, ETSIYouTubeTriggerSelectiveKPIs v
where	s.testId = v.testId AND	s.SessionId = v.SessionID

update #tmpKPIResults2
set #tmpKPIResults2.KPI20621_errorCode=k.ErrorCode,
    #tmpKPIResults2.KPI20621_duration=k.Duration
from #tmpKPIResults2 join ResultsKPI k on (#tmpKPIResults2.TestId=k.TestId and #tmpKPIResults2.SessionId=k.SessionId and k.KPIId=20621)
	
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
------------------------------------------------------------ lat lot for duplicate values-------
Update #tmptestStartMode
Set #tmptestStartMode.testStartLat = Position.latitude ,
	#tmptestStartMode.testStartLong =Position.longitude
	
from #tmptestStartMode, Position
where #tmptestStartMode.TestId = Position.TestId AND
	Position.MsgTime = (select min(pos.MsgTime)  from Position pos
		where pos.TestId = #tmptestStartMode.TestId)

--------------------------------------------------------------------------------------------------------------
Update #tmptestStartMode
Set #tmptestStartMode.testStartFreq=WCDMAActiveSet.FreqDL,
	#tmptestStartMode.testStartPSC=WCDMAActiveSet.PrimScCode,
	#tmptestStartMode.testStartRSCP=WCDMAActiveSet.RSCP_PSC,
	#tmptestStartMode.testStartEcNo=WCDMAActiveSet.AggrEcIo_PSC
from #tmptestStartMode, WCDMAActiveSet
where #tmptestStartMode.testId = WCDMAActiveSet.TestId AND
	WCDMAActiveSet.MsgId = (select min(wcdma.msgId) +1 from WCDMAActiveSet wcdma
		where wcdma.testId = #tmptestStartMode.testId)
---------------------------------------------------------------------------------------------------------------			
Update #tmptestStartMode
Set --#tmptestStartMode.testStartEARFCN=LTEServingCellInfo.DL_EARFCN,
	--#tmptestStartMode.testStartPCI=LTEServingCellInfo.PhyCellId,
	#tmptestStartMode.testStartBW=LTEServingCellInfo.DLBandwidth
from #tmptestStartMode, LTEServingCellInfo
where #tmptestStartMode.testId = LTEServingCellInfo.TestId AND
	LTEServingCellInfo.LTEServingCellInfoId = (select min(lte.LTEServingCellInfoId) from LTEServingCellInfo lte
		where lte.testId = #tmptestStartMode.testId)
------------------------------------------------- start for avg Radio-------------------------------------------	
Update #tmptestStartMode
Set #tmptestStartMode.testAvgRSRP =LTEMeasurementReport.RSRP
	--####tmpCallStartMode.testStartSINR=LTEMeasurementReport.SINR0
from #tmptestStartMode, LTEMeasurementReport 
--where ####tmpCallStartMode.sessionId = AVG(LTEMeasurementReport.sessionId )AND 
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
---------------------------------------------------------------------------------------------------------------------------------------------
Update #tmptestStartMode
Set #tmptestStartMode.testStartEARFCN=LTEMeasurementReport.EARFCN,
	#tmptestStartMode.testStartPCI=LTEMeasurementReport.PhyCellId,
	#tmptestStartMode.testStartRSRP=LTEMeasurementReport.RSRP,
	#tmptestStartMode.testStartSINR=LTEMeasurementReport.SINR0
from #tmptestStartMode, LTEMeasurementReport
where #tmptestStartMode.testId = LTEMeasurementReport.TestId AND
	LTEMeasurementReport.MsgId = (select min(lte.msgId) from LTEMeasurementReport lte
		where lte.testId = #tmptestStartMode.testId)
--------------------------------------------------------------------------------------------------------------------------------------------------		
Select 	t.testId,
    	t.testFinishTime,
		t.NetworkId,
		testEndLat = 33.33,
		testEndLong = 33.33,
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
--------------------------------------------------------------------------
Update #tmptestEndTime
Set #tmptestEndTime.testEndLat = Position.latitude ,
	#tmptestEndTime.testEndLong =Position.longitude
	
from #tmptestEndTime, Position
where #tmptestEndTime.TestId = Position.TestId AND
	Position.MsgTime = (select min(pos.MsgTime)  from Position pos
		where pos.TestId = #tmptestEndTime.TestId)
-------------------------------------------------------------------------

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
-------------------------------------------------------------------------------------------------------------------------------
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
(TestInfo.TypeofTest like 'YouTube No Reference Smartphone' )		--Renamed “YouTube No Reference Smartphone” to “YouTube Video Streaming” 
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
	ResultsKPI.Duration as DNS_Duration

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

select s.SessionId, s.TestId, 
(PlayerAccessDuration) as PlayerServiceAccessTime, 
(PlayerDownloadDuration) as PlayerDownloadDuration,
(VideoAccessDuration) as VideoServiceAccessDuration,
(case Reproduction when 0 then 1 else 0 end) as ReproductionSuccessNumber,
(case Reproduction when 0 then 0 else 1 end) as ReproductionFailNumber,
(ReproductionDelay) as ReproductionStartDelayDuration,
(case when fr.NumFreezings is not null then fr.NumFreezings else -1 end) as PlayoutInterruptionNumber,
(case when fr.AccFreezingTime is not null then fr.AccFreezingTime else -1 end) as PlayoutInterruptionTotalDuration,
(VideoDownloadDuration) as VideoDownloadDuration,
(fr.MaxFreezingTime) as MaxFreezingTime
into #tmp_ytkpi
from #tmpSessions s
inner join ETSIYouTubeTriggerSelectiveKPIs kpi on s.SessionId=kpi.SessionId and s.TestId=kpi.TestId
inner join vETSIYouTubeFreezings fr on s.TestId=fr.TestId

select s.Sessionid, s.Testid,
sum(case when (Duration is not null) and (CurrTechnology like '%HSPA%' or CurrTechnology like '%R99%' or PrevTechnology like '%HSPA%' or PrevTechnology like '%R99%')  then Duration else 0

end) as UMTDuration,
sum(case when (Duration is not null) and (CurrTechnology like '%LTE%' or PrevTechnology like '%LTE%') then Duration else 0

end) as LTEDuration,

sum(case when (Duration is not null) and (CurrTechnology like '%GPRS%' or CurrTechnology like '%EDGE%' or CurrTechnology like '%GSM%' or PrevTechnology like '%GPRS%' or PrevTechnology like '%EDGE%' or PrevTechnology like '%GSM%') then Duration else 0

end) as GSMDuration
into #tmp_technology
from Technology t
inner join #tmpSessions s on s.SessionId=t.SessionId and s.TestId=t.TestId
where Duration is not null
group by s.SessionId, s.TestId

select
yt.*,
case when (GSMDuration + UMTDuration + LTEDuration) != 0 then
100.0*convert(real, GSMDuration) / (convert(real, GSMDuration) + convert(real, UMTDuration) + convert(real, LTEDuration))
else
0 
end as GSMPercentage,
case when (GSMDuration + UMTDuration + LTEDuration) != 0 then
100.0*convert(real, UMTDuration) / (convert(real, GSMDuration) + convert(real, UMTDuration) + convert(real, LTEDuration))
else
0 
end as UMTPercentage,
case when (GSMDuration + UMTDuration + LTEDuration) != 0 then
100.0*convert(real, LTEDuration) / (convert(real, GSMDuration) + convert(real, UMTDuration) + convert(real, LTEDuration))
else
0 
end as LTEPercentage

into #tmp_youtube_living
from #tmp_ytkpi yt
inner join #tmp_technology tech on yt.SessionId=tech.SessionId and yt.TestId=tech.TestId
order by yt.SessionId, yt.TestId

----------------------------------------------------------------------------------------------------------
select testid,
  DownloadDuration,
  State

  into #tmpstate
  from ResultsVideoStream 
   order by TestId


   drop table #tmpstate
-----------------------------------------------------------------------------------------------------------------

select TestId,
       min(VisualQuality) as minVisualQual,
       max(VisualQuality) as maxVisualQual
into #tmpVisualQuality
from ResultsVQ08ClipAvg
group by TestId
------------------------------------------------------------------------------------
Select 


FactVideoStreaming.TestId,
FactVideoStreaming.SessionId,
FactVideoStreaming.AvgRes

into #tmpavgresolution
from FactVideoStreaming
---------------------------------------------------------------------------------------------
Select  n.Operator,
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
	--FileList.IMEI, -- J
	--case when AccessPoints.APN!='' then AccessPoints.APN else '' end as APN,

	#tmptestStartMode.TestStartMode,
	#tmptestStartMode.TestStartLat,
	#tmptestStartMode.TestStartLong,

	-- start insert dns data
	--dns.CallStartTime, dns.DNS_Status, dns.DNS_Duration, dns.testStartLat, dns.testStartLong, dns.testStartCellId, dns.testStartLAC,
	-- end   insert dns data

	#tmptestStartMode.TestStartLAC,
	#tmptestStartMode.TestStartCellId,
	#tmptestStartMode.TestStartBCCH,
	#tmptestStartMode.TestStartEARFCN,
	#tmptestStartMode.testStartBW, -- Z

	#tmptestStartMode.TestStartPCI, -- AA
	--#tmptestStartMode.TestStartRSRP,
	--#tmptestStartMode.TestStartSINR,
	#tmptestStartMode.TestStartFreq,
	#tmptestStartMode.TestStartPSC,
	--#tmptestStartMode.TestStartRSCP,
	--#tmptestStartMode.TestStartEcNo,
	#tmptestStartMode.testAvgRxlev ,
	#tmptestStartMode.testAvgRxQual ,
	#tmptestStartMode.testAvgRSCP ,
	#tmptestStartMode.testAvgEcNo ,
	#tmptestStartMode.testAvgRSRP,
	#tmptestStartMode.testAvgSINR,
   -- technology.Summary,	
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

	#tmptestEndTime.TestEndLat,
	#tmptestEndTime.TestEndLong, -- AG

	-- CA
	n.Technology,

	#tmptestEndTime.TestEndLAC,
	#tmptestEndTime.TestEndCellId,
	#tmptestEndTime.TestEndBCCH,
	#tmptestEndTime.TestEndEARFCN,

	-- CC
	#tmptestEndTime.testEndBW,

	#tmptestEndTime.TestEndPCI, -- AQ
	--#tmptestEndTime.TestEndRSRP,
	--#tmptestEndTime.TestEndSINR,
	#tmptestEndTime.TestEndFreq,
	#tmptestEndTime.TestEndPSC,
	--#tmptestEndTime.TestEndRSCP,
	--#tmptestEndTime.TestEndEcNo,
	vResultsVideoStreamAvg.SessionQuality,

	vResultsVideoStreamAvg.TestQualityMin,
	vResultsVideoStreamAvg.TestQualityAvg,----NEW
	vResultsVideoStreamAvg.TestQualityMax, -- AZ
	vResultsVideoStreamAvg.FreezingPercent /100 as 'FreezingTimePerc',  -- BA


	ResultsVideoStreamTCPData.TimeToStartBufferingPlayer/1000.0 as TimeToStartBufferingPlayer, -- BB
	ResultsVideoStreamTCPData.PreBufferingTimePlayer/1000.0 as PreBufferingTimePlayer,
	ResultsVideoStreamTCPData.TimeToFirstPicturePlayer/1000.0 as TimeToFirstPicturePlayer,
	--ResultsVideoStreamTCPData.TimeToFirstPicture/1000.0 as TimeToFirstPicture,
	ResultsVQ08StreamAvg.Jerkiness, -- BF

	-- find -- BE
	case when #tmpKPIResults2.KPI10625_errorCode=0 then 'Success' else case when #tmpKPIResults2.KPI10625_errorCode is null then '--' else 'Fail' end end as VideoAccessKPI10625,
	#tmpKPIResults2.KPI10625_duration,
	case when #tmpKPIResults2.KPI20625_errorCode=0 then 'Success' else case when #tmpKPIResults2.KPI20625_errorCode is null then '--' else 'Fail' end end as VideoDownloadStatusKPI20625,

	vETSI.[VideoPlayoutDuration] as 'Video Play Start Time',

	#tmpKPIResults2.KPI20625_duration, -- BJ
	case when #tmpKPIResults2.KPI30621_errorCode=0 then 'Success' else case when #tmpKPIResults2.KPI30621_errorCode is null then '--' else 'Fail' end end as PlayBackStartKPI30621,
	#tmpKPIResults2.KPI30621_duration,
	case when #tmpKPIResults2.KPI20621_errorCode=0 then 'Success' else case when #tmpKPIResults2.KPI20621_errorCode is null then '--' else 'Fail' end end as PlayBackStartKPI20621,
	#tmpKPIResults2.KPI20621_duration/1000.0 as TotalPlayBackTimeKPI20621, -- BN
	case when #tmpKPIResults2.KPI10620_errorCode=0 then 'Success' else case when #tmpKPIResults2.KPI10620_errorCode is null then '--' else 'Fail' end end as ConfigAccessKPI10620,
	#tmpKPIResults2.KPI10620_duration,
	CAST(ResultsVideoStream.HorResolution as varchar)+' x '+CAST(ResultsVideoStream.VerResolution as varchar) as Resolution,
	--8*ResultsVideoStreamTCPData.BytesTotal as TotalBits, -- BR
	#tmpavgresolution.AVGres,
	--evs.E2ESession,
	ef.ImpairmentFree,
	ef.Freezings, 
	ef.NumFreezings,
	--ef.AccFreezingTime,
	ResultsVideoStream.state as State,
	t.QualityIndication
	--case when 8*ResultsVideoStreamTCPData.BytesTotal!=-8 and #tmpKPIResults2.KPI20625_duration!=0 then str(convert(real, 8*ResultsVideoStreamTCPData.BytesTotal) / convert(real, #tmpKPIResults2.KPI20625_duration)) else '' end as UserDataRate,
	--ytl.PlayerServiceAccessTime, 
	--ytl.PlayerDownloadDuration,

	-- new column
--vETSI.[Video Reproduction Start Delay [s]]] as "Reproduction start delay start TA/Video download start TA (first video data byte)",
--case when ytl.ReproductionSuccessNumber=0 and ytl.ReproductionFailNumber=0 then 0 else 100.0*convert(real, ytl.ReproductionSuccessNumber) / (convert(real, ytl.ReproductionSuccessNumber) + convert(real, ytl.ReproductionFailNumber)) end as ReproductionStartDelaySuccessRate,
--ytl.ReproductionFailNumber, 
--ytl.ReproductionStartDelayDuration,
--ytl.VideoServiceAccessDuration, 
--ytl.VideoDownloadDuration,
--vETSIApp.AppVideoPlayoutDuration as "Video playout download duration",
--case when ytl.PlayoutInterruptionNumber!=-1 then convert(varchar(10), ytl.PlayoutInterruptionNumber) else '--' end as PlayoutInterruptionNumber, 
--case when ytl.PlayoutInterruptionTotalDuration!=-1 then convert(varchar(10), ytl.PlayoutInterruptionTotalDuration) else '--' end as PlayoutInterruptionTotalDuration,
--case when ytl.PlayoutInterruptionNumber=0 then '--' else case when ytl.PlayoutInterruptionNumber=-1 then '--' else convert(varchar(10), convert(real, ytl.PlayoutInterruptionTotalDuration)/convert(real, ytl.PlayoutInterruptionNumber)) end end as PlayoutInterruptionAverageDuration,
--ytl.MaxFreezingTime,
--ytl.GSMPercentage, 
--ytl.UMTPercentage, 
--ytl.LTEPercentage, 
--vv3.TestQualityAvg as VMOS

--case when (ytl.PlayoutInterruptionTotalDuration) < 15 and (ytl.PlayoutInterruptionNumber) <=10 and ((ytl.PlayerDownloadDuration) + (ytl.VideoServiceAccessDuration) + (ytl.ReproductionStartDelayDuration) ) < 33 and ytl.MaxFreezingTime < 8 then 'Yes' else 'No' end as qualified
--vq.minVisualQual as MinVisualQuality,
--vq.maxVisualQual as MaxVisualQuality

INTO BI_YOUTUBE

From
#tmpSessions	Join	Filelist On(#tmpSessions.FileID=FileList.FileID)
		Join	Testinfo t On(#tmpSessions.TestId=t.TestId)
		Left Join	vResultsVideoStreamAvg On(t.TestId=vResultsVideoStreamAvg.TestId)
		Left Join	ResultsVQ08StreamAvg On(t.TestId=ResultsVQ08StreamAvg.TestId)
		Left Join	ResultsVideoStreamTCPData On(t.TestId=ResultsVideoStreamTCPData.TestId)
		Left Join	ResultsVideoStream On(t.TestId=ResultsVideoStream.TestId)
		JOIN vETSIYouTubeFreezings ef ON(t.TestId=ef.TestId)
		JOIN ETSIYouTubeTriggerSelectiveKPIs evs ON(t.TestId=evs.TestId)
                Left Join AccessPoints On(t.TestId=AccessPoints.TestId)
		Join Technology On(t.Testid=Technology.Testid and Technology.TriggerMsg like '%test end%')
		Left Join #tmpKPIResults2 On(t.TestId = #tmpKPIResults2.TestId)
                Left Join #tmptestStartMode On(t.testId = #tmptestStartMode.testId)
				 Left Join #tmpavgresolution On(t.testId = #tmpavgresolution.testId)
				Left Join #tmptestEndTime On(t.testId = #tmptestEndTime.TestId)
				Left Join #tmp_DNS dns on (dns.TestId = t.testid)
				left join #tmp_youtube_living ytl on ytl.SessionId=#tmpSessions.SessionId and ytl.TestId=#tmpSessions.TestId
				left join #tmpVisualQuality vq on vq.TestId=#tmpSessions.TestId
				left join vResultsVideoStreamAvg vv3 on vv3.TestId=#tmpSessions.TestId
				left join vETSIYouTubeKPIs vETSI on vETSI.SessionId=#tmpSessions.SessionId and vETSI.TestId=#tmpSessions.TestId
				left join vETSIYouTubeKPIs vETSIApp on vETSIApp.SessionID=#tmpSessions.SessionId and vETSIApp.TestId=#tmpSessions.TestId
				Join networkInfo n On(#tmptestEndTime.networkID = n.networkID)

where t.TestName like 'YouTube Service%' AND (([#tmptestStartMode].[testStartCellId] < 2147483647 OR [#tmptestStartMode].[testStartCellId] IS NULL) AND ([#tmptestEndTime].[testEndCellId] < 2147483647 OR [#tmptestEndTime].[testEndCellId] IS NULL))


--AND (CollectionName LIKE 'THR%' OR
--CollectionName LIKE 'EMA%' OR
--CollectionName LIKE 'CMA%' OR
--CollectionName LIKE 'WMA%' OR
--CollectionName LIKE 'ATH%' OR
--CollectionName LIKE 'STR%') 
----------------------drop------------------------
Drop Table #tmpSessions
Drop Table #tmpKPIResults2
Drop table #tmptestStartMode
Drop table #tmptestEndTime

Drop Table #tmp_DNS
Drop Table #tmpSessionsDNS
Drop table #tmptestStartModeDNS

drop table #tmp_youtube_living
drop table #tmp_technology
drop table #tmp_ytkpi
drop table #tmpVisualQuality

drop table #tmpavgresolution
--DROP TABLE BI_YOUTUBE