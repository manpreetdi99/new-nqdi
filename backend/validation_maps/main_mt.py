#!/usr/bin/env python3
"""
main_mt.py

Multithreaded variant of main.py.
Goal: reduce end-to-end runtime by building independent Folium panels in parallel.

Key idea:
- Each panel (FREE/GSM/DATA/SCANNER) is independent: it runs its own SQL queries and OSRM calls.
- We run panel creation concurrently using ThreadPoolExecutor (best for I/O bound work: SQL + HTTP OSRM).

Public API mirrors main.py:
    run_for_collection(collection, database, mode="all", input_gpx=None, **kwargs)

NOTE:
- This file does NOT require changes in existing panel_* modules.
"""

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Optional, Tuple, Dict, Any

import folium
from branca.element import Figure
import os
import gpx

from panel_free import make_panel_free
from panel_gsm import make_panel_gsm
from panel_data import make_panel_data
from panel_scanner import make_panel_scanner


def _safe_pct(num: float, den: float) -> float:
    return (num / den * 100.0) if den else 0.0


def _build_free_legend(title: str, left: str, top: str, width: str, height: str, cnt: Dict[str, int], completed_diff_color: str = "inherit") -> str:
    total_calls = cnt["completed"] + cnt["dropped"] + cnt["failed"] + cnt["system_release"]
    prev_total_calls = cnt.get("prev_total_calls", 0)
    prev_success_calls = cnt.get("prev_success_calls", 0)
    prev_failed_calls = cnt.get("prev_failed_calls", 0)
    prev_dropped_calls = cnt.get("prev_dropped_calls", 0)
    prev_system_release_calls = cnt.get("prev_system_release_calls", 0)
    previous_collection_name = cnt.get("previous_collection_name", "")
    previous_scope = cnt.get("previous_scope", "")
    total_mos = cnt["LQ>4.5"] + cnt["LQ4-4.5"] + cnt["LQ2-4"] + cnt["LQ1-2"]
    total_rsrp = (
        cnt["RSRP_UNDER80"] + cnt["RSRP_90-80"] + cnt["RSRP_100-90"] + cnt["RSRP_110-100"] + cnt["RSRP_OVER110"]
    )
    total_tech = (
        cnt["GSM_900"] + cnt["GSM_1800"] + cnt["LTE_E-UTRA_1"] + cnt["LTE_E-UTRA_3"] + cnt["LTE_E-UTRA_20"]
        + cnt["LTE_E-UTRA_28"] + cnt["LTE_E-UTRA_7"]
    )
    legend_id = "".join(ch.lower() if ch.isalnum() else "_" for ch in title)
    completed_pct = _safe_pct(cnt["completed"], total_calls)
    mos_color = "red" if cnt["completed"] > 0 and total_mos < cnt["completed"] * 8 else "inherit"

    return f"""
    <div style="
        position: absolute;
        left: {left};
        top: calc({top} + {height} + 14px);
        width: {width};
        background: white;
        border: 1px solid #bbb;
        border-radius: 8px;
        box-shadow: 0 2px 6px rgba(0,0,0,0.08);
        font-size: 12px;
        line-height: 1.4;
        padding: 10px 16px;
        z-index: 9999;
    ">
      <div style="font-weight:600; margin-bottom:8px; text-align:center;">
        📞 {title} — Summary
      </div>

      <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px 16px;">

        <div>
          <div style="font-weight:700; margin-bottom:4px;">Calls</div>
          <div style="color:{completed_diff_color};"><span style="color:green;">●</span> Completed: {cnt['completed']} ({completed_pct:.1f}%)</div>
          <div><span style="color:red;">●</span> Dropped: {cnt['dropped']} ({_safe_pct(cnt['dropped'], total_calls):.1f}%)</div>
          <div><span style="color:orange;">●</span> Failed: {cnt['failed']} ({_safe_pct(cnt['failed'], total_calls):.1f}%)</div>
          <div><span style="color:purple;">●</span> Sys. Release: {cnt['system_release']} ({_safe_pct(cnt['system_release'], total_calls):.1f}%)</div>
          <div style="font-weight:700;">Total: {total_calls}</div>

            <div style="margin-top:10px;">
              <button id="toggle_prev_scope_{legend_id}" onclick="togglePrevScope_{legend_id}(this)" style="
                padding: 4px 8px;
                background: #f0f0f0;
                border: 1px solid #999;
                border-radius: 4px;
                cursor: pointer;
                font-size: 11px;
                font-weight: bold;
                transition: all 0.2s;
              ">▶ Show Previous Scope</button>
            </div>
          
            <div id="prev_scope_data_{legend_id}" style="display:none; margin-top:8px; border-top:1px dashed #ccc; padding-top:8px;">
              <div style="font-weight:500; color:red; margin-bottom:4px;">Προσοχη στο προηγούμενο scope τα system releases δεν προσμετρούνται στο ποσοστο</div>
              <div style="font-size:11px; color:#555;"><b>Prev Scope ({previous_scope or '-'})</b></div>
              <div style="font-size:10px; color:#666; margin-bottom:4px;">{previous_collection_name or 'N/A'}</div>
              <div><span style="color:green;">●</span> Success: {prev_success_calls} ({_safe_pct(prev_success_calls, prev_total_calls):.1f}%)</div>
              <div><span style="color:red;">●</span> Dropped: {prev_dropped_calls} ({_safe_pct(prev_dropped_calls, prev_total_calls):.1f}%)</div>
              <div><span style="color:orange;">●</span> Failed: {prev_failed_calls} ({_safe_pct(prev_failed_calls, prev_total_calls):.1f}%)</div>
              <div><span style="color:purple;">●</span> Sys. Release: {prev_system_release_calls} ({_safe_pct(prev_system_release_calls, prev_total_calls):.1f}%)</div>
              <div style="font-weight:700; margin-top:4px;">Prev Total: {prev_total_calls}</div>
            </div>
        </div>

        <div>
          <div style="font-weight:700; margin-bottom:4px;">MOS</div>
          <div><span style="color:green;">●</span> &gt;4.5: {cnt['LQ>4.5']} ({_safe_pct(cnt['LQ>4.5'], total_mos):.1f}%)</div>
          <div><span style="color:lightgreen;">●</span> 4.0–4.5: {cnt['LQ4-4.5']} ({_safe_pct(cnt['LQ4-4.5'], total_mos):.1f}%)</div>
          <div><span style="color:orange;">●</span> 2.0–4.0: {cnt['LQ2-4']} ({_safe_pct(cnt['LQ2-4'], total_mos):.1f}%)</div>
          <div><span style="color:red;">●</span> 1.0–2.0: {cnt['LQ1-2']} ({_safe_pct(cnt['LQ1-2'], total_mos):.1f}%)</div>
          <div style="font-weight:700; color:{mos_color};">Total: {total_mos}</div>
        </div>

        <div>
          <div style="font-weight:700; margin-bottom:4px;">RSRP</div>
          <div><span style="color:green;">●</span> ≥−80: {cnt["RSRP_UNDER80"]} ({_safe_pct(cnt["RSRP_UNDER80"], total_rsrp):.1f}%)</div>
          <div><span style="color:lightgreen;">●</span> −90 to −80: {cnt['RSRP_90-80']} ({_safe_pct(cnt['RSRP_90-80'], total_rsrp):.1f}%)</div>
          <div><span style="color:yellow;">●</span> −100 to −90: {cnt['RSRP_100-90']} ({_safe_pct(cnt['RSRP_100-90'], total_rsrp):.1f}%)</div>
          <div><span style="color:orange;">●</span> −110 to −100: {cnt['RSRP_110-100']} ({_safe_pct(cnt['RSRP_110-100'], total_rsrp):.1f}%)</div>
          <div><span style="color:red;">●</span> &lt;−110: {cnt['RSRP_OVER110']} ({_safe_pct(cnt['RSRP_OVER110'], total_rsrp):.1f}%)</div>
          <div style="font-weight:700;">Total: {total_rsrp}</div>
        </div>

        <div>
          <div style="font-weight:700; margin-bottom:4px;">Technology</div>
          <div><span style="color:cyan;">●</span> GSM 900: {cnt["GSM_900"]} ({_safe_pct(cnt["GSM_900"], total_tech):.1f}%)</div>
          <div><span style="color:blue;">●</span> GSM 1800: {cnt["GSM_1800"]} ({_safe_pct(cnt["GSM_1800"], total_tech):.1f}%)</div>
          <div><span style="color:brown;">●</span> LTE E-UTRA 1: {cnt["LTE_E-UTRA_1"]} ({_safe_pct(cnt["LTE_E-UTRA_1"], total_tech):.1f}%)</div>
          <div><span style="color:green;">●</span> LTE E-UTRA 3: {cnt["LTE_E-UTRA_3"]} ({_safe_pct(cnt["LTE_E-UTRA_3"], total_tech):.1f}%)</div>
          <div><span style="color:red;">●</span> LTE E-UTRA 7: {cnt["LTE_E-UTRA_7"]} ({_safe_pct(cnt["LTE_E-UTRA_7"], total_tech):.1f}%)</div>
          <div><span style="color:orange;">●</span> LTE E-UTRA 20: {cnt["LTE_E-UTRA_20"]} ({_safe_pct(cnt["LTE_E-UTRA_20"], total_tech):.1f}%)</div>
          <div><span style="color:purple;">●</span> LTE E-UTRA 28: {cnt["LTE_E-UTRA_28"]} ({_safe_pct(cnt["LTE_E-UTRA_28"], total_tech):.1f}%)</div>
          <div style="font-weight:700; margin-top:4px;">Total: {total_tech}</div>
        </div>

      </div>
      
        <script>
          function togglePrevScope_{legend_id}(btn) {{
            const data = document.getElementById('prev_scope_data_{legend_id}');
            const isHidden = data.style.display === 'none';
            data.style.display = isHidden ? 'block' : 'none';
            btn.textContent = isHidden ? '▼ Hide Previous Scope' : '▶ Show Previous Scope';
            btn.style.background = isHidden ? '#e0f0ff' : '#f0f0f0';
          }}
        </script>
    </div>
    """


