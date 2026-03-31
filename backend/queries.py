import pandas as pd
from sqlalchemy import text
from databese import make_engine
from sqlalchemy.exc import ProgrammingError

def query_rsrp_free(phone: str, collection: str, database: str) -> pd.DataFrame:

    # Χρησιμοποιούμε το collection στο WHERE
      
    engine = make_engine(database)  # <-- ΠΑΙΡΝΕΙ τη ΒΑΣΗ από τα args/GUI
    sql_rsrp_free = text("""
        SELECT
            DF.CollectionName,
            DF.ASideLocation,
            CAST(DP.Latitude  AS FLOAT) AS latitude,
            CAST(DP.Longitude AS FLOAT) AS longitude,
            flr.MsgTime,
            flr.PosId,
            flr.rsrp
        FROM LTEMeasurementReport AS flr
        LEFT JOIN Sessions AS fs ON flr.SessionId = fs.SessionId
        LEFT JOIN FileList     AS DF ON fs.FileId     = DF.FileId
        LEFT JOIN Position    AS DP ON flr.PosId     = DP.PosId
        WHERE DF.ASideLocation = :location
        AND DF.CollectionName = :collection
        ORDER BY flr.MsgTime;
    """)



    with engine.begin() as conn:  # ανοίγει/κλείνει transaction & connection
        df = pd.read_sql(sql_rsrp_free, conn, params={
    "location":  phone,        # π.χ. "Cosmote Free A"
    "collection": collection,  # από το gg.py
    })
        

    print(f"(RSRP) DataFrame loaded: {len(df)} rows for phone '{phone}' and collection '{collection}'.")
    if df.empty:
        raise SystemExit("No rows returned by the query.")
    return df

def query_mos_free(phone: str, collection: str, database: str) -> pd.DataFrame:   
    engine = make_engine(database)
    sql_mos = text('''SELECT  
      fs.FactId,
      fl.CollectionName,

      dp.Latitude AS latitude,

      dp.Longitude AS longitude,

      fs.FullDate,
      fs.MsgId,
      fs.SessionId,
      fs.SessionIdCalledParty,
      fs.SessionIdASide,
      fs.SessionIdBSide,
      fs.TestId,
      fs.FileId,
      fs.EndPosId,
      fs.LQ AS LQ

FROM dbo.FactSpeech fs
LEFT JOIN FileList fl 
    ON fl.FileId = fs.FileId

LEFT JOIN TestInfo TI
	ON TI.TestId = fs.TestId

LEFT JOIN Position dp 
    ON dp.PosId = TI.PosId

WHERE CollectionName=:collection AND ASideLocation = :location

ORDER BY TestId

 ''')
    
    sql_fallback = text('''WITH base_sessions AS (
    SELECT DISTINCT fs.SessionId
    FROM ResultsLQ08Avg fs
	left join Sessions Se on fs.SessionId= se.SessionId
    LEFT JOIN FileList df ON se.FileId = df.FileId
    where df.ASideLocation=:location and df.CollectionName=:collection
    )
     SELECT
      --fs.FactId
    df.CollectionName
    , df.ASideLocation
    , dp.Latitude  AS latitude
    , dp.Longitude AS longitude
    , fs.OptionalWB as LQ
FROM ResultsLQ08Avg fs

left join Sessions Se on fs.SessionId= se.SessionId
left join TestInfo t on fs.TestId=t.TestId
LEFT JOIN FileList df ON se.FileId = df.FileId
LEFT JOIN Position dp  ON t.PosId=dp.PosId
WHERE EXISTS (
    SELECT 1
    FROM base_sessions bs
    WHERE bs.SessionId=fs.SessionId
	
)''')
    
    # with engine.begin() as conn:
    #     df = pd.read_sql(sql_mos, conn, params={
    # "location":  phone,        # π.χ. "Cosmote Free A"
    # "collection": collection,  # από το gg.py
    # })
    
    # print(f"(MOS) DataFrame loaded: {len(df)} rows for phone '{phone}' and collection '{collection}'.")
    # if df.empty:
    #     raise SystemExit("No rows returned by the query.")
    # return df
    try:
        with engine.begin() as conn:
            df = pd.read_sql(sql_mos, conn, params={"location": phone, "collection": collection})
            print(f"mos from factspeech: {len(df)} rows.")
            if df.empty:
                df = pd.read_sql(sql_fallback, conn, params={"location": phone, "collection": collection})
            return df

    except ProgrammingError as e:
        # Αν ο πίνακας DmnFile δεν υπάρχει (Error 42S02)
        if "42S02" in str(e):
            print(f"⚠️ DmnFile missing, trying FileList fallback... (Error: {e.orig})")
            try:
                # Νέο connection context για το fallback query
                with engine.begin() as conn_fallback:
                    df = pd.read_sql(sql_fallback, conn_fallback, params={"location": phone, "collection": collection})
                    print(f"mos from resultslq08AVG: {len(df)} rows.")
                    return df
            except Exception as e2:
                print(f"❌ Both queries failed. Fallback error: {e2}")
                return pd.DataFrame() # Επιστρέφει άδειο DF αντί για None για να μην σπάει η pandas
        else:
            print(f"❌ SQL Error: {e}")
            return pd.DataFrame()

    except Exception as e:
        print(f"❌ Unexpected error: {e}")
        return pd.DataFrame()
        
