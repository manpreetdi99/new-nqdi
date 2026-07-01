Select SessionId
into #Sessions
from Sessions

--------------------------------------------------------------------
SELECT 
	pa.Operator,
	pa.HomeOperator,
	pa.ASidelocation,
	pa.collectionname,
	pa.TestName,
	pa.TypeOfTest,
	pa.LAC,
	pa.CId,
	pa.LTEServingCellInfoId,
	pa.PosId,
	pa.MsgTime,
	pa.TestId,
	pa.SessionId,
	pa.Duration,
	pa.CACount,
	pa.DLBandWidth1st,
	pa.DLBandWidth2nd,
	pa.DLBandWidth3rd,
	pa.DLBandWidth4th,
	pa.DLBandWidth5th,
	pa.DL_EARFCN1st,
	pa.DL_EARFCN2nd,
	pa.DL_EARFCN3rd,
	pa.DL_EARFCN4th,
	pa.DL_EARFCN5th,
	ThpCarrier1st = AVG(pd1.NetPDSCHThroughput)/1000*8,
	ThpCarrier2nd = AVG(pd2.NetPDSCHThroughput)/1000*8,
	ThpCarrier3rd = AVG(pd3.NetPDSCHThroughput)/1000*8,
	ThpCarrier4th = AVG(pd4.NetPDSCHThroughput)/1000*8,
	ThpCarrier5th = AVG(pd5.NetPDSCHThroughput)/1000*8,
	TotalThp =  AVG(pdi.NetPDSCHThroughput)/1000*8,
	AvgMCS=Avg(pdi.AvgMCS),
	TotalThpUL=AVG(pdiu.NetPUSCHThroughput)/1000*8,
	AvgMCSUL=Avg(pdiu.AvgMCS)
	into #tmptst
