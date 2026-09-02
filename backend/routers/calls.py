"""Σελίδα Voice Calls: λίστα κλήσεων + σχόλια/validation ανά κλήση."""
from typing import Union

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from db import get_connection

router = APIRouter(tags=["calls"])


class CommentRequest(BaseModel):
    database: str
    session_id: Union[str, int]
    comment: str | None = ""


@router.post("/api/calls/comment")
def update_call_comment(req: CommentRequest):
    try:
        conn = get_connection(req.database)
        cursor = conn.cursor()

        # DwAnalysisCommentToSessionMapping holds one row per SessionId
        # (SessionId, Comment) — upsert it. AnalysisComment/AnalysisCommentSessionsBridge
        # are deprecated and no longer written to.
        cursor.execute(
            "SELECT 1 FROM DwAnalysisCommentToSessionMapping WHERE SessionId = ?",
            (req.session_id,),
        )
        if cursor.fetchone():
            cursor.execute(
                "UPDATE DwAnalysisCommentToSessionMapping SET Comment = ? WHERE SessionId = ?",
                (req.comment, req.session_id),
            )
        else:
            cursor.execute(
                "INSERT INTO DwAnalysisCommentToSessionMapping (SessionId, Comment) VALUES (?, ?)",
                (req.session_id, req.comment),
            )

        # If comment starts with 'fake' or 'FAKE', set session as invalid (Valid = 0), otherwise Valid = 1
        if req.comment and req.comment.lower().startswith("fake"):
            cursor.execute("UPDATE Sessions SET Valid = 0 WHERE SessionId = ?", (req.session_id,))
        else:
            cursor.execute("UPDATE Sessions SET Valid = 1 WHERE SessionId = ?", (req.session_id,))

        conn.commit()
        conn.close()

        return {"message": "Comment updated successfully"}
    except Exception as e:
        print(f"Error in update_call_comment mapping upsert: {e}")
        # If the above fails because of missing table, fallback to updating Sessions.InvalidReason
        try:
            conn = get_connection(req.database)
            cursor = conn.cursor()
            cursor.execute("UPDATE Sessions SET InvalidReason = ? WHERE SessionId = ?", (req.comment, req.session_id))
            if req.comment and req.comment.lower().startswith("fake"):
                cursor.execute("UPDATE Sessions SET Valid = 0 WHERE SessionId = ?", (req.session_id,))
            else:
                cursor.execute("UPDATE Sessions SET Valid = 1 WHERE SessionId = ?", (req.session_id,))
            conn.commit()
            conn.close()
            return {"message": "Comment updated successfully in Sessions"}
        except Exception as fallback_e:
            print(f"Fallback Error in update_call_comment: {fallback_e}")
            raise HTTPException(status_code=500, detail=str(e))


