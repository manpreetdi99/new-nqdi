-- ==================================================FAKE EVENT LIST=======================================================
-- "Fake" κριτήριο = ΑΚΡΙΒΩΣ ό,τι αποφασίζει η ίδια η εφαρμογή στο update_call_comment
-- (backend/routers/calls.py): SET Valid=0 ΜΟΝΟ όταν το σχόλιο αρχίζει από "fake"/"FAKE"
-- (comment.lower().startswith("fake")) — ό,τι δεν αρχίζει έτσι παίρνει Valid=1.
--
-- 2026-09-02, real-data bug: μόνο valid='0' (χωρίς κριτήριο σχολίου) ΚΑΙ ακόμα και
-- valid='0' + "υπάρχει οποιοδήποτε σχόλιο" έδιναν 191 "fake" σε βάση που είχε ΜΟΝΟ 1
-- πραγματικό fake session. Sessions.Valid=0 από μόνο του ΔΕΝ σημαίνει "μαρκαρίστηκε fake
-- εδώ" — πολλά sessions μπαίνουν Valid=0 από το ίδιο το import/collection pipeline (π.χ.
-- αποτυχημένη λήψη, calibration run) πολύ πριν αγγίξει κανείς το comment box, και ένα
-- session μπορεί να έχει ΟΠΟΙΟΔΗΠΟΤΕ άσχετο σχόλιο (π.χ. "route ok, signal dropped near
-- tunnel") χωρίς να είναι fake. Γι' αυτό εδώ φιλτράρουμε ρητά LIKE 'fake%' πάνω στο ίδιο
-- comment source με το backend's comment_expr — COALESCE(DwAnalysisCommentToSessionMapping.
-- Comment, Sessions.InvalidReason). ΟΧΙ dbo.AnalysisComment/AnalysisCommentSessionsBridge
-- σαν κριτήριο filter — αυτά τα δύο tables είναι deprecated, το backend δεν τα διαβάζει
-- πια (βλ. σχόλιο "AnalysisComment/AnalysisCommentSessionsBridge are deprecated and no
-- longer read from" στο calls.py). Τα κρατάμε εδώ ΜΟΝΟ σαν ενημερωτική στήλη
-- (LegacyComment) — δεν επηρεάζουν αν ένα session μετράει "fake" ή όχι, ίδιο με την
-- εφαρμογή. Βλ. buildFakeEventTable στο src/lib/attachmentC.ts.

SELECT
    dbo.FileList.CollectionName,
    dbo.FileList.ASideLocation AS ASideLocation,
    dbo.FileList.TaskName,
    dbo.FileList.FileId,
    dbo.Sessions.SessionId,
    dbo.Sessions.startTime,
    dbo.Sessions.sessionType,
    dbo.CallAnalysis.callType,
    dbo.CallAnalysis.callDir,
    dbo.CallAnalysis.callStatus,
    uc.UserComment,
    dbo.AnalysisComment.Comment AS LegacyComment,
    dbo.CallAnalysis.codeDescription AS DiversityComment,
    dbo.FileList.ASideFileName,
    dbo.FileList.BSideFileName,
    dbo.Sessions.valid AS SessionValidity
FROM
    dbo.Sessions
    INNER JOIN dbo.CallAnalysis
        ON dbo.Sessions.SessionId = dbo.CallAnalysis.SessionId
    INNER JOIN dbo.FileList
        ON dbo.FileList.FileId = dbo.Sessions.FileId
    LEFT JOIN dbo.AnalysisCommentSessionsBridge
        ON dbo.AnalysisCommentSessionsBridge.SessionId = dbo.Sessions.SessionId
    LEFT JOIN dbo.AnalysisComment
        ON dbo.AnalysisCommentSessionsBridge.CommentId = dbo.AnalysisComment.CommentId
    LEFT JOIN dbo.DwAnalysisCommentToSessionMapping
        ON dbo.DwAnalysisCommentToSessionMapping.SessionId = dbo.Sessions.SessionId
    CROSS APPLY (
        -- ΙΔΙΑ σειρά/πηγές με το backend's comment_expr — βλ. σχόλιο πάνω από το SELECT.
        SELECT COALESCE(dbo.DwAnalysisCommentToSessionMapping.Comment,
                        dbo.Sessions.InvalidReason) AS UserComment
    ) uc
WHERE
    dbo.FileList.CollectionName LIKE '%%'
    AND dbo.Sessions.sessionType = 'CALL'
    AND dbo.Sessions.valid = '0'
    AND LOWER(uc.UserComment) LIKE 'fake%'


-- ============================== FAKE EVENT COUNT — ίδιο σύνολο με το "Fake Event(s)" row στο Summary tab ==============================
-- Group by operator (COSMOTE/VODAFONE/NOVA) + GSM/FREE table πάνω στην ΙΔΙΑ λίστα από
-- πάνω — ίδιο split με τα resolveMode/resolveOperator helpers που χρησιμοποιεί η σελίδα.
-- Η στήλη "Total" του Summary (δεξιά άκρη του πίνακα) = SUM([Fake Event(s)]) των operators
-- μέσα στο ΙΔΙΟ CallMode πάνω στο αποτέλεσμα παρακάτω — όχι ξεχωριστό φίλτρο.

SELECT
    CASE
        WHEN LOWER(FL.ASideLocation) LIKE '%gsm%' THEN 'GSM'
        WHEN LOWER(FL.ASideLocation) LIKE '%free%' OR LOWER(FL.ASideLocation) LIKE '%voice%' THEN 'FREE'
        ELSE 'OTHER'
    END AS CallMode,
    CASE
        WHEN LOWER(FL.ASideLocation) LIKE '%cosmote%' THEN 'COSMOTE'
        WHEN LOWER(FL.ASideLocation) LIKE '%vodafone%' THEN 'VODAFONE'
        WHEN LOWER(FL.ASideLocation) LIKE '%nova%' OR LOWER(FL.ASideLocation) LIKE '%wind%' THEN 'NOVA'
        ELSE 'UNKNOWN'
    END AS Operator,
    COUNT(DISTINCT S.SessionId) AS [Fake Event(s)]
FROM dbo.Sessions S
INNER JOIN dbo.CallAnalysis CA ON CA.SessionId = S.SessionId
INNER JOIN dbo.FileList FL ON FL.FileId = CA.FileId
LEFT JOIN dbo.DwAnalysisCommentToSessionMapping DW ON DW.SessionId = S.SessionId
WHERE FL.CollectionName LIKE '%%' AND     -- ίδιο filter placeholder με τη λίστα παραπάνω
      S.sessionType = 'CALL' AND
      S.valid = '0' AND
      LOWER(COALESCE(DW.Comment, S.InvalidReason)) LIKE 'fake%'   -- ίδιο κριτήριο με comment.lower().startswith("fake") στο calls.py
GROUP BY
    CASE WHEN LOWER(FL.ASideLocation) LIKE '%gsm%' THEN 'GSM'
         WHEN LOWER(FL.ASideLocation) LIKE '%free%' OR LOWER(FL.ASideLocation) LIKE '%voice%' THEN 'FREE'
         ELSE 'OTHER' END,
    CASE WHEN LOWER(FL.ASideLocation) LIKE '%cosmote%' THEN 'COSMOTE'
         WHEN LOWER(FL.ASideLocation) LIKE '%vodafone%' THEN 'VODAFONE'
         WHEN LOWER(FL.ASideLocation) LIKE '%nova%' OR LOWER(FL.ASideLocation) LIKE '%wind%' THEN 'NOVA'
         ELSE 'UNKNOWN' END
ORDER BY CallMode, Operator;
