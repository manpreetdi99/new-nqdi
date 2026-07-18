"""Σελίδα Antennas Map: κεραίες 4G από το geo4g.xlsx (με in-memory cache)."""
import os

from fastapi import APIRouter, HTTPException, Query
import openpyxl

router = APIRouter(tags=["antennas"])

# ---- Antennas cache ----
_antennas_cache: list[dict] | None = None

# __file__ = backend/routers/antennas.py -> repo root είναι 3 επίπεδα πάνω.
_REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

ANTENNAS_EXCEL_PATH = os.path.join(
    _REPO_ROOT,
    "cosmote all antennas",
    "geo4g.xlsx"
)


def _load_antennas() -> list[dict]:
    global _antennas_cache
    if _antennas_cache is not None:
        return _antennas_cache

    wb = openpyxl.load_workbook(ANTENNAS_EXCEL_PATH, read_only=True, data_only=True)
    ws = wb.active
    rows_iter = ws.iter_rows(min_row=1, values_only=True)
    header = next(rows_iter)
    # Column indices (0-based)
    lat_idx      = header.index("Latitude_Sector")
    lon_idx      = header.index("Longitude_Sector")
    site_idx     = header.index("SiteID")
    cell_idx     = header.index("Cell_ID")
    name_idx     = header.index("CellName")
    az_idx       = header.index("Azimuth")
    freq_idx     = header.index("FREQUENCY")
    vendor_idx   = header.index("VENDOR")
    enb_idx      = header.index("ENB_NAME")
    tech_idx     = header.index("Technology")
    status_idx   = header.index("TECHSTATUS")
    pci_idx      = header.index("PCI")
    tilt_idx     = header.index("Downtilt")
    ht_idx       = header.index("HT")

    result = []
    for row in rows_iter:
        lat = row[lat_idx]
        lon = row[lon_idx]
        if lat is None or lon is None:
            continue
        try:
            lat = float(lat)
            lon = float(lon)
        except (TypeError, ValueError):
            continue
        result.append({
            "lat": lat,
            "lon": lon,
            "siteId":   row[site_idx],
            "cellId":   row[cell_idx],
            "cellName": row[name_idx],
            "azimuth":  row[az_idx],
            "freq":     row[freq_idx],
            "vendor":   row[vendor_idx],
            "enbName":  row[enb_idx],
            "tech":     row[tech_idx],
            "status":   row[status_idx],
            "pci":      row[pci_idx],
            "downtilt": row[tilt_idx],
            "height":   row[ht_idx],
        })
    wb.close()
    _antennas_cache = result
    return result


@router.get("/api/antennas")
def get_antennas(
    freq: list[int] | None = Query(default=None),
    vendor: list[str] | None = Query(default=None),
    status: str | None = Query(default=None),
):
    """Return all 4G antenna sectors from geo4g.xlsx.
    Optional filters: freq (e.g. 1800, 2100), vendor, status (ACTIVATED/DEACTIVATED).
    First call loads & caches the file (~3-5s); subsequent calls are instant.
    """
    try:
        antennas = _load_antennas()
        result = antennas

        if freq:
            freq_set = set(freq)
            result = [a for a in result if a["freq"] in freq_set]

        if vendor:
            vendor_set = {v.lower() for v in vendor}
            result = [a for a in result if (a["vendor"] or "").lower() in vendor_set]

        if status:
            result = [a for a in result if (a["status"] or "").upper() == status.upper()]

        return {"antennas": result, "total": len(result)}
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="geo4g.xlsx not found")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