FROM
	(SELECT -- Calculate the duration of each LTE Serving Cell configuration
		fl.ASidelocation,
		fl.CollectionName,
		fl.TestDescription,
		fl.ASideNumber,
		ti.TestName,
		ti.typeoftest AS TypeOfTest,
		ni.Operator,
		ni.HomeOperator,
		ni.LAC,
		ni.CId,
		li.LTEServingCellInfoId,
		li.PosId,
		li.MsgTime,
		li.TestId,
		Duration = CASE li.SessionId WHEN li1.SessionId THEN datediff(ms,li.MsgTime,li1.MsgTime)
					ELSE 
						CASE WHEN DATEADD(ms,ni.duration,ni.MsgTime) > DATEADD(ms,ti.duration,ti.startTime) THEN datediff(ms,li.MsgTime,DATEADD(ms,ti.duration,ti.startTime))
						ELSE datediff(ms,li.MsgTime,DATEADD(ms,ni.duration,ni.MsgTime))END END,
		li.SessionId,
		li.NetworkId,
		CACount = ISNULL(COUNT(ca.CarrierIndex)+1,1),
		DLBandWidth1st = li.DLBandwidth,
		DLBandWidth2nd = ca1.DLBandwidth,
		DLBandWidth3rd = ca2.DLBandwidth,
		DLBandWidth4th = ca3.DLBandwidth,
		DLBandWidth5th = ca4.DLBandwidth,
		DL_EARFCN1st = li.[DL_EARFCN],
		DL_EARFCN2nd = ca1.EARFCN,
		DL_EARFCN3rd = ca2.EARFCN,
		DL_EARFCN4th = ca3.EARFCN,
		DL_EARFCN5th = ca4.EARFCN
	FROM #Sessions ss
		INNER JOIN Sessions s ON s.SessionId = ss.SessionId
		INNER JOIN FileList fl ON s.FileId = fl.FileId
		INNER JOIN TestInfo ti ON s.SessionId = ti.SessionId 
		inner join LTEServingCellInfo li on ti.TestId = li.TestId AND ss.SessionId = li.SessionId AND li.TestId <> 0
		inner join LTEServingCellInfo li1 on li.LTEServingCellInfoId + 1 = li1.LTEServingCellInfoId AND li1.TestId <> 0
		INNER JOIN NetworkInfo ni on li.NetworkId = ni.NetworkId
		-- INNER JOin SessionsB bs on li.SessionId = bs.SessionId
		LEFT OUTER JOIN LTECACellInfo ca ON li.LTECACellInfoId = ca.LTECACellInfoId
		LEFT OUTER JOIN (SELECT EARFCN, 
							DLBandWidth, 
							cnt=ROW_NUMBER () OVER(Partition by LTECACellInfoId order BY CarrierIndex), -- CarrierIndex is the signalled index, it can have any number not always starting with 1, with ROW_NUMBER we count them starting with 1.
							LTECACellInfoId, 
							CarrierIndex 
							
						FROM  LTECACellInfo) ca1 ON li.LTECACellInfoId = ca1.LTECACellInfoId AND ca1.cnt = 1
		LEFT OUTER JOIN (SELECT EARFCN, 
							DLBandWidth, 
							cnt=ROW_NUMBER () OVER(Partition by LTECACellInfoId order BY CarrierIndex), 
							LTECACellInfoId, 
							CarrierIndex 
						FROM  LTECACellInfo) ca2 ON li.LTECACellInfoId = ca2.LTECACellInfoId AND ca2.cnt = 2
		LEFT OUTER JOIN (SELECT EARFCN, 
							DLBandWidth, 
							cnt=ROW_NUMBER () OVER(Partition by LTECACellInfoId order BY CarrierIndex), 
							LTECACellInfoId, 
							CarrierIndex 
						FROM  LTECACellInfo) ca3 ON li.LTECACellInfoId = ca3.LTECACellInfoId AND ca3.cnt = 3
		LEFT OUTER JOIN (SELECT EARFCN, 
							DLBandWidth, 
							cnt=ROW_NUMBER () OVER(Partition by LTECACellInfoId order BY CarrierIndex), 
							LTECACellInfoId, 
							CarrierIndex 
						FROM  LTECACellInfo) ca4 ON li.LTECACellInfoId = ca4.LTECACellInfoId AND ca4.cnt = 4


where TestName in( 'Capacity DL','Capacity UL') 
	GROUP BY 
	    li.TestId,
		li.LTEServingCellInfoId,
		li.PosId,
		li.MsgTime,
		ti.starttime,
		li.SessionId,
		li.NetworkId,
		li1.SessionId,
		li1.MsgTime,
		ni.Duration,
		ni.MsgTime,
		ti.duration,
		li.DlBandwidth,
		li.DL_EARFCN,
		ca1.DLBandwidth,
		ca2.DLBandwidth,
		ca3.DLBandwidth,
		ca4.DLBandwidth,
		ca1.EARFCN,
		ca2.EARFCN,
		ca3.EARFCN,
		ca4.EARFCN,
		ni.Operator,
		ni.HomeOperator, 
		fl.ASidelocation,
		fl.Collectionname,
		fl.TestDescription,
		fl.ASideNumber,
		ti.TestName,
		ti.typeoftest,
		ni.LAC,
		ni.CId)pa
	LEFT OUTER JOIN LTEPDSCHStatisticsInfo pdi ON pdi.TestId = pa.TestId AND pdi.MsgTime Between pa.MsgTime and DATEADD(ms,pa.Duration,pa.MsgTime)
	LEFT OUTER JOIN LTEPDSCHStatisticsCarrier pd1 ON pdi.LTEPDSCHInfoId = pd1.LTEPDSCHInfoId AND pd1.CarrierIndex = 0
	LEFT OUTER JOIN LTEPDSCHStatisticsCarrier pd2 ON pdi.LTEPDSCHInfoId = pd2.LTEPDSCHInfoId AND pd2.CarrierIndex = 1
	LEFT OUTER JOIN LTEPDSCHStatisticsCarrier pd3 ON pdi.LTEPDSCHInfoId = pd3.LTEPDSCHInfoId AND pd3.CarrierIndex = 2
	LEFT OUTER JOIN LTEPDSCHStatisticsCarrier pd4 ON pdi.LTEPDSCHInfoId = pd4.LTEPDSCHInfoId AND pd4.CarrierIndex = 3
	LEFT OUTER JOIN LTEPDSCHStatisticsCarrier pd5 ON pdi.LTEPDSCHInfoId = pd5.LTEPDSCHInfoId AND pd5.CarrierIndex = 4
	LEFT OUTER JOIN LTEPUSCHStatisticsInfo pdiu ON pdiu.TestId = pa.TestId AND pdiu.MsgTime Between pa.MsgTime and DATEADD(ms,pa.Duration,pa.MsgTime)