def _build_gsm_legend(title: str, left: str, top: str, width: str, height: str, cnt: Dict[str, int], completed_diff_color: str = "inherit") -> str:
    total_calls = cnt["completed"] + cnt["dropped"] + cnt["failed"] + cnt["system_release"]
    total_mos = cnt["LQ>4.5"] + cnt["LQ4-4.5"] + cnt["LQ2-4"] + cnt["LQ1-2"]
    total_rx = cnt["RX_UNDER80"] + cnt["RX_90-80"] + cnt["RX_100-90"] + cnt["RX_110-100"] + cnt["RX_OVER110"]
    total_tech = cnt["TECH_900"] + cnt["TECH_1800"]
    prev_total_calls = cnt.get("prev_total_calls", 0)
    prev_success_calls = cnt.get("prev_success_calls", 0)
    prev_failed_calls = cnt.get("prev_failed_calls", 0)
    prev_dropped_calls = cnt.get("prev_dropped_calls", 0)
    prev_system_release_calls = cnt.get("prev_system_release_calls", 0)
    previous_collection_name = cnt.get("previous_collection_name", "")
    previous_scope = cnt.get("previous_scope", "")

    legend_id = "".join(ch.lower() if ch.isalnum() else "_" for ch in title)
    completed_pct = _safe_pct(cnt["completed"], total_calls)
    mos_color = "red" if cnt["completed"] > 0 and total_mos < cnt["completed"] * 8 else "inherit"

    return f"""
    <div style="
        position: absolute;
        left: {left};
        top: calc({top} + {height} + 14px);
        width: {width};
        background: white;
        border: 1px solid #bbb;
        border-radius: 8px;
        box-shadow: 0 2px 6px rgba(0,0,0,0.08);
        font-size: 12px;
        line-height: 1.4;
        padding: 10px 16px;
        z-index: 9999;
    ">
      <div style="font-weight:600; margin-bottom:8px; text-align:center;">
        📞 {title} — Summary
      </div>

      <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px 16px;">

        <div>
          <div style="font-weight:700; margin-bottom:4px;">Calls</div>
          <div style="color:{completed_diff_color};"><span style="color:green;">●</span> Completed: {cnt['completed']} ({completed_pct:.1f}%)</div>
          <div><span style="color:red;">●</span> Dropped: {cnt['dropped']} ({_safe_pct(cnt['dropped'], total_calls):.1f}%)</div>
          <div><span style="color:orange;">●</span> Failed: {cnt['failed']} ({_safe_pct(cnt['failed'], total_calls):.1f}%)</div>
          <div><span style="color:purple;">●</span> Sys. Release: {cnt['system_release']} ({_safe_pct(cnt['system_release'], total_calls):.1f}%)</div>
          <div style="font-weight:700;">Total: {total_calls}</div>

           <div style="margin-top:10px;">
             <button id="toggle_prev_scope_{legend_id}" onclick="togglePrevScope_{legend_id}(this)" style="
                    padding: 4px 8px;
                    background: #f0f0f0;
                    border: 1px solid #999;
                    border-radius: 4px;
                    cursor: pointer;
                    font-size: 11px;
                    font-weight: bold;
                    transition: all 0.2s;
              ">▶ Show Previous Scope</button>
            </div>
            <div id="prev_scope_data_{legend_id}" style="display:none; margin-top:8px; border-top:1px dashed #ccc; padding-top:8px;">
                <div style="font-weight:500; color:red; margin-bottom:4px;">Προσοχη στο προηγούμενο scope τα system releases δεν προσμετρούνται στο ποσοστο</div>
                <div style="margin-top:6px; border-top:1px dashed #ccc; padding-top:6px;"><b>Prev Scope ({previous_scope or '-'})</b></div>
                <div style="font-size:11px; color:#555;">{previous_collection_name or 'N/A'}</div>
                <div><span style="color:green;">●</span> Success: {prev_success_calls} ({_safe_pct(prev_success_calls, prev_total_calls):.1f}%)</div>
                <div><span style="color:red;">●</span> Dropped: {prev_dropped_calls} ({_safe_pct(prev_dropped_calls, prev_total_calls):.1f}%)</div>
                <div><span style="color:orange;">●</span> Failed: {prev_failed_calls} ({_safe_pct(prev_failed_calls, prev_total_calls):.1f}%)</div>
                <div><span style="color:purple;">●</span> Sys. Release: {prev_system_release_calls} ({_safe_pct(prev_system_release_calls, prev_total_calls):.1f}%)</div>
                <div style="font-weight:700;">Prev Total: {prev_total_calls}</div>
            </div>
        </div>

        <div>
          <div style="font-weight:700; margin-bottom:4px;">MOS</div>
          <div><span style="color:green;">●</span> &gt;4.5: {cnt['LQ>4.5']} ({_safe_pct(cnt['LQ>4.5'], total_mos):.1f}%)</div>
          <div><span style="color:yellow;">●</span> 4.0–4.5: {cnt['LQ4-4.5']} ({_safe_pct(cnt['LQ4-4.5'], total_mos):.1f}%)</div>
          <div><span style="color:orange;">●</span> 2.0–4.0: {cnt['LQ2-4']} ({_safe_pct(cnt['LQ2-4'], total_mos):.1f}%)</div>
          <div><span style="color:red;">●</span> 1.0–2.0: {cnt['LQ1-2']} ({_safe_pct(cnt['LQ1-2'], total_mos):.1f}%)</div>
          <div style="font-weight:700; color:{mos_color};">Total: {total_mos}</div>
        </div>

        <div>
          <div style="font-weight:700; margin-bottom:4px;">RX (RxLevFull)</div>
          <div><span style="color:green;">●</span> ≥−80: {cnt["RX_UNDER80"]} ({_safe_pct(cnt["RX_UNDER80"], total_rx):.1f}%)</div>
          <div><span style="color:lightgreen;">●</span> −90 to −80: {cnt['RX_90-80']} ({_safe_pct(cnt['RX_90-80'], total_rx):.1f}%)</div>
          <div><span style="color:yellow;">●</span> −100 to −90: {cnt['RX_100-90']} ({_safe_pct(cnt['RX_100-90'], total_rx):.1f}%)</div>
          <div><span style="color:orange;">●</span> −110 to −100: {cnt['RX_110-100']} ({_safe_pct(cnt['RX_110-100'], total_rx):.1f}%)</div>
          <div><span style="color:red;">●</span> &lt;−110: {cnt['RX_OVER110']} ({_safe_pct(cnt['RX_OVER110'], total_rx):.1f}%)</div>
          <div style="font-weight:700;">Total: {total_rx}</div>
        </div>

        <div>
          <div style="font-weight:700; margin-bottom:4px;">Technology</div>
          <div><span style="color:blue;">●</span> GSM 900: {cnt["TECH_900"]} ({_safe_pct(cnt["TECH_900"], total_tech):.1f}%)</div>
          <div><span style="color:cyan;">●</span> GSM 1800: {cnt["TECH_1800"]} ({_safe_pct(cnt["TECH_1800"], total_tech):.1f}%)</div>
          <div style="font-weight:700; margin-top:4px;">Total: {total_tech}</div>
        </div>

        </div>
      
        <script>
          function togglePrevScope_{legend_id}(btn) {{
            const data = document.getElementById('prev_scope_data_{legend_id}');
            const isHidden = data.style.display === 'none';
            data.style.display = isHidden ? 'block' : 'none';
            btn.textContent = isHidden ? '▼ Hide Previous Scope' : '▶ Show Previous Scope';
            btn.style.background = isHidden ? '#e0f0ff' : '#f0f0f0';
          }}
        </script>
    </div>
      </div>
    </div>
    """