def query_technology_free(phone: str, collection: str, database: str) -> pd.DataFrame:
    engine = make_engine(database)
    sql_technology = text('''SELECT
        f.CollectionName,
        f.ASideLocation,
        p.Latitude AS latitude,
                p.Longitude AS longitude,
            p.TestId,
            ni.NetworkId,
            ni.technology AS technology,
            ni.MsgTime
        FROM Sessions AS s
        JOIN Position  AS p  ON s.SessionId = p.SessionId
        OUTER APPLY (
            SELECT TOP (1) n.*
            FROM NetworkInfo AS n
            WHERE n.FileId = p.FileId
            AND n.MsgTime < p.msgTime
            ORDER BY n.MsgTime DESC
        ) AS ni
        LEFT JOIN dbo.Filelist AS f ON s.FileId = f.FileId

        WHERE s.Valid = 1 and f.ASideLocation = :location
        AND f.CollectionName = :collection
        AND ni.technology <> 'Unknown'
        order by MsgTime''')
    
    with engine.begin() as conn:
        df = pd.read_sql(sql_technology, conn, params={
    "location":  phone,        # π.χ. "Cosmote Free A"
    "collection": collection,  # από το gg.py
    })
    
    print(f"(technology) DataFrame loaded: {len(df)} rows for phone '{phone}' and collection '{collection}'.")
    if df.empty:
        raise SystemExit("No rows returned by the query.")
    return df
    
def query_calls_free(phone: str, collection: str, database: str) -> pd.DataFrame:
    engine = make_engine(database)
    
    # Το αρχικό query (SmartAnalytics)
    sql_main = text(''' SELECT 
        CA.SessionId, CA.callStatus as status, DF.CollectionName, DF.Location,
        POS.Latitude as latitude, POS.Longitude as longitude
        FROM CallAnalysis CA
        LEFT JOIN DmnFile DF ON CA.FileId=DF.FileId
        LEFT JOIN Position POS ON CA.PosId=POS.PosId
        LEFT JOIN Sessions S ON S.SessionId=CA.SessionId
        WHERE DF.Location = :location AND DF.CollectionName = :collection AND S.Valid = 1''')

    # Το εναλλακτικό query (Raw/Fallback)
    sql_fallback = text(''' SELECT 
        CA.SessionId, CA.callStatus as status, DF.CollectionName, DF.ASideLocation as Location,
        POS.Latitude as latitude, POS.Longitude as longitude
        FROM CallAnalysis CA
        LEFT JOIN FileList DF ON CA.FileId=DF.FileId
        LEFT JOIN Position POS ON CA.PosId=POS.PosId
        LEFT JOIN Sessions S ON S.SessionId=CA.SessionId
        WHERE DF.ASideLocation = :location AND DF.CollectionName = :collection AND S.Valid = 1''')

    try:
        # Προσπάθεια για το πρώτο query
        with engine.begin() as conn:
            df = pd.read_sql(sql_main, conn, params={"location": phone, "collection": collection})
            print(f"(calls) Loaded from DmnFile: {len(df)} rows.")
            if df.empty:
                df = pd.read_sql(sql_fallback, conn, params={"location": phone, "collection": collection})
                print(f"(calls) Loaded from FileList: {len(df)} rows.")
            return df

    except ProgrammingError as e:
        # Αν ο πίνακας DmnFile δεν υπάρχει (Error 42S02)
        if "42S02" in str(e):
            print(f"⚠️ DmnFile missing, trying FileList fallback... (Error: {e.orig})")
            try:
                # Νέο connection context για το fallback query
                with engine.begin() as conn_fallback:
                    df = pd.read_sql(sql_fallback, conn_fallback, params={"location": phone, "collection": collection})
                    print(f"(calls) Loaded from FileList: {len(df)} rows.")
                    return df
            except Exception as e2:
                print(f"❌ Both queries failed. Fallback error: {e2}")
                return pd.DataFrame() # Επιστρέφει άδειο DF αντί για None για να μην σπάει η pandas
        else:
            print(f"❌ SQL Error: {e}")
            return pd.DataFrame()

    except Exception as e:
        print(f"❌ Unexpected error: {e}")
        return pd.DataFrame()

