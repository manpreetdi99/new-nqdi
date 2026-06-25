-- ==================================================LQCallData=======================================================

SELECT
	FileList.ASideFileName,
	--FileList.TestDescription, 
	FileList.CollectionName,
	FileList.CampaignName,
	FileList.UserName,
	FileList.ASideLocation,
	Filelist.ASideDevice,
	Filelist.BSideDevice,
	Filelist.ASideNumber,
	FileList.BSideNumber, 
	Filelist.FileID,
	CallSession.SessionId AS 'SessionId',
	CallSession.callStatus AS 'CallStatus',
	Callsession.Callcause,
	Callsession.Calltype,
	Callsession.Calldir,

	Case	when Callsession.callDir like 'A->B' then 'MOC'
			when Callsession.callDir like 'B->A' then 'MTC' else NULL end as 'MOCMTC',

	
	Callsession.VoiceCalltype,
	--'',
        CallSession.CallTechnology AS 'Technology',
	Networkinfo.Operator,
	Networkinfo.Technology,
	
	--CallSession.CallMode AS 'CallMode',

	case  when Callsession.callDir like 'A->B' and CallSession.CallMode in ('VoLTE','SRVCC') then 'VoLTE Call'
	      when Callsession.callDir like 'A->B' and CallSession.CallMode in ('CSFB','CS') then 'CS call'          
		  when Callsession.callDir like 'B->A' and CallSession.CallModeB in ('VoLTE','SRVCC') then 'VoLTE Call'
	      when Callsession.callDir like 'B->A' and CallSession.CallModeB in ('CSFB','CS') then 'CS call'

		  when callDir like 'A->B' and CallMode in ('-') and CallSession.CallTechnology like ('%lte%') then 'VoLTE Call'
		  when callDir like 'A->B' and CallMode in ('-') and CallSession.CallTechnology like ('%UMTS%') then 'CS call'
          when callDir like 'A->B' and CallMode in ('-') and CallSession.CallTechnology like ('%GSM%') then 'CS call'

	      when callDir like 'B->A' and CallModeB in ('-') and CallSession.CallTechnology like ('%lte%') then 'VoLTE Call'
	      when callDir like 'B->A' and CallModeB in ('-') and CallSession.CallTechnology like ('%UMTS%') then 'CS call'
	      when callDir like 'B->A' and CallModeB in ('-') and CallSession.CallTechnology like ('%GSM%') then 'CS call'
		  
		  else NULL end as 'CustomCallMode',

	--      when CallSession.CallModeB in ('CSFB','CS') then 'CS call' else NULL end as 'CustomCallModeB',






	Sessions.startTime,
	sessions.duration,
	
	--OLD

	--min(CASE WHEN vResultsKPI.KPIId = 11013 and vResultsKPI.ErrorCode=0 and (CallSession.CallMode  in ('VoLTE','SRVCC') or CallSession.CallModeB  in ('VoLTE','SRVCC'))  and (CallSession.callDir in ('A->B') or CallSession.callDir in ('B->A')) and Callsession.Callstatus in ('Completed','Dropped') THEN vResultsKPI.Duration*0.001 else NULL END) AS 'CallSetupTimeVoLTE ',
	--min(CASE WHEN vResultsKPI.KPIId = 10108 and vResultsKPI.ErrorCode=0 and (CallSession.CallMode in      ('CSFB','CS') or  CallSession.CallModeB in     ('CSFB','CS')) and  (CallSession.callDir in ('A->B') or CallSession.callDir in ('B->A')) and Callsession.Callstatus in ('Completed','Dropped') THEN vResultsKPI.Duration*0.001 else NULL END) AS 'CallSetupTimeCS ',
	 
	--NEW

	--min(CASE WHEN vResultsKPI.KPIId = 11013 and vResultsKPI.ErrorCode=0 and (Callsession.callDir like 'A->B' and CallSession.CallMode in ('VoLTE','SRVCC') or Callsession.callDir like 'B->A' and CallSession.CallModeB in ('VoLTE','SRVCC')) and Callsession.Callstatus in ('Completed','Dropped') THEN vResultsKPI.Duration*0.001 else NULL END) AS 'CallSetupTimeVoLTE ',
	--min(CASE WHEN vResultsKPI.KPIId = 10108 and vResultsKPI.ErrorCode=0 and (Callsession.callDir like 'A->B' and CallSession.CallMode in ('CSFB','CS') or Callsession.callDir like 'B->A' and CallSession.CallModeB in ('CSFB','CS')) and Callsession.Callstatus in ('Completed','Dropped') THEN vResultsKPI.Duration*0.001 else NULL END) AS 'CallSetupTimeCS ',

        min(CASE WHEN vResultsKPI.KPIId = 11013 and vResultsKPI.ErrorCode=0 and (Callsession.callDir like 'A->B' and CallSession.CallMode in ('VoLTE','SRVCC') or Callsession.callDir like 'B->A' and CallSession.CallModeB in ('VoLTE','SRVCC')) and Callsession.Callstatus in ('Completed','Dropped') THEN vResultsKPI.Duration*0.001 else NULL END) AS 'CallSetupTimeVoLTE ',
	min(CASE WHEN vResultsKPI.KPIId = 10108 and vResultsKPI.ErrorCode=0 and (Callsession.callDir like 'A->B' and CallSession.CallMode in ('CSFB','CS') or Callsession.callDir like 'B->A' and CallSession.CallModeB in ('CSFB','CS')) and Callsession.Callstatus in ('Completed','Dropped') THEN vResultsKPI.Duration*0.001 
	         WHEN vResultsKPI.KPIId = 11013 and vResultsKPI.ErrorCode=0 and (Callsession.callDir like 'A->B' and CallSession.CallMode in ('CSFB','CS') or Callsession.callDir like 'B->A' and CallSession.CallModeB in ('CSFB','CS')) and Callsession.Callstatus in ('Completed','Dropped') THEN vResultsKPI.Duration*0.001 else NULL END) AS 'CallSetupTimeCS ',
	


	Case When Callsession.Callstatus in ('Completed','Dropped','Failed')then 1 else 0 end as 'CallAttemps',
	Case When Callsession.Callstatus in ('Failed') then 0 else 1 end as 'Callconnected',
	Case When Callsession.Callstatus in ('Completed') then 1 else 0 end as 'CallCompleted',
	Case When Callsession.Callstatus in ('Dropped') then 1 else 0 end as 'CallDropped',
    Case When Callsession.Callstatus in ('Failed') then 1 else 0 end as 'CallFailed'

