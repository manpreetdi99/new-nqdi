-- ======================= YouTube Raw (CTE version) =======================

WITH SessionsCTE AS (
    SELECT
        Sessions.FileId,
        Sessions.SessionId,
        Testinfo.TestId
    FROM
        Sessions
        JOIN Testinfo ON Sessions.SessionId = Testinfo.SessionId
    WHERE
        Sessions.Valid = 1
        AND TestInfo.Valid = 1
        AND Sessions.jtId IN (4, 5, 7)
    GROUP BY
        Sessions.FileId,
        Sessions.SessionId,
        Testinfo.TestId
),
MsgEtherealVideoServerCTE AS (
    SELECT
        MsgEthereal.Sessionid,
        MsgEthereal.Testid,
        MsgEthereal.dst AS VideoServer
    FROM
        SessionsCTE
        JOIN MsgEthereal ON SessionsCTE.TestId = MsgEthereal.TestId
    WHERE
        MsgEthereal.msg LIKE 'GET /videoplayback%' AND
        MsgEthereal.MsgId = (
            SELECT MAX(m2.MsgId)
            FROM MsgEthereal m2
            WHERE
                m2.msg LIKE 'GET /videoplayback%' AND
                m2.TestId = MsgEthereal.TestId
        )
    GROUP BY
        MsgEthereal.Sessionid,
        MsgEthereal.Testid,
        MsgEthereal.dst
)

SELECT
    FileList.ASideFileName as 'A Side File Name', 
    FileList.TestDescription as 'Test Description',
    FileList.CollectionName as 'Collection Name',
    FileList.CampaignName as 'Campaign Name',
    FileList.UserName as 'User Name',
    FileList.CallingModule as 'Calling Module',
    FileList.ASideDevice as 'A Side Device',
    FileList.ASideNumber as 'A Side Number',
    FileList.ASideLocation as 'A Side Location',
    FileList.Region,
    DataSession.JobName as 'Job Name',
    TestInfo.TestName as 'Test Name',
    SessionsCTE.SessionId as 'Session ID',
    TestInfo.TestId as 'Test ID',
    CONVERT(VARCHAR, TestInfo.StartTime, 104) AS [Date],
    CONVERT(VARCHAR, TestInfo.StartTime, 108) AS [Time],
    TestInfo.TypeOfTest AS [Test Type],
    CASE 
        WHEN TestInfo.TypeOfTest LIKE '%YouTube%' THEN 'YouTube' 
        ELSE 'MediaServer' 
    END AS Source,
    NetworkInfo.Cid as 'CID', 
    NetworkInfo.LAC, 
    NetworkInfo.Operator,
    NetworkInfo.Technology,
    ResultsVideoStream.Player,
    ResultsVideoStream.URL,
    ResultsVideoStream.VideoResolution as 'Video Resolution',
    CONVERT(VARCHAR, ResultsVideoStream.HorResolution) + ' * ' + CONVERT(VARCHAR, ResultsVideoStream.VerResolution) AS 'Display Resolution',
    ResultsVideoStreamTCPData.Container,
    MsgEtherealVideoServerCTE.VideoServer as 'Video Server',
    vResultsVideoStreamAvg.Model AS [VQ Series],
    vResultsVideoStreamAvg.SessionQuality as 'Session Quality',
    vResultsVideoStreamAvg.TestQualityAvg  as 'Avg Visual Quality',
    vResultsVideoStreamAvg.TestQualityMin as 'Min Visual Quality',
    vResultsVideoStreamAvg.TestQualityMax as 'Max Visual Quality',
    vResultsVideoStreamAvg.Freezing,
    vResultsVideoStreamAvg.FreezingPercent * 0.01 AS 'Freezing Ratio',
    vResultsVideoStreamAvg.Status,
    CASE 
        WHEN vResultsVideoStreamAvg.Status LIKE '%ok%' THEN 1 
        ELSE 0 
    END AS Ok,
    CASE 
        WHEN vResultsVideoStreamAvg.Status LIKE '%ok%' THEN 0 
        ELSE 1 
    END AS Failed,
    CASE 
        WHEN ResultsVideoStreamTCPData.TimeToFirstPicture IS NOT NULL 
            THEN ResultsVideoStreamTCPData.TimeToFirstPicture * 0.001 
            ELSE ResultsVideoStreamTCPData.TimeToFirstPicturePlayer * 0.001 
    END AS 'Time To First Picture',
    ResultsVQ08StreamAvg.Jerkiness,
    ResultsVQ08StreamAvg.Blurring,
    ResultsVQ08StreamAvg.Tiling

FROM
    SessionsCTE
    JOIN FileList ON SessionsCTE.FileID = FileList.FileID
    JOIN TestInfo ON SessionsCTE.TestId = TestInfo.TestId
    JOIN NetworkInfo ON TestInfo.NetworkId = NetworkInfo.NetworkId
    JOIN vResultsVideoStreamAvg ON TestInfo.TestId = vResultsVideoStreamAvg.TestId
    JOIN ResultsVQ08StreamAvg ON TestInfo.TestId = ResultsVQ08StreamAvg.TestId
    JOIN ResultsVideoStream ON TestInfo.TestId = ResultsVideoStream.TestId
    JOIN DataSession ON SessionsCTE.SessionId = DataSession.SessionID
    LEFT JOIN ResultsVideoStreamTCPData ON TestInfo.TestId = ResultsVideoStreamTCPData.TestId
    LEFT JOIN MsgEtherealVideoServerCTE ON TestInfo.TestId = MsgEtherealVideoServerCTE.TestId
Where CollectionName like '%%' AND SessionsCTE.SessionId is not null