IF OBJECT_ID('tempdb..#TMPRadioTech') IS NOT NULL
   DROP TABLE #TMPRadioTech;


SELECT
        Sessions.FileId,
        FileList.ASideLocation,
        Sessions.SessionId,
        NetworkInfo.MsgTime,
        FileList.ASideDevice,
        NetworkInfo.Technology,
        FileList.CollectionName,
        NetworkInfo.NetworkId,
      --  CallSession.callDir AS CallDirection,
        CallSession.callType AS CallType

INTO #TMPRadioTech

FROM Sessions AS Sessions

INNER JOIN FileList
    ON Sessions.FileId = FileList.FileId

INNER JOIN Position
    ON Sessions.SessionId = Position.SessionId

INNER JOIN NetworkInfo
    ON NetworkInfo.NetworkId =
    (
        SELECT MAX(tech_2.NetworkId)
        FROM NetworkInfo tech_2
        WHERE tech_2.FileId = Position.FileID
          AND tech_2.MsgTime < Position.MsgTime
    )

INNER JOIN CallSession
    ON CallSession.SessionId = Sessions.SessionId

WHERE Sessions.Valid = 1
  AND FileList.ASideLocation NOT LIKE '%DATA%'
  AND FileList.ASideDevice NOT LIKE '%Scanner%'
  AND CallSession.callDir IN ('A->B', 'B->A');


