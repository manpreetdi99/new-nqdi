/* Script for 50m binning into Scanner Data for 3.5Ghz */
SELECT 
		fl.CollectionName,
		AVG(n.SS_RSRP) as 'Avg_SS-RSRP',
		AVG(n.SS_RSRQ) as 'Avg_SS-RSRQ',
		n.AbsFreqSSB,
		COUNT(n.SS_RSRP) as 'SampleCount',
		n.DmnIdBinRegionZ8,
		bin.BinCenterLatitude,
		bin.BinCenterLongitude

into BI_NR_SCANNER_MAP_500

  FROM [FactNR5GScannerBeam] n 
  left join DmnBinRegion bin On bin.DmnId = n.DmnIdBinRegionZ8 --500m
  left join FileList fl ON fl.FileId = n.FileId

  where DmnIdTopN_SS_RSRP = 1 and AbsFreqSSB like '6%'

  group by
		fl.CollectionName,
		n.AbsFreqSSB,
		n.DmnIdBinRegionZ8,
		bin.BinCenterLatitude,
		bin.BinCenterLongitude

ORDER BY n.DmnIdBinRegionZ8 asc