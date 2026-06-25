-- ==================================================CELL ID CT FREE=======================================================


SELECT
NetworkInfo.CID,
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
        vBTSList.BSIC as BTSBSIC,
        
        Position.Latitude,
        Position.Longitude,
        Position.PosId,
        Position.Level as FloorPlanLevel,
        dbo.GetFloorPlanId(FileList.FileId, Position.FloorPlanId)                                  as FloorPlanId,
        Position.Direction + 90 - 360 *
        FLOOR(((Position.Direction + 90) / 360))
        as PositionDirection,
        Sessions.FileId,
        Sessions.SessionId,
        FileList.CallingModule,
        FileList.ASideDevice,
        FileList.ASideLocation,
        FileList.Zone,
        FileList.CollectionName,
        SubString(FileList.ASideFileName, 1, 41)                                 as Logname,
		NULL as IndoorMap,
        --dbo.HasIndoorMap(FileList.FileId)                                  as IndoorMap,
        --dbo.GetFloorPlanName(Sessions.FileId,                             Position.FloorPlanId, {+Len+})                                 as FloorPlanName,
NetworkInfo.NetworkId,
NetworkInfo.MsgTime

FROM
 Sessions as Sessions, Position,  FileList, 
NetworkIdRelation nr1, NetworkIdRelation nr2,
     NetworkInfo 
     LEFT JOIN vBTSList ON vBTSList.CGI = NetworkInfo.CGI
     LEFT JOIN vBTSList as bts2 ON bts2.CGI = NetworkInfo.CGI2
     LEFT JOIN vBTSList as bts3 ON bts3.CGI = NetworkInfo.CGI3
Where CollectionName like '%%' AND
Sessions.FileId = FileList.FileId and 
Sessions.Valid = 1 And
Sessions.SessionId = Position.SessionId And
FileList.FileId = NetworkInfo.FileId and
NetworkInfo.FileId = Position.FileId And
(NetworkInfo.NetworkId = nr1.NetworkId and Position.PosId > nr1.PosId) and
(NetworkInfo.NetworkId + 1 = nr2.NetworkId and Position.PosId <= nr2.PosId) and
nr2.type = 'NetworkId' and nr1.type = 'NetworkId' and
NetworkInfo.CId > 0 and
ASideLocation = 'Cosmote Free A'