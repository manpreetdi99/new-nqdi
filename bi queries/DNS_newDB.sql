Select Sessions.SessionId, 
testinfo.TestId, 
TestInfo.TestName,
NetworkInfo.Operator as 'Serving Operator', 
NetworkInfo.HomeOperator as 'Home Operator', 
Sessions.Technology, 
FileList.ASideLocation, 
FileList.ASideDevice, 
Convert(varchar, Sessions.StartTime, 104) as 'msgDate', 
Convert(varchar, Sessions.StartTime, 108) as 'msgTime', 
FileList.CollectionName, 
vResultsKPI.KPIStatus,
FileList.TestDescription, 
FileList.Zone, 
Round(Convert(float, vResultsKPI.Duration), 3) as DNS_TIME

into #TEMP_BI_DNS

from vSessionsTechnologyAll Sessions
JOIN FileList ON FileList.FileId = Sessions.FileId
JOIN NetworkInfo ON Networkinfo.NetworkId = Sessions.NetworkId
JOIN vResultsKPI ON vResultsKPI.SessionId = Sessions.SessionId and vResultsKPI.KPIID = 31100
join TestInfo on TestInfo.TestId=vResultsKPI.TestId


where Sessions.Valid = 1 and ASideLocation in ('Wind Data','Cosmote Data','Vodafone Data','Nova Data') and vResultsKPI.Duration>0

--AND (CollectionName LIKE 'THR%' OR
--CollectionName LIKE 'EMA%' OR
--CollectionName LIKE 'CMA%' OR
--CollectionName LIKE 'WMA%' OR
--CollectionName LIKE 'ATH%' OR
--CollectionName LIKE 'STR%')
 
--AND TestName LIKE '%Cap%' --and vResultsKPI.TestId =146028888084


order by TestId



SELECT 
	[Home Operator],
    CollectionName,
	ASideLocation,
	TestName,
    COUNT(KPIStatus) AS TotalDNSAttempts,
    SUM(CASE WHEN KPIStatus = 'Successful' THEN 1 ELSE 0 END) AS SuccessDNSTests,
    AVG(CASE WHEN KPIStatus = 'Successful' THEN CAST(DNS_TIME AS FLOAT) END ) AS Avg_DNS_TIME,
    MIN(CASE WHEN KPIStatus = 'Successful' THEN CAST(DNS_TIME AS FLOAT) END) AS Min_DNS_TIME,
	MAX(CASE WHEN KPIStatus = 'Successful' THEN CAST(DNS_TIME AS FLOAT) END) AS Max_DNS_TIME


INTO BI_DNS_NEW   
FROM 
    #TEMP_BI_DNS
GROUP BY 
    CollectionName,
	[Home Operator],
	TestName,
	ASideLocation


drop table #TEMP_BI_DNS
--DROP TABLE BI_DNS_NEW