GROUP BY 
	pa.ASidelocation,
	pa.CollectionName,
	pa.TestDescription,
	pa.ASideNumber,
	pa.TestName,
	pa.Operator,
	pa.HomeOperator,
	pa.LAC,
	pa.CId,
	pa.LTEServingCellInfoId,
	pa.PosId,
	pa.MsgTime,
	pa.TestId, pa.TypeOfTest,
	pa.SessionId,
	pa.Duration,
	pa.CACount,
	pa.DLBandWidth1st,
	pa.DLBandWidth2nd,
	pa.DLBandWidth3rd,
	pa.DLBandWidth4th,
	pa.DLBandWidth5th,
	pa.DL_EARFCN1st,
	pa.DL_EARFCN2nd,
	pa.DL_EARFCN3rd,
	pa.DL_EARFCN4th,
    pa.DL_EARFCN5th
ORDER BY pa.LTEServingCellInfoId --, pdi.MsgTime


Update #tmptst
Set #tmptst.DLBandWidth2nd = 0
from #tmptst
where #tmptst.DLBandWidth2nd is NULL


Update #tmptst
Set #tmptst.DLBandWidth3rd = 0
from #tmptst
where #tmptst.DLBandWidth3rd is NULL

Update #tmptst
Set #tmptst.DLBandWidth4th = 0
from #tmptst
where #tmptst.DLBandWidth4th is NULL

Update #tmptst
Set #tmptst.DLBandWidth5th = 0
from #tmptst
where #tmptst.DLBandWidth5th is NULL

Update #tmptst
Set #tmptst.ThpCarrier2nd = '' 
from #tmptst
where #tmptst.ThpCarrier2nd is NULL

Update #tmptst
Set #tmptst.ThpCarrier3rd = '' 
from #tmptst
where #tmptst.ThpCarrier3rd is NULL

Update #tmptst
Set #tmptst.ThpCarrier4th = '' 
from #tmptst
where #tmptst.ThpCarrier4th is NULL

Update #tmptst
Set #tmptst.ThpCarrier5th = '' 
from #tmptst
where #tmptst.ThpCarrier5th is NULL



---------------------------------------------------------------------------------------------------------------------------------
Select 	

LTEMeasurementReport.PosId,

Avg(LTEMeasurementReport.RSRP) as RSRP,
AVG(LTEMeasurementReport.RSRQ) as RSRQ,
AVG(LTEMeasurementReport.RSSI) as RSSI,
AVG(LTEMeasurementReport.SINR0) as SINR0,
AVG(LTEMeasurementReport.SINR1) as SINR1
--sum(LTEMeasurementReport.SINR0 + LTEMeasurementReport.SINR1 )as 'SINR'

into #tmppradio
from 
Sessions as Sessions,TestInfo, Position,  FileList, 
LTEMeasurementReport,NetworkInfo 
where Sessions.FileId = FileList.FileId and 
Sessions.Valid=1 And TestInfo.valid=1 and
Sessions.SessionId=TestInfo.SessionId and
TestInfo.TestId = LTEMeasurementReport.TestId AND
LTEMeasurementReport.PosId = Position.PosId AND
LTEMeasurementReport.NetworkId = NetworkInfo.NetworkId 

group by LTEMeasurementReport.PosId


order by PosId
---------------------------------------------------------------------------------------------------------------------------


