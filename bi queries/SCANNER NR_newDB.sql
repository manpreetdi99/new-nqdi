
IF OBJECT_ID('dbo.SCANNER_5G_RSRP_RSRQ_C', 'U') IS NOT NULL DROP TABLE dbo.SCANNER_5G_RSRP_RSRQ_C
IF OBJECT_ID('#dbo.Operators_5G', 'U') IS NOT NULL DROP TABLE #dbo.Operators_5G

CREATE TABLE #Operators_5G
(
	Display VARCHAR(10),
	Channel VARCHAR(10)
);

INSERT INTO #Operators_5G VALUES

--('Cosmote','433250'), 
('Cosmote','636666'),
('Cosmote','156510'),
('Cosmote','431070'),
('Cosmote','634080'),
('Cosmote','630720'),
('Cosmote','632064'),

('Vodafone','422856'),
('Vodafone','422870'),
('Vodafone','424856'),
('Vodafone','643322'),
('Vodafone','640608'),
('Vodafone','640680'),
('Vodafone','423130'),
('Vodafone','425080'),
('Vodafone','154090'),

('Wind','428856'),
('Wind','427930'),
('Wind','427730'),
('Wind','422876'),
('Wind','647328'),
('Wind','152210'),
('Wind','156210'),
('Wind','649988')


Select --Sessions.SessionId, 
--FactNR5GScannerBeam.PCI,
--Round(Convert(float, SS_RSRP), 3) AS 'RSRP',  
--Round(Convert(float, SS_RSRQ), 3) AS 'RSRQ',
--FactNR5GScannerBeam.DmnIdTopN_SS_RSRP,
FactNR5GScannerBeam.AbsFreqSSB,

count (case when FactNR5GScannerBeam.SS_RSRP < -120 then '1' end) as 'No coverage RSRP',
count (case when FactNR5GScannerBeam.SS_RSRP >= -120 and FactNR5GScannerBeam.SS_RSRP < -110 then '1' end) as 'Poor RSRP',
count (case when FactNR5GScannerBeam.SS_RSRP >= -110 and FactNR5GScannerBeam.SS_RSRP < -100 then '1' end) as 'Fair RSRP',
count (case when FactNR5GScannerBeam.SS_RSRP >= -100 and FactNR5GScannerBeam.SS_RSRP < -85 then '1' end) as 'Good RSRP',
count (case when FactNR5GScannerBeam.SS_RSRP >= -85 and FactNR5GScannerBeam.SS_RSRP <= -1 then '1' end) as 'Excelent RSRP',

count (case when FactNR5GScannerBeam.SS_SINR < -5 then '1' end) as 'No coverage SINR',
count (case when FactNR5GScannerBeam.SS_SINR >= -5 and FactNR5GScannerBeam.SS_SINR < 5 then '1' end ) as 'Poor SINR',
count (case when FactNR5GScannerBeam.SS_SINR >= 5  and FactNR5GScannerBeam.SS_SINR < 10 then '1' end ) as 'fair SINR',
count (case when FactNR5GScannerBeam.SS_SINR >= 10 and FactNR5GScannerBeam.SS_SINR < 20 then '1' end ) as 'Good SINR',
count (case when FactNR5GScannerBeam.SS_SINR >= 20 and FactNR5GScannerBeam.SS_SINR < 50 then '1' end ) as 'Excelent SINR',


#Operators_5G.Display as 'Operator',
filelist.collectionname
INTO BI_SCANNER_NR


from vSessionsTechnologyAll Sessions
JOIN FileList ON FileList.FileId = Sessions.FileId
JOIN NetworkInfo ON Networkinfo.NetworkId = Sessions.NetworkId
JOIN FactNR5GScannerBeam ON FactNR5GScannerBeam.SessionId = Sessions.SessionId
JOIN #Operators_5G on FactNR5GScannerBeam.AbsFreqSSB = #Operators_5G.Channel
where Sessions.Valid = 1 and FactNR5GScannerBeam.DmnIdTopN_SS_SINR=1 


group by
FactNR5GScannerBeam.AbsFreqSSB,
#Operators_5G.Display,
filelist.collectionname

order by CollectionName

drop table #Operators_5G
--drop table BI_SCANNER_NR