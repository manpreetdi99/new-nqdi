-- ==================================================HTTPSThrptData=======================================================


SELECT
TestInfo.testname as 'Collection Name', 
FileList.ASideLocation, 
NetworkInfo.Operator as 'Serving Operator', 
KPIStatus as 'Status', 
COUNT(KPIStatus) as 'Num', 
Round(AVG(Convert(float, vResultsKPI.value1*0.008)) * COUNT(vResultsKPI.value1*0.008), 3) as 'Avg', 
Round(MIN(Convert(float, vResultsKPI.value1*0.008)), 3) as 'MinVal', 
Round(MAX(Convert(float, vResultsKPI.value1*0.008)), 3) as 'MaxVal', 
Round(STDEV(Convert(float, vResultsKPI.value1*0.008)), 3) as 'StdVal', 
' ' AS 'Percentile', 
vResultsKPI.Value5 as 'URL', 
SUM(CASE WHEN vResultsKPI.value1*0.008 >= 0 AND vResultsKPI.value1*0.008 < 8 THEN 1 ELSE 0 END) as 'PDFHTTPSThrpt 0', 
SUM(CASE WHEN vResultsKPI.value1*0.008 >= 8 AND vResultsKPI.value1*0.008 < 16 THEN 1 ELSE 0 END) as 'PDFHTTPSThrpt 1', 
SUM(CASE WHEN vResultsKPI.value1*0.008 >= 16 AND vResultsKPI.value1*0.008 < 24 THEN 1 ELSE 0 END) as 'PDFHTTPSThrpt 2', 
SUM(CASE WHEN vResultsKPI.value1*0.008 >= 24 AND vResultsKPI.value1*0.008 < 32 THEN 1 ELSE 0 END) as 'PDFHTTPSThrpt 3', 
SUM(CASE WHEN vResultsKPI.value1*0.008 >= 32 AND vResultsKPI.value1*0.008 < 40 THEN 1 ELSE 0 END) as 'PDFHTTPSThrpt 4', 
SUM(CASE WHEN vResultsKPI.value1*0.008 >= 40 AND vResultsKPI.value1*0.008 < 48 THEN 1 ELSE 0 END) as 'PDFHTTPSThrpt 5', 
SUM(CASE WHEN vResultsKPI.value1*0.008 >= 48 AND vResultsKPI.value1*0.008 < 56 THEN 1 ELSE 0 END) as 'PDFHTTPSThrpt 6', 
SUM(CASE WHEN vResultsKPI.value1*0.008 >= 56 AND vResultsKPI.value1*0.008 < 64 THEN 1 ELSE 0 END) as 'PDFHTTPSThrpt 7', 
SUM(CASE WHEN vResultsKPI.value1*0.008 >= 64 AND vResultsKPI.value1*0.008 < 72 THEN 1 ELSE 0 END) as 'PDFHTTPSThrpt 8', 
SUM(CASE WHEN vResultsKPI.value1*0.008 >= 72 AND vResultsKPI.value1*0.008 < 80 THEN 1 ELSE 0 END) as 'PDFHTTPSThrpt 9', 
SUM(CASE WHEN vResultsKPI.value1*0.008 >= 80 AND vResultsKPI.value1*0.008 < 88 THEN 1 ELSE 0 END) as 'PDFHTTPSThrpt 10', 
SUM(CASE WHEN vResultsKPI.value1*0.008 >= 88 AND vResultsKPI.value1*0.008 < 96 THEN 1 ELSE 0 END) as 'PDFHTTPSThrpt 11', 
SUM(CASE WHEN vResultsKPI.value1*0.008 >= 96 AND vResultsKPI.value1*0.008 < 104 THEN 1 ELSE 0 END) as 'PDFHTTPSThrpt 12', 
SUM(CASE WHEN vResultsKPI.value1*0.008 >= 104 AND vResultsKPI.value1*0.008 < 112 THEN 1 ELSE 0 END) as 'PDFHTTPSThrpt 13', 
SUM(CASE WHEN vResultsKPI.value1*0.008 >= 112 AND vResultsKPI.value1*0.008 < 120 THEN 1 ELSE 0 END) as 'PDFHTTPSThrpt 14', 
SUM(CASE WHEN vResultsKPI.value1*0.008 >= 120 AND vResultsKPI.value1*0.008 < 128 THEN 1 ELSE 0 END) as 'PDFHTTPSThrpt 15', 
SUM(CASE WHEN vResultsKPI.value1*0.008 >= 128 AND vResultsKPI.value1*0.008 < 136 THEN 1 ELSE 0 END) as 'PDFHTTPSThrpt 16', 
SUM(CASE WHEN vResultsKPI.value1*0.008 >= 136 AND vResultsKPI.value1*0.008 < 144 THEN 1 ELSE 0 END) as 'PDFHTTPSThrpt 17', 
SUM(CASE WHEN vResultsKPI.value1*0.008 >= 144 AND vResultsKPI.value1*0.008 < 152 THEN 1 ELSE 0 END) as 'PDFHTTPSThrpt 18', 
SUM(CASE WHEN vResultsKPI.value1*0.008 >= 152 AND vResultsKPI.value1*0.008 < 160 THEN 1 ELSE 0 END) as 'PDFHTTPSThrpt 19', 
SUM(CASE WHEN vResultsKPI.value1*0.008 >= 160 AND vResultsKPI.value1*0.008 < 168 THEN 1 ELSE 0 END) as 'PDFHTTPSThrpt 20', 
SUM(CASE WHEN vResultsKPI.value1*0.008 >= 168 AND vResultsKPI.value1*0.008 < 176 THEN 1 ELSE 0 END) as 'PDFHTTPSThrpt 21', 
SUM(CASE WHEN vResultsKPI.value1*0.008 >= 176 AND vResultsKPI.value1*0.008 < 184 THEN 1 ELSE 0 END) as 'PDFHTTPSThrpt 22', 
SUM(CASE WHEN vResultsKPI.value1*0.008 >= 184 AND vResultsKPI.value1*0.008 < 192 THEN 1 ELSE 0 END) as 'PDFHTTPSThrpt 23', 
SUM(CASE WHEN vResultsKPI.value1*0.008 >= 192 AND vResultsKPI.value1*0.008 < 200 THEN 1 ELSE 0 END) as 'PDFHTTPSThrpt 24', 
SUM(CASE WHEN vResultsKPI.value1*0.008 >= 200 AND vResultsKPI.value1*0.008 < 208 THEN 1 ELSE 0 END) as 'PDFHTTPSThrpt 25', 
SUM(CASE WHEN vResultsKPI.value1*0.008 >= 208 AND vResultsKPI.value1*0.008 < 216 THEN 1 ELSE 0 END) as 'PDFHTTPSThrpt 26', 
SUM(CASE WHEN vResultsKPI.value1*0.008 >= 216 AND vResultsKPI.value1*0.008 < 224 THEN 1 ELSE 0 END) as 'PDFHTTPSThrpt 27', 
SUM(CASE WHEN vResultsKPI.value1*0.008 >= 224 AND vResultsKPI.value1*0.008 < 232 THEN 1 ELSE 0 END) as 'PDFHTTPSThrpt 28', 
SUM(CASE WHEN vResultsKPI.value1*0.008 >= 232 AND vResultsKPI.value1*0.008 < 240 THEN 1 ELSE 0 END) as 'PDFHTTPSThrpt 29', 
SUM(CASE WHEN vResultsKPI.value1*0.008 >= 240 AND vResultsKPI.value1*0.008 < 248 THEN 1 ELSE 0 END) as 'PDFHTTPSThrpt 30', 
SUM(CASE WHEN vResultsKPI.value1*0.008 >= 248 AND vResultsKPI.value1*0.008 < 256 THEN 1 ELSE 0 END) as 'PDFHTTPSThrpt 31', 
SUM(CASE WHEN vResultsKPI.value1*0.008 >= 256 AND vResultsKPI.value1*0.008 < 264 THEN 1 ELSE 0 END) as 'PDFHTTPSThrpt 32', 
SUM(CASE WHEN vResultsKPI.value1*0.008 >= 264 AND vResultsKPI.value1*0.008 < 272 THEN 1 ELSE 0 END) as 'PDFHTTPSThrpt 33', 
SUM(CASE WHEN vResultsKPI.value1*0.008 >= 272 AND vResultsKPI.value1*0.008 < 280 THEN 1 ELSE 0 END) as 'PDFHTTPSThrpt 34', 
SUM(CASE WHEN vResultsKPI.value1*0.008 >= 280 AND vResultsKPI.value1*0.008 < 288 THEN 1 ELSE 0 END) as 'PDFHTTPSThrpt 35', 
SUM(CASE WHEN vResultsKPI.value1*0.008 >= 288 AND vResultsKPI.value1*0.008 < 296 THEN 1 ELSE 0 END) as 'PDFHTTPSThrpt 36',  
SUM(CASE WHEN vResultsKPI.value1*0.008 >= 296 AND vResultsKPI.value1*0.008 < 304 THEN 1 ELSE 0 END) as 'PDFHTTPSThrpt 37', 
SUM(CASE WHEN vResultsKPI.value1*0.008 >= 304 AND vResultsKPI.value1*0.008 < 312 THEN 1 ELSE 0 END) as 'PDFHTTPSThrpt 38', 
SUM(CASE WHEN vResultsKPI.value1*0.008 >= 312 AND vResultsKPI.value1*0.008 < 320 THEN 1 ELSE 0 END) as 'PDFHTTPSThrpt 39',  
SUM(CASE WHEN vResultsKPI.value1*0.008 >= 320 AND vResultsKPI.value1*0.008 < 328 THEN 1 ELSE 0 END) as 'PDFHTTPSThrpt 40', 
SUM(CASE WHEN vResultsKPI.value1*0.008 >= 328 AND vResultsKPI.value1*0.008 < 336 THEN 1 ELSE 0 END) as 'PDFHTTPSThrpt 41', 
SUM(CASE WHEN vResultsKPI.value1*0.008 >= 336 AND vResultsKPI.value1*0.008 < 344 THEN 1 ELSE 0 END) as 'PDFHTTPSThrpt 42', 
SUM(CASE WHEN vResultsKPI.value1*0.008 >= 344 AND vResultsKPI.value1*0.008 < 352 THEN 1 ELSE 0 END) as 'PDFHTTPSThrpt 43', 
SUM(CASE WHEN vResultsKPI.value1*0.008 >= 352 AND vResultsKPI.value1*0.008 < 360 THEN 1 ELSE 0 END) as 'PDFHTTPSThrpt 44', 
SUM(CASE WHEN vResultsKPI.value1*0.008 >= 360 AND vResultsKPI.value1*0.008 < 368 THEN 1 ELSE 0 END) as 'PDFHTTPSThrpt 45', 
SUM(CASE WHEN vResultsKPI.value1*0.008 >= 368 AND vResultsKPI.value1*0.008 < 376 THEN 1 ELSE 0 END) as 'PDFHTTPSThrpt 46', 
SUM(CASE WHEN vResultsKPI.value1*0.008 >= 376 AND vResultsKPI.value1*0.008 < 384 THEN 1 ELSE 0 END) as 'PDFHTTPSThrpt 47', 
SUM(CASE WHEN vResultsKPI.value1*0.008 >= 384 AND vResultsKPI.value1*0.008 < 392 THEN 1 ELSE 0 END) as 'PDFHTTPSThrpt 48', 
SUM(CASE WHEN vResultsKPI.value1*0.008 >= 392 AND vResultsKPI.value1*0.008 < 400 THEN 1 ELSE 0 END) as 'PDFHTTPSThrpt 49', 
SUM(CASE WHEN vResultsKPI.value1*0.008 >= 400 THEN 1 ELSE 0 END) as 'PDFHTTPSThrpt 50', 
COUNT(vResultsKPI.value1*0.008) AS 'GSum'
FROM
Sessions
JOIN FileList ON FileList.FileId = Sessions.FileId
JOIN NetworkInfo ON NetworkInfo.NetworkId = Sessions.NetworkId
JOIN vResultsKPI ON vResultsKPI.SessionId = Sessions.SessionId and vResultsKPI.KPIID = 30404
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