select 
#tmptst.Operator,
#tmptst.HomeOperator,
#tmptst.ASideLocation,
#tmptst.CollectionName,
#tmptst.TestName,
#tmptst.LAC,
#tmptst.CId,
#tmptst.SessionId,
#tmptst.TestId,
#tmptst.PosId,
#tmptst.Duration,
#tmptst.CACount,
case when TestName in ('Capacity DL' ) and #tmptst.ThpCarrier1st>0  then #tmptst.DLBandWidth1st else 
case when TestName in ('Capacity UL' ) and #tmptst.TotalThpUL>0  then #tmptst.DLBandWidth1st else 0 end end as BW1,
case when TestName in ('Capacity DL' ) and #tmptst.ThpCarrier2nd>0  then #tmptst.DLBandWidth2nd else 
case when TestName in ('Capacity UL' ) and #tmptst.TotalThpUL>0  then #tmptst.DLBandWidth2nd else 0 end end as BW2,
case when TestName in ('Capacity DL' ) and #tmptst.ThpCarrier3rd>0  then #tmptst.DLBandWidth3rd else 
case when TestName in ('Capacity UL' ) and #tmptst.TotalThpUL>0  then #tmptst.DLBandWidth3rd else 0 end end as BW3,
case when TestName in ('Capacity DL' ) and #tmptst.ThpCarrier4th>0  then #tmptst.DLBandWidth4th else 
case when TestName in ('Capacity UL' ) and #tmptst.TotalThpUL>0  then #tmptst.DLBandWidth4th else 0 end end as BW4,
case when TestName in ('Capacity DL' ) and #tmptst.ThpCarrier5th>0  then #tmptst.DLBandWidth5th else 
case when TestName in ('Capacity UL' ) and #tmptst.TotalThpUL>0  then #tmptst.DLBandWidth5th else 0 end end as BW5,
#tmptst.DLBandWidth1st,
#tmptst.DLBandWidth2nd,
#tmptst.DLBandWidth3rd,
#tmptst.DLBandWidth4th,
#tmptst.DLBandWidth5th,

#tmptst.DLBandWidth1st+#tmptst.DLBandWidth2nd+#tmptst.DLBandWidth3rd+#tmptst.DLBandWidth4th+#tmptst.DLBandWidth5th as TotalBw,

case when TestName in ('Capacity DL' ) and #tmptst.ThpCarrier1st>0  then #tmptst.DL_EARFCN1st else 
case when TestName in ('Capacity UL' ) and #tmptst.TotalThpUL>0  then #tmptst.DL_EARFCN1st else null end end as DLCA1,

case when TestName in ('Capacity DL' ) and #tmptst.ThpCarrier2nd>0   then #tmptst.DL_EARFCN2nd else 
case when TestName in ('Capacity UL' ) and #tmptst.TotalThpUL>0  then #tmptst.DL_EARFCN2nd else null end end as DLCA2,

case when TestName in ('Capacity DL' ) and #tmptst.ThpCarrier3rd>0   then #tmptst.DL_EARFCN3rd else 
case when TestName in ('Capacity UL' ) and #tmptst.TotalThpUL>0  then #tmptst.DL_EARFCN3rd else null end end as DLCA3,

case when TestName in ('Capacity DL' ) and #tmptst.ThpCarrier4th>0   then #tmptst.DL_EARFCN4th else 
case when TestName in ('Capacity UL' ) and #tmptst.TotalThpUL>0  then #tmptst.DL_EARFCN4th else null end end as DLCA4,

case when TestName in ('Capacity DL' ) and #tmptst.ThpCarrier5th>0   then #tmptst.DL_EARFCN5th else 
case when TestName in ('Capacity UL' ) and #tmptst.TotalThpUL>0  then #tmptst.DL_EARFCN5th else null end end as DLCA5,

--case when TestName in ('Capacity DL' ) and #tmptst.ThpCarrier2nd>0  then #tmptst.DL_EARFCN2nd else null end as DLCA2,
--case when TestName in ('Capacity DL' ) and #tmptst.ThpCarrier3rd>0  then #tmptst.DL_EARFCN3rd else null end as DLCA3,
#tmptst.DL_EARFCN1st,
#tmptst.DL_EARFCN2nd,
#tmptst.DL_EARFCN3rd,
#tmptst.DL_EARFCN4th,
#tmptst.DL_EARFCN5th,
case when TestName in ('Capacity DL' ) then #tmptst.ThpCarrier1st  else  null end as ThpCarrier1st,
case when TestName in ('Capacity DL' )  and #tmptst.ThpCarrier2nd>0 then #tmptst.ThpCarrier2nd else null end as ThpCarrier2nd,
case when TestName in ('Capacity DL' )  and #tmptst.ThpCarrier3rd>0 then #tmptst.ThpCarrier3rd else null end as ThpCarrier3rd,
case when TestName in ('Capacity DL' )  and #tmptst.ThpCarrier4th>0 then #tmptst.ThpCarrier4th else null end as ThpCarrier4th,
case when TestName in ('Capacity DL' )  and #tmptst.ThpCarrier5th>0 then #tmptst.ThpCarrier5th else null end as ThpCarrier5th,