def query_scanner( collection: str, database: str) -> pd.DataFrame:
    engine = make_engine(database)
    sql_calls = text('''SELECT [FactId]
      ,[FullDate]
      ,FL.[FileId]
      ,FL.[PosId]
      ,[NetworkId]
      ,[RFBand]
      ,[RFBandConfigured]
      ,[EARFCN]
      ,[MccMncList]
	  ,POS.latitude AS latitude
	  ,POS.longitude AS longitude
      ,[RSRP] as RSRP
      ,[SINR]
      ,[RSRQ]
      ,[DmnIdDateTime]
      ,[DmnIdPosition]
      ,[DmnIdFile]
	  ,fl.DmnIdOperator
    
        FROM FactLTEScanner FL
        LEFT JOIN Position POS ON FL.PosId=POS.PosId
        LEFT JOIN  DmnFile DF ON FL.FileId=DF.FileId
        left join DmnOperator DO on FL.DmnIdOperator=DO.DmnId
        WHERE DmnIdTopN_RSRP=1 AND 
        (FL.EARFCN=1700 OR FL.EARFCN=3050 OR FL.EARFCN=3200 OR FL.EARFCN=6400 OR FL.EARFCN=6363 AND FL.EARFCN=37900 OR FL.EARFCN=1844 OR FL.EARFCN=3194 OR FL.EARFCN=525 OR FL.EARFCN=500) and
        DO.Provider like'%COSMOTE%'
    AND DF.CollectionName=:collection''')
    
    sql_fallback = text('''SELECT 
            POS.latitude AS latitude
        ,POS.longitude AS longitude
        ,FL.RP as RSRP

        
    FROM MsgLTEScannerTopCh FL
    LEFT JOIN [MsgLTEScannerTopChInfo] FI ON FL.TopChnId=FI.TopChnId
    LEFT JOIN Position POS ON FI.PosId=POS.PosId
    LEFT JOIN Sessions SE ON FI.SessionId=SE.SessionId
    LEFT JOIN FileList LI ON SE.FileId=LI.FileId
    
    WHERE 
    (FL.Channel=1700 OR FL.Channel=3050 OR FL.Channel=3200 OR FL.Channel=6400 OR FL.Channel=6363 AND FL.Channel=37900 OR FL.Channel=1844 OR FL.Channel=3194 OR FL.Channel=525 OR FL.Channel=500)
    AND MNC=1 
    and GroupMode=0 and SortMode=0
    AND li.CollectionName=:collection''')
    
    try:
        # Προσπάθεια για το πρώτο query
        with engine.begin() as conn:
            df = pd.read_sql(sql_calls, conn, params={"collection": collection})
            print(f"(scanners) Loaded from DmnFile: {len(df)} rows.")
            if df.empty:
                df = pd.read_sql(sql_fallback, conn, params={"collection": collection})
                print(f"(scanners) Loaded from FileList: {len(df)} rows.")
            return df
    
    except ProgrammingError as e:
        # Αν ο πίνακας DmnFile δεν υπάρχει (Error 42S02)
        if "42S02" in str(e):
            print(f"⚠️ DmnFile missing, trying FileList fallback... (Error: {e.orig})")
            try:
                # Νέο connection context για το fallback query
                with engine.begin() as conn_fallback:
                    df = pd.read_sql(sql_fallback, conn_fallback, params={"collection": collection})
                    print(f"(scanners) Loaded from FileList: {len(df)} rows.")
                    return df
            except Exception as e2:
                print(f"❌ Both queries failed. Fallback error: {e2}")
                return pd.DataFrame() # Επιστρέφει άδειο DF αντί για None για να μην σπάει η pandas
        else:
            print(f"❌ SQL Error: {e}")
            return pd.DataFrame()

    except Exception as e:
        print(f"❌ Unexpected error: {e}")
        return pd.DataFrame()


    # with engine.begin() as conn:
    #     df = pd.read_sql(sql_calls, conn, params={   
    # "collection": collection,  # από το gg.py
    # })
    # print(f"(scanner_rsrp) DataFrame loaded: {len(df)} rows  and collection '{collection}'.")
    # if df.empty:
    #     raise SystemExit("No rows returned by the query.")
    # return df


