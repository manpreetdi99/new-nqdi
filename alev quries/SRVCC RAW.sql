-- ==================================================SRVCC RAW=======================================================


SELECT
DISTINCT Sessions.SessionId,
	FileList.CollectionName,
	
	Case	
			When ResultsKPI.KPIId = 38040 then '4G->3G'
			When ResultsKPI.KPIId = 38050 then '4G->2G'
			Else 'N/A'
	end as 'HO',

	Case
			When ResultsKPI.ErrorCode = 0 then 'Success'
			When ResultsKPI.ErrorCode = 108003 then 'Fail'
			Else 'N/A'
	End as 'HO_Status',

    CallSession.CallTechnology AS 'Technology',
	ASideLocation as Operator,
	Networkinfo.Technology,
	CallSession.callDir,
	
	Case When Callsession.Callstatus in ('Completed','Dropped','Failed')then 1 else 0 end as 'CallAttemps',
	Case When Callsession.Callstatus in ('Failed') then 0 else 1 end as 'Callconnected',
	Case When Callsession.Callstatus in ('Completed') then 1 else 0 end as 'CallCompleted',
	Case When Callsession.Callstatus in ('Dropped') then 1 else 0 end as 'CallDropped',
    Case When Callsession.Callstatus in ('Failed') then 1 else 0 end as 'CallFailed'
FROM
NetworkInfo, CallSession
	JOIN Sessions ON CallSession.SessionId = Sessions.SessionId
	JOIN FileList ON FileList.FileId = Sessions.FileId
	JOIN ResultsKPI ON CallSession.SessionId = ResultsKPI.SessionId

Where CollectionName like '%%' AND
Sessions.valid = 1 AND 
	callStatus IN ('Completed','Failed','Dropped') and 
	ASideLocation like '%Free A%' and
	Networkinfo.NetworkId=(Select max(nf.NetworkId) From Networkinfo nf Where Filelist.FileId = nf.FileId And Sessions.StartTime > nf.Msgtime) 
	AND ResultsKPI.KPIId IN (38040, 38050)
GROUP BY
FileList.CollectionName,
	CallSession.SessionId,
	CallSession.CallTechnology,
	CallSession.callDir,

	Networkinfo.Technology,
	callStatus,
	ASideLocation,

	Sessions.SessionId,
	ResultsKPI.KPIId,
	ResultsKPI.ErrorCode

ORDER BY ASideLocation;