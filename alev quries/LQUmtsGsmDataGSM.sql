-- ==================================================LQUmtsGsmDataGSM=======================================================


SELECT
		NetworkInfo.CID,
        NetworkInfo.LAC,
        NetworkInfo.MCC,
        NetworkInfo.MNC,
        NetworkInfo.CGI,
        NetworkInfo.Technology,
        NetworkInfo.BCCH as NI_BCCH,
        NetworkInfo.SC1 as NI_SC1,
        NetworkInfo.SC2 as NI_SC2,
        NetworkInfo.SC3 as NI_SC3,
        Sessions.FileId,
        Sessions.SessionId,
        Filelist.ASideLocation,
        FileList.ASideDevice,
        FileList.Zone,
        FileList.CollectionName,
NetworkInfo.NetworkId,
NetworkInfo.MsgTime
FROM
Sessions as Sessions, Position,  FileList, 
     NetworkInfo 
     LEFT JOIN vBTSList ON vBTSList.CGI = NetworkInfo.CGI
     LEFT JOIN vBTSList as bts2 ON bts2.CGI = NetworkInfo.CGI2
     LEFT JOIN vBTSList as bts3 ON bts3.CGI = NetworkInfo.CGI3
Where CollectionName like '%%' AND
Sessions.FileId = FileList.FileId and 
Sessions.Valid = 1 And
Sessions.SessionId=Position.SessionId And
Networkinfo.NetworkId=(Select Max(tech_2.NetworkId)From NetworkInfo tech_2
		     Where tech_2.FileId=Position.FileID and tech_2.MsgTime<Position.msgtime) and
ASideLocation Like '%GSM'