case when TestName in ('Capacity DL' ) then #tmptst.ThpCarrier1st+#tmptst.ThpCarrier2nd+#tmptst.ThpCarrier3rd+#tmptst.ThpCarrier4th+#tmptst.ThpCarrier5th else null end as TotalThpSumDL,


case when TestName in ('Capacity DL' ) then #tmptst.TotalThp else case when TestName in ('Capacity UL' ) then #tmptst.TotalThpUL else null end end as TotalThp,

case when TestName in ('Capacity UL' ) then #tmptst.TotalThpUL else null end as TotalThpUL ,

case when TestName in ('Capacity DL' ) then #tmptst.AvgMCS else case when TestName in ('Capacity UL' ) then #tmptst.AvgMCSUL else null end end as AvgMCS,

--case when TestName in ('Capacity UL' ) then #tmptst.AvgMCSUL else null end as AvgMCSUL,

--#tmppradio.EARFCN as PEARFCN,
#tmppradio.RSRP as PRSRP,
#tmppradio.SINR0 as PSINR0,
#tmppradio.SINR1 as PSINR1,
Str(Round((#tmppradio.SINR0 + #tmppradio.SINR1)/2,3),10,2)as 'SINR'

into #tmpFinalBWPH
from #tmptst 
Left Join #tmppradio On(#tmptst.PosId = #tmppradio.PosId)

where Duration <> 0 and TotalThp is not null and TotalThp>=100 and #tmptst.ThpCarrier1st>0 and #tmptst.ThpCarrier1st is not null  and TotalThpUL>0  --and CollectionName = 'PEL_ARGOS-NAFPLIO-DREPANO_TOURISTIC AREAS'

order by TestId
------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

select distinct #tmpFinalBWPH.HomeOperator,
#tmpFinalBWPH.ASideLocation,
#tmpFinalBWPH.CollectionName,
#tmpFinalBWPH.TestName,
#tmpFinalBWPH.LAC,
#tmpFinalBWPH.CId,
#tmpFinalBWPH.SessionId,
#tmpFinalBWPH.TestId,
#tmpFinalBWPH.PosId,
#tmpFinalBWPH.Duration,
#tmpFinalBWPH.CACount,
#tmpFinalBWPH.BW1,
#tmpFinalBWPH.BW2,
#tmpFinalBWPH.BW3,
#tmpFinalBWPH.BW4,
#tmpFinalBWPH.BW5,
#tmpFinalBWPH.BW1+#tmpFinalBWPH.BW2+#tmpFinalBWPH.BW3+#tmpFinalBWPH.BW4+#tmpFinalBWPH.BW5 as TotalBwN,
--#tmpFinalBWPH.TotalBw,
#tmpFinalBWPH.DLCA1,
#tmpFinalBWPH.DLCA2,
#tmpFinalBWPH.DLCA3,
#tmpFinalBWPH.DLCA4,
#tmpFinalBWPH.DLCA5,
case when TestName in ('Capacity DL' ) then #tmpFinalBWPH.TotalThpSumDL else case when TestName in ('Capacity UL') then #tmpFinalBWPH.TotalThp else null end end as TotalThp,
--#tmpFinalBWPH.TotalThpUL,
#tmpFinalBWPH.ThpCarrier1st as ThpCarrier1stDL,
#tmpFinalBWPH.ThpCarrier2nd as ThpCarrier2ndDL,
#tmpFinalBWPH.ThpCarrier3rd as ThpCarrier3rd,
#tmpFinalBWPH.ThpCarrier4th as ThpCarrier4th,
#tmpFinalBWPH.ThpCarrier5th as ThpCarrier5th,
#tmpFinalBWPH.AvgMCS,
#tmpFinalBWPH.PRSRP,
#tmpFinalBWPH.PSINR0,
#tmpFinalBWPH.PSINR1,
#tmpFinalBWPH.SINR

into BI_BW

from #tmpFinalBWPH

--where CollectionName LIKE 'THR%' OR
--CollectionName LIKE 'EMA%' OR
--CollectionName LIKE 'CMA%' OR
--CollectionName LIKE 'WMA%' OR
--CollectionName LIKE 'ATH%' OR
--CollectionName LIKE 'STR%' 

order by TestId





drop table #Sessions
drop table #tmptst
drop table #tmppradio
drop table #tmpFinalBWPH
--drop table BI_BW