def _build_data_legend(title: str, left: str, top: str, width: str, height: str, cnt: Dict[str, int]) -> str:
    total_rsrp = cnt["RSRP_UNDER80"] + cnt["RSRP_90-80"] + cnt["RSRP_100-90"] + cnt["RSRP_110-100"] + cnt["RSRP_OVER110"]
    return f"""
    <div style="
        position: absolute;
        left: {left};
        top: calc({top} + {height} + 14px);
        width: {width};
        background: white;
        border: 1px solid #bbb;
        border-radius: 8px;
        box-shadow: 0 2px 6px rgba(0,0,0,0.08);
        font-size: 12px;
        line-height: 1.4;
        padding: 10px 16px;
        z-index: 9999;
    ">
      <div style="font-weight:600; margin-bottom:8px; text-align:center;">
        📶 {title} — DATA Summary
      </div>

      <div style="display:flex; justify-content: space-between; gap:16px;">
        <div style="flex:1;">
          <div style="font-weight:700; margin-bottom:4px;">RSRP</div>
          <div><span style="color:green;">●</span> ≥−80: {cnt["RSRP_UNDER80"]} ({_safe_pct(cnt["RSRP_UNDER80"], total_rsrp):.1f}%)</div>
          <div><span style="color:lightgreen;">●</span> −90 to −80: {cnt['RSRP_90-80']} ({_safe_pct(cnt['RSRP_90-80'], total_rsrp):.1f}%)</div>
          <div><span style="color:yellow;">●</span> −100 to −90: {cnt['RSRP_100-90']} ({_safe_pct(cnt['RSRP_100-90'], total_rsrp):.1f}%)</div>
          <div><span style="color:orange;">●</span> −110 to −100: {cnt['RSRP_110-100']} ({_safe_pct(cnt['RSRP_110-100'], total_rsrp):.1f}%)</div>
          <div><span style="color:red;">●</span> &lt;−110: {cnt['RSRP_OVER110']} ({_safe_pct(cnt['RSRP_OVER110'], total_rsrp):.1f}%)</div>
          <div style="font-weight:700; margin-top:4px;">Total RSRP: {total_rsrp}</div>
        </div>

        <div style="flex:1;">
          <div style="font-weight:700; margin-bottom:4px;">OOKLA SPEED TEST</div>
          <div><span style="color:green;">●</span> Success: {cnt["OOKLA SUCCESS"]} ({_safe_pct(cnt["OOKLA SUCCESS"], cnt["OOKLA TOTAL"]):.1f}%)</div>
          <div><span style="color:red;">●</span> Fail: {cnt["OOKLA TOTAL"] - cnt["OOKLA SUCCESS"]} ({_safe_pct(cnt["OOKLA TOTAL"] - cnt["OOKLA SUCCESS"], cnt["OOKLA TOTAL"]):.1f}%)</div>
          <div style="font-weight:700; margin-top:4px;">AVG Throughput: {(cnt["TOTAL THROUGHPUT"] / cnt["OOKLA SUCCESS"])/1000 if cnt["OOKLA SUCCESS"] else 0:.1f} Mbps</div>
        </div>
      </div>
    </div>
    """


