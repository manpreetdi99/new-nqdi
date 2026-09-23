"""Σελίδα Call Detail — 5G radio charts:
serving cell values (A & B side), cell info, neighbors, CA config, A/B σύγκριση."""
from fastapi import APIRouter, HTTPException, Query

from api_utils import _rows
from db import get_connection

router = APIRouter(tags=["call-radio-5g"])


@router.get("/api/nr5g_values")
def get_nr5g_values(
    database: str = Query(..., min_length=1),
    session_id: str = Query(..., min_length=1)
):
    """5G NR serving-cell radio for the call, from FactNR5GRadio."""
    try:
        conn = get_connection(database)
        cursor = conn.cursor()

        query = """
            SELECT fr.[FACTId]
                  ,fr.[SessionId]
                  ,fr.[FullDate]           AS [MsgTime]
                  ,fr.[PosId]
                  ,fr.[NetworkId]
                  ,fr.[CarrierIndex]
                  ,fr.[NRARFCN]
                  ,ROUND(fr.[RSRP], 2)  AS [RSRP]
                  ,ROUND(fr.[RSRQ], 2)  AS [RSRQ]
                  ,ROUND(fr.[SINR], 2)  AS [SINR]
                  ,dp.Latitude
                  ,dp.Longitude
                  -- Serving cell: το FactNR5GRadio δεν έχει CID, οπότε έρχεται από το
                  -- DmnCellInformation μέσω του mapping. Χρειάζεται για το «κοινό» 5G scanner
                  -- (/api/nr5g_scanner_raw ανά CID). TOP 1: μία γραμμή ανά μέτρηση.
                  ,fr.[PCI]
                  ,cell.CId
                  ,cell.NCI
                  ,cell.AbsFreqSSB
              FROM [FactNR5GRadio] fr
              LEFT JOIN DmnPosition dp ON dp.DmnId = fr.DmnIdPosition
              OUTER APPLY (
                  SELECT TOP 1 ci.CId, ci.NCI, ci.AbsFreqSSB
                    FROM DwFactNR5GRadioToDmnCellInformationMapping m
                    JOIN DmnCellInformation ci ON ci.DmnId = m.DmnIdCellInformation
                   WHERE m.FactId = fr.FactId
              ) cell
             WHERE fr.[SessionId] = TRY_CONVERT(BIGINT, ?)
              ORDER BY fr.FullDate
        """

        cursor.execute(query, (session_id,))
        data = _rows(cursor)

        conn.close()
        return {"nr5gValues": data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
