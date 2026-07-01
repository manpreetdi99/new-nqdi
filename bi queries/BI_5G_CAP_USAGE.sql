-------------------------------------------------------------------------------

---temp table for DL & UL
SELECT 
    vcapatmp.SessionId,
	vcapatmp.TestId,
	vcapatmp.PosId,
	vcapatmp.Direction,
    vcapatmp.ThroughputGetIP AS ThroughputDL,
    NULL AS ThroughputUL -- Placeholder for UL column
INTO #tempCapaDL_UL
FROM 
    vResultsCapacityTestInstantGet vcapatmp

UNION ALL

SELECT 
    vcapaULtmp.SessionId,
	vcapaULtmp.TestId,
	vcapaULtmp.PosId,
	vcapaULtmp.Direction,
    NULL AS ThroughputDL, -- Placeholder for DL column
    vcapaULtmp.ThroughputPutIP AS ThroughputUL
FROM 
    vResultsCapacityTestInstantPut vcapaULtmp
--------------------------------------------------------------------------------

Select  
TestInfo.TestName,
tmp.PosId,
pos.latitude,
pos.longitude,
FileList.CollectionName,
tmp.SessionId,
tmp.TestId,
FileList.ASideLocation,

Case when  tmp.ThroughputDL<> 0 then convert(float,tmp.ThroughputDL)*0.008 else NULL end as 'ThroughputDL',
Case when  tmp.ThroughputUL<> 0 then convert(float,tmp.ThroughputUL)*0.008 else NULL end as 'ThroughputUL',
case when nr.NRARFCN>0 then (nr.NRARFCN) else LTEmeas.EARFCN end as 'EARFCN',
ROUND(AVG(nr.RSRP),2) AS 'NR_RSRP',
ROUND(AVG(nr.SINR),2) AS 'NR_SINR'

INTO BI_5G_CAP_USAGE

from Sessions	Join FileList On(Sessions.FileId=FileList.FileId)
		LEFT Join TestInfo On(Sessions.SessionId=TestInfo.SessionId)
		left join #tempCapaDL_UL tmp On(TestInfo.TestId = tmp.TestId)  --On(testinfo.SessionId = tmp.SessionId)
		left join FactNR5GRadio nr On(tmp.PosId = nr.PosId)
		left join Position pos On(tmp.PosId = pos.PosId)
		left join LTEMeasurementReport LTEmeas On(tmp.PosId = LTEmeas.PosId)
		left join DmnNR5GCarrierInfo cari on cari.DmnId = nr.DmnIdNR5GCarrierInfo

where Sessions.Valid=1 And
TestInfo.Valid=1 And
(testinfo.TestName like '%Capacity DL%' OR TestInfo.TestName like '%Capacity UL%') AND
ASideLocation like '%Data%' 
AND cari.CarrierIndexName LIKE 'P%'
--AND
--CollectionName = 'CMA_GIANNITSA_MAJOR TOWNS_2024H2'
--and tmp.TestId = '661424963831'
              

group by 
TestInfo.TestName,
tmp.PosId,
tmp.TestId,
nr.NRARFCN,
LTEmeas.EARFCN,
tmp.ThroughputDL,
tmp.ThroughputUL,
FileList.ASideLocation,
Filelist.CollectionName,
tmp.SessionId,
pos.latitude,
pos.longitude



drop table #tempCapaDL_UL
--DROP TABLE BI_5G_CAP_USAGE