def _build_scanner_legend(left: str, top: str, width: str, height: str, cnt: Dict[str, int]) -> str:
    total = cnt["RSRP_UNDER80"] + cnt["RSRP_90-80"] + cnt["RSRP_100-90"] + cnt["RSRP_110-100"] + cnt["RSRP_OVER110"]
    return f"""
    <div style="
        position: absolute;
        left: {left};
        top: calc({top} + {height} + 14px);
        width: {width};
        background: white;
        border: 1px solid #bbb;
        border-radius: 8px;
        box-shadow: 0 2px 6px rgba(0,0,0,0.08);
        font-size: 12px;
        line-height: 1.4;
        padding: 10px 16px;
        z-index: 9999;
    ">
      <div style="font-weight:600; margin-bottom:8px; text-align:center;">
        📡 SCANNER — RSRP Summary
      </div>

      <div style="font-weight:700; margin-bottom:4px;">RSRP</div>
      <div><span style="color:green;">●</span> ≥−80: {cnt["RSRP_UNDER80"]} ({_safe_pct(cnt["RSRP_UNDER80"], total):.1f}%)</div>
      <div><span style="color:lightgreen;">●</span> −90 to −80: {cnt["RSRP_90-80"]} ({_safe_pct(cnt["RSRP_90-80"], total):.1f}%)</div>
      <div><span style="color:yellow;">●</span> −100 to −90: {cnt["RSRP_100-90"]} ({_safe_pct(cnt["RSRP_100-90"], total):.1f}%)</div>
      <div><span style="color:orange;">●</span> −110 to −100: {cnt["RSRP_110-100"]} ({_safe_pct(cnt["RSRP_110-100"], total):.1f}%)</div>
      <div><span style="color:red;">●</span> &lt;−110: {cnt["RSRP_OVER110"]} ({_safe_pct(cnt["RSRP_OVER110"], total):.1f}%)</div>
      <div style="font-weight:700;">Total: {total}</div>
    </div>
    """


