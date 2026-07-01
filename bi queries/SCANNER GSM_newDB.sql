SELECT 
	CASE
		WHEN DmnOperator.NetworkName LIKE '%COSMOTE%' THEN 'COSMOTE'
		WHEN DmnOperator.NetworkName LIKE '%Vodafone%' THEN 'VODAFONE'
		WHEN DmnOperator.NetworkName LIKE '%NOVA%' THEN 'NOVA'
		ELSE 'OTHER'
	END AS 'operator',

    CASE 
        WHEN FGSM.BCCH BETWEEN 0 AND 124 THEN 'GSM 900'
        WHEN FGSM.BCCH BETWEEN 975 AND 1023 THEN 'GSM 900'
        WHEN FGSM.BCCH BETWEEN 512 AND 586 THEN 'GSM 1800'
        WHEN FGSM.BCCH BETWEEN 586 AND 710 THEN 'GSM 1800'
        WHEN FGSM.BCCH BETWEEN 811 AND 885 THEN 'GSM 1800'
		WHEN FGSM.BCCH BETWEEN 711 AND 716 THEN 'GSM 1800'
        ELSE 'OTHER'
    END AS 'Band',
    FGSM.BCCH AS 'TopChn',
    
    COUNT(CASE WHEN RxLev < -105 THEN 1 END) AS 'No coverage GSM',
    COUNT(CASE WHEN RxLev >= -105 AND RxLev < -95 THEN 1 END) AS 'Poor GSM',
    COUNT(CASE WHEN RxLev >= -95 AND RxLev < -85 THEN 1 END) AS 'Fair GSM',
    COUNT(CASE WHEN RxLev >= -85 AND RxLev < -75 THEN 1 END) AS 'Good GSM',
    COUNT(CASE WHEN RxLev >= -75 THEN 1 END) AS 'Excelent GSM',

    DmnFile.CollectionName AS 'collectionname',
	DmnOperator.CountryCode,
	DmnOperator.MCC,
	DmnOperator.MNC		
 into BI_SCANNER_GSM

FROM [FactGSMScanner] FGSM
JOIN DmnOperator ON FGSM.DmnIdOperator = DmnOperator.DmnId
JOIN DmnFile ON FGSM.DmnIdFile = DmnFile.DmnId 

GROUP BY 
    DmnFile.CollectionName,
    DmnOperator.NetworkName,
    FGSM.BCCH,
	DmnOperator.CountryCode,
	DmnOperator.MCC,
	DmnOperator.MNC	
