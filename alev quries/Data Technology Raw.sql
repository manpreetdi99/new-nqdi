Select  NetworkInfo.CID,
        NetworkInfo.LAC,
        NetworkInfo.MCC,
        NetworkInfo.MNC,
        NetworkInfo.CGI,
       NetworkInfo.CGI2,
        NetworkInfo.CGI3,
        NetworkInfo.Technology,
        NetworkInfo.BCCH as NI_BCCH,
        NetworkInfo.SC1 as NI_SC1,
        NetworkInfo.SC2 as NI_SC2,
        NetworkInfo.SC3 as NI_SC3,
        vBTSList.BTSName,
        vBTSList.CellName as BTSCellName,
        vBTSList.Direction as BTSDirection,
        vBTSList.BCCH as BTSBCCH,
        
        --Position.Latitude,
       -- Position.Longitude,
       -- Position.PosId,
        Position.Level as FloorPlanLevel,
        --dbo.GetFloorPlanId(FileList.FileId, Position.FloorPlanId)                                  as FloorPlanId,
        --Position.Direction + 90 - 360 *
        --FLOOR(((Position.Direction + 90) / 360))
        --as PositionDirection,
        Sessions.FileId,
        Sessions.SessionId,
        FileList.CallingModule,
        FileList.ASideDevice,
        FileList.ASideLocation,
        FileList.Zone,
        FileList.CollectionName,
        SubString(FileList.ASideFileName, 1, 41)                                 as Logname,
'  ' as IndoorMap,
      --  dbo.HasIndoorMap(FileList.FileId)                                  as IndoorMap,
       -- dbo.GetFloorPlanName(Sessions.FileId,                             Position.FloorPlanId, {+Len+})                                 as FloorPlanName,
Networkinfo.NetworkId,
Position.SessionId,
Position.TestId,
Position.MsgTime,
Technology.CurrTechnology
from Sessions as Sessions, Position,  FileList, 
Technology,
TestInfo,
     NetworkInfo 
     LEFT JOIN vBTSList ON vBTSList.CGI = NetworkInfo.CGI
     LEFT JOIN vBTSList as bts2 ON bts2.CGI = NetworkInfo.CGI2
     LEFT JOIN vBTSList as bts3 ON bts3.CGI = NetworkInfo.CGI3
where CollectionName like '%%' AND Sessions.FileId = FileList.FileId and 
Sessions.Valid = 1 And
TestInfo.Valid = 1 AND
Sessions.FileId=FileList.FileId And
Sessions.SessionId=TestInfo.SessionId And
TestInfo.TestId =Position.TestId And
TestInfo.TestName in ('Capacity DL','FTP DL','HTTP TRANSFER (DL)') and
TestInfo.NetworkId=NetworkInfo.NetworkId AND
Technology.SessionId = Sessions.SessionId and
Technology.MsgTime=(Select Max(tech_2.MsgTime)From Technology tech_2
		     Where tech_2.TestId=Position.TestID and tech_2.MsgTime<Position.msgtime and tech_2.CurrTechnology is not null)