def build_maps_mt(collection: str, database: str, args, mode: str = "all", input_gpx: str = None, max_workers: int = 6) -> Figure:
    """
    Build maps with parallel panel generation.
    max_workers: tune for your machine/network (SQL + OSRM are IO-bound).
    """
    routes = []
    waypoints = []

    if input_gpx and os.path.exists(input_gpx):
        try:
            routes, waypoints = gpx.parse_gpx(input_gpx)
        except Exception as e:
            print(f"Error parsing provided GPX: {e}")

    via_groups = routes[:] if routes else []

    fig = Figure()

    # Panel positions. left/width stay percentages so each row scales with
    # the iframe's width, but top/height are fixed px — the page has no
    # element with an explicit height, so absolutely-positioned percentages
    # for top/height would otherwise resolve against the iframe's *current*
    # viewport height, making every map panel grow or shrink (and the whole
    # report bloat or get clipped) depending on the screen/window it's
    # viewed on. Fixed px keeps each map a consistent, legible size and
    # just lets the iframe scroll vertically through the stacked rows.
    MAP_H = 620
    ROW_STRIDE = 1080  # MAP_H + room below for that row's legend (FREE/GSM legends are 2-column grids, ~350-400px tall worst case)

    row0_top = 40
    row1_top = row0_top + ROW_STRIDE
    row2_top = row1_top + ROW_STRIDE
    row3_top = row2_top + ROW_STRIDE

    pos1 = ("0%", f"{row0_top}px", "32%", f"{MAP_H}px")
    pos2 = ("34%", f"{row0_top}px", "32%", f"{MAP_H}px")
    pos3 = ("68%", f"{row0_top}px", "32%", f"{MAP_H}px")
    pos4 = ("0%", f"{row1_top}px", "32%", f"{MAP_H}px")
    pos5 = ("34%", f"{row1_top}px", "32%", f"{MAP_H}px")
    pos6 = ("68%", f"{row1_top}px", "32%", f"{MAP_H}px")
    pos7 = ("25%", f"{row2_top}px", "50%", f"{MAP_H}px")
    pos8 = ("0%", f"{row3_top}px", "32%", f"{MAP_H}px")
    pos9 = ("34%", f"{row3_top}px", "32%", f"{MAP_H}px")
    pos10 = ("68%", f"{row3_top}px", "32%", f"{MAP_H}px")

    jobs = []

    with ThreadPoolExecutor(max_workers=max_workers) as ex:
        # FREE
        if mode in ("all", "free"):
            jobs.append(("FREE", "COSMOTE FREE A", pos1, ex.submit(
                make_panel_free, (38.0, 23.7), 12, pos1, args.tiles, "COSMOTE FREE A",
                args, waypoints, via_groups, "COSMOTE FREE A", database, collection
            )))
            jobs.append(("FREE", "VODAFONE FREE A", pos2, ex.submit(
                make_panel_free, (35.2, 24.9), 12, pos2, args.tiles, "VODAFONE FREE A",
                args, waypoints, via_groups, "VODAFONE FREE A", database, collection
            )))
            jobs.append(("FREE", "NOVA FREE A", pos3, ex.submit(
                make_panel_free, (39.0, 21.8), 12, pos3, args.tiles, "NOVA FREE A",
                args, waypoints, via_groups, "NOVA FREE A", database, collection
            )))

        # GSM
        if mode in ("all", "gsm"):
            jobs.append(("GSM", "COSMOTE GSM", pos4, ex.submit(
                make_panel_gsm, (39.0, 21.8), 12, pos4, args.tiles, "COSMOTE GSM",
                args, waypoints, via_groups, "Cosmote GSM", database, collection
            )))
            jobs.append(("GSM", "VODAFONE GSM", pos5, ex.submit(
                make_panel_gsm, (39.0, 23.8), 12, pos5, args.tiles, "VODAFONE GSM",
                args, waypoints, via_groups, "Vodafone GSM", database, collection
            )))
            jobs.append(("GSM", "NOVA GSM", pos6, ex.submit(
                make_panel_gsm, (39.0, 24.8), 12, pos6, args.tiles, "NOVA GSM",
                args, waypoints, via_groups, "Nova GSM", database, collection
            )))

        # DATA
        if mode in ("all", "free"):
            jobs.append(("DATA", "COSMOTE DATA", pos8, ex.submit(
                make_panel_data, (38.0, 23.7), 12, pos8, args.tiles, "COSMOTE DATA",
                args, waypoints, via_groups, "COSMOTE DATA ", database, collection
            )))
            jobs.append(("DATA", "VODAFONE DATA", pos9, ex.submit(
                make_panel_data, (35.2, 24.9), 12, pos9, args.tiles, "VODAFONE DATA",
                args, waypoints, via_groups, "VODAFONE DATA", database, collection
            )))
            jobs.append(("DATA", "NOVA DATA", pos10, ex.submit(
                make_panel_data, (39.0, 21.8), 12, pos10, args.tiles, "NOVA DATA",
                args, waypoints, via_groups, "NOVA DATA", database, collection
            )))

        # SCANNER (always)
        jobs.append(("SCANNER", "SCANNER", pos7, ex.submit(
            make_panel_scanner, (38.5, 23.5), 12, pos7, args.tiles, "SCANNER",
            args, waypoints, via_groups, database, collection
        )))

        # Collect all results first (order doesn't matter for folium Figure)
        results = []
        for kind, title, pos, fut in jobs:
            m, cnt = fut.result()
            results.append((kind, title, pos, m, cnt))

    # Flag the operator(s) within FREE/GSM whose Completed% lags the best
    # performer in that group by more than 5 points, so the legend can
    # highlight it in red.
    def _completed_pct(cnt: Dict[str, int]) -> float:
        total = cnt["completed"] + cnt["dropped"] + cnt["failed"] + cnt["system_release"]
        return _safe_pct(cnt["completed"], total)

    for panel_type in ("FREE", "GSM"):
        group = [(title, cnt) for kind, title, _, _, cnt in results if kind == panel_type]
        if len(group) > 1:
            pcts = {title: _completed_pct(cnt) for title, cnt in group}
            max_pct = max(pcts.values())
            for kind, title, pos, m, cnt in results:
                if kind == panel_type:
                    cnt["_completed_diff_color"] = "red" if max_pct - pcts[title] > 5 else "inherit"

    for kind, title, pos, m, cnt in results:
        fig.add_child(m)

        left, top, width, height = pos
        color = cnt.get("_completed_diff_color", "inherit")
        if kind == "FREE":
            fig.html.add_child(folium.Element(_build_free_legend(title, left, top, width, height, cnt, completed_diff_color=color)))
        elif kind == "GSM":
            fig.html.add_child(folium.Element(_build_gsm_legend(title, left, top, width, height, cnt, completed_diff_color=color)))
        elif kind == "DATA":
            fig.html.add_child(folium.Element(_build_data_legend(title, left, top, width, height, cnt)))
        elif kind == "SCANNER":
            fig.html.add_child(folium.Element(_build_scanner_legend(left, top, width, height, cnt)))

    return fig


