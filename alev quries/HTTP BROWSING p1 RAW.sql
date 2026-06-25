Select TestInfo.testname  As 'Collection Name', 
FileList.ASideLocation, 
NetworkInfo.Operator As 'Serving Operator',
KPIStatus As 'Status', 
COUNT(KPIStatus) As 'Num',
Round(AVG(Convert(float, vResultsKPI.Duration*0.001)) * COUNT(vResultsKPI.Duration*0.001), 3) As 'Avg',
Round(MIN(Convert(float, vResultsKPI.Duration*0.001)), 3) As 'MinVal',
Round(MAX(Convert(float, vResultsKPI.Duration*0.001)), 3) As 'MaxVal',
Round(STDEV(Convert(float, vResultsKPI.Duration*0.001)), 3) As 'StdVal',
vResultsKPI.Value5 As 'URL'
from Sessions
JOIN FileList ON FileList.FileId = Sessions.FileId
JOIN NetworkInfo ON NetworkInfo.NetworkId = Sessions.NetworkId
JOIN vResultsKPI ON vResultsKPI.SessionId = Sessions.SessionId and vResultsKPI.KPIID = 10410
JOIN Testinfo ON TestInfo.TestId = vResultsKPI.TestId and 
     TestInfo.Valid = 1
where CollectionName like '%%' AND Sessions.Valid = 1
group by TestInfo.testname, 
FileList.ASideLocation, 
NetworkInfo.Operator, 
KPIStatus, 
Value5