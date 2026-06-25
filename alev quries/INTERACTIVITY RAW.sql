Select TestInfo.TestId,
		Sessions.SessionId,
		HomeOperator,
		FileList.ASideLocation,
		FileList.CollectionName,
		technology,
                
                CASE
			WHEN ErrorCode  = 0	THEN	'Successful'
			ELSE				'Failed'
		END AS ErrorCode,
		
		PatternName,
		Connectivity,
		PacketsSent,
		PacketsNotSent,
		PacketsLost,
		PacketsLostRate,
		Throughput,
		ThroughputKbps,
		RTT10thPercentile,
		RTTMedian as RTTAverage,
		PacketDelayVarMedian as PacketDelayMedian,
		TestInfo.duration as Duration,
		qualityIndication as QualityIndex,
		FactInteractivity.QoEScore 
                
                

from Sessions
INNER JOIN NetworkInfo ON NetworkInfo.NetworkId = Sessions.NetworkId
INNER JOIN FactInteractivity ON FactInteractivity.SessionId = Sessions.SessionId
INNER JOIN Testinfo ON TestInfo.TestId = FactInteractivity.TestId and	TestInfo.Valid = 1
INNER JOIN FileList ON FileList.FileId = Sessions.FileId
INNER JOIN DmnInteractivity on DmnInteractivity.DmnId = FactInteractivity.DmnIdInteractivity
where CollectionName like '%%' AND Sessions.Valid = 1