def run_for_collection(collection: str, database: str, mode: str = "all", input_gpx: str = None, **kwargs) -> str:
    """
    Same signature as main.py, but uses build_maps_mt.
    Returns output html path.
    """
    # class _Args:
    #     output_html = r"\\192.168.10.182\Public\#SERVICE DIVISION PROJECT FOLDER\COSMOTE 2026 H1\OUTPUT_MAPS\output.html"
    #     tiles = "OpenStreetMap"
    #     profile = "driving"
    #     osrm_url = "https://router.project-osrm.org"
    #     show_straight = False
    #     max_workers = 6
    class _Args:
        tiles = "https://{s}.tile.openstreetmap.de/tiles/osmde/{z}/{x}/{y}.png"                            #costum tiles, try to use when 403r (access denied) problem appear
        attr = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'


        output_html = r"\\192.168.10.182\Public\#SERVICE DIVISION PROJECT FOLDER\COSMOTE 2026 H1\OUTPUT_MAPS\output.html"
        output_folder = ""  # <--- ΠΡΕΠΕΙ ΝΑ ΥΠΑΡΧΕΙ ΕΔΩ
        #tiles = "OpenStreetMap"    #to run german maps
        profile = "driving"
        osrm_url = "https://router.project-osrm.org"
        show_straight = False
        max_workers = 6

    args = _Args()
    for k, v in kwargs.items():
        setattr(args, k.replace("-", "_"), v)

    fig = build_maps_mt(collection, database, args, mode=mode, input_gpx=input_gpx, max_workers=getattr(args, "max_workers", 6))
    fig.save(args.output_html)
    print(f"Map written to: {args.output_html}")
    return args.output_html


