IF OBJECT_ID('dbo.SCANNER_LTE_RSRP_RSRQ_S', 'U') IS NOT NULL DROP TABLE dbo.SCANNER_LTE_RSRP_RSRQ_S
IF OBJECT_ID('dbo.#Operators_LTE', 'U') IS NOT NULL DROP TABLE dbo.#Operators_LTE

CREATE TABLE #Operators_LTE
(
	Display VARCHAR(10),
	Channel VARCHAR(10)
);

INSERT INTO #Operators_LTE VALUES
('Cosmote','1650'),
('Cosmote','1675'),
('Cosmote','1700'),
('Cosmote','3050'),
('Cosmote','3200'),
('Cosmote','6400'),
('Cosmote','6363'),
('Cosmote','37900'),
('Cosmote','1844'),
('Cosmote','1871'),
('Cosmote','3500'),
('Cosmote','3194'),
('Cosmote','525'),
('Cosmote','500'),

('Vodafone','1426'),
('Vodafone','1401'),
('Vodafone','1451'),
('Vodafone','2850'),
('Vodafone','6300'),
('Vodafone','3724'),
('Vodafone','3701'),
('Vodafone','38100'),
('Vodafone','6290'),
('Vodafone','51'),
('Vodafone','53'),
('Vodafone','150'),
('Vodafone','75'),
('Vodafone','50'),
('Vodafone','100'),
('Vodafone','9360'),
--('Vodafone','700'),


('Wind','1326'),
('Wind','9260'),
('Wind','3350'),
('Wind','6200'),
('Wind','1301'),
('Wind','1251'),
('Wind','1276'),
('Wind','351'),
('Wind','325'),
('Wind','300'),
('Wind','350')



Select --Sessions.SessionId,   
--Round(Convert(float, RSRQ), 3) AS 'RSRQ',
--Round(Convert(float, RSRP), 3) AS 'RSRP',
--Round(Convert(float, CINR), 3) AS 'CINR',
[FactLTEScanner].EARFCN,

count (case when [FactLTEScanner].RSRP < -120 then '1' end) as 'No coverage RSRP',
count (case when [FactLTEScanner].RSRP >= -120 and [FactLTEScanner].RSRP < -110 then '1' end) as 'Poor RSRP',
count (case when [FactLTEScanner].RSRP >= -110 and [FactLTEScanner].RSRP < -100 then '1' end) as 'Fair RSRP',
count (case when [FactLTEScanner].RSRP >= -100 and [FactLTEScanner].RSRP < -85 then '1' end) as 'Good RSRP',
count (case when [FactLTEScanner].RSRP >= -85 and [FactLTEScanner].RSRP <= -1 then '1' end) as 'Excelent RSRP',

count (case when [FactLTEScanner].SINR < -5 then '1' end) as 'No coverage SINR',
count (case when [FactLTEScanner].SINR >= -5 and [FactLTEScanner].SINR < 5 then '1' end ) as 'Poor SINR',
count (case when [FactLTEScanner].SINR >= 5 and [FactLTEScanner].SINR < 10 then '1' end ) as 'fair SINR',
count (case when [FactLTEScanner].SINR >= 10 and [FactLTEScanner].SINR < 20 then '1' end ) as 'Good SINR',
count (case when [FactLTEScanner].SINR >= 20 and [FactLTEScanner].SINR < 50 then '1' end ) as 'Excelent SINR',


#Operators_LTE.Display as 'Operator',
filelist.collectionname
--Scope='2019 H2'
INTO BI_SCANNER_LTE


from vSessionsTechnologyAll Sessions
JOIN FileList ON FileList.FileId = Sessions.FileId
JOIN NetworkInfo ON Networkinfo.NetworkId = Sessions.NetworkId
join [FactLTEScanner] on [FactLTEScanner].SessionId = Sessions.SessionId
--JOIN vMsgLTEScannerBestRefS ON vMsgLTEScannerBestRefS.SessionId = Sessions.SessionId
JOIN #Operators_LTE on [FactLTEScanner].EARFCN = #Operators_LTE.Channel
where Sessions.Valid = 1
--DROP TABLE dbo.#SCANNER_LTE_RSRP_RSRQ_S
--DROP TABLE BI_SCANNER_LTE

group by 

[FactLTEScanner].EARFCN,
#Operators_LTE.Display,
FileList.CollectionName



DROP TABLE dbo.#Operators_LTE
--drop table BI_SCANNER_LTE

/*
SELECT

a.ltetopnid,
a.operator,
a.channel,
a.rsrp,
a.rsrq,
filelist.collectionname

FROM SCANNER_LTE_RSRP_RSRQ a
left join sessions on (sessions.sessionid = a.sessionid)
left join filelist on (filelist.fileid = sessions.fileid)
ORDER BY LTETopNId
*/