@router.get("/api/calls")
def list_calls(
    database: str = Query(..., min_length=1),
    collection: list[str] | None = Query(default=None),
    location: list[str] | None = Query(default=None),
):
    try:
        conn = get_connection(database)
        cursor = conn.cursor()

        # Writes (see update_call_comment above) go only to the newer
        # DwAnalysisCommentToSessionMapping table. Reads still fall back to the
        # legacy AnalysisComment/AnalysisCommentSessionsBridge tables so older
        # comments that were never migrated stay visible; DW wins when both exist.
        # Not every database has DwAnalysisCommentToSessionMapping, so only join
        # it when it's present.
        cursor.execute(
            "SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'DwAnalysisCommentToSessionMapping'"
        )
        has_dw_comments = cursor.fetchone() is not None

        dw_comment_join = (
            "LEFT JOIN DwAnalysisCommentToSessionMapping DWC ON DWC.SessionId = CA.SessionId"
            if has_dw_comments
            else ""
        )
        comment_expr = (
            "COALESCE(DWC.Comment, AC.Comment, S.InvalidReason)"
            if has_dw_comments
            else "COALESCE(AC.Comment, S.InvalidReason)"
        )

        query = f"""
            SELECT
                DF.ASideLocation AS Location,
                CA.SessionId,
                CA.technology as technology,
                CA.callmode AS callMode,
                CA.callType,
                CA.callDir,
                CA.callStatus AS status,
                DF.CollectionName,
                COALESCE(S.startTime, SB.startTime) AS callStartTimeStamp,
                ROUND(CA.setupTime, 2) AS setupTime,
                (SELECT ROUND(AVG(OptionalWB),2) AS MOS
                    FROM ResultsLQ08Avg
                    WHERE SessionId = CA.SessionId) AS Avg_mos,
                MOS.MosUlAvg AS mosUlAvg,
                MOS.MosUlMin AS mosUlMin,
                MOS.MosUlMax AS mosUlMax,
                MOS.MosUlSamples AS mosUlSamples,
                MOS.MosDlAvg AS mosDlAvg,
                MOS.MosDlMin AS mosDlMin,
                MOS.MosDlMax AS mosDlMax,
                MOS.MosDlSamples AS mosDlSamples,
                -- MOC/MTC setup time: ίδιο κριτήριο ΚΑΙ ίδια πηγή τιμής με το A-LEVEL
                -- "LQCallDataGSM.sql" reference query's MOCSetupTime/MTCSetupTime — απευθείας
                -- vResultsKPI.Duration (KPIID=10100, ErrorCode=0), όχι CA.setupTime (δοκιμάστηκε
                -- και ΔΕΝ ταιριάζει 1:1 με το pivot — βλ. VKPI OUTER APPLY). Callstatus in
                -- Completed/Dropped, Technology σε UMTS 2100/900 GSM 900/1800 (NETTECH, ίδιο
                -- "latest NetworkInfo πριν το session" pattern με το SessionCTE των A-LEVEL
                -- queries / /api/technology_mix). Επαληθεύτηκε 1:1 (τιμή ΚΑΙ sample count) στο
                -- STR_EVIA SOUTH_TOURISTIC AREAS_2026H2 / STEREA_26H2.
                CASE
                    WHEN CA.callDir LIKE 'A->B'
                     AND CA.callStatus IN ('Completed', 'Dropped')
                     AND NETTECH.Technology IN ('UMTS 2100', 'UMTS 900', 'GSM 900', 'GSM 1800')
                    THEN VKPI.Kpi10100Duration ELSE NULL
                END AS mocSetupTime,
                CASE
                    WHEN CA.callDir LIKE 'B->A'
                     AND CA.callStatus IN ('Completed', 'Dropped')
                     AND NETTECH.Technology IN ('UMTS 2100', 'UMTS 900', 'GSM 900', 'GSM 1800')
                    THEN VKPI.Kpi10100Duration ELSE NULL
                END AS mtcSetupTime,
                -- VoLTE/CS Call setup time: ίδιο κριτήριο με το A-LEVEL "LQCallData.sql"
                -- reference query's CallSetupTimeVoLTE/CallSetupTimeCS — απευθείας
                -- vResultsKPI.Duration, ΟΧΙ CA.setupTime (ίδιο πρόβλημα με το MOC/MTC
                -- παραπάνω). Real-data check στο ίδιο dataset: VoLTE/SRVCC rows έχουν
                -- ErrorCode=0 στο KPIID=11013 (η reference's KPIId), ενώ CS/CSFB rows δεν
                -- έχουν σχεδόν καθόλου KPIID=10108 (η reference's KPIId για CS) — αντ' αυτού
                -- έχουν KPIID=10100 (το ΙΔΙΟ KPI με το MOC/MTC), οπότε το CS setup διαβάζει
                -- από εκεί (10108 μένει σαν fallback για τις σπάνιες γραμμές που το έχουν).
                -- Callstatus in Completed/Dropped όπως στη reference. Ένα row ανά κλήση εδώ
                -- (όχι A/B-side ζευγάρι σαν CallSession.CallMode/CallModeB), οπότε αρκεί το
                -- CA.CallMode.
                CASE
                    WHEN CA.callStatus IN ('Completed', 'Dropped') AND CA.callmode IN ('VoLTE', 'SRVCC')
                    THEN VKPI.Kpi11013Duration ELSE NULL
                END AS volteSetupTime,
                CASE
                    WHEN CA.callStatus IN ('Completed', 'Dropped') AND CA.callmode IN ('CSFB', 'CS')
                    THEN VKPI.KpiCsDuration ELSE NULL
                END AS csSetupTime,
                CODEC.CodecFrAmrWbCount AS codecFrAmrWbCount,
                CODEC.CodecAmrHrCount AS codecAmrHrCount,
                CODEC.CodecAmrCount AS codecAmrCount,
                CODEC.CodecEfrCount AS codecEfrCount,
                CODEC.CodecFrCount AS codecFrCount,
                CODEC.CodecHrCount AS codecHrCount,
                CODEC.CodecOtherCount AS codecOtherCount,
                CODEC.CodecNoRateCount AS codecNoRateCount,
                BADCALL.BadCall AS badCall,
                BADCALL.BadCallPct AS badCallPercentage,
                BADCALL.NumBadSample AS numBadSample,
                BADCALL.NumValidSample AS numValidSample,
                BADCALL.NumSilenceSample AS numSilenceSample,
                BADQUALITY.BadQualityCall AS badQualityCall,
                (ca.callDuration/1000) as callDuration,
                {comment_expr} AS comment,
                DF.ASideFileName,
                POS.Latitude AS latitude,
                POS.Longitude AS longitude,
                S.Valid AS isValid
            FROM CallAnalysis CA
            LEFT JOIN FileList DF ON CA.FileId = DF.FileId
            LEFT JOIN Position POS ON CA.PosId = POS.PosId
            LEFT JOIN Sessions S ON S.SessionId = CA.SessionId
            LEFT JOIN SessionsB SB ON SB.SessionId = CA.SessionId
            LEFT JOIN AnalysisCommentSessionsBridge ACSB ON ACSB.sessionID = CA.SessionId
            LEFT JOIN AnalysisComment AC ON ACSB.commentId = AC.commentID
            {dw_comment_join}
            -- Raw ResultsLQ08Avg samples (ίδιο κριτήριο με το A-LEVEL Attachment C query:
            -- OptionalWB BETWEEN 1 AND 5, TestInfo.Valid = 1), σπασμένα σε UL (A->B) / DL (B->A)
            -- ανά TestInfo.direction — ώστε το count να είναι τα raw MOS samples (~calls x N),
            -- όχι ένα ήδη-μέσο-όρο νούμερο ανά κλήση.
            OUTER APPLY (
                SELECT
                    ROUND(AVG(CASE WHEN TI.direction = 'A->B' THEN LQ.OptionalWB END), 2) AS MosUlAvg,
                    MIN(CASE WHEN TI.direction = 'A->B' THEN LQ.OptionalWB END)           AS MosUlMin,
                    MAX(CASE WHEN TI.direction = 'A->B' THEN LQ.OptionalWB END)           AS MosUlMax,
                    COUNT(CASE WHEN TI.direction = 'A->B' THEN LQ.OptionalWB END)         AS MosUlSamples,
                    ROUND(AVG(CASE WHEN TI.direction = 'B->A' THEN LQ.OptionalWB END), 2) AS MosDlAvg,
                    MIN(CASE WHEN TI.direction = 'B->A' THEN LQ.OptionalWB END)           AS MosDlMin,
                    MAX(CASE WHEN TI.direction = 'B->A' THEN LQ.OptionalWB END)           AS MosDlMax,
                    COUNT(CASE WHEN TI.direction = 'B->A' THEN LQ.OptionalWB END)         AS MosDlSamples
                FROM ResultsLQ08Avg LQ
                JOIN TestInfo TI ON TI.TestId = LQ.TestId
                WHERE LQ.SessionId = CA.SessionId
                    AND TI.Valid = 1
                    AND LQ.OptionalWB BETWEEN 1 AND 5
            ) MOS
            -- Session's radio band (π.χ. "GSM 900", "UMTS 2100") για το MOC/MTC setup
            -- time φίλτρο παραπάνω — ίδιο "latest NetworkInfo πριν το session start"
            -- pattern με το SessionCTE των A-LEVEL queries και με το OUTER APPLY του
            -- /api/technology_mix, εδώ όμως keyed στο session start αντί σε Position.
            OUTER APPLY (
                SELECT TOP (1) n.Technology
                FROM NetworkInfo AS n
                WHERE n.FileId = CA.FileId
                  AND n.MsgTime < COALESCE(S.startTime, SB.startTime)
                ORDER BY n.MsgTime DESC
            ) NETTECH
            -- Setup-time KPI durations για MOC/MTC/VoLTE/CS setup time παραπάνω —
            -- vResultsKPI (υπάρχει σ' αυτό το schema, βλ. σχόλια στα CASE) φιλτραρισμένο σε
            -- ErrorCode=0, MIN ανά KPIID (μπορεί να υπάρχουν πολλαπλές γραμμές/session).
            -- KpiCsDuration παίρνει KPIID 10100 (πραγματική πηγή του "CS" setup σ' αυτά τα
            -- δεδομένα) με fallback στο 10108 (το KPIId της reference query, σπάνιο εδώ).
            OUTER APPLY (
                SELECT
                    MIN(CASE WHEN VK.KPIID = 10100 AND VK.ErrorCode = 0 THEN VK.Duration * 0.001 END) AS Kpi10100Duration,
                    MIN(CASE WHEN VK.KPIID = 11013 AND VK.ErrorCode = 0 THEN VK.Duration * 0.001 END) AS Kpi11013Duration,
                    MIN(CASE WHEN VK.KPIID IN (10100, 10108) AND VK.ErrorCode = 0 THEN VK.Duration * 0.001 END) AS KpiCsDuration
                FROM vResultsKPI VK
                WHERE VK.SessionID = CA.SessionId
            ) VKPI
            -- Codec Type Usage % inputs for the session: per-test counts bucketed
            -- exactly like the A-LEVEL "CallCodecTypeUsageGSM.sql" reference query /
            -- bucketCodec() in attachmentC.ts (Testinfo.Valid=1, Appl % 10 <> 0,
            -- direction-matched vVoiceCodecTest; AMR+WB -> FR AMR WB, AMR+HR -> AMR HR,
            -- AMR -> AMR, *EFR* -> EFR, HR%/FR% -> HR/FR, unrecognized -> other,
            -- NULL/'-' -> no codec rate). Returned as counts (not one dominant name) so
            -- the frontend can weight "Codec Type Usage %" by actual test volume.
            OUTER APPLY (
                SELECT
                    SUM(CASE WHEN Bucketed.CodecBucket = 'FR AMR WB' THEN Bucketed.Cnt ELSE 0 END) AS CodecFrAmrWbCount,
                    SUM(CASE WHEN Bucketed.CodecBucket = 'AMR HR' THEN Bucketed.Cnt ELSE 0 END) AS CodecAmrHrCount,
                    SUM(CASE WHEN Bucketed.CodecBucket = 'AMR' THEN Bucketed.Cnt ELSE 0 END) AS CodecAmrCount,
                    SUM(CASE WHEN Bucketed.CodecBucket = 'EFR' THEN Bucketed.Cnt ELSE 0 END) AS CodecEfrCount,
                    SUM(CASE WHEN Bucketed.CodecBucket = 'FR' THEN Bucketed.Cnt ELSE 0 END) AS CodecFrCount,
                    SUM(CASE WHEN Bucketed.CodecBucket = 'HR' THEN Bucketed.Cnt ELSE 0 END) AS CodecHrCount,
                    SUM(CASE WHEN Bucketed.CodecBucket = 'other' THEN Bucketed.Cnt ELSE 0 END) AS CodecOtherCount,
                    SUM(CASE WHEN Bucketed.CodecBucket = 'no codec rate' THEN Bucketed.Cnt ELSE 0 END) AS CodecNoRateCount
                FROM (
                    SELECT
                        CASE
                            WHEN VVCT.CodecName IS NULL OR VVCT.CodecName = '-' THEN 'no codec rate'
                            WHEN CHARINDEX('AMR', UPPER(VVCT.CodecName)) > 0 AND CHARINDEX('WB', UPPER(VVCT.CodecName)) > 0 THEN 'FR AMR WB'
                            WHEN CHARINDEX('AMR', UPPER(VVCT.CodecName)) > 0 AND CHARINDEX('HR', UPPER(VVCT.CodecName)) > 0 THEN 'AMR HR'
                            WHEN CHARINDEX('AMR', UPPER(VVCT.CodecName)) > 0 THEN 'AMR'
                            WHEN CHARINDEX('EFR', UPPER(VVCT.CodecName)) > 0 THEN 'EFR'
                            WHEN UPPER(VVCT.CodecName) LIKE 'HR%' THEN 'HR'
                            WHEN UPPER(VVCT.CodecName) LIKE 'FR%' THEN 'FR'
                            ELSE 'other'
                        END AS CodecBucket,
                        COUNT(*) AS Cnt
                    FROM TestInfo TI2
                    JOIN ResultsLQ08Avg R2 ON TI2.TestId = R2.TestId AND R2.Appl % 10 <> 0
                    LEFT JOIN vVoiceCodecTest VVCT ON TI2.TestID = VVCT.TestID AND (
                        (TI2.direction = 'A->B' AND VVCT.Direction = 'U') OR
                        (TI2.direction = 'B->A' AND VVCT.Direction = 'D')
                    )
                    WHERE TI2.SessionID = CA.SessionId AND TI2.Valid = 1
                    GROUP BY CASE
                        WHEN VVCT.CodecName IS NULL OR VVCT.CodecName = '-' THEN 'no codec rate'
                        WHEN CHARINDEX('AMR', UPPER(VVCT.CodecName)) > 0 AND CHARINDEX('WB', UPPER(VVCT.CodecName)) > 0 THEN 'FR AMR WB'
                        WHEN CHARINDEX('AMR', UPPER(VVCT.CodecName)) > 0 AND CHARINDEX('HR', UPPER(VVCT.CodecName)) > 0 THEN 'AMR HR'
                        WHEN CHARINDEX('AMR', UPPER(VVCT.CodecName)) > 0 THEN 'AMR'
                        WHEN CHARINDEX('EFR', UPPER(VVCT.CodecName)) > 0 THEN 'EFR'
                        WHEN UPPER(VVCT.CodecName) LIKE 'HR%' THEN 'HR'
                        WHEN UPPER(VVCT.CodecName) LIKE 'FR%' THEN 'FR'
                        ELSE 'other'
                    END
                ) Bucketed
            ) CODEC
            -- "BadCall" — ίδιο κριτήριο με το A-LEVEL LQStatisticData.sql reference query
            -- (Attachment C): ανά session, δείγμα-προς-δείγμα (όχι μέσος όρος). Ένα
            -- δείγμα είναι "κακό" αν OptionalWB < 2.2 ή έχει Silence flag (bit 10 του
            -- reversed QualityCode). BadCall = 1 αν το ποσοστό κακών δειγμάτων στα
            -- έγκυρα δείγματα ξεπερνά 15%. Ίδιο Valid/Appl φίλτρο με το MOS OUTER APPLY
            -- παραπάνω, μεταφρασμένο στο CallAnalysis (η reference υπολογίζει το BadCall
            -- πάνω σε Callsession/vResultsKPI QualityCode/Silence bits — δεν έχει
            -- επαληθευτεί 1:1 σαν το MOC/MTC/VoLTE/CS setup time παρακάτω, βλ. VKPI).
            OUTER APPLY (
                SELECT
                    CASE
                        WHEN SUM(CASE WHEN LQB.OptionalWB > 0 OR LQB.Silence = 1 THEN 1 ELSE 0 END) > 0
                        THEN CASE
                                WHEN CONVERT(REAL, SUM(CASE WHEN LQB.OptionalWB < 2.2 OR LQB.Silence = 1 THEN 1 ELSE 0 END)) * 100.0
                                     / CONVERT(REAL, SUM(CASE WHEN LQB.OptionalWB > 0 OR LQB.Silence = 1 THEN 1 ELSE 0 END)) > 15.0
                                THEN 1 ELSE 0
                             END
                        ELSE NULL
                    END AS BadCall,
                    CASE
                        WHEN SUM(CASE WHEN LQB.OptionalWB > 0 OR LQB.Silence = 1 THEN 1 ELSE 0 END) > 0
                        THEN CONVERT(REAL, SUM(CASE WHEN LQB.OptionalWB < 2.2 OR LQB.Silence = 1 THEN 1 ELSE 0 END)) * 100.0
                             / CONVERT(REAL, SUM(CASE WHEN LQB.OptionalWB > 0 OR LQB.Silence = 1 THEN 1 ELSE 0 END))
                        ELSE NULL
                    END AS BadCallPct,
                    SUM(CASE WHEN LQB.OptionalWB < 2.2 OR LQB.Silence = 1 THEN 1 ELSE 0 END) AS NumBadSample,
                    SUM(CASE WHEN LQB.OptionalWB > 0 OR LQB.Silence = 1 THEN 1 ELSE 0 END)   AS NumValidSample,
                    SUM(CASE WHEN LQB.Silence = 1 THEN 1 ELSE 0 END)                         AS NumSilenceSample
                FROM (
                    SELECT
                        LQ.OptionalWB,
                        CASE WHEN SUBSTRING(REVERSE(LQ.QualityCode), 10, 1) LIKE '1' THEN 1 ELSE 0 END AS Silence
                    FROM ResultsLQ08Avg LQ
                    JOIN TestInfo TI ON TI.TestId = LQ.TestId
                    WHERE LQ.SessionId = CA.SessionId
                      AND TI.Valid = 1
                      AND LQ.Appl % 10 <> 0
                ) LQB
            ) BADCALL
            -- "Low Speech Quality Calls (POLQA < 1.3)" — ίδιο κριτήριο με το A-LEVEL
            -- "LOW MOS 1_3.sql" reference query: μόνο Completed κλήσεις· ένα session
            -- πιάνεται αν υπάρχουν 3 διαδοχικά TestId δείγματα (L1, L1+1, L1+2) όπου
            -- το L1 είναι "κακό" ΚΑΙ (το L1+1 ή το L1+2 είναι επίσης "κακό") — "κακό"
            -- σημαίνει OptionalWB αυστηρά μέσα στο (1.01, 1.29) ή status='Silence' με
            -- ένα από τα δύο συγκεκριμένα QualityCode. Διαφορετικό silence-flag test
            -- από το BadCall παραπάνω (bit) — έτσι ακριβώς το ορίζει η reference query,
            -- δεν το ενοποιούμε.
            OUTER APPLY (
                SELECT CASE WHEN CA.callStatus = 'Completed' AND EXISTS (
                    SELECT 1
                    FROM ResultsLQ08Avg L1
                    JOIN TestInfo TI1 ON TI1.TestId = L1.TestId AND TI1.Valid = 1
                    LEFT JOIN ResultsLQ08Avg L2 ON L2.SessionId = L1.SessionId AND L2.TestId = L1.TestId + 1
                    LEFT JOIN ResultsLQ08Avg L3 ON L3.SessionId = L1.SessionId AND L3.TestId = L1.TestId + 2
                    WHERE L1.SessionId = CA.SessionId
                      AND (
                            (L1.OptionalWB < 1.29 AND L1.OptionalWB > 1.01)
                            OR (L1.status = 'Silence' AND L1.QualityCode IN ('0001000000000000', '0000001000000000'))
                          )
                      AND (
                            (
                                (L2.OptionalWB < 1.29 AND L2.OptionalWB > 1.01)
                                OR (L2.status = 'Silence' AND L2.QualityCode IN ('0001000000000000', '0000001000000000'))
                            )
                            OR
                            (
                                (L3.OptionalWB < 1.29 AND L3.OptionalWB > 1.01)
                                OR (L3.status = 'Silence' AND L3.QualityCode IN ('0001000000000000', '0000001000000000'))
                            )
                          )
                ) THEN 1 ELSE 0 END AS BadQualityCall
            ) BADQUALITY
            WHERE (S.Valid = 1 or S.Valid = 0)
        """

        params: list[object] = []
        selected_collections = [col for col in (collection or []) if col and col.strip()]

        if selected_collections:
            placeholders = ", ".join(["?"] * len(selected_collections))
            query += f" AND DF.CollectionName IN ({placeholders})"
            params.extend(selected_collections)

        selected_locations = [loc for loc in (location or []) if loc and loc.strip()]

        if selected_locations:
            placeholders = ", ".join(["?"] * len(selected_locations))
            query += f" AND DF.ASideLocation IN ({placeholders})"
            params.extend(selected_locations)

        query += " ORDER BY callStartTimeStamp"

        cursor.execute(query, tuple(params))

        columns = [col[0] for col in cursor.description] if cursor.description else []
        rows = cursor.fetchall() if cursor.description else []

        data = []
        for row in rows:
            data.append({columns[idx]: row[idx] for idx in range(len(columns))})

        conn.close()

        return {"rows": data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/api/technology_mix")
def get_technology_mix(
    database: str = Query(..., min_length=1),
    collection: list[str] | None = Query(default=None),
    location: list[str] | None = Query(default=None),
):
    """Ποσοστά ανά radio band (π.χ. "GSM 900", "GSM 1800", "LTE E-UTRA 20") — ίδια
    πηγή/μεθοδολογία με τον χάρτη ("Technology σημεία (FREE/GSM)" στο
    QueryMap.tsx / backend/validation_maps/queries.py::query_technology_free), ΟΧΙ
    το CA.technology του /api/calls (που είναι πολύ χοντρικό, π.χ. "LTE"/"GSM/LTE"
    — δεν ξεχωρίζει bands).

    Ένα "sample" = μία θέση GPS (Position) σε valid Session, με technology =
    NetworkInfo.Technology της πιο πρόσφατης καταγραφής πριν από αυτή τη θέση (ίδιο
    OUTER APPLY pattern, εδώ ΟΜΩΣ αθροισμένο με GROUP BY αντί να επιστρέφει
    ανά-γραμμή rows). Σκόπιμα ΔΕΝ περιορίζεται σε "μέσα σε ενεργή κλήση"
    (CallSession/callDir) ούτε φιλτράρει DATA locations / Scanner devices — αυτό
    το endpoint τροφοδοτεί το ίδιο table (SummaryTab technology mix) που πρέπει να
    ταιριάζει 1:1 με ό,τι δείχνει ο χάρτης για το ίδιο collection/location, αλλιώς
    βγαίνουν διαφορετικά ποσοστά (π.χ. STR_EVIA SOUTH_TOURISTIC AREAS_2026H2).
    """
    try:
        conn = get_connection(database)
        cursor = conn.cursor()

        query = """
            SELECT
                FileList.ASideLocation AS location,
                ni.technology AS technology,
                COUNT(*) AS samples
            FROM Sessions
            INNER JOIN FileList ON Sessions.FileId = FileList.FileId
            INNER JOIN Position ON Sessions.SessionId = Position.SessionId
            OUTER APPLY (
                SELECT TOP (1) n.*
                FROM NetworkInfo AS n
                WHERE n.FileId = Position.FileId
                  AND n.MsgTime < Position.MsgTime
                ORDER BY n.MsgTime DESC
            ) AS ni
            WHERE Sessions.Valid = 1
              AND ni.technology IS NOT NULL
              AND ni.technology <> 'Unknown'
        """

        params: list[object] = []
        selected_collections = [col for col in (collection or []) if col and col.strip()]
        if selected_collections:
            placeholders = ", ".join(["?"] * len(selected_collections))
            query += f" AND FileList.CollectionName IN ({placeholders})"
            params.extend(selected_collections)

        selected_locations = [loc for loc in (location or []) if loc and loc.strip()]
        if selected_locations:
            placeholders = ", ".join(["?"] * len(selected_locations))
            query += f" AND FileList.ASideLocation IN ({placeholders})"
            params.extend(selected_locations)

        query += " GROUP BY FileList.ASideLocation, ni.technology"

        cursor.execute(query, tuple(params))

        columns = [col[0] for col in cursor.description] if cursor.description else []
        rows = cursor.fetchall() if cursor.description else []

        data = [{columns[idx]: row[idx] for idx in range(len(columns))} for row in rows]

        conn.close()

        return {"rows": data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/api/cell_band_count")
def get_cell_band_count(
    database: str = Query(..., min_length=1),
    collection: list[str] | None = Query(default=None),
):
    """"Number of 900/1800 band Cells" (Attachment C, GSM) — πλήθος ΔΙΑΚΡΙΤΩΝ cells ανά
    (ASideLocation, NetworkInfo.Technology). Ίδιο query και μεθοδολογία με το A-LEVEL
    "CELL ID GSM.sql" reference query (κοινό πλέον για τους 3 operators, πριν ήταν 3
    ξεχωριστά αρχεία ένα ανά ASideLocation), με COUNT(DISTINCT NetworkInfo.CID) — ΟΧΙ
    CGI, που έχει μικρές ασυνέπειες LAC/MCC/MNC formatting και φουσκώνει το count κατά
    1-2. Επαληθεύτηκε 1:1 στο STR_EVIA SOUTH_TOURISTIC AREAS_2026H2 / STEREA_26H2
    (GSM 1800: 1/24/8, GSM 900: 70/66/72 για Cosmote/Vodafone/Nova).

    Το "latest NetworkInfo πριν από κάθε Position" εδώ ΔΕΝ είναι το OUTER APPLY
    MsgTime<Position.MsgTime pattern του /api/technology_mix — είναι το
    NetworkIdRelation nr1/nr2 boundary-by-PosId pattern της reference query. Δύο
    διαφορετικές μεθοδολογίες για «ποιο δίκτυο ήταν ενεργό σ' αυτή τη θέση» — κρατάμε
    εδώ ακριβώς αυτή της reference γιατί είναι αυτή που επαληθεύτηκε 1:1.
    """
    try:
        conn = get_connection(database)
        cursor = conn.cursor()

        query = """
            SELECT
                FileList.ASideLocation AS location,
                NetworkInfo.Technology AS technology,
                COUNT(DISTINCT NetworkInfo.CID) AS cellCount
            FROM
                Sessions AS Sessions, Position, FileList,
                NetworkIdRelation nr1, NetworkIdRelation nr2,
                NetworkInfo
            WHERE FileList.CollectionName like '%%' AND
                Sessions.FileId = FileList.FileId and
                Sessions.Valid = 1 And
                Sessions.SessionId = Position.SessionId And
                FileList.FileId = NetworkInfo.FileId and
                NetworkInfo.FileId = Position.FileId And
                (NetworkInfo.NetworkId = nr1.NetworkId and Position.PosId > nr1.PosId) and
                (NetworkInfo.NetworkId + 1 = nr2.NetworkId and Position.PosId <= nr2.PosId) and
                nr2.type = 'NetworkId' and nr1.type = 'NetworkId' and
                NetworkInfo.CId > 0 and
                FileList.ASideLocation LIKE '%GSM'
        """

        params: list[object] = []
        selected_collections = [col for col in (collection or []) if col and col.strip()]
        if selected_collections:
            placeholders = ", ".join(["?"] * len(selected_collections))
            query += f" AND FileList.CollectionName IN ({placeholders})"
            params.extend(selected_collections)

        query += " GROUP BY FileList.ASideLocation, NetworkInfo.Technology"

        cursor.execute(query, tuple(params))

        columns = [col[0] for col in cursor.description] if cursor.description else []
        rows = cursor.fetchall() if cursor.description else []

        data = [{columns[idx]: row[idx] for idx in range(len(columns))} for row in rows]

        conn.close()

        return {"rows": data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/api/serving_band_tech")
def get_serving_band_tech(
    database: str = Query(..., min_length=1),
    collection: list[str] | None = Query(default=None),
    location: list[str] | None = Query(default=None),
):
    """Serving Band (NR) / Serving Technology (per Time) — ποσοστά για το SummaryTab
    "PS Data Stats" block. Οι δύο "kind" έχουν ΔΙΑΦΟΡΕΤΙΚΗ βάση δειγμάτων:

    TECH ("Serving Technology (per Time)") — ακριβής μεταγραφή του πραγματικού "bi
    queries" reference query (δόθηκε αυτούσιο 2026-08-31, βλ. Ord list στο
    buildServingBandTechTable): ένα "sample" = μία Position πάνω σε valid PS Data DL
    test (Capacity DL / FTP DL / HTTP TRANSFER (DL)) που ΕΧΕΙ NetworkInfo row για το
    TestInfo.NetworkId ΚΑΙ Technology row πριν από αυτή (plain/INNER join και στα δύο,
    όπως η reference — ΟΧΙ LEFT/OUTER APPLY σαν πριν). Technology =
    Technology.CurrTechnology της πιο πρόσφατης τέτοιας εγγραφής (Technology.SessionId
    = Sessions.SessionId, Technology.MsgTime = MAX(...) πριν το sample — ίδιο
    "correlated MAX" pattern με τη reference, ΟΧΙ το OUTER APPLY TOP 1 του παλιού
    query). Η στήλη CurrTechnology αποθηκεύει το raw 5G-NSA label ως 'LTE-5G NR' (με
    κενό) — γίνεται REPLACE σε 'LTE-5GNR' (χωρίς κενό, ίδιο με το reference SQL) ώστε
    να ταιριάζει με το literal code του SERVING_BAND_TECH_METRICS στο frontend.

    ΣΗΜΕΙΩΣΗ '#NODATA' / "No data transfer (%)" (ord 16 στο SERVING_BAND_TECH_METRICS):
    η reference ΔΕΝ έχει bucket γι' αυτό — ένα sample χωρίς NetworkInfo ή χωρίς
    Technology row πριν από αυτό αποκλείεται εντελώς από το TECH count (δεν εμφανίζεται
    πουθενά, ούτε ως 'Other'), αντί να μπαίνει σε '#NODATA' όπως έκανε το παλιό OUTER
    APPLY. Ρητή επιλογή (2026-08-31) ώστε το TECH να ταιριάζει 1:1 με τη reference — το
    "No data transfer (%)" row στο SummaryTab πλέον βγαίνει 0 αντί να μετράει πραγματικά
    samples.

    BAND ("Serving Band (per Time)") — ΟΧΙ πάνω στα ίδια DL-test Position δείγματα
    (αυτό υποεκτιμούσε δραστικά τα NR28/NR1/NR78 ποσοστά, μόνο τα download-test
    στιγμιότυπα). Ίδιο query/μεθοδολογία με το A-LEVEL reference query: ΚΑΘΕ
    FactNR5GRadio εγγραφή (join FactNR5GCellInfo για το Band) για sessions σε
    ASideLocation LIKE '%Data%' — ανεξάρτητα από ποιο PS Data test έτρεχε τη στιγμή
    της εγγραφής, κανονικοποιημένο σε "NR28"/"NR1"/"NR78" κ.λπ.

    Επιστρέφει flat (location, kind, code, samples) rows, ΟΧΙ ήδη υπολογισμένα
    ποσοστά — το ίδιο σχήμα με /api/technology_mix — ώστε το frontend να μπορεί να
    αθροίσει ανά operator (buildServingBandTechTable) πριν διαιρέσει.
    """
    try:
        conn = get_connection(database)
        cursor = conn.cursor()

        query = """
            SELECT 'TECH' AS kind, FileList.ASideLocation AS location,
                   REPLACE(Technology.CurrTechnology, 'LTE-5G NR', 'LTE-5GNR') AS code,
                   COUNT(*) AS samples
            FROM Sessions
            JOIN FileList ON FileList.FileId = Sessions.FileId
            JOIN TestInfo ON TestInfo.SessionId = Sessions.SessionId
            JOIN Position ON Position.TestId = TestInfo.TestId
            JOIN NetworkInfo ON NetworkInfo.NetworkId = TestInfo.NetworkId
            JOIN Technology ON Technology.SessionId = Sessions.SessionId
                AND Technology.MsgTime = (
                    SELECT MAX(tech_2.MsgTime)
                    FROM Technology tech_2
                    WHERE tech_2.TestId = Position.TestId
                      AND tech_2.MsgTime < Position.MsgTime
                      AND tech_2.CurrTechnology IS NOT NULL
                )
            WHERE Sessions.Valid = 1
              AND TestInfo.Valid = 1
              AND TestInfo.TestName IN ('Capacity DL','FTP DL','HTTP TRANSFER (DL)')
        """

        params: list[object] = []
        selected_collections = [col for col in (collection or []) if col and col.strip()]
        if selected_collections:
            placeholders = ", ".join(["?"] * len(selected_collections))
            query += f" AND FileList.CollectionName IN ({placeholders})"
            params.extend(selected_collections)

        selected_locations = [loc for loc in (location or []) if loc and loc.strip()]
        if selected_locations:
            placeholders = ", ".join(["?"] * len(selected_locations))
            query += f" AND FileList.ASideLocation IN ({placeholders})"
            params.extend(selected_locations)

        query += """
            GROUP BY FileList.ASideLocation, REPLACE(Technology.CurrTechnology, 'LTE-5G NR', 'LTE-5GNR')

            UNION ALL

            SELECT 'BAND' AS kind, FileList.ASideLocation AS location,
                   'NR' + REPLACE(REPLACE(UPPER(LTRIM(RTRIM(FactNR5GCellInfo.Band))), 'NR', ''), 'N', '') AS code,
                   COUNT(*) AS samples
            FROM FactNR5GRadio
            JOIN Sessions ON FactNR5GRadio.SessionId = Sessions.SessionId
            JOIN FileList ON FactNR5GRadio.FileId = FileList.FileId
            JOIN FactNR5GCellInfo ON FactNR5GCellInfo.NR5GCACellInfoId = FactNR5GRadio.FactIdFactNR5GCellInfo
            WHERE Sessions.Valid = 1
              AND FileList.ASideLocation LIKE '%Data%'
              AND FactNR5GCellInfo.Band IS NOT NULL
        """

        if selected_collections:
            placeholders = ", ".join(["?"] * len(selected_collections))
            query += f" AND FileList.CollectionName IN ({placeholders})"
            params.extend(selected_collections)

        if selected_locations:
            placeholders = ", ".join(["?"] * len(selected_locations))
            query += f" AND FileList.ASideLocation IN ({placeholders})"
            params.extend(selected_locations)

        query += """
            GROUP BY FileList.ASideLocation, 'NR' + REPLACE(REPLACE(UPPER(LTRIM(RTRIM(FactNR5GCellInfo.Band))), 'NR', ''), 'N', '')
        """

        cursor.execute(query, tuple(params))

        columns = [col[0] for col in cursor.description] if cursor.description else []
        rows = cursor.fetchall() if cursor.description else []

        data = [{columns[idx]: row[idx] for idx in range(len(columns))} for row in rows]

        conn.close()

        return {"rows": data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/api/srvcc")
def get_srvcc(
    database: str = Query(..., min_length=1),
    collection: list[str] | None = Query(default=None),
):
    """"Total/Successful/Failed SRVCC attempts" — 3 γραμμές στο τέλος του FREE table
    (Attachment C). Ίδιο query/μεθοδολογία με το A-LEVEL "SRVCC RAW.sql" reference
    query: ένα "attempt" = ένα distinct (SessionId, ResultsKPI.KPIId, ErrorCode) HO
    event, KPIId 38040 (4G->3G) ή 38050 (4G->2G) — το ίδιο HO (handover) KPI, όχι
    το vResultsKPI/Kpi11013 που τροφοδοτεί το VoLTE call setup time. ErrorCode=0
    -> success, ErrorCode=108003 -> fail (η reference query ονομάζει "N/A" κάθε
    άλλο ErrorCode — δεν το μετράμε ως fail, αλλά μπαίνει στο "attempts" total).

    Ίδιο "latest NetworkInfo πριν το session start" pattern (FileId + StartTime >
    MsgTime) με το A-LEVEL "LQCallData.sql" reference query's WHERE clause — ΔΕΝ
    είναι το Position.MsgTime OUTER APPLY του /api/technology_mix ούτε το
    NetworkIdRelation boundary pattern του /api/cell_band_count, κρατάμε το ίδιο
    με τη reference query.

    Επιστρέφει ήδη-αθροισμένα (location, status, count) rows — το frontend τα
    αθροίζει ανά operator (buildSrvccTable).
    """
    try:
        conn = get_connection(database)
        cursor = conn.cursor()

        query = """
            WITH SrvccEvents AS (
                SELECT DISTINCT
                    Sessions.SessionId,
                    FileList.ASideLocation AS Location,
                    ResultsKPI.ErrorCode
                FROM NetworkInfo, CallSession
                JOIN Sessions ON CallSession.SessionId = Sessions.SessionId
                JOIN FileList ON FileList.FileId = Sessions.FileId
                JOIN ResultsKPI ON CallSession.SessionId = ResultsKPI.SessionId
                WHERE Sessions.Valid = 1
                  AND CallSession.callStatus IN ('Completed', 'Failed', 'Dropped')
                  AND FileList.ASideLocation LIKE '%Free A%'
                  AND ResultsKPI.KPIId IN (38040, 38050)
                  AND NetworkInfo.NetworkId = (
                        SELECT MAX(nf.NetworkId) FROM NetworkInfo nf
                        WHERE FileList.FileId = nf.FileId AND Sessions.StartTime > nf.MsgTime
                  )
        """

        params: list[object] = []
        selected_collections = [col for col in (collection or []) if col and col.strip()]
        if selected_collections:
            placeholders = ", ".join(["?"] * len(selected_collections))
            query += f" AND FileList.CollectionName IN ({placeholders})"
            params.extend(selected_collections)

        query += """
            )
            SELECT
                Location AS location,
                CASE
                    WHEN ErrorCode = 0 THEN 'success'
                    WHEN ErrorCode = 108003 THEN 'fail'
                    ELSE 'other'
                END AS status,
                COUNT(*) AS count
            FROM SrvccEvents
            GROUP BY Location, CASE
                    WHEN ErrorCode = 0 THEN 'success'
                    WHEN ErrorCode = 108003 THEN 'fail'
                    ELSE 'other'
                END
        """

        cursor.execute(query, tuple(params))

        columns = [col[0] for col in cursor.description] if cursor.description else []
        rows = cursor.fetchall() if cursor.description else []

        data = [{columns[idx]: row[idx] for idx in range(len(columns))} for row in rows]

        conn.close()

        return {"rows": data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/api/ookla")
def get_ookla(
    database: str = Query(..., min_length=1),
    collection: list[str] | None = Query(default=None),
    location: list[str] | None = Query(default=None),
):
    """"Ookla DL"/"Ookla UL" (PS Data Stats, βλ. sectionRank στο attachmentC.ts — τα
    pin-άρει αμέσως κάτω από το Capacity UL). Ίδιο query με το A-LEVEL "OOKLA RAW
    (CTE-Compatible)" reference query· ήδη υπήρχε παρόμοια (μαζί με Lat/Long) στο
    backend/queries.py::query_ookla ως pandas script, εδώ ως FastAPI endpoint με
    multi-select collection/location φίλτρα (ίδιο convention με τα υπόλοιπα endpoints
    εδώ) αντί για ένα μοναδικό collection/location.

    Η reference query είναι γενική (καλύπτει ΚΑΘΕ App test action — social media
    posts/messaging KAI downlink/uplink performance) — φιλτράρουμε στο τέλος στο
    ΙΔΙΟ ActionName CASE με το query_ookla's WHERE (βλ. εκεί) ώστε να μείνουν μόνο
    οι 'Downlink Performance'/'Uplink Performance' γραμμές (Ookla speedtest), όχι οι
    social/messaging action rows άλλων app tests στο ίδιο collection.

    Throughput ήδη σε kbps (DLThroughput/ULThroughput * 8 / 1000, ίδιο με τη
    reference). Το frontend μετατρέπει αυτά τα rows σε DataCallRow-σχήμα
    (testType="Ookla", direction="DL"/"UL") ώστε να μπουν στο ίδιο buildDataSections
    pipeline με τα υπόλοιπα PS Data tests — βλ. mapOoklaRowsToDataCallRows.
    """
    try:
        conn = get_connection(database)
        cursor = conn.cursor()

        query = """
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
                ti.SessionId AS sessionId,
                ti.TestId AS testId,
                fl.CollectionName AS collectionName,
                fl.ASideDevice AS aSideDevice,
                fl.ASideFileName AS aSideFileName,
                fl.ASideLocation AS location,
                ni.HomeOperator AS homeOperator,
                ni.Technology AS technology,
                t.PrevTechnology AS dataTechnology,
                CONVERT(VARCHAR, COALESCE(aa.MsgTime, aaf.MsgTime, aam.MsgTime, sm.MsgTime), 121) AS endTime,
                atp.ServiceProvider AS app,
                atp.ServiceProfileName AS profileName,
                COALESCE(aa.ActionId, aaf.ActionId, aam.ActionId, sm.ActionId) AS actionId,
                COALESCE(aa.Duration, aaf.Duration, aam.Duration, sm.CoreDuration) AS durationMs,
                CASE ISNULL(CAST(aa.Throughput AS REAL), aaf.Thp) * 8 / 1000
                    WHEN 0 THEN NULL
                    ELSE ISNULL(CAST(aa.Throughput AS REAL), aaf.Thp) * 8 / 1000
                END AS throughputKbps,
                CASE COALESCE(aa.ErrorCode, aaf.ErrorCode, aam.ErrorCode, sm.ErrorCode)
                    WHEN 0 THEN 'Success'
                    ELSE 'Failed'
                END AS actionStatus,
                CASE
                    WHEN aap.ActionName = 'Ohome' THEN 'Open Home'
                    WHEN aap.ActionName = 'Dp' THEN 'Delete Post'
                    WHEN aap.ActionName = 'Cp' THEN 'Create Post'
                    WHEN aap.ActionName = 'Lp' THEN 'Like Post'
                    WHEN aap.ActionName = 'Cpicture' THEN 'Comment Post'
                    WHEN aap.ActionName = 'Opost' THEN 'Open Post'
                    WHEN aap.ActionName = 'Oprofile' THEN 'Open Profile'
                    ELSE COALESCE(aap.ActionName, aad.ActionName, aau.ActionName, aaf.ActionName, aam.ActionName)
                END AS actionName,
                aaf.Latency AS latencyMs,
                aaf.PacketLossPercent AS packetLossPct,
                ni.CGI AS cgi,
                DATEADD(MS, -1 * COALESCE(aa.Duration, aaf.Duration, aam.Duration, sm.CoreDuration),
                    COALESCE(aa.MsgTime, aaf.MsgTime, aam.MsgTime, sm.MsgTime)) AS startTime
            FROM SessionsCTE s
            INNER JOIN FileList fl ON fl.FileId = s.FileId
            INNER JOIN TestInfo ti ON s.SessionId = ti.SessionId AND ti.Valid = 1
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
            WHERE s.SessionId IS NOT NULL
              -- Μόνο Ookla speedtest rows (Downlink/Uplink Performance) — ίδιο φίλτρο
              -- με το backend/queries.py::query_ookla, εδώ και για τις δύο κατευθύνσεις.
              AND (CASE
                    WHEN aap.ActionName = 'Ohome' THEN 'Open Home'
                    WHEN aap.ActionName = 'Dp' THEN 'Delete Post'
                    WHEN aap.ActionName = 'Cp' THEN 'Create Post'
                    WHEN aap.ActionName = 'Lp' THEN 'Like Post'
                    WHEN aap.ActionName = 'Cpicture' THEN 'Comment Post'
                    WHEN aap.ActionName = 'Opost' THEN 'Open Post'
                    WHEN aap.ActionName = 'Oprofile' THEN 'Open Profile'
                    ELSE COALESCE(aap.ActionName, aad.ActionName, aau.ActionName, aaf.ActionName, aam.ActionName)
                END) IN ('Downlink Performance', 'Uplink Performance')
        """

        params: list[object] = []
        selected_collections = [col for col in (collection or []) if col and col.strip()]
        if selected_collections:
            placeholders = ", ".join(["?"] * len(selected_collections))
            query += f" AND fl.CollectionName IN ({placeholders})"
            params.extend(selected_collections)

        selected_locations = [loc for loc in (location or []) if loc and loc.strip()]
        if selected_locations:
            placeholders = ", ".join(["?"] * len(selected_locations))
            query += f" AND fl.ASideLocation IN ({placeholders})"
            params.extend(selected_locations)

        query += " ORDER BY ti.TestId, ISNULL(aa.ActionId, aaf.ActionId)"

        cursor.execute(query, tuple(params))

        columns = [col[0] for col in cursor.description] if cursor.description else []
        rows = cursor.fetchall() if cursor.description else []

        data = [{columns[idx]: row[idx] for idx in range(len(columns))} for row in rows]
        for item in data:
            if item.get("endTime") is not None and not isinstance(item["endTime"], str):
                item["endTime"] = str(item["endTime"])
            if item.get("startTime") is not None and hasattr(item["startTime"], "isoformat"):
                item["startTime"] = item["startTime"].isoformat()

        conn.close()

        return {"rows": data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/api/capacity_link")
def get_capacity_link(
    database: str = Query(..., min_length=1),
    collection: list[str] | None = Query(default=None),
    location: list[str] | None = Query(default=None),
):
    """Ε1 · Bulk throughput — breakdown του "Capacity DL 10GB"/"Capacity UL 1GB" ανά
    server ("Link": grx/akamai) — βλ. "θέλω να μου το σπάσεις Link grx και akamai"
    (2026-08-31). ΔΕΝ αντικαθιστά τις υπάρχουσες "Capacity" γραμμές του CDRCombined
    (/api/data_calls) — αυτές μένουν όπως ήταν, η βάση των Ε1 compact directional
    tables (βλ. buildDirectionalDataSections). Αυτό εδώ είναι ένα ΕΠΙΠΛΕΟΝ breakdown,
    ίδιο query με το ήδη υπάρχον "CAPACITY – DL/UL Throughput (grx+akamai+ookla)"
    saved query του QueryMap (βλ. src/components/QueryMap.tsx — CAPACITY TESTS
    UNION branch), εδώ χωρίς το APP TESTS union branch και χωρίς Position/lat-long
    (δεν χρειάζεται χάρτης εδώ, μόνο aggregation ανά operator/link).

    Ο διαχωρισμός σε grx/akamai γίνεται πάνω στο ResultsCapacityTestParameters.URIList
    (ίδιο CASE με το QueryMap) — ResultsCapacityTest.TestId = ResultsCapacityTestParameters.TestId.
    Direction 'get%' = DL, 'put%' = UL (ίδιο conventiοn με τα δύο ξεχωριστά QueryMap
    saved queries, εδώ ενωμένα σε ένα call). ThroughputGet/ThroughputPut είναι σε
    bytes/sec (ίδιο με το QueryMap's *8.0/1000000.0 -> Mbps) — εδώ *8.0/1000.0 για
    kbps, ίδια μονάδα με το CDRCombined "Capacity_Sustainable Throughput (kbps)".

    Το frontend μετατρέπει αυτά τα rows σε DataCallRow σχήμα (testType="Capacity
    grx"/"Capacity akamai") ώστε να μπουν στο ίδιο buildDataSections pipeline, σαν
    ΕΠΙΠΛΕΟΝ sections δίπλα στα κύρια Capacity DL/UL — μόνο στο Full mode (βλ.
    mapCapacityLinkRowsToDataCallRows στο attachmentC.ts, COMPACT_EXCLUDED_SECTION_LABELS
    στο SummaryTab.tsx).
    """
    try:
        conn = get_connection(database)
        cursor = conn.cursor()

        query = """
            SELECT
                fl.ASideFileName AS aSideFileName,
                fl.CollectionName AS collectionName,
                fl.ASideLocation AS location,
                s.SessionId AS sessionId,
                rct.TestId AS testId,
                CASE
                    WHEN rctp.Direction LIKE 'get%' THEN 'DL'
                    WHEN rctp.Direction LIKE 'put%' THEN 'UL'
                    ELSE rctp.Direction
                END AS direction,
                CASE
                    WHEN rctp.URIList LIKE '%akamai-bench.commsquare.com%' THEN 'akamai'
                    WHEN rctp.URIList LIKE '%grx-bench.commsquare.com%' THEN 'grx'
                    ELSE LEFT(rctp.URIList, CHARINDEX(';', rctp.URIList + ';') - 1)
                END AS link,
                CASE WHEN rctp.Direction LIKE 'get%' THEN rct.ThroughputGet ELSE rct.ThroughputPut END * 8.0 / 1000.0 AS throughputKbps,
                CASE WHEN rct.ErrorCode = 0 THEN 1 ELSE 0 END AS success,
                CASE WHEN rct.ErrorCode = 0 THEN 0 ELSE 1 END AS failed
            FROM Sessions s
            INNER JOIN FileList fl                    ON fl.FileId = s.FileId
            INNER JOIN ResultsCapacityTest rct         ON rct.SessionId = s.SessionId
            INNER JOIN ResultsCapacityTestParameters rctp ON rctp.TestId = rct.TestId
            WHERE s.Valid = 1
              AND rct.LastBlock = 1
              AND (rctp.Direction LIKE 'get%' OR rctp.Direction LIKE 'put%')
        """

        params: list[object] = []
        selected_collections = [col for col in (collection or []) if col and col.strip()]
        if selected_collections:
            placeholders = ", ".join(["?"] * len(selected_collections))
            query += f" AND fl.CollectionName IN ({placeholders})"
            params.extend(selected_collections)

        selected_locations = [loc for loc in (location or []) if loc and loc.strip()]
        if selected_locations:
            placeholders = ", ".join(["?"] * len(selected_locations))
            query += f" AND fl.ASideLocation IN ({placeholders})"
            params.extend(selected_locations)

        cursor.execute(query, tuple(params))

        columns = [col[0] for col in cursor.description] if cursor.description else []
        rows = cursor.fetchall() if cursor.description else []

        data = [{columns[idx]: row[idx] for idx in range(len(columns))} for row in rows]

        conn.close()

        return {"rows": data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/api/ping_1000")
def get_ping_1000(
    database: str = Query(..., min_length=1),
    collection: list[str] | None = Query(default=None),
    location: list[str] | None = Query(default=None),
):
    """Ping 40/800/1000 (PS Data Stats) — δεν φτάνουν σαν δικό τους TestName από το
    CDRCombined view (βλ. /api/data_calls· από εκεί φτάνει μόνο "Ping"/"Payload Ping
    BIDIRECTIONAL"), οπότε τα φτιάχνουμε από το raw ResultsPingTest — ίδιο query με το
    A-LEVEL "PING RAW.sql" reference query (ίδιο query με το "Ping RAW" saved query του
    QueryEditor).

    ΕΝΗΜΕΡΩΣΗ (2026-08-31): ΧΩΡΙΣ PacketSize filter πλέον — γυρνάει packets ΚΑΙ για τα
    τρία μεγέθη (40/800/1000) σε ΕΝΑ call, το frontend τα χωρίζει σε "Ping 40"/"Ping 800"/
    "Ping 1000" βάσει του packetSize (βλ. mapPing1000RowsToDataCallRows στο
    attachmentC.ts). Πριν, φιλτράραμε εδώ σε PacketSize=1000 μόνο επειδή τα "Ping 40 B"/
    "Ping 800 B" έφταναν από το CDRCombined view (TestName "ICMP Ping 40"/"ICMP Ping
    800") — αυτό το endpoint είναι ΠΛΕΟΝ η ΜΟΝΗ πηγή και για τα τρία, οπότε το frontend
    βγάζει ρητά τα "ICMP Ping 40"/"ICMP Ping 800" από τα /api/data_calls rows πριν μπουν
    στο summary pipeline (βλ. excludeCdrPingDuplicates στο attachmentC.ts) — αλλιώς το
    Ping 40 B/800 B θα μετρούσε διπλά.

    Ένα row ανά ping packet (raw, όχι ήδη-αθροισμένο ανά test) — RTT μόνο όταν
    ErrorCode=0 (αλλιώς NULL), success/failed από το ίδιο ErrorCode. Το frontend τα
    μετατρέπει σε DataCallRow σχήμα (testType="Ping 40"/"Ping 800"/"Ping 1000") ώστε να
    μπουν στο ίδιο buildDataSections pipeline με τα υπόλοιπα PS Data tests — βλ.
    mapPing1000RowsToDataCallRows στο attachmentC.ts.
    """
    try:
        conn = get_connection(database)
        cursor = conn.cursor()

        query = """
            SELECT
                FileList.ASideFileName AS aSideFileName,
                FileList.CollectionName AS collectionName,
                FileList.ASideLocation AS location,
                Sessions.SessionId AS sessionId,
                TestInfo.TestId AS testId,
                ResultsPingTest.Host AS host,
                CASE WHEN ResultsPingTest.ErrorCode = 0 THEN ResultsPingTest.RTT ELSE NULL END AS rtt,
                ResultsPingTest.PacketSize AS packetSize,
                ErrorCodes.msg AS errorCode,
                CASE WHEN ResultsPingTest.ErrorCode = 0 THEN 1 ELSE 0 END AS success,
                CASE WHEN ResultsPingTest.ErrorCode = 0 THEN 0 ELSE 1 END AS failed,
                ResultsPingTest.seqNumber AS sequenceNumber
            FROM FileList, Sessions, TestInfo, NetworkInfo, ResultsPingTest, ErrorCodes
            WHERE Sessions.Valid = 1 AND TestInfo.Valid = 1
              AND FileList.FileId = Sessions.FileId
              AND TestInfo.SessionId = Sessions.SessionId
              AND ResultsPingTest.TestId = TestInfo.TestId
              AND ResultsPingTest.ErrorCode = ErrorCodes.Code
              AND TestInfo.NetworkId = NetworkInfo.NetworkId
        """

        params: list[object] = []
        selected_collections = [col for col in (collection or []) if col and col.strip()]
        if selected_collections:
            placeholders = ", ".join(["?"] * len(selected_collections))
            query += f" AND FileList.CollectionName IN ({placeholders})"
            params.extend(selected_collections)

        selected_locations = [loc for loc in (location or []) if loc and loc.strip()]
        if selected_locations:
            placeholders = ", ".join(["?"] * len(selected_locations))
            query += f" AND FileList.ASideLocation IN ({placeholders})"
            params.extend(selected_locations)

        cursor.execute(query, tuple(params))

        columns = [col[0] for col in cursor.description] if cursor.description else []
        rows = cursor.fetchall() if cursor.description else []

        data = [{columns[idx]: row[idx] for idx in range(len(columns))} for row in rows]

        conn.close()

        return {"rows": data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/api/interactivity")
def get_interactivity(
    database: str = Query(..., min_length=1),
    collection: list[str] | None = Query(default=None),
    location: list[str] | None = Query(default=None),
):
    """"Interactivity" (PS Data Stats) — gaming/app pattern tests (FactInteractivity),
    δεν φτάνουν σαν δικό τους TestName από το CDRCombined view (βλ. /api/data_calls),
    οπότε τα φτιάχνουμε από το raw FactInteractivity/DmnInteractivity — ίδιο query με
    το A-LEVEL "INTERACTIVITY RAW.sql" reference query (ίδιο query με το "Interactivity
    RAW" saved query του QueryEditor).

    Ένα row ανά test (ήδη ένα per-TestId αποτέλεσμα, όχι raw packets σαν το ping) —
    status = "Successful"/"Failed" (ErrorCode=0 -> Successful). Το frontend τα
    μετατρέπει σε DataCallRow σχήμα (testType="Interactivity") ώστε να μπουν στο ίδιο
    buildDataSections pipeline με τα υπόλοιπα PS Data tests — βλ.
    mapInteractivityRowsToDataCallRows στο attachmentC.ts.
    """
    try:
        conn = get_connection(database)
        cursor = conn.cursor()

        query = """
            SELECT
                FileList.ASideFileName AS aSideFileName,
                FileList.CollectionName AS collectionName,
                FileList.ASideLocation AS location,
                Sessions.SessionId AS sessionId,
                TestInfo.TestId AS testId,
                HomeOperator AS homeOperator,
                technology,
                CASE WHEN ErrorCode = 0 THEN 'Successful' ELSE 'Failed' END AS status,
                PatternName AS patternName,
                Connectivity AS connectivity,
                PacketsSent AS packetsSent,
                PacketsNotSent AS packetsNotSent,
                PacketsLost AS packetsLost,
                PacketsLostRate AS packetsLostRate,
                Throughput AS throughput,
                ThroughputKbps AS throughputKbps,
                RTT10thPercentile AS rtt10thPercentile,
                RTTMedian AS rttAverage,
                PacketDelayVarMedian AS packetDelayMedian,
                TestInfo.duration AS duration,
                qualityIndication AS qualityIndex,
                FactInteractivity.QoEScore AS qoeScore
            FROM Sessions
            INNER JOIN NetworkInfo ON NetworkInfo.NetworkId = Sessions.NetworkId
            INNER JOIN FactInteractivity ON FactInteractivity.SessionId = Sessions.SessionId
            INNER JOIN TestInfo ON TestInfo.TestId = FactInteractivity.TestId AND TestInfo.Valid = 1
            INNER JOIN FileList ON FileList.FileId = Sessions.FileId
            INNER JOIN DmnInteractivity ON DmnInteractivity.DmnId = FactInteractivity.DmnIdInteractivity
            WHERE Sessions.Valid = 1
        """

        params: list[object] = []
        selected_collections = [col for col in (collection or []) if col and col.strip()]
        if selected_collections:
            placeholders = ", ".join(["?"] * len(selected_collections))
            query += f" AND FileList.CollectionName IN ({placeholders})"
            params.extend(selected_collections)

        selected_locations = [loc for loc in (location or []) if loc and loc.strip()]
        if selected_locations:
            placeholders = ", ".join(["?"] * len(selected_locations))
            query += f" AND FileList.ASideLocation IN ({placeholders})"
            params.extend(selected_locations)

        cursor.execute(query, tuple(params))

        columns = [col[0] for col in cursor.description] if cursor.description else []
        rows = cursor.fetchall() if cursor.description else []

        data = [{columns[idx]: row[idx] for idx in range(len(columns))} for row in rows]

        conn.close()

        return {"rows": data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/api/dns")
def get_dns(
    database: str = Query(..., min_length=1),
    collection: list[str] | None = Query(default=None),
    location: list[str] | None = Query(default=None),
):
    """"DNS" (PS Data Stats) — DNS resolution time, vResultsKPI.KPIID = 31100. Ίδιο
    query με αυτό που έδωσε ο πελάτης (2026-08-26), δεν φτάνει σαν δικό του TestName
    από το CDRCombined view (βλ. /api/data_calls).

    Ήδη-αθροισμένο ανά (location, status) αντί για raw ανά-attempt rows — ίδιο σχήμα
    με το /api/srvcc. `avg`/`minVal`/`maxVal`/`stdVal` σε ms. Το δικό μας `avg` είναι
    ήδη ο απλός per-group μέσος όρος — το "AVG(Duration)*COUNT(Duration)" idiom της
    πηγαίας query είναι ένα weighted-sum trick για συνδυασμό πολλών GROUP BY γραμμών
    downstream σε ένα pivot table, περιττό εδώ αφού το frontend κάνει ήδη το δικό του
    weighted-average πάνω σε αυτά τα (location, status, count, avg) rows — βλ.
    mapDnsRowsToDataCallRows στο attachmentC.ts. Περιορίζεται σε ASideLocation LIKE
    '%Data' (η πηγαία query's φίλτρο) — το DNS test τρέχει μόνο σε Data-mode locations.
    """
    try:
        conn = get_connection(database)
        cursor = conn.cursor()

        query = """
            SELECT
                FileList.ASideLocation AS location,
                vResultsKPI.KPIStatus AS status,
                COUNT(vResultsKPI.KPIStatus) AS count,
                ROUND(AVG(CONVERT(FLOAT, vResultsKPI.Duration)), 3) AS avg,
                ROUND(MIN(CONVERT(FLOAT, vResultsKPI.Duration)), 3) AS minVal,
                ROUND(MAX(CONVERT(FLOAT, vResultsKPI.Duration)), 3) AS maxVal,
                ROUND(STDEV(CONVERT(FLOAT, vResultsKPI.Duration)), 3) AS stdVal
            FROM Sessions
            JOIN FileList ON FileList.FileId = Sessions.FileId
            JOIN vResultsKPI ON vResultsKPI.SessionId = Sessions.SessionId AND vResultsKPI.KPIID = 31100
            WHERE Sessions.Valid = 1 AND FileList.ASideLocation LIKE '%Data'
        """

        params: list[object] = []
        selected_collections = [col for col in (collection or []) if col and col.strip()]
        if selected_collections:
            placeholders = ", ".join(["?"] * len(selected_collections))
            query += f" AND FileList.CollectionName IN ({placeholders})"
            params.extend(selected_collections)

        selected_locations = [loc for loc in (location or []) if loc and loc.strip()]
        if selected_locations:
            placeholders = ", ".join(["?"] * len(selected_locations))
            query += f" AND FileList.ASideLocation IN ({placeholders})"
            params.extend(selected_locations)

        query += " GROUP BY FileList.ASideLocation, vResultsKPI.KPIStatus"

        cursor.execute(query, tuple(params))

        columns = [col[0] for col in cursor.description] if cursor.description else []
        rows = cursor.fetchall() if cursor.description else []

        data = [{columns[idx]: row[idx] for idx in range(len(columns))} for row in rows]

        conn.close()

        return {"rows": data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