def query_rx_lev_gsm(phone: str, collection: str, database: str) -> pd.DataFrame:
    engine = make_engine(database)
    sql_calls = text('''SELECT
    CASE 
        WHEN (l1.RxLevFull IS NULL) OR (l1.formatid = 'IDLE') 
            THEN 'invalid' 
        ELSE 'valid' 
    END AS RxLevFullValidity,

    COALESCE(l1.RxLevFull, -200) AS RxLevFull,

    r.BCCH AS ChNr,
    l1.TA,
    l1.TxPwr,
    l1.BCCH_RxLev,
    l1.SC_Rx_Lev_Access_Min,
    l1.SC_MS_TXPWR_MAX_CCH,
    (l1.SC_NCC * 10) + l1.SC_BCC AS SC_BSIC,

    l1.TestId,
    l1.msgTime,
    l1.networkId,
    p.Latitude  AS latitude,
    p.Longitude AS longitude

FROM msgGSMLayer1 AS l1
JOIN Sessions     AS s ON s.SessionId = l1.SessionId AND s.Valid = 1
JOIN FileList     AS f ON f.FileId   = s.FileId 
                       -- AND f.ASideLocation IN ('Nova GSM','Vodafone GSM','Cosmote GSM')
JOIN NetworkInfo  AS n ON n.NetworkId = l1.NetworkId
JOIN Position     AS p ON p.PosId     = l1.PosId
JOIN MsgGSMReport AS r
    ON r.MsgId = (
        SELECT MAX(r2.MsgId)
        FROM MsgGSMReport AS r2
        JOIN Sessions      AS s2 ON s2.SessionId = r2.SessionId
        WHERE r2.MsgTime < l1.MsgTime
          AND s2.FileId  = s.FileId
		  AND F.ASideLocation= :location
          AND F.CollectionName= :collection
    );
-- Optional:
-- ORDER BY l1.msgTime;
-- To exclude IDLE rows entirely instead of just flagging them, add:
-- WHERE l1.formatid <> 'IDLE';
    ''')

    with engine.begin() as conn:
        df = pd.read_sql(sql_calls, conn, params={
    "location":  phone,        # π.χ. "Cosmote Free A"
    "collection": collection,  # από το gg.py
    })
    print(f"(RX LEVEL) DataFrame loaded: {len(df)} rows for phone '{phone}' and collection '{collection}'.")
    if df.empty:
        print("No rows returned by the query.")
    return df

def query_rx_lev_sub_gsm(phone: str, collection: str, database: str) -> pd.DataFrame:
    engine = make_engine(database)
    sql_calls = text('''SELECT
    CASE 
        WHEN (l1.RxLevSub IS NULL) OR (l1.formatid = 'IDLE') 
            THEN 'invalid' 
        ELSE 'valid' 
    END AS RxLevSubValidity,

    COALESCE(l1.RxLevSub, -200) AS RxLevSub,

    r.BCCH AS ChNr,
    l1.TA,
    l1.TxPwr,
    l1.BCCH_RxLev,
    l1.SC_Rx_Lev_Access_Min,
    l1.SC_MS_TXPWR_MAX_CCH,
    (l1.SC_NCC * 10) + l1.SC_BCC AS SC_BSIC,

    l1.TestId,
    l1.msgTime,
    l1.networkId,
    p.Latitude  AS latitude,
    p.Longitude AS longitude

FROM msgGSMLayer1 AS l1
JOIN Sessions     AS s ON s.SessionId = l1.SessionId AND s.Valid = 1
JOIN FileList     AS f ON f.FileId    = s.FileId 
                       --AND f.ASideLocation IN ('Nova GSM','Vodafone GSM','Cosmote GSM')
JOIN NetworkInfo  AS n ON n.NetworkId = l1.NetworkId
JOIN Position     AS p ON p.PosId     = l1.PosId
JOIN MsgGSMReport AS r
    ON r.MsgId = (
        SELECT MAX(r2.MsgId)
        FROM MsgGSMReport AS r2
        JOIN Sessions      AS s2 ON s2.SessionId = r2.SessionId
        WHERE r2.MsgTime < l1.MsgTime
          AND s2.FileId   = s.FileId
          AND f.ASideLocation  = :location
          AND f.CollectionName = :collection
    );
-- Optional:
-- ORDER BY l1.msgTime;
-- To exclude IDLE rows entirely instead of just flagging them, add:
-- WHERE l1.formatid <> 'IDLE';
   ''')

    with engine.begin() as conn:
        df = pd.read_sql(sql_calls, conn, params={
    "location":  phone,        # π.χ. "Cosmote Free A"
    "collection": collection,  # από το gg.py
    })
    print(f"(RX LEVEL SUB) DataFrame loaded: {len(df)} rows for phone '{phone}' and collection '{collection}'.")
    if df.empty:
        print("No rows returned by the query.")
    return df


