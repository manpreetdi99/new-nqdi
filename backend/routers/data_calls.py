"""Σελίδα Data Sessions: λίστα data tests (CDRCombined)."""
from fastapi import APIRouter, HTTPException, Query

from api_utils import rows_response
from db import get_connection

router = APIRouter(tags=["data-calls"])


@router.get("/api/data_calls")
def list_data_calls(
    database: str = Query(..., min_length=1),
    collection: list[str] | None = Query(default=None),
    location: list[str] | None = Query(default=None),
):
    try:
        conn = get_connection(database)
        cursor = conn.cursor()

        # Οι A-LEVEL πηγές ανά TestId (HTTP Transfer / Browser throughput, HTTPS URL, YouTube
        # streams, IP throughput) υλοποιούνται ΠΡΩΤΑ σε #temp με clustered index και το κύριο
        # SELECT κάνει απλό LEFT JOIN. Σαν derived tables μέσα στο ίδιο SELECT ο optimizer
        # τα ξαναυπολόγιζε (views vResultsKPI / vResultsVideoStreamAvg): ~10s για όλη την
        # DOD_26H2 αντί για ~1s που κοστίζουν μόνα τους. Ίδιο pattern με το /api/calls.
        cursor.execute("""
            SET NOCOUNT ON;

            -- HTTP Transfer: "HTTPS TRANSFER RAW.sql" — Throughput*0.008, lastBlock=1, ErrorCode=0.
            SELECT H.TestId,
                   AVG(CASE WHEN H.ErrorCode = 0 THEN CONVERT(float, H.Throughput) * 0.008 END) AS Thr
            INTO #ht
            FROM ResultsHTTPTransferTest H
            WHERE H.lastBlock = 1
            GROUP BY H.TestId;
            CREATE CLUSTERED INDEX IX_ht ON #ht(TestId);

            -- HTTP Browser (Kepler/Newton): "HTTP BROWSING p2 RAW.sql" — KPI 30407 Value1*8*0.001.
            SELECT K.TestId,
                   AVG(CASE WHEN K.KPIStatus = 'Successful' THEN CONVERT(float, K.Value1) * 8 * 0.001 END) AS Thr
            INTO #kb
            FROM vResultsKPI K
            WHERE K.KPIID = 30407
            GROUP BY K.TestId;
            CREATE CLUSTERED INDEX IX_kb ON #kb(TestId);

            -- HTTPS Browser URL του KPI 20404 ("HTTPSBrowserData.sql": Value5 IS NOT NULL).
            SELECT K.TestId, MAX(K.Value5) AS Url
            INTO #bu
            FROM vResultsKPI K
            WHERE K.KPIID = 20404
            GROUP BY K.TestId;
            CREATE CLUSTERED INDEX IX_bu ON #bu(TestId);

            -- Video streams ("YOUTUBE RAW.sql"): VQ (TestQualityAvg), stream status (ok),
            -- Freezing % (FreezingPercent), First Delay (TimeToFirstPicture, αλλιώς
            -- TimeToFirstPicturePlayer). HasVq = υπάρχουν και οι γραμμές ResultsVQ08StreamAvg /
            -- ResultsVideoStream που η reference απαιτεί (inner join) — ποια streams
            -- μετράνε το αποφασίζει το Summary (βλ. youtubeStreamLevel, attachmentC.ts).
            SELECT V.TestId,
                   AVG(V.TestQualityAvg)  AS VqAvg,
                   MAX(CASE WHEN V.Status LIKE '%ok%' THEN 1 ELSE 0 END) AS StreamOk,
                   AVG(V.FreezingPercent) AS FreezingPct,
                   AVG(CASE WHEN T.TimeToFirstPicture IS NOT NULL THEN T.TimeToFirstPicture * 0.001
                            ELSE T.TimeToFirstPicturePlayer * 0.001 END) AS FirstDelaySec,
                   MAX(CASE WHEN Q.TestId IS NOT NULL AND RVS.TestId IS NOT NULL THEN 1 ELSE 0 END) AS HasVq
            INTO #yv
            FROM vResultsVideoStreamAvg V
            JOIN TestInfo TIV                     ON TIV.TestId = V.TestId AND TIV.Valid = 1
            LEFT JOIN ResultsVQ08StreamAvg Q      ON Q.TestId   = V.TestId
            LEFT JOIN ResultsVideoStream RVS      ON RVS.TestId = V.TestId
            LEFT JOIN ResultsVideoStreamTCPData T ON T.TestId   = V.TestId
            GROUP BY V.TestId;
            CREATE CLUSTERED INDEX IX_yv ON #yv(TestId);

            -- Downlink IP throughput δείγματα ("YT_IP LAYER RAW.sql"): άθροισμα/πλήθος/max
            -- ανά test, ώστε ο μέσος όρος στο Summary να είναι ανά δείγμα όπως στο Excel.
            SELECT F.TestId,
                   SUM(F.ThroughputKbps)   AS ThrSum,
                   COUNT(F.ThroughputKbps) AS ThrCnt,
                   MAX(F.ThroughputKbps)   AS ThrMax
            INTO #yip
            FROM FactIPThroughput F
            JOIN TestInfo TIY   ON TIY.TestId = F.TestId AND TIY.Valid = 1
                               AND TIY.TestName IN ('YouTube Service', 'YouTube Service_Live', 'YouTube Service_4K')
            JOIN Position PY    ON PY.PosId = F.PosId
            JOIN NetworkInfo NY ON NY.NetworkId = F.NetworkId
            WHERE F.direction = 'Downlink'
            GROUP BY F.TestId;
            CREATE CLUSTERED INDEX IX_yip ON #yip(TestId);
        """)

        query = """
            SELECT
                FL.ASideLocation                                    AS Location,
                CC.SessionId,
                CC.TestId,
                CC.[Test Start TS]                                  AS callStartTimeStamp,
                CC.[Test Name]                                      AS testType,
                CC.TestDirection                                    AS direction,
                CC.[Transfer Status]                                AS status,
                CC.[Scoring Status]                                 AS scoringStatus,
                -- CAST σε bounded varchar: το CC.Host είναι varchar(8000) και το
                -- COALESCE(AC.Comment, ...) παρακάτω varchar(MAX) — και τα δύο βάζουν τον
                -- ODBC driver σε ακριβό per-row μονοπάτι για 30k+ γραμμές (fetch 2.2s -> 1.7s).
                -- Τα πραγματικά μήκη είναι <100 chars (host) και <30 (comment).
                CAST(CC.Host AS varchar(255))                       AS host,
                CC.[Ping_RTT Avg (ms)]                              AS pingRttAvg,
                CC.[Transfer Throughput (kbps)]                     AS throughputKbps,
                CC.[Capacity_Sustainable Throughput (kbps)]         AS capacityThroughputKbps,
                -- Throughput με την πηγή του A-LEVEL Attachment C (Summary tab) — το
                -- CC.[Transfer Throughput] βγαίνει 1-40% ψηλότερο για αυτά τα tests:
                --   HTTP Transfer: "HTTPS TRANSFER RAW.sql" — ResultsHTTPTransferTest
                --     .Throughput*0.008, lastBlock=1, μόνο ErrorCode=0.
                --   HTTP Browser (Kepler/Kepler_2/Newton): "HTTP BROWSING p2 RAW.sql" —
                --     KPI 30407 Value1*8*0.001, μόνο KPIStatus='Successful'.
                -- Άλλα tests (HTTPS sites, Ookla κλπ.) δεν έχουν τέτοια γραμμή ->
                -- CC.[Transfer Throughput], που εκεί ταιριάζει ήδη με το Excel.
                CASE
                    WHEN HT.TestId IS NOT NULL THEN HT.Thr
                    WHEN KB.TestId IS NOT NULL THEN KB.Thr
                    ELSE CC.[Transfer Throughput (kbps)]
                END                                                 AS refThroughputKbps,
                CC.[YouTube_Avg. Video MOS]                         AS youtubeMos,
                CC.[YouTube_Number of Interuptions]                 AS youtubeInterruptions,
                -- YouTube KPIs του A-LEVEL Attachment C ("YOUTUBE RAW.sql" /
                -- "YT_IP LAYER RAW.sql"), ανά test — βλ. YV / YIP παρακάτω.
                YV.FreezingPct                                      AS youtubeFreezingPct,
                YV.FirstDelaySec                                    AS youtubeFirstDelaySec,
                YV.VqAvg                                            AS youtubeVq,
                YV.StreamOk                                         AS youtubeStreamOk,
                -- 2 = stream με αποτέλεσμα VQ (vResultsVideoStreamAvg + ResultsVQ08StreamAvg +
                -- ResultsVideoStream, ακριβώς οι inner joins του "YOUTUBE RAW.sql"), 1 = stream
                -- χωρίς VQ08/ResultsVideoStream, 0 = κανένα stream (π.χ. failed πριν παίξει).
                CASE WHEN YV.TestId IS NULL THEN 0 WHEN YV.HasVq = 1 THEN 2 ELSE 1 END AS youtubeStreamLevel,
                YIP.ThrSum                                          AS youtubeIpThrSumKbps,
                YIP.ThrCnt                                          AS youtubeIpThrSamples,
                YIP.ThrMax                                          AS youtubeIpThrMaxKbps,
                CC.Technology                                       AS technology,
                CC.[Start Technology]                               AS startTechnology,
                FL.CollectionName,
                FL.ASideFileName,
                S.Valid                                             AS isValid,
                -- TestInfo.Valid: όλα τα A-LEVEL data queries κρατούν μόνο TestInfo.Valid=1 —
                -- ένα invalid test μέσα σε valid session μετρούσε σαν επιπλέον failed test.
                TI.Valid                                            AS testValid,
                -- 1 = HTTPS Browser test του οποίου το KPI 20404 δεν έχει URL (Value5 NULL,
                -- π.χ. failed πριν ανοίξει σελίδα). Το A-LEVEL "HTTPSBrowserData.sql" έχει
                -- "Value5 IS NOT NULL", άρα δεν το μετράει καθόλου — το Summary το κρύβει.
                CASE WHEN BU.TestId IS NOT NULL AND BU.Url IS NULL THEN 1 ELSE 0 END AS browserUrlMissing,
                CAST(COALESCE(AC.Comment, S.InvalidReason) AS varchar(1000)) AS comment,
                P.Latitude                                          AS latitude,
                P.Longitude                                         AS longitude
            FROM CDRCombined CC
            JOIN FileList FL         ON FL.FileId    = CC.FileId
            LEFT JOIN Sessions S     ON S.SessionId  = CC.SessionId
            LEFT JOIN TestInfo TI    ON TI.TestId    = CC.TestId
            LEFT JOIN Position P     ON P.PosId      = TI.PosId
            LEFT JOIN AnalysisCommentSessionsBridge ACSB ON ACSB.sessionID = CC.SessionId
            LEFT JOIN AnalysisComment AC                 ON AC.commentID   = ACSB.commentId
            LEFT JOIN #ht  HT  ON HT.TestId  = CC.TestId
            LEFT JOIN #kb  KB  ON KB.TestId  = CC.TestId
            LEFT JOIN #bu  BU  ON BU.TestId  = CC.TestId
            LEFT JOIN #yv  YV  ON YV.TestId  = CC.TestId
            LEFT JOIN #yip YIP ON YIP.TestId = CC.TestId
            WHERE (S.Valid = 1 OR S.Valid = 0 OR S.Valid IS NULL)
              AND FL.ASideLocation NOT LIKE '%Free%'
              AND FL.ASideLocation NOT LIKE '%Voice%'
        """

        params: list[object] = []
        selected_collections = [col for col in (collection or []) if col and col.strip()]

        if selected_collections:
            placeholders = ", ".join(["?"] * len(selected_collections))
            query += f" AND FL.CollectionName IN ({placeholders})"
            params.extend(selected_collections)

        selected_locations = [loc for loc in (location or []) if loc and loc.strip()]

        if selected_locations:
            placeholders = ", ".join(["?"] * len(selected_locations))
            query += f" AND FL.ASideLocation IN ({placeholders})"
            params.extend(selected_locations)

        # Ταξινόμηση ανά location, μετά χρονολογικά (SessionId ↑ = πιο παλιό πρώτα).
        # Κάθε 6 συνεχόμενα SessionId μιας location αποτελούν ένα cycle (grouping γίνεται στο UI).
        query += " ORDER BY FL.ASideLocation, CC.SessionId, CC.TestId"

        cursor.execute(query, tuple(params))

        response = rows_response(cursor)

        conn.close()

        return response
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/api/data_device_info")
def get_data_device_info(
    database: str = Query(..., min_length=1),
    session_id: str = Query(..., min_length=1)
):
    """Device & scanner info for a data session — same shape as /api/call_device_info
    (Scanner & Κινητό panel), but data sessions hang off Sessions/FileList instead of
    CallAnalysis (data tests have no CallAnalysis row)."""
    try:
        conn = get_connection(database)
        cursor = conn.cursor()

        # File-level device info from FileList, same fields as call_device_info
        cursor.execute("""
            SELECT TOP 1
                FL.ASideDevice,
                FL.BSideDevice,
                FL.ASideNumber,
                FL.BSideNumber,
                FL.IMEI,
                FL.FirmwareV,
                FL.IMSI,
                FL.ProductVersion,
                FL.MFVersion,
                FL.SWVersion,
                FL.ASideFileName,
                FL.BSideFileName,
                FL.ASideLocation,
                FL.BSideLocation
            FROM Sessions S
            LEFT JOIN FileList FL ON FL.FileId = S.FileId
            WHERE S.SessionId = TRY_CONVERT(BIGINT, ?)
        """, (session_id,))

        row = cursor.fetchone()
        columns = [col[0] for col in cursor.description] if cursor.description else []
        file_info = {columns[i]: row[i] for i in range(len(columns))} if row else {}

        # DmnDevice info for the device that ran this data session
        a_device = None
        try:
            cursor.execute("""
                SELECT TOP 1
                    DD.Model,
                    DD.IMEI,
                    DD.IMSI,
                    DD.Firmware,
                    DD.Number,
                    DD.Side,
                    DD.DeviceType,
                    DD.RFManufacturer,
                    DD.RFModel,
                    DD.SerialNumber,
                    DD.OS,
                    DD.BaseBand
                FROM FactLTERadio FR
                LEFT JOIN DmnDevice DD ON FR.DmnIdDevice = DD.DmnId
                WHERE FR.SessionId = TRY_CONVERT(BIGINT, ?)
                  AND DD.DmnId IS NOT NULL
                ORDER BY FR.FullDate
            """, (session_id,))
            r = cursor.fetchone()
            if r:
                cols = [c[0] for c in cursor.description]
                a_device = {cols[i]: r[i] for i in range(len(cols))}
        except Exception:
            pass

        # DmnDevice info for the other phone on the same trace file (B-side), if any —
        # data tests have no CallAnalysis pairing, so match on FileId + DmnDevice.Side instead.
        b_device = None
        try:
            cursor.execute("""
                ;WITH file_root AS (
                    SELECT TOP (1) S.FileId
                    FROM Sessions S
                    WHERE S.SessionId = TRY_CONVERT(BIGINT, ?)
                )
                SELECT TOP 1
                    DD.Model,
                    DD.IMEI,
                    DD.IMSI,
                    DD.Firmware,
                    DD.Number,
                    DD.Side,
                    DD.DeviceType,
                    DD.RFManufacturer,
                    DD.RFModel,
                    DD.SerialNumber,
                    DD.OS,
                    DD.BaseBand
                FROM FactLTERadio FR
                INNER JOIN Sessions S2 ON S2.SessionId = FR.SessionId
                INNER JOIN file_root FR_ROOT ON S2.FileId = FR_ROOT.FileId
                LEFT JOIN DmnDevice DD ON FR.DmnIdDevice = DD.DmnId
                WHERE DD.DmnId IS NOT NULL
                  AND DD.Side = 'B'
                ORDER BY FR.FullDate
            """, (session_id,))
            r = cursor.fetchone()
            if r:
                cols = [c[0] for c in cursor.description]
                b_device = {cols[i]: r[i] for i in range(len(cols))}
        except Exception:
            pass

        conn.close()
        return {
            "fileInfo": file_info,
            "aSideDevice": a_device,
            "bSideDevice": b_device,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
