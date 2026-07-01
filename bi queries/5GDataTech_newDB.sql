SELECT 	FL.ASideLocation,
		FL.CollectionName  AS STR_ID,
			-- 1st part: Before the 1st "_"
			  LEFT(FL.CollectionName, CHARINDEX('_', FL.CollectionName) - 1) AS 'Greater Area',

			-- 2nd part: Between 1st and 2nd "_"
			CAST(
			  SUBSTRING(
				FL.CollectionName,
				CHARINDEX('_', FL.CollectionName) + 1,
				CHARINDEX('_', FL.CollectionName, CHARINDEX('_', FL.CollectionName) + 1) - CHARINDEX('_', FL.CollectionName) - 1
				)AS VARCHAR(MAX)
			 )AS CollectionName,

			-- 3rd part: Between 2nd and 3rd "_"
			  SUBSTRING(
				FL.CollectionName,
				CHARINDEX('_', FL.CollectionName, CHARINDEX('_', FL.CollectionName) + 1) + 1,
				CHARINDEX('_', FL.CollectionName, CHARINDEX('_', FL.CollectionName,
				CHARINDEX('_', FL.CollectionName) + 1) + 1) - CHARINDEX('_', FL.CollectionName, CHARINDEX('_', FL.CollectionName) + 1) - 1)
			   AS Category,

			-- 4th part: After the last "_"
			  RIGHT(
				FL.CollectionName,
				LEN(FL.CollectionName) - CHARINDEX('_', FL.CollectionName, CHARINDEX('_', FL.CollectionName, CHARINDEX('_', FL.CollectionName) + 1) + 1))
			   AS Scope,
		[Duration],
		DmnDataTechnology.DataTechnologyReporting,
		DCI.DL_NRARFCN,
		DT.TestName,
		DMO.Provider as 'Home Operator'
	
	INTO BI_NR_DATA

FROM FactDataTechnology FDT
LEFT JOIN [DmnDataTechnology] ON FDT.DmnIdDataTechnology = DmnDataTechnology.DmnId
LEFT JOIN BridgeFactDataTechnologyDmnCellInformation BrFDTdCI ON FDT.FactId = BrFDTdCI.FactId
LEFT JOIN DmnCellInformation DCI ON BrFDTdCI.DmnId = DCI.DmnId
LEFT JOIN FileList FL ON FL.FileId = FDT.FileId
LEFT JOIN DmnOperator DMO ON DMO.DmnId = FDT.DmnIdOperator
LEFT JOIN DmnTest DT ON DT.TestId =	FDT.TestId

WHERE FL.ASideLocation LIKE '%Data' and dt.Valid = 'Valid'
and DT.TestName NOT IN ('Interactivity', 'Payload Ping', 'ICMP Ping 40', 'ICMP Ping 800')