FROM
	NetworkInfo,CallSession
	JOIN Sessions ON CallSession.SessionId = Sessions.SessionId
	JOIN FileList ON FileList.FileId = Sessions.FileId
    --Join NetworkInfo on NetworkInfo.FileId = Sessions.FileId
	LEFT JOIN vResultsLQAvg ON CallSession.SessionId = vResultsLQAvg.SessionId
	LEFT JOIN TestInfo ON TestInfo.TestId = vResultsLQAvg.TestId
	LEFT JOIN vResultsKPI ON CallSession.SessionId = vResultsKPI.SessionId
Where CollectionName like '%%' AND
	Sessions.valid = 1 AND 
	callStatus IN ('Completed','Failed','Dropped') and 
	ASideLocation like '%Free A%' and
	Callsession.VoiceCallType In('Intrusive') and
	Networkinfo.NetworkId=(Select max(nf.NetworkId) From Networkinfo nf Where Filelist.FileId = nf.FileId And Sessions.StartTime > nf.Msgtime)
GROUP BY
	FileList.ASideFileName,
	FileList.TestDescription, 
	FileList.CollectionName,
	FileList.CampaignName,
    FileList.UserName,
	FileList.ASideLocation,
	Filelist.ASideDevice,
	Filelist.BSideDevice,
	Filelist.ASideNumber,
	FileList.BSideNumber,
	Filelist.FileID, 
	sessions.duration,
	Callsession.Callcause,
	CallSession.SessionId,
	Callsession.Calltype,
	Callsession.Calldir,
	FileList.TaskName,
	CallSession.CallTechnology,
	Networkinfo.Technology,
	CallSession.CallMode,
	CallSession.CallModeB,
	callStatus,
	Networkinfo.Operator,
	Callsession.VoiceCalltype,
	Sessions.startTime

ORDER BY SessionId