def query_rsrp_data(phone: str, collection: str, database: str) -> pd.DataFrame:
    engine = make_engine(database)
    sql_calls = text('''SELECT [FactId]
      ,[FullDate]
      ,FL.[FileId]
      ,FL.[PosId]
      ,[NetworkId]
      ,[EARFCN]
	  ,POS.latitude
	  ,POS.longitude
      ,[RSRP]
      ,[SINR]
      ,[RSRQ]
      ,[DmnIdPosition]
      ,[DmnIdFile]
    
  FROM FactLTERadio FL
  LEFT JOIN Position POS ON FL.PosId=POS.PosId
  LEFT JOIN  DmnFile DF ON FL.FileId=DF.FileId
  WHERE DF.Location= :location
	AND DF.CollectionName= :collection
	order by FullDate ''')

    with engine.begin() as conn:
        df = pd.read_sql(sql_calls, conn, params={
    "location":  phone,        # π.χ. "Cosmote Free A"
    "collection": collection,  # από το gg.py
    })
    print(f"(RSRP FOR DATA ) DataFrame loaded: {len(df)} rows for phone '{phone}' and collection '{collection}'.")
    if df.empty:
        raise SystemExit("No rows returned by the query.")
    return df

def query_ookla(phone: str, collection: str, database: str) -> pd.DataFrame:
    engine = make_engine(database)
    sql_calls = text('''-- ======================= OOKLA RAW (CTE-Compatible) WITH LAT/LONG =======================

WITH SessionsCTE AS (
    SELECT
        SessionId,
        FileId,
        info
    FROM Sessions
    WHERE valid = 1
    GROUP BY SessionId, FileId, info
),
MinDurCTE AS (
    SELECT
        raam.TestId,
        raam.SessionId,
        s.FileId,
        MinDuration = COALESCE(MIN(k1.Duration), MIN(k2.Duration), MIN(k3.Duration), 100)
    FROM SessionsCTE s
    INNER JOIN ResultsAppActionMessaging raam ON raam.SessionId = s.SessionId
    LEFT JOIN ResultsKPI k1 ON k1.SessionId = s.SessionId AND k1.KPIId = 31000 AND k1.TestId = raam.TestId
    LEFT JOIN ResultsKPI k2 ON k2.SessionId = raam.SessionId AND k2.KPIId = 31000
    LEFT JOIN Sessions sss ON sss.FileId = s.FileId
    INNER JOIN ResultsKPI k3 ON k3.SessionId = sss.SessionId AND k3.KPIId = 31000
    GROUP BY raam.TestId, raam.SessionId, s.FileId
),
MinDelDurCTE AS (
    SELECT
        s.FileId,
        MinDeliveryTime = ISNULL(MIN(DATEDIFF(ms, aab.StartTime, aa.LogTime)), 0)
    FROM ResultsAppActionMessaging aa
    LEFT JOIN ResultsAppActionMessaging aab ON aab.Identifier = aa.Identifier
        AND aab.ActionId = aa.ActionId
        AND aab.Direction = 0
        AND aa.Direction = 1
        AND aab.TestId <> aa.TestId
    INNER JOIN SessionsCTE s ON s.SessionId = aa.SessionId
    GROUP BY s.FileId
)

SELECT
    ti.SessionId,
    ti.TestId,
    -- Προσθήκη Lat/Long
    dp.Latitude as latitude,
    dp.Longitude as longitude,
    fl.CollectionName,
    fl.ASideDevice,
    fl.ASideFileName,
    fl.TestDescription,
    fl.ASideNumber,
    s.info AS Session_Info,
    ti.TestName,
    ti.TypeOfTest,
    fl.ASideLocation,
    ni.HomeOperator,
    ni.Technology,
    t.PrevTechnology as 'Data_Technology', 
    CONVERT(VARCHAR, COALESCE(aa.MsgTime, aaf.MsgTime, aam.MsgTime, sm.MsgTime), 121) AS EndTime,
    atp.ServiceProvider AS App,
    atp.ServiceProfileName AS ProfileName,
    COALESCE(aa.ActionId, aaf.ActionId, aam.ActionId, sm.ActionId) AS ActionId,
    COALESCE(aa.Duration, aaf.Duration, aam.Duration, sm.CoreDuration) AS 'Duration[ms]',
    CASE ISNULL(CAST(aa.Throughput AS REAL), aaf.Thp) * 8 / 1000
        WHEN 0 THEN NULL
        ELSE ISNULL(CAST(aa.Throughput AS REAL), aaf.Thp) * 8 / 1000
    END AS Throughput,
    CASE COALESCE(aa.ErrorCode, aaf.ErrorCode, aam.ErrorCode, sm.ErrorCode)
        WHEN 0 THEN 'Success'
        ELSE 'Failed'
    END AS ActionStatus,
    CASE 
        WHEN aap.ActionName = 'Ohome' THEN 'Open Home'
        WHEN aap.ActionName = 'Dp' THEN 'Delete Post'
        WHEN aap.ActionName = 'Cp' THEN 'Create Post'
        WHEN aap.ActionName = 'Lp' THEN 'Like Post'
        WHEN aap.ActionName = 'Cpicture' THEN 'Comment Post'
        WHEN aap.ActionName = 'Opost' THEN 'Open Post'
        WHEN aap.ActionName = 'Oprofile' THEN 'Open Profile'
        ELSE COALESCE(aap.ActionName, aad.ActionName, aau.ActionName, aaf.ActionName, aam.ActionName)
    END AS ActionName,
    aaf.Latency AS 'Latency[ms]',
    aaf.PacketLossPercent  AS 'PacketLoss[%]',
    ni.CGI,
    DATEADD(MS, -1 * COALESCE(aa.Duration, aaf.Duration, aam.Duration, sm.CoreDuration), 
        COALESCE(aa.MsgTime, aaf.MsgTime, aam.MsgTime, sm.MsgTime)) AS StartTime
FROM SessionsCTE s
INNER JOIN FileList fl ON fl.FileId = s.FileId
INNER JOIN TestInfo ti ON s.SessionId = ti.SessionId AND ti.Valid = 1
-- Joins για τις συντεταγμένες
--LEFT JOIN FactPosition fp ON ti.PosId = fp.PosId
LEFT JOIN Position dp ON dp.PosId = ti.PosId
INNER JOIN ResultsAppTestParameters atp ON ti.TestId = atp.TestId
LEFT JOIN ResultsAppActionSocialMedia sm ON sm.TestId = ti.TestId
LEFT JOIN ResultsAppAction aa ON ti.TestId = aa.TestId AND aa.LastBlock = 1
LEFT JOIN ResultsAppActionParams aap ON (aap.TestId = aa.TestId OR aap.TestId = sm.TestId)
    AND (aap.ActionId = aa.ActionId OR aap.ActionId = sm.ActionId)
LEFT JOIN ResultsAppActionDownloadFileParams aad ON ti.TestId = aad.TestId AND aad.ActionId = aa.ActionId
LEFT JOIN ResultsAppActionUploadFileParams aau ON ti.TestId = aau.TestId AND aau.ActionId = aa.ActionId
LEFT JOIN (
    SELECT 
        TestId,
        ActionId,
        MsgTime,
        ErrorCode,
        NetworkId,
        Duration = 1000 * CAST(DLSize AS REAL) / NULLIF(DLThroughput, 0),
        TransSize = DLSize,
        Thp = DLThroughput,
        ActionName = 'Downlink Performance',
        Latency = ISNULL(Ping, Latency),
        PacketLossPercent
    FROM ResultsAppActionPerformance
    UNION ALL
    SELECT 
        TestId,
        ActionId,
        MsgTime,
        ErrorCode,
        NetworkId,
        Duration = 1000 * CAST(ULSize AS REAL) / NULLIF(ULThroughput, 0),
        TransSize = ULSize,
        Thp = ULThroughput,
        ActionName = 'Uplink Performance',
        Latency = ISNULL(Ping, Latency),
        PacketLossPercent
    FROM ResultsAppActionPerformance
) aaf ON ti.TestId = aaf.TestId
LEFT JOIN (
    SELECT  
        r.TestId,
        r.ActionId,
        r.MsgTime,
        r.ErrorCode,
        r.NetworkId,
        r.Direction,
        CASE r.MessagingType
            WHEN 1 THEN 'Text'
            WHEN 2 THEN 'Sticker'
            WHEN 3 THEN 'Photo'
            WHEN 4 THEN 'Audio'
            WHEN 5 THEN 'Video'
            ELSE NULL
        END AS ActionName,
        CASE r.Direction
            WHEN 0 THEN r.Duration
            WHEN 1 THEN DATEDIFF(ms, ref.StartTime, r.LogTime)
                       - ISNULL(mdd.MinDeliveryTime, 0)
                       + ISNULL(md.MinDuration, 100)
            ELSE NULL
        END AS Duration
    FROM ResultsAppActionMessaging r
    INNER JOIN SessionsCTE s2 ON s2.SessionId = r.SessionId
    LEFT JOIN MinDurCTE md ON r.TestId = md.TestId
    INNER JOIN MinDelDurCTE mdd ON s2.FileId = mdd.FileId
    LEFT JOIN ResultsAppActionMessaging ref ON ref.Identifier = r.Identifier
        AND ref.ActionId = r.ActionId
        AND ref.Direction = 0 AND r.Direction = 1
) aam ON ti.TestId = aam.TestId
INNER JOIN NetworkInfo ni ON ni.NetworkId = ISNULL(ISNULL(ISNULL(aa.NetworkId, aaf.NetworkId), aam.NetworkId), ti.NetworkId)
LEFT JOIN Technology t ON t.PrevTechnology IS NOT NULL AND (
    (t.TestId = sm.TestId AND sm.MsgTime BETWEEN DATEADD(ms, -1 * t.Duration, t.MsgTime) AND t.MsgTime) OR
    (t.TestId = aam.TestId AND aam.MsgTime BETWEEN DATEADD(ms, -1 * t.Duration, t.MsgTime) AND t.MsgTime) OR
    (t.TestId = aaf.TestId AND aaf.MsgTime BETWEEN DATEADD(ms, -1 * t.Duration, t.MsgTime) AND t.MsgTime) OR
    (t.TestId = aa.TestId AND aa.MsgTime BETWEEN DATEADD(ms, -1 * t.Duration, t.MsgTime) AND t.MsgTime)
)
Where fl.CollectionName =:collection
    AND fl.ASideLocation =:location
  AND s.SessionId is not null 
  -- Φιλτράρισμα στην τελική στήλη ActionName
  AND (CASE 
        WHEN aap.ActionName = 'Ohome' THEN 'Open Home'
        WHEN aap.ActionName = 'Dp' THEN 'Delete Post'
        WHEN aap.ActionName = 'Cp' THEN 'Create Post'
        WHEN aap.ActionName = 'Lp' THEN 'Like Post'
        WHEN aap.ActionName = 'Cpicture' THEN 'Comment Post'
        WHEN aap.ActionName = 'Opost' THEN 'Open Post'
        WHEN aap.ActionName = 'Oprofile' THEN 'Open Profile'
        ELSE COALESCE(aap.ActionName, aad.ActionName, aau.ActionName, aaf.ActionName, aam.ActionName)
    END) = 'Downlink Performance'
ORDER BY ti.TestId, ISNULL(aa.ActionId, aaf.ActionId);''')
    with engine.begin() as conn:
        df = pd.read_sql(sql_calls, conn, params={
    "location":  phone,        # π.χ. "Cosmote Free A"
    "collection": collection,  # από το gg.py
    })
    print(f"(ookla) DataFrame loaded: {len(df)} rows for phone '{phone}' and collection '{collection}'.")
    if df.empty:
        print("No rows returned by the query.")
    return df
    