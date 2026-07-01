
------------------------------------ Create Temporary Table with required raw data -----------------------------------
SELECT	TestInfo.TestId,
		Sessions.SessionId,
		HomeOperator,																			--Home operator is different from serving operator in the case of NO SIGNAL (Emergency State )
		FileList.ASideLocation,
		FileList.CollectionName,
		technology,
		ErrorCode,																				--If ErrorCode == 0, then test is successful, else it failed
		PatternName,
		Connectivity,																			--The connectivity is a single value, expressing the quota of valid packets that have arrived
																								--in time compared to the maximum allowed packet error rate (PER) for a given traffic pattern
																								--(application) (range 0…1).
		PacketsSent,
		PacketsNotSent,																			--Packet not sent due to phone failure
		PacketsLost,																			--Packet lost due to network failure
		PacketsLostRate,
		Throughput,
		ThroughputKbps,
		RTT10thPercentile,
		RTTMedian as RTTAverage,																--Median and Average are equivalent
		PacketDelayVarMedian as PacketDelayMedian,
		TestInfo.duration as Duration,
		qualityIndication as QualityIndex,
		FactInteractivity.QoEScore,

		CASE
			WHEN ErrorCode  = 0	THEN	'Successful'
			ELSE							'Failed'
		END AS Status

INTO #TMP_Interactivity																			--Temporary Table

FROM Sessions																					--All session Info

INNER JOIN NetworkInfo ON NetworkInfo.NetworkId = Sessions.NetworkId							--Network Info

INNER JOIN FactInteractivity ON FactInteractivity.SessionId = Sessions.SessionId				--SessionInfo of Interactivity Tests

INNER JOIN Testinfo ON TestInfo.TestId = FactInteractivity.TestId								--Info about only Valid Interactivity Tests
					and	TestInfo.Valid = 1

INNER JOIN FileList ON FileList.FileId = Sessions.FileId										--Info about Measurement File with foreign key FileId

INNER JOIN DmnInteractivity on DmnInteractivity.DmnId = FactInteractivity.DmnIdInteractivity	--Dimension Table of Smart Analytics with interactivity Info

WHERE Sessions.Valid = 1																		--Take into account only valid measurements
--and ErrorCode != 0;																			--Check Failed Tests

----------------------------------------- End of Temporary Table -----------------------------------------------------------

----------------------------------------- Create table BI_Interactivity ----------------------------------------------------

--SELECT *	FROM #TMP_Interactivity;															--Sanity Check

SELECT	tmp.HomeOperator,
		tmp.ASideLocation,
		tmp.CollectionName,
		tmp.PatternName,
		

		SUM(tmp.PacketsSent)		AS SumPacketsSent,
		SUM(tmp.PacketsNotSent)		AS PacketsNotSent,
		SUM(tmp.PacketsLost)		AS PacketsLost,
		
		AVG(tmp.PacketsLostRate)	AS AVGPacketsLostRate,
		AVG(tmp.Throughput)			AS AvgThroughput,
		AVG(tmp.ThroughputKbps)		AS AvgThroughputKbps,
		AVG(tmp.RTT10thPercentile)	AS AVGRTT10THPercentile,
		AVG(tmp.RTTAverage)			AS AVGRTT,
		AVG(tmp.PacketDelayMedian)	AS AVGDelay,
		AVG(tmp.Duration)			AS AVGDuration,
		COUNT(CASE WHEN tmp.Status = 'Successful' THEN 1 ELSE NULL END) AS Succ_Count,
		COUNT(CASE WHEN tmp.Status = 'Failed' THEN 1 ELSE NULL END) AS Fail_Count,
		AVG(tmp.QoEScore) as 'QoEScore'
		--tmp.Status
		
		--CASE
			--WHEN tmp.ErrorCode  = 0	THEN	'Successful'
			--ELSE							'Failed'
		--END AS Status

INTO BI_INTERACTIVITY																			--Create new Table. To be copied to BI_DATA	

FROM #TMP_Interactivity AS tmp


--where CollectionName LIKE 'THR%' OR
--CollectionName LIKE 'EMA%' OR
--CollectionName LIKE 'CMA%' OR
--CollectionName LIKE 'WMA%' OR
--CollectionName LIKE 'ATH%' OR
--CollectionName LIKE 'STR%' 
--WHERE tmp.ErrorCode != 0																		--Filter Failed records for debugging

GROUP BY	tmp.HomeOperator,
			tmp.ASideLocation,
			tmp.CollectionName,
			tmp.PatternName,
			tmp.Status
			
ORDER BY tmp.HomeOperator;
----------------------------------------- End of BI_Interactivity ---------------------------------------------------------

--SELECT *	FROM BI_INTERACTIVITY;																--Sanity Check


----------------------------------------- Memory Cleaning ------------------------------------------------------------------

DROP TABLE #TMP_Interactivity;	--Clear temporary table
--DROP TABLE BI_INTERACTIVITY;	--Clear LOCAL BI associated table

----------------------------------------- End of Memory Cleaning -----------------------------------------------------------