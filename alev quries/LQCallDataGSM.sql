-- ==================================================LQCallDataGSM=======================================================


SELECT
FileList.ASideFileName, 
FileList.TestDescription, 
FileList.CollectionName,
FileList.CampaignName,
FileList.UserName,
Filelist.ASideLocation,
Filelist.ASideDevice,
Filelist.BSideDevice,
Filelist.ASideNumber,
FileList.BSideNumber, 
Filelist.FileID,
Sessions.SessionID,
Callsession.Callstatus,
Callsession.Callcause,
Callsession.Calltype,
Callsession.Calldir,
Case	when Callsession.callDir like 'A->B' then 'MOC'
	when Callsession.callDir like 'B->A' then 'MTC' else NULL end as 'MOCMTC', 
Callsession.VoiceCalltype,
Networkinfo.NetworkID,
Networkinfo.Operator,
Networkinfo.Technology,
vResultsKPI.KPIID,
vResultsKPI.StartTime,
vResultsKPI.EndTime,
vResultsKPI.Duration*0.001,
Case When Callsession.callDir like 'A->B' and vResultsKPI.ErrorCode=0 and Callsession.Callstatus in ('Completed','Dropped') And Networkinfo.Technology in ('UMTS 2100','UMTS 900','GSM 900','GSM 1800') then vResultsKPI.Duration*0.001 else NULL end as 'MOCSetupTime',
Case When Callsession.callDir like 'B->A' and vResultsKPI.ErrorCode=0 and Callsession.Callstatus in ('Completed','Dropped') And Networkinfo.Technology in ('UMTS 2100','UMTS 900','GSM 900','GSM 1800') then vResultsKPI.Duration*0.001 else NULL end as 'MTCSetupTime',
vResultsKPI.ErrorCode,
Case When Callsession.Callstatus in ('Completed','Dropped','Failed')then 1 else 0 end as 'CallAttemps',
Case When vResultsKPI.ErrorCode=0 then 1 else 0 end as 'Callconnected',
Case When Callsession.Callstatus in ('Completed') then 1 else 0 end as 'CallCompleted',
Case When Callsession.Callstatus in ('Dropped') then 1 else 0 end as 'CallDropped',
Case When Callsession.Callstatus in ('Failed') then 1 else 0 end as 'CallFailed'

FROM
Networkinfo,
Filelist        Join Sessions On(Filelist.FileID=Sessions.FileID)
		Join Callsession On(Sessions.SessionID=Callsession.SessionID)
		Left Join vResultsKPI On(Sessions.SessionID=vResultsKPI.SessionID and vResultsKPI.KPIID=10100)
Where CollectionName like '%%' AND
Sessions.Valid=1 and
Callsession.Callstatus Not In('System Release') and
Callsession.VoiceCallType In('Intrusive') and
Networkinfo.NetworkId=(Select max(nf.NetworkId) From Networkinfo nf Where Filelist.FileId = nf.FileId And Sessions.StartTime > nf.Msgtime) and
ASideLocation Like '%GSM'