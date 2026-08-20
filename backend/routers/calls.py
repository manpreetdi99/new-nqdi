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

        wrote_old = False
        wrote_dw = False

        # Old way: AnalysisComment (comment text, deduped) + AnalysisCommentSessionsBridge
        # (SessionId -> commentId). Kept alongside the newer mapping table so both
        # get the write.
        try:
            cursor.execute("SELECT commentID FROM AnalysisComment WHERE Comment = ?", (req.comment,))
            row = cursor.fetchone()

            if row:
                comment_id = row[0]
            else:
                try:
                    # We must insert it. In SQL Server OUTPUT INSERTED is supported.
                    cursor.execute("INSERT INTO AnalysisComment (Comment) OUTPUT INSERTED.commentID VALUES (?)", (req.comment,))
                    comment_id = cursor.fetchone()[0]
                except Exception:
                    # Fallback if OUTPUT INSERTED is not supported or identity fails
                    cursor.execute("INSERT INTO AnalysisComment (Comment) VALUES (?)", (req.comment,))
                    cursor.execute("SELECT @@IDENTITY")
                    comment_id = cursor.fetchone()[0]

            # check if it exists in bridge
            cursor.execute("SELECT sessionID FROM AnalysisCommentSessionsBridge WHERE sessionID = ?", (req.session_id,))
            if cursor.fetchone():
                cursor.execute("UPDATE AnalysisCommentSessionsBridge SET commentId = ? WHERE sessionID = ?", (comment_id, req.session_id))
            else:
                cursor.execute("INSERT INTO AnalysisCommentSessionsBridge (sessionID, commentId) VALUES (?, ?)", (req.session_id, comment_id))

            wrote_old = True
        except Exception as e:
            print(f"Error in update_call_comment old-way bridge update (continuing): {e}")
            # Reset the transaction (some ODBC drivers abort the whole txn on error)
            # so the mapping-table write below isn't blocked by this failure.
            try:
                conn.rollback()
            except Exception:
                pass

        # New way: DwAnalysisCommentToSessionMapping holds one row per SessionId
        # (SessionId, Comment) — upsert it too.
        try:
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

            wrote_dw = True
        except Exception as e:
            print(f"Error in update_call_comment mapping upsert (continuing): {e}")
            try:
                conn.rollback()
            except Exception:
                pass

        if not wrote_old and not wrote_dw:
            raise Exception("Could not write comment to AnalysisComment/bridge or DwAnalysisCommentToSessionMapping")

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

        # Not every database has DwAnalysisCommentToSessionMapping, so only
        # join it when it exists; comments there win over AnalysisComment.
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
                CODEC.CodecName AS codecName,
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
            -- Dominant codec type for the session: same bucketing inputs as the
            -- A-LEVEL "Codec Type Usage %" query (Testinfo.Valid=1, Appl % 10 <> 0,
            -- direction-matched vVoiceCodecTest), picking the codec with the most
            -- tests so a session with a couple of stray tests in another codec
            -- still reads as its dominant one.
            OUTER APPLY (
                SELECT TOP (1)
                    CASE WHEN VVCT.CodecName IS NULL OR VVCT.CodecName = '-' THEN 'no codec rate' ELSE VVCT.CodecName END AS CodecName
                FROM TestInfo TI2
                JOIN ResultsLQ08Avg R2 ON TI2.TestId = R2.TestId AND R2.Appl % 10 <> 0
                LEFT JOIN vVoiceCodecTest VVCT ON TI2.TestID = VVCT.TestID AND (
                    (TI2.direction = 'A->B' AND VVCT.Direction = 'U') OR
                    (TI2.direction = 'B->A' AND VVCT.Direction = 'D')
                )
                WHERE TI2.SessionID = CA.SessionId AND TI2.Valid = 1
                GROUP BY CASE WHEN VVCT.CodecName IS NULL OR VVCT.CodecName = '-' THEN 'no codec rate' ELSE VVCT.CodecName END
                ORDER BY COUNT(*) DESC
            ) CODEC
            -- "BadCall" — ίδιο κριτήριο με το A-LEVEL LQStatisticData.sql reference query
            -- (Attachment C): ανά session, δείγμα-προς-δείγμα (όχι μέσος όρος). Ένα
            -- δείγμα είναι "κακό" αν OptionalWB < 2.2 ή έχει Silence flag (bit 10 του
            -- reversed QualityCode). BadCall = 1 αν το ποσοστό κακών δειγμάτων στα
            -- έγκυρα δείγματα ξεπερνά 15%. Ίδιο Valid/Appl φίλτρο με το MOS OUTER APPLY
            -- παραπάνω, μεταφρασμένο στο CallAnalysis (η reference χρησιμοποιεί τον
            -- παλιό πίνακα Callsession/vResultsKPI, που δεν υπάρχει σ' αυτό το schema).
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
