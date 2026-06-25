-- ==================================================HTTPSBrowserData=======================================================


SELECT
TestInfo.testname as 'Collection Name', 
FileList.ASideLocation, 
NetworkInfo.Operator as 'Serving Operator', 
KPIStatus as 'Status', 
COUNT(KPIStatus) as 'Num', 
Round(AVG(Convert(float, vResultsKPI.Duration*0.001)) * COUNT(vResultsKPI.Duration*0.001), 3) as 'Avg', 
Round(MIN(Convert(float, vResultsKPI.Duration*0.001)), 3) As 'MinVal', 
Round(MAX(Convert(float, vResultsKPI.Duration*0.001)), 3) As 'MaxVal', 
Round(STDEV(Convert(float, vResultsKPI.Duration*0.001)), 3) As 'StdVal', 
vResultsKPI.Value5 As 'URL'
FROM
Sessions
JOIN FileList ON FileList.FileId = Sessions.FileId
JOIN NetworkInfo ON NetworkInfo.NetworkId = Sessions.NetworkId
JOIN vResultsKPI ON vResultsKPI.SessionId = Sessions.SessionId and vResultsKPI.KPIID = 20404
JOIN Testinfo ON TestInfo.TestId = vResultsKPI.TestId and 
     TestInfo.Valid = 1
WHERE CollectionName like '%%' AND vResultsKPI.Value5 IS NOT NULL AND
Sessions.Valid = 1
GROUP BY
TestInfo.testname, 
FileList.ASideLocation, 
NetworkInfo.Operator, 
KPIStatus, 
Value5