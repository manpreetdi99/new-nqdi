"""Σελίδα Validation: παραγωγή validation map μέσω main_mt.run_for_collection()."""
import os

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter(tags=["validation"])


class RunMapRequest(BaseModel):
    database: str
    collection: str
    gpx_path: str = ""
    max_workers: int = 6


@router.post("/api/run_map")
def run_map(req: RunMapRequest):
    """
    Trigger main_mt.run_for_collection() and return captured stdout logs + output path.
    The main_mt.py / panel_*.py files must be importable from sys.path.
    """
    import sys
    import io
    import contextlib

    # Folder that contains main_mt.py / panel_*.py, bundled inside this repo.
    # __file__ = backend/routers/validation.py -> validation_maps ζει στο backend/.
    _BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    MAP_SCRIPTS_DIR = os.path.join(_BACKEND_DIR, "validation_maps")
    if MAP_SCRIPTS_DIR not in sys.path:
        sys.path.insert(0, MAP_SCRIPTS_DIR)

    try:
        import main_mt  # type: ignore
    except ImportError as e:
        raise HTTPException(
            status_code=500,
            detail=f"Cannot import main_mt: {e}. Make sure MAP_SCRIPTS_DIR is correct."
        )

    log_buffer = io.StringIO()
    output_html = None

    try:
        with contextlib.redirect_stdout(log_buffer):
            output_html = main_mt.run_for_collection(
                req.collection,
                req.database,
                input_gpx=req.gpx_path if req.gpx_path.strip() else None,
                max_workers=req.max_workers,
            )
    except Exception as e:
        raw_logs = [l for l in log_buffer.getvalue().splitlines() if l.strip()]
        raw_logs.append(f"ERROR: {e}")
        raise HTTPException(status_code=500, detail="\n".join(raw_logs))

    logs = [l for l in log_buffer.getvalue().splitlines() if l.strip()]

    html_content = None
    if output_html and os.path.isfile(output_html):
        with open(output_html, "r", encoding="utf-8") as f:
            html_content = f.read()

    return {"output_path": output_html, "html_content": html_content, "logs": logs, "success": True}
