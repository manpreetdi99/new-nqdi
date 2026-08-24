-- ==================================================CELL ID GSM=======================================================
-- Κοινό query και για τους 3 operators (πριν ήταν 3 σχεδόν-ίδια αρχεία: "CELL ID CT
-- GSM.sql" / "CELL ID VD GSM.sql" / "CELL ID WD GSM.sql", ένα ανά ASideLocation) —
-- τώρα ASideLocation LIKE '%GSM' καλύπτει Cosmote/Vodafone/Nova μαζί, ξεχωρίζονται
-- από τη στήλη FileList.ASideLocation στο αποτέλεσμα.


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
NetworkInfo.CId >0 and
ASideLocation Like '%GSM'


-- ============================== "Number of 900/1800 band Cells" (Attachment C) ==============================
-- Πλήθος ΔΙΑΚΡΙΤΩΝ cells ανά operator/band, πάνω στο ίδιο row-set με πάνω:
-- COUNT(DISTINCT NetworkInfo.CID) — ΟΧΙ CGI (το CGI string έχει μικρές ασυνέπειες
-- LAC/MCC/MNC formatting που το φουσκώνουν κατά 1-2 σε σχέση με το CID). Επαληθεύτηκε
-- 1:1 στο STR_EVIA SOUTH_TOURISTIC AREAS_2026H2 / STEREA_26H2 — βλ. backend
-- /api/cell_band_count.
--
-- SELECT
--     FileList.ASideLocation,
--     NetworkInfo.Technology,
--     COUNT(DISTINCT NetworkInfo.CID) AS CellCount
-- FROM ... (ίδιο FROM/WHERE με πάνω)
-- GROUP BY FileList.ASideLocation, NetworkInfo.Technology
