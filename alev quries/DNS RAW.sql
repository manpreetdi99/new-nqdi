Select FileList.ASideLocation, 
KPIStatus AS 'Status', 
COUNT(KPIStatus) AS 'Num', 
Round(AVG(Convert(float, vResultsKPI.Duration)) * COUNT(vResultsKPI.Duration), 3) AS 'Avg', 
Round(MIN(Convert(float, vResultsKPI.Duration)), 3) AS 'MinVal', 
Round(MAX(Convert(float, vResultsKPI.Duration)), 3) AS 'MaxVal', 
Round(STDEV(Convert(float, vResultsKPI.Duration)), 3) AS 'StdVal'

from Sessions
JOIN FileList ON FileList.FileId = Sessions.FileId
JOIN vResultsKPI ON vResultsKPI.SessionId = Sessions.SessionId and vResultsKPI.KPIID = 31100
where CollectionName like '%%' AND Sessions.Valid = 1 AND ASideLocation like '%Data'
group by FileList.ASideLocation, 
KPIStatus