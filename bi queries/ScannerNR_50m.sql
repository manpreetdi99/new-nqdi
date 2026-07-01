/* Script for 50m binning into Scanner Data for 3.5Ghz */
SELECT 
		fl.CollectionName,
		AVG(n.SS_RSRP) as 'Avg_SS-RSRP',
		AVG(n.SS_RSRQ) as 'Avg_SS-RSRQ',
		n.AbsFreqSSB,
		n.DmnIdBinRegionZ9,
		COUNT(n.SS_RSRP) as 'SampleCount',
		bin.BinCenterLatitude,
		bin.BinCenterLongitude

INTO BI_NR_SCANNER_MAP_50

FROM [FactNR5GScannerBeam] n 
  left join DmnBinRegion bin On bin.DmnId = n.DmnIdBinRegionZ9 --50m
  left join FileList fl ON fl.FileId = n.FileId

where DmnIdTopN_SS_RSRP = 1 and AbsFreqSSB like '6%'

group by
		fl.CollectionName,
		n.AbsFreqSSB,
		n.DmnIdBinRegionZ9,
		bin.BinCenterLatitude,
		bin.BinCenterLongitude

ORDER BY n.DmnIdBinRegionZ9 asc