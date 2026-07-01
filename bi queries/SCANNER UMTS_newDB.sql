Select distinct MSGWCDMAScannerTopCh.MCC, MSGWCDMAScannerTopCh.MNC, MSGWCDMAScannerTopCh.Channel, Operators.Display
into #Operators1
From dbo.MSGWCDMAScannerTopCh 
Join dbo.Operators On(MSGWCDMAScannerTopCh.MCC=Operators.MCC and MSGWCDMAScannerTopCh.MNC=Operators.MNC)

SELECT
	Info.SessionId,
	Info.WPilotId,
	Info.Channel,
	Info.IO as 'RSSI',
	Info.IO + Pilot.EcIoData as 'MaxCPICHRSCP',
	Pilot.EcIoData as 'MaxCPICHEcNo',
	Pilot.Number as 'PSCMaxCPICH'
INTO #M_RSCP_ECNO
FROM MsgWCDMAScannerPilotInfo info 
JOIN MsgWCDMAScannerPilot pilot ON info.WPilotId = pilot.WPilotId
where pilot.MCC = 202

select 
	M.sessionid,
	M.WPilotId,
	F.CollectionName,
	CONVERT(VARCHAR,Display)+' '+CONVERT(VARCHAR,M.channel) AS 'OP_CH',
	CONVERT(VARCHAR,Display) as HomeOperetor,
	CONVERT(VARCHAR,M.channel) as Carrier ,
	max(MaxCPICHRSCP) AS 'RSCP',
	max(MaxCPICHEcNo) AS'EcNo'
INTO #TMM_RSCP_ECNO
from #M_RSCP_ECNO M
LEFT JOIN Sessions s ON s.sessionid = M.SessionId
LEFT JOIN Filelist f ON f.fileid = s.fileid
LEFT JOIN #Operators1 o ON o.Channel = M.Channel

 --where OP_CH in ('Cosmote 10764','Cosmote 10739','Cosmote 10714','Cosmote 2938','Vodafone 10614','Vodafone 10589','Vodafone 10564','Vodafone 10639','Vodafone 3062','Wind 10664','Wind 10689')


group by WPilotId,M.Channel,M.sessionid,display,CollectionName
order by Sessionid,WpilotId

DROP TABLE #Operators1
DROP TABLE #M_RSCP_ECNO


	Select 
	     #TMM_RSCP_ECNO.HomeOperetor,
	     #TMM_RSCP_ECNO.Carrier,
		 #TMM_RSCP_ECNO.OP_CH,
		 #TMM_RSCP_ECNO.Collectionname,
		
		count (case when #TMM_RSCP_ECNO.RSCP < -115 then '1' end ) as 'No coverage RSCP',
		count (case when #TMM_RSCP_ECNO.RSCP >= -115 and  #TMM_RSCP_ECNO.RSCP < -105 then '1' end) as 'Poor RSCP',
		count (case when #TMM_RSCP_ECNO.RSCP >= -105 and  #TMM_RSCP_ECNO.RSCP < -95 then '1' end) as 'Fair RSCP',
		count (case when #TMM_RSCP_ECNO.RSCP >= -95 and   #TMM_RSCP_ECNO.RSCP < -80 then '1' end) as 'Good RSCP',
		count (case when #TMM_RSCP_ECNO.RSCP >= -80 then '1' end) as 'Excelent RSCP',

		count (case when #TMM_RSCP_ECNO.ECNO <-18 then '1' end ) as 'No coverage ECNO',
		count (case when #TMM_RSCP_ECNO.ECNO >= -18 and #TMM_RSCP_ECNO.ECNO <-15 then '1' end) as 'Poor ECNO',
		count (case when #TMM_RSCP_ECNO.ECNO >= -15 and #TMM_RSCP_ECNO.ECNO <-12 then '1' end) as 'Fair ECNO',
		count (case when #TMM_RSCP_ECNO.ECNO >= -12 and #TMM_RSCP_ECNO.ECNO <-8 then '1' end) as 'Good ECNO',
		count (case when #TMM_RSCP_ECNO.ECNO >= -8 then '1' end) as 'Excelent ECNO'


		--#TMM_RSCP_ECNO.RSCP,
	    --#TMM_RSCP_ECNO.ECNO



		INTO BI_SCANNER_UMTS
	


	From #TMM_RSCP_ECNO
	Where
		#TMM_RSCP_ECNO.RSCP<0 and #TMM_RSCP_ECNO.RSCP>-190 
		and op_ch in ('Cosmote 10764','Cosmote 10739','Cosmote 10714','Cosmote 2938','Vodafone 10614','Vodafone 10613','Vodafone 10589','Vodafone 10588','Vodafone 10564','Vodafone 10639','Vodafone 3062','Wind 10664','Wind 10689''Wind 10663','Wind 10688')

	Group by
         #TMM_RSCP_ECNO.HomeOperetor,
	     #TMM_RSCP_ECNO.Carrier,
		 #TMM_RSCP_ECNO.OP_CH,
		 #TMM_RSCP_ECNO.Collectionname
		-- #TMM_RSCP_ECNO.RSCP,
		 --#TMM_RSCP_ECNO.ECNO
	--ORDER BY #TMM_RSCP_ECNO.OP_CH ASC


	--DROP TABLE #Operators1
--DROP TABLE #M_RSCP_ECNO
DROP TABLE #TMM_RSCP_ECNO
--DROP TABLE BI_SCANNER_UMTS