SELECT 
    #TMPRadioTech.ASideLocation,
    #TMPRadioTech.CollectionName,
 --   #TMPRadioTech.CallDirection,
   

    COUNT(CASE 
            WHEN #TMPRadioTech.Technology = 'GSM 1800'
              OR #TMPRadioTech.Technology = 'GSM 1900'
            THEN 1 
          END) * 100.0 / COUNT(#TMPRadioTech.Technology) AS [GSM_1800_Perc],

    COUNT(CASE 
            WHEN #TMPRadioTech.Technology = 'GSM 1800'
              OR #TMPRadioTech.Technology = 'GSM 1900'
            THEN 1 
          END) AS [GSM_1800_Samples],

    COUNT(CASE 
            WHEN #TMPRadioTech.Technology = 'GSM 900'
            THEN 1 
          END) * 100.0 / COUNT(#TMPRadioTech.Technology) AS [GSM_900_Perc],

    COUNT(CASE 
            WHEN #TMPRadioTech.Technology = 'GSM 900'
            THEN 1 
          END) AS [GSM_900_Samples],

    COUNT(CASE 
            WHEN #TMPRadioTech.Technology = 'GSM 900'
            THEN 1 
          END)
    +
    COUNT(CASE 
            WHEN #TMPRadioTech.Technology = 'GSM 1800'
              OR #TMPRadioTech.Technology = 'GSM 1900'
            THEN 1 
          END) AS [GSM_Total_Samples],


    COUNT(CASE 
            WHEN #TMPRadioTech.Technology = 'UMTS 2100'
              OR #TMPRadioTech.Technology = 'UMTS 1700'
            THEN 1 
          END) * 100.0 / COUNT(#TMPRadioTech.Technology) AS [UMTS_2100_Perc],

    COUNT(CASE 
            WHEN #TMPRadioTech.Technology = 'UMTS 2100'
              OR #TMPRadioTech.Technology = 'UMTS 1700'
            THEN 1 
          END) AS [UMTS_2100_Samples],

    COUNT(CASE 
            WHEN #TMPRadioTech.Technology = 'UMTS 900'
            THEN 1 
          END) * 100.0 / COUNT(#TMPRadioTech.Technology) AS [UMTS_900_Perc],

    COUNT(CASE 
            WHEN #TMPRadioTech.Technology = 'UMTS 900'
            THEN 1 
          END) AS [UMTS_900_Samples],

    COUNT(CASE 
            WHEN #TMPRadioTech.Technology = 'UMTS 2100'
              OR #TMPRadioTech.Technology = 'UMTS 1700'
            THEN 1 
          END)
    +
    COUNT(CASE 
            WHEN #TMPRadioTech.Technology = 'UMTS 900'
            THEN 1 
          END) AS [UMTS_Total_Samples],


    COUNT(CASE 
            WHEN #TMPRadioTech.Technology = 'LTE E-UTRA 1'
            THEN 1 
          END) * 100.0 / COUNT(#TMPRadioTech.Technology) AS [LTE B1_Perc],

    COUNT(CASE 
            WHEN #TMPRadioTech.Technology = 'LTE E-UTRA 1'
            THEN 1 
          END) AS [LTE B1_Samples],


    COUNT(CASE 
            WHEN #TMPRadioTech.Technology = 'LTE E-UTRA 3'
            THEN 1 
          END) * 100.0 / COUNT(#TMPRadioTech.Technology) AS [LTE B3_Perc],

    COUNT(CASE 
            WHEN #TMPRadioTech.Technology = 'LTE E-UTRA 3'
            THEN 1 
          END) AS [LTE B3_Samples],


    COUNT(CASE 
            WHEN #TMPRadioTech.Technology = 'LTE E-UTRA 7'
            THEN 1 
          END) * 100.0 / COUNT(#TMPRadioTech.Technology) AS [LTE B7_Perc],

    COUNT(CASE 
            WHEN #TMPRadioTech.Technology = 'LTE E-UTRA 7'
            THEN 1 
          END) AS [LTE B7_Samples],


    COUNT(CASE 
            WHEN #TMPRadioTech.Technology = 'LTE E-UTRA 8'
            THEN 1 
          END) * 100.0 / COUNT(#TMPRadioTech.Technology) AS [LTE B8_Perc],

    COUNT(CASE 
            WHEN #TMPRadioTech.Technology = 'LTE E-UTRA 8'
            THEN 1 
          END) AS [LTE B8_Samples],


    COUNT(CASE 
            WHEN #TMPRadioTech.Technology = 'LTE E-UTRA 20'
            THEN 1 
          END) * 100.0 / COUNT(#TMPRadioTech.Technology) AS [LTE B20_Perc],

    COUNT(CASE 
            WHEN #TMPRadioTech.Technology = 'LTE E-UTRA 20'
            THEN 1 
          END) AS [LTE B20_Samples],


    COUNT(CASE 
            WHEN #TMPRadioTech.Technology = 'LTE E-UTRA 28'
            THEN 1 
          END) * 100.0 / COUNT(#TMPRadioTech.Technology) AS [LTE B28_Perc],

    COUNT(CASE 
            WHEN #TMPRadioTech.Technology = 'LTE E-UTRA 28'
            THEN 1 
          END) AS [LTE B28_Samples],


    COUNT(CASE 
            WHEN #TMPRadioTech.Technology = 'LTE E-UTRA 1'
            THEN 1 
          END)
    +
    COUNT(CASE 
            WHEN #TMPRadioTech.Technology = 'LTE E-UTRA 3'
            THEN 1 
          END)
    +
    COUNT(CASE 
            WHEN #TMPRadioTech.Technology = 'LTE E-UTRA 7'
            THEN 1 
          END)
    +
    COUNT(CASE 
            WHEN #TMPRadioTech.Technology = 'LTE E-UTRA 8'
            THEN 1 
          END)
    +
    COUNT(CASE 
            WHEN #TMPRadioTech.Technology = 'LTE E-UTRA 20'
            THEN 1 
          END)
    +
    COUNT(CASE 
            WHEN #TMPRadioTech.Technology = 'LTE E-UTRA 28'
            THEN 1 
          END) AS [LTE_Total_Samples],


       COUNT(#TMPRadioTech.Technology) AS [Total_Samples],

    #TMPRadioTech.CallType AS [CallType]

INTO BI_RADIO_TECH

FROM #TMPRadioTech

GROUP BY  
    #TMPRadioTech.ASideLocation,
    #TMPRadioTech.CollectionName,
  --  #TMPRadioTech.CallDirection,
    #TMPRadioTech.CallType

ORDER BY 
    #TMPRadioTech.CollectionName,
    #TMPRadioTech.ASideLocation,
   -- #TMPRadioTech.CallDirection,
    #TMPRadioTech.CallType;


DROP TABLE #TMPRadioTech;

--DROP TABLE BI_RADIO_TECH;