def main(collection: Optional[str] = None, database: Optional[str] = None) -> None:
    ap = argparse.ArgumentParser(description="MT GPX → Folium maps with KPI overlays.")
    ap.add_argument("--input_gpx")
    ap.add_argument("--output_html", default=r"\\192.168.10.182\Public\#SERVICE DIVISION PROJECT FOLDER\COSMOTE 2026 H1\OUTPUT_MAPS\output.html")
    ap.add_argument("--tiles", default="OpenStreetMap")
    ap.add_argument("--profile", default="driving")
    ap.add_argument("--osrm-url", default="https://router.project-osrm.org")
    ap.add_argument("--show-straight", action="store_true")
    ap.add_argument("--collection")
    ap.add_argument("--database")
    ap.add_argument("--mode", choices=["all", "free", "gsm"], default="all")
    ap.add_argument("--max-workers", type=int, default=6)

    args = ap.parse_args([] if (collection and database) else None)

    coll = collection or args.collection
    db = database or args.database
    if not coll or not db:
        raise SystemExit("Both --collection and --database are required.")

    # Use kwargs to override
    run_for_collection(
        coll, db,
        mode=args.mode,
        input_gpx=args.input_gpx,
        output_html=args.output_html,
        tiles=args.tiles,
        profile=args.profile,
        osrm_url=getattr(args, "osrm_url", "https://router.project-osrm.org"),
        show_straight=args.show_straight,
        max_workers=args.max_workers,
    )


if __name__ == "__main__":
    main()
